import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Media Library auto-save ────────────────────────────────────────────
// Best-effort: every image (or, later, video) generated and picked during
// content generation gets a record here automatically, tagged with where
// it came from (plan/idea/platform), so it's findable later without a
// separate gallery being built. Mirrors the shape src/pages/media/index.jsx
// already writes by hand for manual uploads — same table, same columns,
// plus tags.
//
// Note on durability: this saves whatever URL was current at the moment of
// picking. During review that's the image-provider's own (temporary) URL;
// once a post is actually generated, the real post carries a permanent
// Supabase Storage copy — this library entry is a quick-reference record,
// not the system of record for the final asset.
// Read side, for the "pick a reference from the library" picker.
//
// The workspace_id filter is NOT redundant with RLS. RLS scopes rows to every
// workspace the signed-in user belongs to — and someone who runs three brands
// belongs to three. Without this filter that person sees one merged pile and
// Aqeeq's shots turn up while they are working on Alo Kheyatah. Each library
// belongs to exactly one workspace, so the query has to say which.
export async function fetchMediaLibrary(workspaceId, accessToken, { kind = 'all', limit = 200 } = {}) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/media_library?select=*&workspace_id=eq.${workspaceId}&order=created_at.desc&limit=${limit}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` } },
    )
    if (!res.ok) return []
    const rows = await res.json()
    if (kind === 'all') return rows
    // Rows written before mime_type was consistently set can have it empty;
    // treating those as images matches what the library page already assumes
    // and is better than hiding an asset the user can plainly see there.
    return rows.filter(r => {
      const m = r.mime_type || 'image/'
      return kind === 'video' ? m.startsWith('video/') : m.startsWith('image/')
    })
  } catch { return [] }
}

export async function saveToMediaLibrary(workspaceId, accessToken, { name, url, platform, topic, source = 'generated', mimeType = 'image/webp', tags = [] }) {
  if (!workspaceId || !url) return { ok: false }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/media_library`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        workspace_id: workspaceId, name: name || 'Generated image', url,
        platform: platform || null, topic: topic || null, source, mime_type: mimeType, size_bytes: 0, tags,
      }),
    })
    return { ok: res.ok }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// ─── Uploading a file straight from the composer ───────────────────────────
// The composer's media picker offers the library and Creative Studio. Neither
// helps when the thing you want to post is a photo somebody took on a phone
// ten minutes ago — so this is the third door, and it is the one people
// actually reach for first.
//
// Bytes go to the media-library bucket and the row stores a URL to the object,
// the same shape brand assets, Studio renders and post images all use. That
// matters for publishing specifically: Zernio takes media by URL, so anything
// uploaded here is publishable without a second round trip.
//
// Deliberately NOT a data: URL. media_library rows used to store the file
// itself as base64 in `url`, which turned a 4 MB image into a ~5.5 MB string
// that every listing query then read in full — see the comment in
// src/pages/media/index.jsx, which does the same upload by hand and should
// eventually call this instead.
export async function uploadToMediaLibrary(workspaceId, accessToken, file) {
  if (!workspaceId) return { error: 'No workspace.' }
  if (!file) return { error: 'No file.' }

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
  }
  // Prefixed with the workspace so the bucket is browsable per tenant, and
  // timestamped so re-uploading a file with the same name does not overwrite
  // the earlier one — two posts can legitimately use "photo.jpg".
  const safeName = String(file.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${workspaceId}/${Date.now()}_${safeName}`

  try {
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/media-library/${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    // Reported, never swallowed. A failed upload that returns quietly looks
    // exactly like a file that vanished on drop, and the user's next move is
    // to try the same file again.
    if (!up.ok) return { error: `${file.name}: ${(await up.text()).slice(0, 160)}` }

    const url = `${SUPABASE_URL}/storage/v1/object/public/media-library/${path}`
    const row = {
      workspace_id: workspaceId,
      name: file.name || safeName,
      url,
      storage_path: path,
      source: 'upload',
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size || 0,
    }
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/media_library`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(row),
    })
    if (!ins.ok) return { error: `Saved the file but could not record it: ${(await ins.text()).slice(0, 160)}` }
    const rows = await ins.json().catch(() => [])
    return { asset: rows[0] || row }
  } catch (err) {
    return { error: err.message }
  }
}
