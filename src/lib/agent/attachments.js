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
//      thumbnail, plus (since 2026-11-02) where the original was kept in the
//      private `chat-files` bucket — never the file itself. Later turns replay
//      the history from the database, and they replay a one-line note in place
//      of the file.
//   5. A later question that needs the file again ("look at the PDF again")
//      re-opens it with the get_attachment tool (api/agent/_chatFiles.js):
//      a PDF as the text extracted once at upload, an image as the image.
//
// ── WHY NOT RE-SEND THE FILE EVERY TURN ──
//
// History is rebuilt from research_messages on every request (chat.js never
// trusts a browser-posted history). Storing the base64 there would put
// megabytes in a text table, and re-sending the file would re-bill it on
// every later turn of a 40-message window — a newsletter PDF is ~50k tokens a
// time. The model has already described what it saw in its own answer, which
// IS replayed, and that answers most follow-ups. For the ones it does not,
// the file is a tool call away, paid for only on the turn that needs it, and
// a PDF comes back as its text, which costs a fraction of the PDF.
//
// Storage layout, one folder per thread so a thread's files sit together:
//   chat-files  <workspace>/chat/<chat>/<key>/file.<ext>
//                                       <key>/text.txt   (PDFs only)
// The workspace leads the path so companyFolders() (src/lib/workspaceFiles.js)
// finds them when a company is deleted.

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

export const CHAT_FILES_BUCKET = 'chat-files'

/**
 * Most text get_attachment returns in one call. A long PDF comes back in
 * pages of this size and the model asks for the next with `offset`, so one
 * re-read never costs more than a re-sent PDF would have.
 */
export const MAX_TEXT_CHARS = 40_000

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' }

/** The thread's folder. Everything this chat keeps lives under it. */
export const chatFolder = (workspaceId, chatId) => `${workspaceId}/chat/${chatId}/`

/**
 * Where one original goes. `key` is random per file, chosen by the caller;
 * the person's file name stays on the stored entry and out of the path,
 * because Storage refuses some characters a file name can have.
 */
export function chatFilePath(workspaceId, chatId, key, mediaType) {
  return `${chatFolder(workspaceId, chatId)}${key}/file.${EXT[mediaType] || 'bin'}`
}

/** The extracted text sits next to the PDF it came from. */
export const textPathFor = path => path.replace(/\/[^/]*$/, '/text.txt')

/**
 * Is this path inside this thread's folder? A stored path is ours, not the
 * model's, but the read checks it anyway: a path from another thread or
 * another company must never be fetched with the service key.
 */
export function inChatFolder(path, workspaceId, chatId) {
  const p = String(path || '')
  return Boolean(workspaceId && chatId) && p.startsWith(chatFolder(workspaceId, chatId)) && !p.includes('..')
}

/**
 * What is stored with the message: enough to show it and to find it again,
 * never the file. `saved` is what _chatFiles.js managed to keep, by position;
 * a file it could not keep is stored without a path and its note says so.
 */
export function storedAttachments(attachments = [], saved = []) {
  return (attachments || []).map((a, i) => {
    const entry = { name: a.name, media_type: a.media_type, kind: a.kind, thumb: a.thumb || '' }
    const s = saved?.[i]
    if (s?.path) {
      entry.path = s.path
      if (s.text_path) entry.text_path = s.text_path
      if (s.pages) entry.pages = s.pages
      if (Number.isFinite(s.text_chars)) entry.text_chars = s.text_chars
    }
    return entry
  })
}

const label = a => `${a.name} (${a.kind === 'pdf' ? 'PDF' : 'image'})`

/**
 * The line that stands in for a file on later turns.
 *
 * Says plainly that the file is NOT in front of the model any more, so it
 * neither pretends to look again nor contradicts what it said the first time,
 * and says how to re-open the ones that were kept.
 */
export function attachmentNote(stored = []) {
  const list = (Array.isArray(stored) ? stored : []).filter(a => a && a.name)
  if (!list.length) return ''
  const kept = list.filter(a => a.path)
  const lost = list.filter(a => !a.path)
  const parts = [`[With this message the person attached: ${list.map(label).join(', ')}. Files are not re-sent on later turns.`]
  if (kept.length) {
    parts.push(
      `${kept.length === list.length ? 'They are' : `${kept.map(a => a.name).join(', ')} ${kept.length > 1 ? 'are' : 'is'}`} kept: ` +
      'when a question needs the file itself rather than what you already said about it, re-open it with ' +
      'get_attachment and its name.',
    )
  }
  if (lost.length) {
    parts.push(
      `${lost.map(a => a.name).join(', ')} ${lost.length > 1 ? 'were' : 'was'} not kept; rely on what you said ` +
      'about it at the time, and ask them to attach it again if you need another look.',
    )
  }
  return `${parts.join(' ')}]`
}

/**
 * Every kept file in a thread, newest first, from its user messages'
 * stored attachments. Rows are research_messages with `attachments` and
 * `created_at`.
 */
export function threadFiles(rows = []) {
  const out = []
  for (const row of rows || []) {
    for (const a of Array.isArray(row?.attachments) ? row.attachments : []) {
      if (a?.name && a.path) out.push({ ...a, attached_at: row.created_at || null })
    }
  }
  return out.sort((x, y) => String(y.attached_at || '').localeCompare(String(x.attached_at || '')))
}

/**
 * The file a name refers to. Exact (ignoring case) first, then a name that
 * contains what was asked for; the newest wins a tie, because "the PDF" in a
 * follow-up means the one just discussed. With no name and one file, that
 * file. Otherwise { error, files } naming what there is.
 */
export function pickFile(files, name) {
  const want = String(name ?? '').trim().toLowerCase()
  const names = files.map(f => f.name)
  if (!files.length) return { error: 'No files have been attached in this conversation, or none were kept.', files: [] }
  if (!want) {
    return files.length === 1 ? { file: files[0] } : { error: 'Several files are attached in this conversation; say which.', files: names }
  }
  const hit = files.find(f => f.name.toLowerCase() === want) ||
    files.find(f => f.name.toLowerCase().includes(want)) ||
    // "the pdf" / "the image": the newest of that kind.
    (/\bpdf\b/.test(want) ? files.find(f => f.kind === 'pdf') : null) ||
    (/\b(image|photo|picture|screenshot)\b/.test(want) ? files.find(f => f.kind === 'image') : null)
  return hit ? { file: hit } : { error: `No attached file matches "${name}".`, files: names }
}
