// ─── Reading the assistant's answer as Markdown ─────────────────────────────
// The model answers in Markdown — bold, bullets, the odd table — and the chat
// used to print that verbatim, so a careful answer arrived looking like source
// code: `**Instagram evidence**`, `- Cadence up`, literal backticks.
//
// This is a deliberately small subset rather than a library. It covers what
// the model actually writes, it returns plain data (the component turns that
// into React elements, so there is no HTML string and nothing to sanitise),
// and it has to survive streaming: an answer is parsed again on every delta,
// so a half-written `**bold` must render as text, not swallow the rest.

const FENCE = /^\s*(```|~~~)/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const BULLET = /^(\s*)[-*+•]\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function splitRow(line) {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  return row.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
}

function listItem(line) {
  const b = BULLET.exec(line)
  // A rule like `---` or `* * *` is not a one-item list.
  if (b && !RULE.test(line)) return { ordered: false, indent: b[1].length, text: b[2] }
  const o = ORDERED.exec(line)
  if (o) return { ordered: true, indent: o[1].length, start: Number(o[2]), text: o[3] }
  return null
}

/**
 * Split Markdown into blocks.
 *
 * @param {string} text
 * @returns {Array<
 *   {type:'heading', level:number, text:string} |
 *   {type:'paragraph', text:string} |
 *   {type:'list', ordered:boolean, start:number, items:Array<{text:string, depth:number}>} |
 *   {type:'code', text:string} |
 *   {type:'quote', text:string} |
 *   {type:'table', header:string[], rows:string[][]} |
 *   {type:'rule'}
 * >}
 */
export function parseBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let para = []

  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: para.join('\n') })
    para = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (FENCE.test(line)) {
      flush()
      const marker = FENCE.exec(line)[1]
      const body = []
      // An unclosed fence runs to the end, which is what a fence still being
      // streamed looks like.
      for (i++; i < lines.length && !lines[i].trim().startsWith(marker); i++) body.push(lines[i])
      blocks.push({ type: 'code', text: body.join('\n') })
      continue
    }

    if (!line.trim()) { flush(); continue }

    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      continue
    }

    if (RULE.test(line)) { flush(); blocks.push({ type: 'rule' }); continue }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush()
      const header = splitRow(line)
      const rows = []
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(splitRow(lines[i]))
      i--
      blocks.push({ type: 'table', header, rows })
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      flush()
      const body = [quote[1]]
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1])) body.push(QUOTE.exec(lines[++i])[1])
      blocks.push({ type: 'quote', text: body.join('\n') })
      continue
    }

    const item = listItem(line)
    if (item) {
      flush()
      // Continue the list directly above — including across a blank line, which
      // models put between items about as often as not; splitting there would
      // make ordered lists restart at 1. A nested item of the other kind (a
      // bullet under "1.") stays in its parent list too.
      const prev = blocks[blocks.length - 1]
      const list = prev?.type === 'list' && (prev.ordered === item.ordered || item.indent > prev.base)
        ? prev
        : { type: 'list', ordered: item.ordered, start: item.start || 1, items: [], base: item.indent }
      if (list !== prev) blocks.push(list)

      list.items.push({ text: item.text, depth: item.indent > list.base ? Math.min(3, Math.ceil((item.indent - list.base) / 2)) : 0 })
      // Lazy continuation: an indented line that is not itself an item belongs
      // to the item above it.
      while (i + 1 < lines.length && lines[i + 1].trim() && /^\s+/.test(lines[i + 1]) && !listItem(lines[i + 1])) {
        list.items[list.items.length - 1].text += '\n' + lines[++i].trim()
      }
      continue
    }

    // An unindented line straight under a list starts a paragraph rather than
    // extending the last item — which is how the model uses it.
    para.push(line.trim())
  }
  flush()

  for (const b of blocks) if (b.type === 'list') delete b.base
  return blocks
}

// Order matters: code spans first so nothing inside backticks is read as
// emphasis — `ig_status: not_found` must stay one literal token.
const INLINE = new RegExp([
  /(`+)([^`]|[^`][\s\S]*?[^`])\1/.source,                         // 1,2 code
  /\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)/.source,                     // 3   strong
  /(?<![\w_])__(?=\S)([\s\S]*?\S)__(?![\w_])/.source,            // 4   strong
  /(?<![*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/.source,    // 5   em
  /(?<![\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/.source,      // 6   em
  /~~(?=\S)([\s\S]*?\S)~~/.source,                               // 7   strike
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.source,               // 8,9 link
  /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/.source,             // 10  bare url
].join('|'), 'g')

/**
 * Split a line of Markdown into inline tokens.
 *
 * @param {string} text
 * @returns {Array<{type:'text'|'code', text:string} | {type:'strong'|'em'|'strike', children:Array} | {type:'link', href:string, children:Array}>}
 */
export function parseInline(text) {
  const src = String(text ?? '')
  const out = []
  let last = 0
  const push = t => {
    if (!t) return
    const prev = out[out.length - 1]
    if (prev?.type === 'text') prev.text += t
    else out.push({ type: 'text', text: t })
  }

  // A fresh regex per call: this function recurses into bold and links, and a
  // shared global regex would have its lastIndex reset by the inner call —
  // which loops the outer one forever.
  const re = new RegExp(INLINE)
  let m
  while ((m = re.exec(src))) {
    push(src.slice(last, m.index))
    if (m[2] !== undefined) out.push({ type: 'code', text: m[2].replace(/^ (.*) $/, '$1') })
    else if (m[3] !== undefined) out.push({ type: 'strong', children: parseInline(m[3]) })
    else if (m[4] !== undefined) out.push({ type: 'strong', children: parseInline(m[4]) })
    else if (m[5] !== undefined) out.push({ type: 'em', children: parseInline(m[5]) })
    else if (m[6] !== undefined) out.push({ type: 'em', children: parseInline(m[6]) })
    else if (m[7] !== undefined) out.push({ type: 'strike', children: parseInline(m[7]) })
    else if (m[8] !== undefined) out.push({ type: 'link', href: m[9], children: parseInline(m[8]) })
    else if (m[10] !== undefined) out.push({ type: 'link', href: m[10], children: [{ type: 'text', text: m[10] }] })
    last = re.lastIndex
  }
  push(src.slice(last))
  return out
}
