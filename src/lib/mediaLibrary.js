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

// ─── How big is this picture? ──────────────────────────────────────────────
// Instagram refuses an image whose proportions are outside 0.5625 to 1.91,
// and until now the app had no way to know a picture's proportions before the
// provider told it. Both of these answer that, and both answer `null` rather
// than guessing: an unmeasured image must stay distinguishable from a
// measured one, because the composer only refuses shapes it actually knows.
//
// Decoded rather than parsed. Reading the dimensions out of a JPEG or PNG
// header by hand is a few lines until it meets a WebP, an EXIF-rotated phone
// photo or a progressive JPEG; the browser already has a correct decoder and
// it reports the ORIENTED size, which is the one that gets published.

async function measureBitmap(source) {
  // createImageBitmap is the cheap path — it decodes off the main thread and
  // does not need an element in the document. Safari has had it since 15, but
  // the <img> fallback stays because a failure here is silent otherwise.
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(source)
      const size = { width: bmp.width, height: bmp.height }
      bmp.close?.()
      return size
    } catch { /* fall through to the element */ }
  }
  return null
}

export async function measureImageFile(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return null
  const bmp = await measureBitmap(file)
  if (bmp) return bmp
  const url = URL.createObjectURL(file)
  try { return await measureImageUrl(url) } finally { URL.revokeObjectURL(url) }
}

export function measureImageUrl(url) {
  if (!url) return Promise.resolve(null)
  return new Promise(resolve => {
    const img = new Image()
    // Supabase Storage serves these with permissive CORS, and the fitter needs
    // the same flag to read pixels back out of a canvas without tainting it.
    // Set here too so one measured image is one network fetch, not two.
    img.crossOrigin = 'anonymous'
    img.onload  = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
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
// `source` and `tags` are open so the image fitter can save its render here
// rather than growing a second, near-identical uploader: a re-shaped picture
// is a new asset in the library like any other, and tagging it 'adjusted'
// keeps the original findable beside it instead of replacing it.
export async function uploadToMediaLibrary(workspaceId, accessToken, file, { source = 'upload', tags = [] } = {}) {
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

  // Before the bytes leave, because after them we would have to fetch the
  // file back to learn something the browser already had in hand. Failure is
  // not fatal: an upload that cannot be measured still uploads, and the
  // composer measures it again when it is picked.
  const size = await measureImageFile(file)

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
      source,
      ...(tags.length ? { tags } : {}),
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size || 0,
      ...(size ? { width: size.width, height: size.height } : {}),
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

// ─── Measuring what is already in a post ──────────────────────────────────
//
// Rows written before width/height existed carry neither, and an unmeasured
// image is one the validator stays silent about — which is the bug, not the
// safeguard. This fills them in from the browser, once, for whatever list it
// is given, and returns the same list untouched when there is nothing to
// learn so a caller can compare by identity and skip the state update.
export async function measureMediaList(media = []) {
  const wanted = media.filter(m => m?.type !== 'video' && (m?.width == null || m?.height == null))
  if (!wanted.length) return media

  let learned = false
  const measured = await Promise.all(media.map(async m => {
    if (m?.type === 'video' || (m?.width != null && m?.height != null)) return m
    const size = await measureImageUrl(m?.url)
    if (!size) return m
    learned = true
    return { ...m, ...size }
  }))

  // The SAME array back when nothing was learned, not a new one holding the
  // same items. An image that cannot be measured — a dead URL, a bucket that
  // refuses CORS — would otherwise hand back a fresh array on every call, and
  // a caller comparing by identity to decide whether to store it would store,
  // re-render, measure again, and never stop.
  return learned ? measured : media
}
