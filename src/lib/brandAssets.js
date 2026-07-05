import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Brand Asset Library ─────────────────────────────────────────────────
// Real photos/files that back the Brand Brain — product shots, project
// photos, logo, reference material, music. Stored in the public
// `brand-assets` Storage bucket (see supabase/migrations/20260630_brand_brain_v2.sql)
// with metadata in `brand_assets`. Public URLs are fed straight into
// FLUX/i2v/render calls, so uploads go to Storage, not base64-in-DB like
// the general Media Library.

export const ASSET_KINDS = [
  { value: 'product_photo', label: 'Product Photo' },
  { value: 'project_photo', label: 'Project Photo' },
  { value: 'logo',          label: 'Logo' },
  { value: 'reference',     label: 'Reference' },
  { value: 'music',         label: 'Music' },
  { value: 'other',         label: 'Other' },
]

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

export async function fetchBrandAssets(workspaceId, accessToken) {
  if (!workspaceId) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/brand_assets?workspace_id=eq.${workspaceId}&select=*&order=created_at.desc`,
      { headers: authHeaders(accessToken) }
    )
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

export async function uploadBrandAsset(workspaceId, accessToken, file, kind = 'other', project = '') {
  if (!workspaceId) return { error: 'No active workspace. Try signing out and back in.' }
  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${workspaceId}/${kind}/${Date.now()}_${safeName}`

    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/brand-assets/${path}`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!uploadRes.ok) return { error: await uploadRes.text() }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/brand-assets/${path}`

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/brand_assets`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        kind,
        project:      project || '',
        storage_path: path,
        public_url:   publicUrl,
        title:        file.name.replace(/\.[^.]+$/, ''),
      }),
    })
    if (!insertRes.ok) return { error: await insertRes.text() }
    const [row] = await insertRes.json()
    return { ok: true, row }
  } catch (err) {
    return { error: err.message }
  }
}

export async function updateBrandAsset(accessToken, id, patch) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brand_assets?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return { error: await res.text() }
    const [row] = await res.json()
    return { ok: true, row }
  } catch (err) {
    return { error: err.message }
  }
}

export async function deleteBrandAsset(accessToken, id, storagePath) {
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/brand-assets/${storagePath}`, {
      method: 'DELETE',
      headers: authHeaders(accessToken),
    })
    await fetch(`${SUPABASE_URL}/rest/v1/brand_assets?id=eq.${id}`, {
      method: 'DELETE',
      headers: authHeaders(accessToken),
    })
    return { ok: true }
  } catch (err) {
    return { error: err.message }
  }
}
