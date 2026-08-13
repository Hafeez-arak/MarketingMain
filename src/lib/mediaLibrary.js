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
