// ─── Is the company named when a buyer asks an AI assistant? ───────────────
//
// GEO's measure. Search Console says where we rank on Google; nothing said
// whether ChatGPT, Gemini or Claude NAME us when a buyer asks "who designs
// lighting in Riyadh?" — and on arak-sa.com the AI assistants were already
// sending one visit for every four Google sent. This asks a fixed list of
// buyer questions through a model with live web search, the way an assistant
// would answer them, and records three things per answer: were we named, was
// our site cited, and who was named instead.
//
// The prompt never mentions the company. A question that says "is ARAK a good
// lighting company?" measures nothing; the point is what an assistant says to
// someone who has never heard of us.
//
// This module is PURE: the prompt, the matching and the arithmetic. The model
// call and the database live in server/agentHandlers/aiAnswers.js.

const str = v => String(v ?? '').trim()

/** Questions per check. Each one is a paid model call with web search. */
export const MAX_QUESTIONS = 20

/** Web searches each answer may make. An assistant answering a buyer looks a few things up, not twenty. */
export const SEARCHES_PER_ANSWER = 3

/**
 * The configured questions, cleaned: the Brand Brain textarea `ai_questions`
 * (one per line) or a list. Blank lines and repeats dropped, at most
 * MAX_QUESTIONS kept, in the order they were written.
 */
export function aiQuestions(raw) {
  const list = Array.isArray(raw) ? raw : str(raw).split(/\r?\n/)
  const seen = new Set()
  const out = []
  for (const item of list) {
    const q = str(item).replace(/\s+/g, ' ')
    const key = q.toLowerCase()
    if (!q || seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length === MAX_QUESTIONS) break
  }
  return out
}

/** Who the model is told it is. Deliberately an ordinary assistant. */
export const ANSWER_IDENTITY =
  'You are a helpful AI assistant with web search, answering a question from a buyer. ' +
  'Search the web, then answer the way a good general-purpose assistant would.'

/**
 * The question as a buyer would put it, with only the context any assistant
 * would infer anyway: they are in Saudi Arabia. Named companies are asked for
 * because that is what a buyer wants, and what this measures.
 */
export function answerPrompt(question, { country = 'Saudi Arabia' } = {}) {
  return [
    `A buyer in ${country} asks:`,
    '',
    str(question),
    '',
    'Answer them directly. Where it helps, name specific companies, products or sources, ' +
    'and say briefly why each is worth considering. Answer in the language of the question. ' +
    'Keep it under 250 words.',
  ].join('\n')
}

// Letters and digits in any script. A plain \b does not work for Arabic, and
// "arak" must not match "Araki" or "barakah".
const EDGE = '[\\p{L}\\p{N}]'
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where `term` first appears in `text` as a whole word, or -1. */
export function firstMention(text, term) {
  const t = str(term)
  if (!t) return -1
  const m = new RegExp(`(?<!${EDGE})${escape(t)}(?!${EDGE})`, 'iu').exec(str(text))
  return m ? m.index : -1
}

/** Earliest whole-word mention of any of the names, or -1. */
function earliest(text, names = []) {
  let at = -1
  for (const n of names) {
    const i = firstMention(text, n)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  return at
}

/** `https://www.arak-sa.com/x` → `arak-sa.com`. */
export function hostOf(url) {
  try {
    return new URL(str(url)).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * One answer, scored.
 *
 * `rank` is our place among the companies the answer names, by first mention:
 * 1 means we were the first company the buyer read about. Only the brand and
 * the configured competitors count as companies, so it is "1st of the names we
 * track", stated as such on screen, never "1st in Saudi Arabia".
 *
 * `cited` is our own site among the answer's sources, which is what earns the
 * click; being named without a link is visibility, not traffic.
 */
export function scoreAnswer({ text = '', sources = [], brandTerms = [], site = '', competitors = [] } = {}) {
  const ourAt = earliest(text, brandTerms)
  const named = ourAt >= 0
  const rivals = competitors
    .map(name => ({ name, at: firstMention(text, name) }))
    .filter(r => r.at >= 0)
    .sort((a, b) => a.at - b.at)
  const ourHost = hostOf(site.startsWith('http') ? site : `https://${str(site).replace(/^sc-domain:/, '')}`)
  const hosts = [...new Set(sources.map(hostOf).filter(Boolean))]
  return {
    named,
    rank: named ? rivals.filter(r => r.at < ourAt).length + 1 : null,
    cited: !!ourHost && hosts.some(h => h === ourHost || h.endsWith(`.${ourHost}`)),
    competitors: rivals.map(r => r.name),
    sources: hosts.slice(0, 10),
  }
}

/** Count `key` values across rows, most frequent first. */
function tally(rows, pick) {
  const by = new Map()
  for (const r of rows) for (const v of pick(r)) by.set(v, (by.get(v) || 0) + 1)
  return [...by].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

/**
 * One check, summarised. Answers that failed are counted apart and kept out
 * of every share: a question the model never answered is not a question where
 * we were left out.
 */
export function checkSummary(rows = []) {
  const answered = rows.filter(r => !r.error)
  const named = answered.filter(r => r.named).length
  const cited = answered.filter(r => r.cited).length
  return {
    asked: rows.length,
    answered: answered.length,
    failed: rows.length - answered.length,
    named,
    cited,
    namedShare: answered.length ? (named / answered.length) * 100 : 0,
    citedShare: answered.length ? (cited / answered.length) * 100 : 0,
    rivals: tally(answered, r => r.competitors || []),
    sources: tally(answered, r => r.sources || []).slice(0, 8),
    cost: rows.reduce((n, r) => n + (Number(r.cost_usd) || 0), 0),
  }
}

/**
 * Stored rows (newest first, any number of checks) grouped into checks, newest
 * first. A check is every row sharing a run_id.
 */
export function groupChecks(rows = []) {
  const by = new Map()
  for (const r of rows) {
    const list = by.get(r.run_id) || []
    list.push(r)
    by.set(r.run_id, list)
  }
  return [...by.values()]
    .map(list => ({ runId: list[0].run_id, checkedAt: list[0].checked_at, rows: list, summary: checkSummary(list) }))
    .sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt)))
}

/**
 * Per question, this check against the last one that asked it. "Newly named"
 * and "dropped" are the movements worth a sentence; everything else is noise
 * between two runs of a model.
 */
export function questionMoves(current = [], previous = []) {
  const before = new Map(previous.filter(r => !r.error).map(r => [str(r.question).toLowerCase(), r]))
  return current.map(r => {
    const was = before.get(str(r.question).toLowerCase())
    let move = 'new'
    if (r.error) move = 'failed'
    else if (was) move = r.named === was.named ? 'same' : r.named ? 'gained' : 'lost'
    return { ...r, move }
  })
}

/**
 * The sources an answer shows its reader: the citations on its text blocks,
 * in order. Those are the links an assistant prints under its answer, so they
 * are what "cited" means. Only when an answer cites nothing does this fall
 * back to every result its searches returned, and says so with `fromSearch`.
 */
export function answerSources(response) {
  const content = Array.isArray(response?.content) ? response.content : []
  const cited = []
  for (const block of content) {
    if (block?.type !== 'text') continue
    for (const c of block.citations || []) if (c?.url && !cited.includes(c.url)) cited.push(c.url)
  }
  if (cited.length) return { urls: cited, fromSearch: false }
  const searched = []
  for (const block of content) {
    if (block?.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue
    for (const r of block.content) if (r?.url && !searched.includes(r.url)) searched.push(r.url)
  }
  return { urls: searched, fromSearch: true }
}
