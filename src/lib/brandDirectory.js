import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Suppliers & Competitors ─────────────────────────────────────────────
// Thin CRUD over brand_suppliers / brand_competitors (see
// supabase/migrations/20260630_brand_brain_v2.sql). Same auth model as
// brandBrain.js: anon key for gateway routing, user's session token for RLS.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

function makeCrud(table) {
  return {
    async list(workspaceId, accessToken) {
      if (!workspaceId) return []
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/${table}?workspace_id=eq.${workspaceId}&select=*&order=created_at.asc`,
          { headers: authHeaders(accessToken) }
        )
        if (!res.ok) return []
        return await res.json()
      } catch {
        return []
      }
    },
    async create(workspaceId, accessToken, row) {
      if (!workspaceId) return { error: 'No active workspace.' }
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
          method: 'POST',
          headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ workspace_id: workspaceId, ...row }),
        })
        if (!res.ok) return { error: await res.text() }
        const [created] = await res.json()
        return { ok: true, row: created }
      } catch (err) {
        return { error: err.message }
      }
    },
    async update(accessToken, id, patch) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
          method: 'PATCH',
          headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) return { error: await res.text() }
        const [updated] = await res.json()
        return { ok: true, row: updated }
      } catch (err) {
        return { error: err.message }
      }
    },
    async remove(accessToken, id) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE', headers: authHeaders(accessToken) })
        return { ok: true }
      } catch (err) {
        return { error: err.message }
      }
    },
  }
}

export const suppliersApi   = makeCrud('brand_suppliers')
export const competitorsApi = makeCrud('brand_competitors')
export const productsApi    = makeCrud('brand_products')
export const templatesApi   = makeCrud('brand_message_templates')
