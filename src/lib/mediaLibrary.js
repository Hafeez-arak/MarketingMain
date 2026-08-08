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
