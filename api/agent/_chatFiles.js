import crypto from 'node:crypto'
import { db } from './_supabase.js'
import {
  CHAT_FILES_BUCKET, MAX_TEXT_CHARS, chatFilePath, textPathFor, inChatFolder, threadFiles, pickFile,
} from '../../src/lib/agent/attachments.js'

// ─── Files attached in the chat, kept for later turns ──────────────────────
// 2026-11-02. The IO half of the storage notes in src/lib/agent/attachments.js.
//
//   saveChatFiles  at upload: each original into the private `chat-files`
//                  bucket, and a PDF's text next to it, extracted once here
//                  because re-reading text costs a fraction of re-sending
//                  the PDF.
//   getAttachment  the get_attachment tool: a file from THIS thread, again.
//   sweepOrphans   files whose chat is gone (a deleted company or
//                  conversation), removed with the service key. Run on each
//                  upload, the way lead-files sweeps itself, because the
//                  browser cannot see this private bucket to clean it.
//
// The bucket arrives in a hand-applied migration
// (supabase/migrations/20261110_chat_files_bucket.sql). Until it is applied
// every upload fails, the files are stored without a path, and the note on
// later turns says they were not kept — exactly the behaviour before this
// file existed. The chat must not go down in the window between the deploy
// and the migration.

const enc = encodeURIComponent

function storageBase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) return null
  return { base: `${url.replace(/\/$/, '')}/storage/v1`, auth: { apikey: key, Authorization: `Bearer ${key}` } }
}

const encodePath = path => path.split('/').map(enc).join('/')

async function upload(path, bytes, contentType) {
  const s = storageBase()
  if (!s) return { ok: false, error: 'storage is not configured' }
  const r = await fetch(`${s.base}/object/${CHAT_FILES_BUCKET}/${encodePath(path)}`, {
    method: 'POST',
    headers: { ...s.auth, 'Content-Type': contentType, 'x-upsert': 'true', 'cache-control': 'no-store' },
    body: bytes,
  })
  if (r.ok) return { ok: true }
  const j = await r.json().catch(() => null)
  return { ok: false, error: j?.message || j?.error || `HTTP ${r.status}` }
}

async function download(path) {
  const s = storageBase()
  if (!s) throw new Error('Storage is not configured on this deployment.')
  const r = await fetch(`${s.base}/object/authenticated/${CHAT_FILES_BUCKET}/${encodePath(path)}`, { headers: s.auth })
  if (!r.ok) throw new Error(`The stored file could not be read (HTTP ${r.status}).`)
  return Buffer.from(await r.arrayBuffer())
}

async function removeAll(paths) {
  const s = storageBase()
  if (!s || !paths.length) return
  await fetch(`${s.base}/object/${CHAT_FILES_BUCKET}`, {
    method: 'DELETE', headers: { ...s.auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }),
  })
}

/** Remove files whose chat no longer exists. Never throws. */
export async function sweepOrphans({ max = 200 } = {}) {
  try {
    const names = (await db('rpc/chat_files_orphaned', { method: 'POST', body: { max_rows: max } }) || [])
      .map(r => (typeof r === 'string' ? r : r?.chat_files_orphaned)).filter(Boolean)
    await removeAll(names)
    return { removed: names.length }
  } catch (err) {
    return { removed: 0, error: String(err?.message || err).slice(0, 200) }
  }
}

/**
 * A PDF's text, page by page, with a marker before each page so a re-read
 * can say "page 3". Empty when the PDF is scanned images with no text layer;
 * the tool then falls back to the PDF itself.
 */
export async function pdfText(bytes) {
  const { getDocumentProxy, extractText } = await import('unpdf')
  const doc = await getDocumentProxy(new Uint8Array(bytes))
  const { totalPages, text } = await extractText(doc, { mergePages: false })
  const pages = (text || []).map(t => String(t || '').trim())
  if (!pages.some(Boolean)) return { pages: totalPages, text: '' }
  return { pages: totalPages, text: pages.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join('\n\n') }
}

/**
 * Keep every attachment of one message. Returns one entry per attachment, by
 * position: { path, text_path?, pages?, text_chars? }, or {} for a file that
 * could not be kept. Never throws — a file that was not kept costs a later
 * re-read, never this answer.
 */
export async function saveChatFiles(workspaceId, chatId, attachments = []) {
  if (!workspaceId || !chatId || !attachments.length) return attachments.map(() => ({}))
  // Alongside, not before: the person is waiting on this answer, not on the sweep.
  const swept = sweepOrphans()
  const saved = await Promise.all(attachments.map(async a => {
    try {
      const path = chatFilePath(workspaceId, chatId, crypto.randomUUID(), a.media_type)
      const bytes = Buffer.from(a.data, 'base64')
      const up = await upload(path, bytes, a.media_type)
      if (!up.ok) {
        console.error(`[agent/chat-files] ${a.name} not kept: ${up.error}`)
        return {}
      }
      if (a.kind !== 'pdf') return { path }
      // The original is kept either way; a PDF whose text could not be read
      // is re-opened as the PDF instead.
      try {
        const { pages, text } = await pdfText(bytes)
        if (!text) return { path, pages }
        const text_path = textPathFor(path)
        const saved = await upload(text_path, Buffer.from(text, 'utf8'), 'text/plain; charset=utf-8')
        return saved.ok ? { path, text_path, pages, text_chars: text.length } : { path, pages }
      } catch (err) {
        console.error(`[agent/chat-files] ${a.name}: text not extracted: ${err?.message || err}`)
        return { path }
      }
    } catch (err) {
      console.error(`[agent/chat-files] ${a.name} not kept: ${err?.message || err}`)
      return {}
    }
  }))
  await swept
  return saved
}

/**
 * The get_attachment tool. The thread and the company come from the verified
 * session — the endpoint proved the thread is the caller's own — never from
 * the model, whose arguments only name a file and a place in its text.
 *
 * Returns { result } and, for an image or a PDF with no text, `blocks` the
 * loop sends back as the file itself (see toolResultBlock).
 */
export async function getAttachment(workspaceId, args = {}, session = {}) {
  const chatId = session?.chatId
  if (!chatId) return { error: 'Attached files can only be re-opened from a chat.' }

  const rows = await db(
    `research_messages?chat_id=eq.${enc(chatId)}&workspace_id=eq.${enc(workspaceId)}` +
    '&role=eq.user&attachments=not.is.null&order=created_at.desc&limit=200&select=attachments,created_at',
  )
  const files = threadFiles(rows)
    // Belt and braces: a stored path outside this thread's folder is never fetched.
    .filter(f => inChatFolder(f.path, workspaceId, chatId))
  const picked = pickFile(files, args?.name)
  if (!picked.file) return { error: picked.error + (picked.files.length ? ` Files kept in this conversation: ${picked.files.join(', ')}.` : '') }
  const f = picked.file

  const about = { name: f.name, kind: f.kind, attached_at: f.attached_at, ...(f.pages ? { pages: f.pages } : {}) }

  if (f.kind === 'pdf' && f.text_path && inChatFolder(f.text_path, workspaceId, chatId)) {
    const text = (await download(f.text_path)).toString('utf8')
    const offset = Math.max(0, Math.floor(Number(args?.offset) || 0))
    const slice = text.slice(offset, offset + MAX_TEXT_CHARS)
    const next = offset + slice.length
    return {
      result: {
        ...about,
        text: slice,
        chars: text.length,
        offset,
        ...(next < text.length
          ? { more: `This is characters ${offset}–${next} of ${text.length}. Call again with offset ${next} for the rest.` }
          : {}),
        note: 'Text extracted from the PDF. Layout, images and charts are not included; say so if the question is about them.',
      },
    }
  }

  const bytes = await download(f.path)
  const data = bytes.toString('base64')
  if (f.kind === 'pdf') {
    // No text layer (a scan) or no text saved: the PDF itself, which costs
    // what the first look cost.
    return {
      result: { ...about, note: 'This PDF has no readable text layer, so it is attached again as the PDF.' },
      blocks: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: f.name }],
    }
  }
  return {
    result: { ...about, note: 'The image is attached to this tool result.' },
    blocks: [{ type: 'image', source: { type: 'base64', media_type: f.media_type, data } }],
  }
}
