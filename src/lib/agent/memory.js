// ─── What the agent remembers ──────────────────────────────────────────────
// Pure. No network, no database, no clock it did not receive as an argument.
//
// ── THE PROBLEM THIS EXISTS FOR ──
//
// Two consecutive live runs proposed, with no awareness of each other:
//
//   Run 1:  "Inside our Riyadh partner floor: 20+ certified brands, one room"
//           "The guest turns one dial and the room answers"
//   Run 2:  "Ritz Carlton Riyadh — what a luxury hospitality fit-out requires"
//           "KNX and GRMS: what hotel operators are actually specifying"
//
// Both sets are fine. The problem is that run 3 would cheerfully propose them
// again, because they were written into a jsonb blob on `research_runs` that
// nothing ever reads back. An agent that cannot remember what it already said
// converges on the same safe, generic advice every week, and the person stops
// reading it.
//
// ── THE TWO HALVES, AND WHY BOTH ──
//
// A digest carried in the prompt tells the model what it already said. That is
// necessary and not sufficient: a model told "do not repeat these" will still
// occasionally rephrase one. So there is also `isRepeat()`, which runs in code
// over a normalised fingerprint and cannot be talked out of its answer. The
// prompt is the polite request; the fingerprint is the enforcement. This
// codebase's whole pattern is that a guarantee held only by a prompt is not a
// guarantee.
//
// ── THE CONSTRAINT THAT SHAPES EVERYTHING ELSE ──
//
// The digest rides inside the CACHED system block (see prompt.js). Cached
// reads cost roughly a tenth of fresh input, so ~1,200 tokens of memory is
// genuinely negligible — but only while the bytes stay stable. A digest
// rewritten on every message turns a cached prefix into a fresh one every
// turn, at ~10x on the whole prefix, and nothing in the response says so.
//
// Hence: the digest is rebuilt on a SLOW cadence and is byte-stable between
// rebuilds. Anything newer rides as a small volatile tail on the user turn.

/** Note kinds. Must match the CHECK constraint in docs/memory-schema.sql. */
export const NOTE_KINDS = [
  'idea_proposed',
  'idea_outcome',
  'correction',
  'constraint',
  'fact',
  'question_asked',
  'run_headline',
]

/**
 * How long each kind stays interesting, in days.
 *
 * `null` means it never expires on its own. Corrections and constraints are
 * standing law — a person who said "never use discount language" has not
 * withdrawn it just because a month passed, and quietly forgetting it is worse
 * than any amount of staleness elsewhere.
 */
export const KIND_TTL_DAYS = {
  correction: null,
  constraint: null,
  idea_proposed: 120,
  idea_outcome: 180,
  fact: 90,
  question_asked: 60,
  run_headline: 45,
}

/**
 * Compaction priority. Higher survives.
 *
 * Deliberately not "most recent wins". A constraint from three months ago
 * outranks a run headline from Tuesday, because breaking a standing
 * instruction is a real failure and forgetting last week's headline is not.
 */
export const KIND_WEIGHT = {
  correction: 100,
  constraint: 95,
  idea_proposed: 70,
  idea_outcome: 60,
  fact: 45,
  question_asked: 30,
  run_headline: 20,
}

/**
 * Words that carry no identity, so two ideas are not "different" because of
 * them.
 *
 * Written in plain English and stemmed at load (see STOPWORDS below), because
 * a list holding "showcase" while the stemmer produces "showcas" silently
 * stops filtering — the kind of mismatch that looks like it works.
 */
const STOPWORD_SOURCE = [
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'with', 'from', 'into', 'about', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those', 'we', 'our',
  'us', 'you', 'your', 'they', 'their', 'how', 'what', 'why', 'when', 'which',
  'can', 'could', 'should', 'would', 'will', 'do', 'does', 'did', 'not', 'no',
  // Marketing filler that appears in almost every idea and would otherwise
  // inflate similarity between genuinely different ones.
  'post', 'content', 'piece', 'create', 'show', 'showcase', 'highlight', 'feature',
  'actually', 'really', 'about',
]

/**
 * One token, reduced to its comparable core.
 *
 * Punctuation goes first ("20+" and "20" are the same claim), then a light
 * suffix strip. The stemming is deliberately crude — it exists to survive the
 * specific rewrites a model produces when told not to repeat itself, which are
 * overwhelmingly tense and plural changes: "specifying" for "specify",
 * "operators" for "operator", "showcasing" for "showcase". A full stemmer
 * would merge more aggressively and start colliding genuinely different ideas,
 * which is the more expensive error.
 */
function normaliseToken(t) {
  let word = t.replace(/[^a-z0-9]/g, '')
  if (word.length <= 4) return word

  for (const suffix of ['ingly', 'edly', 'ing', 'ed', 'es', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      word = word.slice(0, -suffix.length)
      // "planning" -> "plann" -> "plan".
      if (/([a-z])\1$/.test(word)) word = word.slice(0, -1)
      break
    }
  }

  // The step that makes the two directions agree. Without it "showcase" stays
  // whole while "showcasing" becomes "showcas", and the pair never matches —
  // which defeats the point, since the -ing form is exactly the rewrite a
  // model reaches for.
  if (word.length > 4 && word.endsWith('e')) word = word.slice(0, -1)

  return word
}

/**
 * The stopword set, passed through the same stemmer as real tokens so the two
 * cannot drift apart.
 */
const STOPWORDS = new Set(STOPWORD_SOURCE.map(normaliseToken))

/**
 * The comparable form of a piece of text.
 *
 * Lowercased, punctuation stripped, stopwords removed, remaining tokens sorted
 * and de-duplicated. Sorting is what makes word ORDER irrelevant: "what hotel
 * operators specify about KNX" and "KNX: what operators specify" must collide,
 * or the duplicate check is defeated by a rewrite — which is exactly what a
 * model asked not to repeat itself will produce.
 */
export function fingerprint(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .split(/[\s—–—–\-_/,.:;!?()[\]{}'"]+/)
      .map(normaliseToken)
      .filter(t => t.length > 2 && !STOPWORDS.has(t)),
  )].sort().join(' ')
}

/** The significant-token set, for overlap scoring. */
export function tokensOf(text) {
  return new Set(fingerprint(text).split(' ').filter(Boolean))
}

/**
 * Jaccard overlap of two texts, 0 to 1.
 *
 * Two empty texts score 0, not 1. An empty idea is not "identical to" another
 * empty idea in any sense a caller wants — returning 1 would silently suppress
 * every blank-bodied note as a duplicate of the first one.
 */
export function similarity(a, b) {
  const A = tokensOf(a)
  const B = tokensOf(b)
  if (!A.size || !B.size) return 0
  let shared = 0
  for (const t of A) if (B.has(t)) shared += 1
  return shared / (A.size + B.size - shared)
}

/**
 * Above this overlap, two ideas are the same idea wearing different words.
 *
 * Measured, not guessed. Scored over the five real ideas from the two live
 * runs above, against hand-written rewrites of each:
 *
 *   lowest score between an idea and a rewrite of itself   0.714
 *   highest score between two genuinely different ideas    0.167
 *
 * 0.6 sits in the middle of that gap with room on both sides. If a future
 * change narrows the margin, the test that asserts this separation should fail
 * before anything reaches production.
 *
 * Erring LOW would suppress good new ideas, which is the more expensive
 * mistake: a repeat is annoying and visible, a suppressed idea is invisible.
 */
export const REPEAT_AT = 0.6

/**
 * Has this been proposed before?
 *
 * Returns the matching note, or null. Exact fingerprint equality is checked
 * first because it is cheap and certain; overlap is the fallback that catches
 * rewordings.
 *
 * @param {string} candidate
 * @param {Array}  priorNotes  notes with { body, fingerprint, ... }
 * @param {number} threshold
 */
export function isRepeat(candidate, priorNotes = [], threshold = REPEAT_AT) {
  const fp = fingerprint(candidate)
  if (!fp) return null

  for (const note of priorNotes) {
    if ((note?.fingerprint || fingerprint(note?.body)) === fp) return note
  }
  let best = null
  let bestScore = 0
  for (const note of priorNotes) {
    const score = similarity(candidate, note?.body)
    if (score > bestScore) { bestScore = score; best = note }
  }
  return bestScore >= threshold ? best : null
}

/**
 * Split proposed items into what is genuinely new and what has been said
 * before.
 *
 * Repeats are RETURNED, not silently dropped, so the brief can say "we already
 * suggested this three weeks ago and nothing happened" — which is more useful
 * to a person than the idea vanishing. An idea quietly disappearing looks
 * identical to the agent never having had it.
 */
export function partitionRepeats(candidates = [], priorNotes = [], threshold = REPEAT_AT) {
  const fresh = []
  const repeats = []
  // Accumulates as we go, so two identical ideas inside ONE run also collide.
  const seen = [...priorNotes]

  for (const c of candidates) {
    const body = typeof c === 'string' ? c : (c?.idea || c?.title || c?.headline || '')
    if (!body.trim()) continue
    const hit = isRepeat(body, seen, threshold)
    if (hit) repeats.push({ candidate: c, body, matched: hit })
    else {
      fresh.push(c)
      seen.push({ body, fingerprint: fingerprint(body) })
    }
  }
  return { fresh, repeats }
}

// ─── Notes ─────────────────────────────────────────────────────────────────

/** A number, or null. `Number(null)` is 0 and `isFinite(0)` is true. */
function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Build one note, normalised and fingerprinted.
 *
 * `expires_at` is computed from the kind rather than passed in, so a caller
 * cannot accidentally give a correction a 30-day life. Pass `expiresAt`
 * explicitly only when the note has a real deadline of its own.
 */
export function makeNote({
  kind, body, source = 'run', sourceId = null, expiresAt, now = new Date(),
}) {
  const text = String(body || '').trim().replace(/\s+/g, ' ')
  const ttl = KIND_TTL_DAYS[kind]
  const computed = ttl == null
    ? null
    : new Date(now.getTime() + ttl * 86_400_000).toISOString()

  return {
    kind: NOTE_KINDS.includes(kind) ? kind : 'fact',
    body: text,
    fingerprint: fingerprint(text),
    source,
    source_id: sourceId,
    status: 'new',
    seen_count: 1,
    expires_at: expiresAt === undefined ? computed : expiresAt,
  }
}

/**
 * Has this note expired?
 *
 * A null `expires_at` means EVERGREEN, not expired. Getting this backwards
 * silently deletes every standing instruction the moment memory is compacted,
 * and nothing would report it.
 */
export function isExpired(note, now = new Date()) {
  if (!note?.expires_at) return false
  const t = new Date(note.expires_at).getTime()
  return Number.isFinite(t) && t < now.getTime()
}

/**
 * Everything worth remembering from one research run.
 *
 * Proposed ideas are the load-bearing part — they are what must never repeat.
 * The headline is kept so the agent can say what it concluded last time.
 * Findings are NOT kept wholesale: they are already in `research_runs.report`
 * and re-recording them here would fill the digest with things that are
 * cheaply re-readable, which is exactly the padding the cap exists to prevent.
 */
export function notesFromRun(report = {}, runId = null, now = new Date()) {
  const notes = []

  for (const idea of report.proposed_ideas || []) {
    const body = typeof idea === 'string' ? idea : (idea?.idea || idea?.title || '')
    if (body.trim()) {
      notes.push(makeNote({ kind: 'idea_proposed', body, source: 'run', sourceId: runId, now }))
    }
  }

  if (String(report.headline || '').trim()) {
    notes.push(makeNote({ kind: 'run_headline', body: report.headline, source: 'run', sourceId: runId, now }))
  }

  // A finding that carries a real expiry is worth keeping as a fact, because
  // "we already know about this" is the answer to a question someone will ask
  // before it expires. Undated findings are not kept — see above.
  for (const f of report.findings || []) {
    if (f?.perishable_until && String(f?.headline || '').trim()) {
      notes.push(makeNote({
        kind: 'fact',
        body: f.headline,
        source: 'run',
        sourceId: runId,
        expiresAt: f.perishable_until,
        now,
      }))
    }
  }

  return notes
}

// ─── Rendering the digest ──────────────────────────────────────────────────

/**
 * Rough token count.
 *
 * Four characters per token is the standard approximation and is close enough
 * for a budget check. It is deliberately an OVER-estimate for text with lots
 * of short words, which is the safe direction: a digest slightly under budget
 * costs nothing, one over it breaks the thing the budget protects.
 */
export function approxTokens(text) {
  return Math.ceil(String(text || '').length / 4)
}

/** The digest's hard ceiling. See the cache note at the top of this file. */
export const DIGEST_TOKEN_BUDGET = 1_200

/** Days since a note was created, for the "3 weeks ago" rendering. */
function ageLabel(iso, now) {
  const t = new Date(iso || '').getTime()
  if (!Number.isFinite(t)) return ''
  const days = Math.floor((now.getTime() - t) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}

/**
 * Order notes by what should survive compaction.
 *
 * Kind weight dominates, then how often it has resurfaced, then recency. The
 * middle term is what stops a thing that keeps mattering being dropped in
 * favour of something newer and trivial.
 */
export function rankNotes(notes = [], now = new Date()) {
  return notes
    .filter(n => !isExpired(n, now))
    .map(n => {
      const weight = num(KIND_WEIGHT[n.kind]) ?? 10
      const seen = num(n.seen_count) ?? 1
      const age = new Date(n.created_at || 0).getTime() || 0
      return { note: n, score: weight + Math.min(seen, 5) * 4, age }
    })
    .sort((a, b) => (b.score - a.score) || (b.age - a.age))
    .map(x => x.note)
}

const SECTIONS = [
  {
    kinds: ['idea_proposed'],
    title: 'IDEAS YOU HAVE ALREADY PROPOSED — do not propose these again',
    note: 'If one is still the right answer, say so and say it is a repeat, with what changed.',
  },
  { kinds: ['idea_outcome'], title: 'WHAT HAPPENED TO THEM', note: '' },
  {
    kinds: ['correction', 'constraint'],
    title: 'STANDING INSTRUCTIONS FROM THE TEAM — these override your own judgement',
    note: '',
  },
  { kinds: ['fact'], title: 'WHAT YOU HAVE ESTABLISHED', note: '' },
  { kinds: ['question_asked'], title: 'TOPICS ALREADY COVERED WITH THIS PERSON', note: '' },
  { kinds: ['run_headline'], title: 'WHAT RECENT RUNS CONCLUDED', note: '' },
]

/**
 * Render the notebook that rides in the prompt.
 *
 * Capped by dropping the lowest-ranked notes until it fits — never by
 * truncating mid-text, which would leave a half-sentence instruction that
 * reads as complete. A dropped note is still in `agent_notes`; a mangled one
 * is actively misleading.
 *
 * Returns the text and what it had to leave out, so the caller can record that
 * the cap is biting rather than discovering it from behaviour.
 */
export function renderDigest(notes = [], { budget = DIGEST_TOKEN_BUDGET, now = new Date() } = {}) {
  const ranked = rankNotes(notes, now)

  const header = 'WHAT YOU ALREADY KNOW AND HAVE ALREADY SAID\n' +
    'This is your own memory of previous runs and conversations with this team. ' +
    'Treat it as established. Do not re-derive it, and do not repeat advice you ' +
    'have already given — build on it or say plainly that nothing has changed.\n'

  let kept = ranked
  let dropped = []
  let text = ''

  // Shrink from the bottom of the ranking until it fits. At most as many passes
  // as there are notes, so this terminates even if a single note exceeds the
  // budget on its own.
  for (let i = 0; i <= ranked.length; i += 1) {
    kept = ranked.slice(0, ranked.length - i)
    dropped = ranked.slice(ranked.length - i)
    text = renderSections(kept, header, now)
    if (approxTokens(text) <= budget) break
  }

  return {
    text: kept.length ? text : '',
    approx_tokens: kept.length ? approxTokens(text) : 0,
    kept: kept.length,
    dropped: dropped.length,
  }
}

function renderSections(notes, header, now) {
  const out = [header]
  for (const section of SECTIONS) {
    const rows = notes.filter(n => section.kinds.includes(n.kind))
    if (!rows.length) continue
    out.push(`\n## ${section.title}`)
    if (section.note) out.push(section.note)
    for (const n of rows) {
      const when = ageLabel(n.created_at, now)
      out.push(`- ${n.body}${when ? ` (${when})` : ''}`)
    }
  }
  return out.join('\n')
}

/**
 * The volatile tail: what happened since the digest was last built.
 *
 * This is how "updates on every message" is delivered without breaking the
 * cache. It goes on the USER turn, never into the system block — a few dozen
 * tokens at full price, rather than re-billing the entire cached prefix.
 *
 * Empty string when there is nothing new, so the request bytes do not change
 * on a quiet turn either.
 */
export function freshTail(notes = [], builtThrough = null, { max = 8, now = new Date() } = {}) {
  const cutoff = builtThrough ? new Date(builtThrough).getTime() : 0
  const fresh = notes
    .filter(n => !isExpired(n, now))
    .filter(n => (new Date(n.created_at || 0).getTime() || 0) > cutoff)
    .slice(0, max)

  if (!fresh.length) return ''
  return [
    'Since your memory was last compacted, this also happened:',
    ...fresh.map(n => `- ${n.body}`),
  ].join('\n')
}

/**
 * Should the digest be rebuilt?
 *
 * Rebuilding costs a model call, so it is not done on a whim — but a digest
 * that never rebuilds is just a stale prompt with extra steps.
 */
export function digestIsStale({
  builtThrough = null, latestNoteAt = null, unfoldedCount = 0,
  minNotes = 3, maxAgeDays = 7, now = new Date(),
} = {}) {
  if (unfoldedCount <= 0) return false

  // Enough has piled up to be worth a call.
  if (unfoldedCount >= minNotes) return true

  // Nothing has ever been folded, so even one note is the first memory this
  // workspace has. Build it.
  if (!builtThrough) return true

  // A lone note must not wait forever. Someone who corrected the agent once
  // should not need to correct it twice more before it listens — so age is a
  // trigger in its own right, not just volume.
  const age = now.getTime() - new Date(builtThrough).getTime()
  if (Number.isFinite(age) && age > maxAgeDays * 86_400_000) return true

  void latestNoteAt
  return false
}
