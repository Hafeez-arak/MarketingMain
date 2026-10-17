// ─── Images and PDFs in the chat ───────────────────────────────────────────
// 2026-10-17. Pure — no IO, no DOM — because both halves use it: the browser to
// refuse a file before uploading it, the server (api/agent/chat.js) to refuse
// the same file again, since a browser check is a courtesy and not a boundary.
// The browser-only half (canvas downscaling) is src/lib/chatAttachments.js.
//
// ── HOW AN ATTACHMENT TRAVELS ──
//
//   1. The browser downscales an image to a long edge of 1568px as JPEG — the
//      size past which Anthropic's API downsamples anyway, so anything larger
//      is bytes paid for and thrown away — plus a ~160px thumbnail. A PDF is
//      read as-is, under a size cap.
//   2. Both go in the POST body as base64. Vercel caps a request body at
//      4.5 MB, so the total is held well under it (MAX_TOTAL_BASE64).
//   3. The server sends them to the model as content blocks on THIS turn only:
//      `image` blocks for pictures, a `document` block for a PDF, ahead of the
//      question text.
//   4. What is stored with the message is the name, the type and the tiny
//      thumbnail — never the file. Later turns replay the history from the
//      database, and they replay a one-line note in place of the file.
//
// ── WHY NOT RE-SEND THE FILE EVERY TURN ──
//
// History is rebuilt from research_messages on every request (chat.js never
// trusts a browser-posted history). Storing the base64 there would put
// megabytes in a text table and re-bill every image on every later turn of a
// 40-message window. The model has already described what it saw in its own
// answer, which IS replayed; the note tells it to ask for the file again if it
// needs another look. Uploading to Storage and passing a URL was the other
// option, and it buys back follow-up looks at the price of a bucket, its
// policies and signed-URL expiry — not worth it for how this chat is used.

export const ATTACH_LIMITS = {
  maxCount: 4,
  /** Long edge, px. The API downsamples beyond this, so larger is wasted. */
  maxImageEdge: 1568,
  thumbEdge: 160,
  /** A PDF read raw. Base64 adds a third, so 2.5 MB becomes ~3.3 MB on the wire. */
  maxPdfBytes: 2_500_000,
  /** Every attachment's base64 together. Vercel's body cap is 4.5 MB. */
  maxTotalBase64: 3_800_000,
  /** A stored thumbnail. Anything larger is dropped rather than stored. */
  maxThumbChars: 40_000,
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const DOCUMENT_TYPES = ['application/pdf']

export const kindOf = mediaType =>
  IMAGE_TYPES.includes(mediaType) ? 'image' : DOCUMENT_TYPES.includes(mediaType) ? 'pdf' : ''

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const clean = v => String(v ?? '').trim()

/**
 * Check a list of attachments from a request body and return the usable ones.
 *
 * Returns { ok, attachments, error }. Anything wrong refuses the whole set —
 * silently dropping one of three photos produces an answer about two of them
 * that reads as if it were about all three.
 *
 * @param {Array<{name:string, media_type:string, data:string, thumb?:string}>} list
 */
export function validateAttachments(list) {
  if (list === undefined || list === null) return { ok: true, attachments: [], error: '' }
  if (!Array.isArray(list)) return { ok: false, attachments: [], error: 'attachments must be a list.' }
  if (list.length > ATTACH_LIMITS.maxCount) {
    return { ok: false, attachments: [], error: `At most ${ATTACH_LIMITS.maxCount} attachments per message.` }
  }
  let total = 0
  const out = []
  for (const a of list) {
    const name = clean(a?.name).slice(0, 200) || 'attachment'
    const mediaType = clean(a?.media_type).toLowerCase()
    const kind = kindOf(mediaType)
    if (!kind) return { ok: false, attachments: [], error: `${name}: only images (JPEG, PNG, WebP, GIF) and PDFs can be attached.` }
    const data = clean(a?.data).replace(/^data:[^,]*,/, '')
    if (!data || !BASE64.test(data)) return { ok: false, attachments: [], error: `${name}: the file did not arrive intact.` }
    if (kind === 'pdf' && Math.floor(data.length * 3 / 4) > ATTACH_LIMITS.maxPdfBytes) {
      return { ok: false, attachments: [], error: `${name}: PDFs can be at most ${Math.round(ATTACH_LIMITS.maxPdfBytes / 1e6 * 10) / 10} MB.` }
    }
    total += data.length
    const thumb = clean(a?.thumb)
    out.push({
      name,
      media_type: mediaType,
      kind,
      data,
      thumb: /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(thumb) && thumb.length <= ATTACH_LIMITS.maxThumbChars
        ? thumb : '',
    })
  }
  if (total > ATTACH_LIMITS.maxTotalBase64) {
    return { ok: false, attachments: [], error: 'Those attachments are too large together. Send fewer, or smaller files.' }
  }
  return { ok: true, attachments: out, error: '' }
}

/**
 * The content of the user turn: files first, then the words.
 *
 * Images before text is Anthropic's documented best placement. With nothing
 * attached it stays a plain string, byte-identical to before this feature —
 * a chat turn without a file must not change shape for no reason.
 */
export function userContent(text, attachments = []) {
  if (!attachments?.length) return text
  const blocks = attachments.map(a => (
    a.kind === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name }
      : { type: 'image', source: { type: 'base64', media_type: a.media_type, data: a.data } }
  ))
  return [...blocks, { type: 'text', text }]
}

/** What is stored with the message: enough to show it, never the file. */
export function storedAttachments(attachments = []) {
  return (attachments || []).map(a => ({ name: a.name, media_type: a.media_type, kind: a.kind, thumb: a.thumb || '' }))
}

/**
 * The line that stands in for a file on later turns.
 *
 * Says plainly that the file is NOT in front of the model any more, so it
 * neither pretends to look again nor contradicts what it said the first time.
 */
export function attachmentNote(stored = []) {
  const list = (Array.isArray(stored) ? stored : []).filter(a => a && a.name)
  if (!list.length) return ''
  const named = list.map(a => `${a.name} (${a.kind === 'pdf' ? 'PDF' : 'image'})`).join(', ')
  return `[With this message the person attached: ${named}. The file is not re-sent on later turns; ` +
    'rely on what you said about it at the time, and ask them to attach it again if you need another look.]'
}
