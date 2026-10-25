// ─── Refs are for code, not for readers ────────────────────────────────────
// The synthesis cites by ref — "F3" for this run's finding, "S2" for a stored
// signal, "G1" for its own gap — so code can resolve the cite to the URLs
// behind it (ruleSourceResolver) and file each idea under what it answers
// (bindIdeas). Those refs belong in the structured fields: `refs`, `sources`,
// `answers`.
//
// The model also writes them into its sentences: "Huda is buying showroom
// space (F19, F23, F32)." The page never prints an F, S or G label — its cards
// number themselves 1, 2, 3 — so on 2026-10-25 a reader took F19 to mean
// "project 19" and could not find it. A ref a reader cannot look up is noise
// at best and a false pointer at worst, so it is stripped from every sentence
// a reader sees: in mergeBrief before the report is stored, and again when a
// stored report is rendered, so briefs written before this read cleanly too.
//
// Pure. No imports, so the page can use it without pulling in the prompts.

const TOKEN = '[FSG]\\d{1,3}'
const SEP = '\\s*(?:,|;|/|&|-|–|\\band\\b)\\s*'
const LIST = `${TOKEN}(?:${SEP}${TOKEN})*`
const LEAD = '(?:(?:[Ss]ee(?:\\s+also)?|[Rr]efs?\\.?|[Cc]f\\.?)\\s*:?\\s*)?'

const PATTERNS = [
  // "(F12)", "(F19, F23, F32)", "[S2]", "(see F3 and G2)", "(refs: F3; S1)"
  new RegExp(`\\s*[(\\[]\\s*${LEAD}${LIST}\\s*[)\\]]`, 'g'),
  // A ref list at the end of a longer parenthesis: "(three signals: F3, F7, S2)"
  new RegExp(`\\s*[,;:]\\s*${LEAD}${LIST}(?=\\s*\\))`, 'g'),
  // ...or at its start: "(F3, from the Huda site)"
  new RegExp(`(?<=\\()\\s*${LIST}\\s*[,;:]\\s*`, 'g'),
  // "see F3", ", see F3 and S2", "— see also G2"
  new RegExp(`(?:\\s*[,;]|\\s+[—–-])?\\s*\\b[Ss]ee(?:\\s+also)?\\s+${LIST}\\b`, 'g'),
  // A bare list closing a sentence: "… rising — F19, F23." / "Refs: F3, F4."
  new RegExp(`\\s*(?:[—–:]\\s*|\\b(?:[Rr]efs?|[Ss]ources?)\\s*:\\s*)${LIST}(?=\\s*(?:[.!?;]|$))`, 'g'),
]

const TOKENS = new RegExp(TOKEN, 'g')

/**
 * Remove ref citations from one sentence.
 *
 * F and S refs are always removed. A G ref is removed only when it is one of
 * this brief's gap ids: G4 and G9 are also lamp bases, and "capsule lamps (G4)"
 * in a lighting brief is a product, not a cite.
 *
 * @param {string} text
 * @param {{ gapIds?: Iterable<string> }} [opts] the brief's gap ids; when
 *   omitted, no G ref is treated as a cite.
 * @returns {string}
 */
export function stripRefs(text, { gapIds } = {}) {
  if (typeof text !== 'string' || !/[FSG]\d/.test(text)) return text
  const gaps = new Set([...(gapIds || [])].map(g => String(g || '').trim().toUpperCase()))
  const isCite = match => (match.match(TOKENS) || []).every(t => t[0] !== 'G' || gaps.has(t))

  let out = text
  for (const re of PATTERNS) out = out.replace(re, m => (isCite(m) ? '' : m))
  if (out === text) return text
  return out
    .replace(/([,;])\s*[,;]/g, '$1')
    .replace(/\s+([.,;:!?)])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

// Fields that are pointers or names, never prose. Arrays (`refs`, `sources`,
// `cited`) and objects (`answers_ref`) are left alone because only direct
// string values are touched.
const STRUCTURAL = new Set(['id', 'claimed_id', 'ref', 'answers', 'source_url', 'url', 'competitor', 'name', 'handle'])

// Every section of a stored report a reader sees as sentences.
const PROSE_SECTIONS = [
  'top_three', 'competitor_moves', 'new_competitors', 'competitor_board', 'market_direction',
  'gaps', 'proposed_rules', 'rules_dropped', 'proposed_ideas', 'agenda_changes', 'unanswered',
]

/**
 * The same report with refs stripped from every reader-facing sentence.
 * Structured fields — refs, sources, answers, ids — are untouched, so source
 * resolution and idea binding work exactly as before.
 */
export function cleanBriefProse(report) {
  if (!report || typeof report !== 'object') return report
  const gapIds = (report.gaps || []).flatMap(g => [g?.id, g?.claimed_id]).filter(Boolean)
  const strip = s => stripRefs(s, { gapIds })
  const cleanItem = item => {
    if (typeof item === 'string') return strip(item)
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const out = { ...item }
    for (const [k, v] of Object.entries(out)) if (typeof v === 'string' && !STRUCTURAL.has(k)) out[k] = strip(v)
    return out
  }

  const out = { ...report }
  if (typeof out.headline === 'string') out.headline = strip(out.headline)
  for (const key of PROSE_SECTIONS) if (Array.isArray(out[key])) out[key] = out[key].map(cleanItem)
  return out
}
