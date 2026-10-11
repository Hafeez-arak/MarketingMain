// ─── Wording that varies per prospect ──────────────────────────────────────
// Two hundred copies of the same email, word for word, is the pattern spam
// filters look for, and it reads like a mail-merge to anyone who compares. So
// an outreach email can carry choices, written the way every cold-email tool
// writes them (spintax):
//
//   {Hi|Hello|Good morning} {{first_name|there}},
//   {I noticed|I saw} that {{company}} is {moving into|starting} fit-out.
//
// Each {a|b|c} becomes ONE of its options. Which one is decided by a seed
// (the campaign, the step and the prospect), never by chance, so:
//
//   • the preview of a prospect is exactly what that prospect is sent,
//   • a send retried after a crash says the same words,
//   • two prospects usually get different wordings.
//
// Single braces are choices; double braces stay merge tags ({{first_name}}),
// and a merge tag may sit inside a choice: {Hi {{first_name}}|Hello}.
// Choices may nest: {Thanks|{Many|Big} thanks}.
//
// And A/B versions: a campaign's first email may have up to two more
// versions (B, C) with their own subject and body. Each prospect is given one
// for good, also by seed, and the campaign page compares their reply rates.

export const MAX_VERSIONS = 3          // A plus up to two more
const MAX_DEPTH = 5

// A choice: a single { (not part of {{ }}), options separated by |, a single }.
// Inside, plain text or whole {{merge tags}}; no other braces (those are
// inner choices, resolved first).
const CHOICE = /(?<!\{)\{(?!\{)((?:[^{}]|\{\{[^{}]*\}\})*)\}/g

/**
 * A stable number from a string: FNV-1a, then MurmurHash3's finaliser. The
 * finaliser matters: FNV's lowest bit is only the parity of the input, so
 * `% 2` without it split eight prospects 0/8 between two versions.
 */
export function hash(str) {
  let h = 0x811c9dc5
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * Split a choice's inside on the | that belong to it: not those inside a
 * {{merge tag|fallback}}, nor inside an inner {choice}.
 */
function options(inside) {
  const out = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < inside.length; i++) {
    if (inside.startsWith('{{', i)) {
      const c = inside.indexOf('}}', i + 2)
      const end = c < 0 ? inside.length : c + 2
      cur += inside.slice(i, end)
      i = end - 1
      continue
    }
    const ch = inside[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (ch === '|' && !depth) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

/**
 * Resolve every {a|b} choice in `text` with `seed`. A brace pair with no |
 * inside is not a choice and is left as written (coldProblems flags it).
 */
export function spin(text, seed = '') {
  let out = String(text ?? '')
  if (!out.includes('|')) return out
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    let n = 0
    let changed = false
    out = out.replace(CHOICE, (whole, inside) => {
      const opts = options(inside)
      if (opts.length < 2) return whole
      changed = true
      return opts[hash(`${seed}#${n++}#${inside}`) % opts.length]
    })
    if (!changed) break
  }
  return out
}

/**
 * Top-level choices in `text`, each as its list of options (which may hold
 * further choices). Merge tags are skipped over; an unclosed brace ends it.
 */
function topChoices(text) {
  const src = String(text ?? '')
  const out = []
  const skipTag = at => { const c = src.indexOf('}}', at + 2); return c < 0 ? src.length : c + 2 }
  for (let i = 0; i < src.length; i++) {
    if (src.startsWith('{{', i)) { i = skipTag(i) - 1; continue }
    if (src[i] !== '{') continue
    let depth = 1
    let j = i + 1
    while (j < src.length && depth) {
      if (src.startsWith('{{', j)) { j = skipTag(j); continue }
      if (src[j] === '{') depth++
      else if (src[j] === '}') depth--
      j++
    }
    if (depth) break
    out.push(options(src.slice(i + 1, j - 1)))
    i = j - 1
  }
  return out
}

/** How many different wordings a text can come out as (capped for display). */
export function wordingCount(text, cap = 1_000_000, depth = 0) {
  if (depth > MAX_DEPTH) return 1
  let total = 1
  for (const opts of topChoices(text)) {
    const n = opts.length < 2 ? 1 : opts.reduce((sum, o) => sum + wordingCount(o, cap, depth + 1), 0)
    total = Math.min(cap, total * n)
  }
  return total
}

/**
 * Why the choices in `text` cannot be sent, or ''. Catches a choice left
 * open, a stray brace, and {single} braces with no options (which would be
 * sent exactly as typed).
 */
export function spinProblem(text) {
  const src = String(text ?? '')
  // What is left after every choice and merge tag is taken out.
  let rest = src
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const next = rest.replace(CHOICE, (whole, inside) => (options(inside).length < 2 ? '\u0000' : 'x'))
    if (next === rest) break
    rest = next
  }
  if (rest.includes('\u0000')) return 'A {…} with only one option: add a second option after a |, or remove the braces.'
  rest = rest.replace(/\{\{[^{}]*\}\}/g, '')
  if (/[{}]/.test(rest)) return 'A {…|…} choice is not closed: every { needs its }.'
  return ''
}

/** The seed for one prospect's wording of one step of one campaign. */
export function spinSeed(campaignId, step, contact) {
  return `${campaignId || 'new'}:${Number(step) || 0}:${contact?.id || contact?.email || ''}`
}

/**
 * Which version of the first email a prospect gets: 0 = A, 1 = B, 2 = C.
 * @param {number} versions  how many versions the campaign has (1–3)
 */
export function pickVersion(campaignId, contactId, versions) {
  const n = Math.max(1, Math.min(MAX_VERSIONS, Number(versions) || 1))
  return n === 1 ? 0 : hash(`${campaignId}|${contactId}|version`) % n
}

/** The extra versions that are actually written (subject or body set). */
export function versionsOf(campaign) {
  const extra = Array.isArray(campaign?.variants) ? campaign.variants : []
  return extra.slice(0, MAX_VERSIONS - 1)
}

/** Version letter for display. */
export const versionLetter = i => String.fromCharCode(65 + (Number(i) || 0))

/**
 * How each version of the first email did, from a campaign's send rows. A
 * prospect belongs to the version of their first email; a reply or sign-up
 * on any of their emails (a follow-up, too) counts for that version.
 * @param {Array} sends   rows with contact_id, step, variant, sent_at, replied_at, subscribed_at, bounced_at
 * @param {number} versions  how many versions the campaign has
 */
export function versionResults(sends, versions) {
  const n = Math.max(1, Math.min(MAX_VERSIONS, Number(versions) || 1))
  const out = Array.from({ length: n }, (_, i) => ({ version: i, letter: versionLetter(i), prospects: 0, sent: 0, replied: 0, subscribed: 0, bounced: 0 }))
  const versionOf = new Map()
  for (const s of sends || []) if (s.step === 0 && s.contact_id) versionOf.set(s.contact_id, Math.min(n - 1, Math.max(0, Number(s.variant) || 0)))
  const replied = new Set()
  const subscribed = new Set()
  for (const s of sends || []) {
    const v = versionOf.get(s.contact_id)
    if (v === undefined) continue
    if (s.replied_at) replied.add(s.contact_id)
    if (s.subscribed_at) subscribed.add(s.contact_id)
    if (s.step === 0) {
      out[v].prospects++
      if (s.sent_at) out[v].sent++
      if (s.bounced_at) out[v].bounced++
    }
  }
  for (const id of replied) out[versionOf.get(id)].replied++
  for (const id of subscribed) out[versionOf.get(id)].subscribed++
  return out
}
