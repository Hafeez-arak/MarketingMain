// ─── Business lines ────────────────────────────────────────────────────────
//
// A brand that sells two different things to two different buyers needs every
// finding to know which of the two it belongs to. Arak sells lighting, which
// architects and lighting designers specify, and controls, which MEP and ELV
// consultants specify and the main contractor buys. The rivals barely overlap
// and neither report reads properly when the two are mixed.
//
// ── THE LINE IS STAMPED IN CODE, NEVER ASKED OF A MODEL ──
//
// It is derived from something factual — the landing page a search resolved
// to, the watchlist entry a competitor matches — against lines the brand
// itself configured. Nothing here knows what lighting is: `LINE_WORDS` does
// not exist, and the patterns come from `customFields.business_lines`, so the
// same code serves a tailoring business without a line of change.
//
// An unclassified finding carries ''. That is honest. A finding filed under
// the wrong business is worse than an unfiled one, because someone acts on it.

const str = v => String(v ?? '').trim()
const lower = v => str(v).toLowerCase()

/**
 * Parse the brand's own configuration.
 *
 *     key | Label | pattern, pattern, pattern
 *
 * A pattern starting with "/" is a URL path; anything else is matched against
 * text. Lenient on purpose — this is typed by a person into a text field.
 */
export function parseLines(text) {
  return str(text)
    .split('\n')
    .map(row => {
      const [key, label, patterns] = row.split('|').map(s => str(s))
      if (!key) return null
      const parts = (patterns || '').split(',').map(s => lower(s)).filter(Boolean)
      return {
        key: key.toLowerCase().replace(/\s+/g, '_'),
        label: label || key,
        paths: parts.filter(p => p.startsWith('/')),
        words: parts.filter(p => !p.startsWith('/')),
      }
    })
    .filter(Boolean)
}

/** The first line whose words appear in this text, or ''. */
export function lineFromWords(text, lines = []) {
  const hay = lower(text)
  if (!hay) return ''
  for (const l of lines) {
    if ((l.words || []).some(w => w && hay.includes(w))) return l.key
  }
  return ''
}

/**
 * Which business line a finding belongs to.
 *
 * Two sources, in order of how much they can be trusted:
 *
 *   1. THE FINDING'S OWN WORDS, against the brand's configured patterns. A
 *      finding that says KNX is about controls whoever it is about.
 *   2. THE COMPETITOR IT NAMES — but only when that competitor sells into
 *      exactly ONE line. Al Nasser and Nassli are in both, so their name
 *      settles nothing, and guessing from a rival who straddles is precisely
 *      how a controls finding ends up on the lighting board.
 *
 * Returns '' when neither answers. `search` findings already carry a line
 * stamped from the landing page they resolved to, which is stronger evidence
 * than either of these, so an existing value is never overwritten.
 */
export function lineForFinding(f = {}, { lines = [], watchlist = [] } = {}) {
  if (str(f.line)) return str(f.line)
  if (!lines.length) return ''

  const fromText = lineFromWords(
    [f.headline, f.detail, f.suggested_action, f.category].filter(Boolean).join(' '),
    lines,
  )
  if (fromText) return fromText

  const name = lower(f.competitor)
  if (!name) return ''
  const rival = watchlist.find(c => lower(c.subject || c.name) === name)
  const rivalLines = (rival?.lines || []).filter(Boolean)
  return rivalLines.length === 1 ? str(rivalLines[0]) : ''
}

/** Stamp a whole run's findings. Returns new objects; nothing is mutated. */
export function stampLines(findings = [], opts = {}) {
  return (findings || []).map(f => ({ ...f, line: lineForFinding(f, opts) }))
}
