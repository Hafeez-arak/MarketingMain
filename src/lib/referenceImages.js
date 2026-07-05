import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Reference Images ─────────────────────────────────────────────────────
// Reference images GUIDE a post's AI image generation (image-to-image) —
// they are not the finished image. A reference is just a public URL, whether
// it was freshly uploaded here or picked from the Brand Brain asset library
// (whose assets already have public URLs). Fresh uploads land in the same
// public `schedule-uploads` bucket the schedule editors already use, under a
// `references/<workspace>/` prefix so they're easy to tell apart.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

export async function uploadReferenceImage(workspaceId, accessToken, file) {
  if (!workspaceId) return { error: 'No active workspace. Try signing out and back in.' }
  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `references/${workspaceId}/${Date.now()}_${safeName}`
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/schedule-uploads/${path}`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) return { error: await res.text() }
    const url = `${SUPABASE_URL}/storage/v1/object/public/schedule-uploads/${path}`
    return { ok: true, url }
  } catch (err) {
    return { error: err.message }
  }
}
