import crypto from 'node:crypto'

// ─── Large attachments through Supabase Storage (2026-10-19) ──────────────
// Vercel answers at most 4.5 MB. A bigger attachment is fetched from the
// mailbox here, kept in the private 'lead-files' bucket for a day, and handed
// to the browser as a ten-minute private link (20261025_lead_files). The
// email keeps the original, so an expired copy is simply fetched again.
//
//   deps.storage   { upload(path, bytes, contentType), sign(path, seconds, downloadName), remove(paths) }
//   deps.db        PostgREST, for the expired list (lead_files_expired)

/** How long a download link lasts. */
export const LINK_SECONDS = 600
/** The largest attachment fetched at all; past this, Outlook. */
export const MAX_BIG_FILE = 100_000_000

/**
 * Where a copy lives: the company, the lead, and the attachment (hashed:
 * Microsoft's ids are long and full of + and /). The name in the path is
 * plain ASCII, since Storage refuses some characters; the person's file name
 * goes on the link instead.
 */
export function filePath(workspaceId, leadId, attachmentId, name = '') {
  const id = crypto.createHash('sha256').update(String(attachmentId)).digest('hex').slice(0, 24)
  const ext = (String(name).match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'bin').toLowerCase()
  return `${workspaceId}/${leadId}/${id}/file.${ext}`
}

/** Delete the copies older than a day. Never throws: a download must not fail on the sweep. */
export async function sweepFiles(deps, { max = 200 } = {}) {
  try {
    const names = (await deps.db('rpc/lead_files_expired', { method: 'POST', body: { max_rows: max } }) || []).map((r) => (typeof r === 'string' ? r : r?.lead_files_expired)).filter(Boolean)
    if (names.length) await deps.storage.remove(names)
    return { removed: names.length }
  } catch (err) {
    return { removed: 0, error: String(err?.message || err).slice(0, 200) }
  }
}

/**
 * A private link to one attachment: the copy from today if there is one,
 * else fetched now (fetchBytes) and stored. Returns { url } or { status, error }.
 */
export async function linkToFile(deps, { workspaceId, leadId, attachmentId, name, contentType, fetchBytes }) {
  await sweepFiles(deps)
  const path = filePath(workspaceId, leadId, attachmentId, name)
  const existing = await deps.storage.sign(path, LINK_SECONDS, name).catch(() => null)
  if (existing) return { url: existing, cached: true }
  const got = await fetchBytes()
  if (got.error) return got
  const up = await deps.storage.upload(path, got.bytes, contentType || 'application/octet-stream')
  if (!up.ok) {
    return up.status === 413
      ? { status: 413, error: 'This attachment is larger than the storage allows. Open it in Outlook on the web.' }
      : { status: 502, error: `The attachment could not be prepared for download: ${up.error || 'storage refused it'}.` }
  }
  const url = await deps.storage.sign(path, LINK_SECONDS, name).catch(() => null)
  if (!url) return { status: 502, error: 'The attachment was prepared but no download link came back. Try again.' }
  return { url, cached: false }
}

/** The real Supabase Storage, with the service key. Used by leadDeps(). */
export function supabaseStorage({ url, key, bucket = 'lead-files', fetch: f = fetch }) {
  const base = `${url.replace(/\/$/, '')}/storage/v1`
  const auth = { apikey: key, Authorization: `Bearer ${key}` }
  const encode = (path) => path.split('/').map(encodeURIComponent).join('/')
  return {
    async upload(path, bytes, contentType) {
      const r = await f(`${base}/object/${bucket}/${encode(path)}`, {
        method: 'POST', headers: { ...auth, 'Content-Type': contentType, 'x-upsert': 'true', 'cache-control': 'no-store' }, body: bytes,
      })
      if (r.ok) return { ok: true }
      const j = await r.json().catch(() => null)
      const tooBig = r.status === 413 || /exceeded the maximum allowed size|too large/i.test(String(j?.message || j?.error || ''))
      return { ok: false, status: tooBig ? 413 : r.status, error: j?.message || j?.error || `HTTP ${r.status}` }
    },
    async sign(path, seconds, downloadName) {
      const r = await f(`${base}/object/sign/${bucket}/${encode(path)}`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: seconds }),
      })
      if (!r.ok) return null
      const j = await r.json().catch(() => null)
      const signed = j?.signedURL || j?.signedUrl
      if (!signed) return null
      return `${base}${signed}${signed.includes('?') ? '&' : '?'}download=${encodeURIComponent(downloadName || 'attachment')}`
    },
    async remove(paths) {
      const r = await f(`${base}/object/${bucket}`, {
        method: 'DELETE', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }),
      })
      return { ok: r.ok }
    },
  }
}
