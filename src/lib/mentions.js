// ─── @mentions in the chat box ─────────────────────────────────────────────
// Pure, so the picker's behaviour is tested without a browser. The assistant
// reads "@Shadia" in the message and uses tag_person; nothing else about a
// mention is special.

/**
 * The @word being typed at the caret, if any: { start, query }. A mention
 * starts at the beginning of the text or after whitespace, so an email
 * address ("hafeez@arak") never opens the picker.
 */
export function mentionQuery(text = '', caret = text.length) {
  const before = String(text).slice(0, caret)
  const m = /(^|\s)@([\p{L}\p{N}_.-]{0,30})$/u.exec(before)
  if (!m) return null
  return { start: before.length - m[2].length - 1, query: m[2] }
}

/** People whose name starts with (or contains a word starting with) the query. */
export function matchMentions(people = [], query = '') {
  const q = String(query).toLowerCase()
  return people.filter(p => {
    const n = String(p.name || '').toLowerCase()
    return !q || n.startsWith(q) || n.split(/\s+/).some(w => w.startsWith(q))
  }).slice(0, 6)
}

/** Replace the @query at `start` with "@Name " and return the new text and caret. */
export function insertMention(text = '', start, caret, name) {
  const first = String(name || '').trim().split(/\s+/)[0]
  const label = first ? first.charAt(0).toUpperCase() + first.slice(1) : ''
  const inserted = `@${label} `
  const next = text.slice(0, start) + inserted + text.slice(caret)
  return { text: next, caret: start + inserted.length }
}
