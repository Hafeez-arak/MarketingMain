// ─── A deleted company takes its files with it ─────────────────────────────
// Deleting the workspace row cascades every table, but Storage is not a table
// the cascade reaches: the images, videos and logos stay in their buckets with
// nothing left pointing at them. Settings → Delete company calls this to find
// them first and remove them after.
//
// Where a company's files live (checked on the live bucket listing 2026-10-24):
//   brand-assets      <workspace>/<kind>/...
//   media-library     <workspace>/...
//   creative-studio   <workspace>/...       uploads and overlay exports
//                     <session>/...         renders n8n writes, one folder per
//                                           creative_sessions row
//   schedule-uploads  references/<workspace>/...
//   hr-papers         <workspace>/<employee>/...   scans of employees' papers (private)
//   catalog-files     <workspace>/<item>/...       datasheets and pictures of catalog items (private)
//
// Not covered, on purpose: instagram-posts, instagram-reels, linkedin-posts and
// schedule-uploads/instagram|linkedin are flat legacy folders with no company
// in the path, so there is no way to tell whose a file is; and lead-files is
// private (no browser access) and empties itself after a day.

const PAGE = 1000
const REMOVE_CHUNK = 100

export function companyFolders(workspaceId, sessionIds = []) {
  if (!workspaceId) throw new Error('companyFolders needs a workspace id')
  return [
    { bucket: 'brand-assets',     prefix: workspaceId },
    { bucket: 'media-library',    prefix: workspaceId },
    { bucket: 'creative-studio',  prefix: workspaceId },
    ...sessionIds.filter(Boolean).map(id => ({ bucket: 'creative-studio', prefix: String(id) })),
    { bucket: 'schedule-uploads', prefix: `references/${workspaceId}` },
    { bucket: 'hr-papers',        prefix: workspaceId },
    { bucket: 'catalog-files',    prefix: workspaceId },
  ]
}

// Every object under `prefix`, at any depth. Storage lists one level at a
// time, a sub-folder showing up as an entry with no id.
export async function listFolder(storage, bucket, prefix) {
  const out = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.from(bucket).list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message || error}`)
    const rows = data || []
    for (const row of rows) {
      const path = `${prefix}/${row.name}`
      if (row.id == null) out.push(...await listFolder(storage, bucket, path))
      else out.push(path)
    }
    if (rows.length < PAGE) return out
  }
}

// { bucket: [path, ...] } for one company. Throws if anything can't be read,
// so the caller can stop before deleting the company rather than leave files
// it never saw.
export async function collectCompanyFiles(client, workspaceId) {
  const { data: sessions, error } = await client
    .from('creative_sessions').select('id').eq('workspace_id', workspaceId)
  if (error) throw new Error(`creative_sessions: ${error.message}`)

  const byBucket = {}
  for (const { bucket, prefix } of companyFolders(workspaceId, (sessions || []).map(s => s.id))) {
    const paths = await listFolder(client.storage, bucket, prefix)
    if (paths.length) (byBucket[bucket] ||= []).push(...paths)
  }
  return byBucket
}

export function countFiles(byBucket) {
  return Object.values(byBucket).reduce((n, paths) => n + paths.length, 0)
}

// Removes what collectCompanyFiles found. Never throws: the company is already
// gone by the time this runs, so a failure is reported, not raised.
export async function removeCompanyFiles(storage, byBucket) {
  let removed = 0, failed = 0
  for (const [bucket, paths] of Object.entries(byBucket)) {
    for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
      const chunk = paths.slice(i, i + REMOVE_CHUNK)
      try {
        const { data, error } = await storage.from(bucket).remove(chunk)
        if (error) { failed += chunk.length; continue }
        const n = Array.isArray(data) ? data.length : chunk.length
        removed += n
        failed += chunk.length - n
      } catch {
        failed += chunk.length
      }
    }
  }
  return { removed, failed }
}
