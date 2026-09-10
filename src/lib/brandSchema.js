import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

// ─── Brand Brain schema ────────────────────────────────────────────────────
// The Brand Brain's *structure* — which sections exist, which fields sit in
// them, and what columns a directory's rows have — used to be a hardcoded
// constant in the settings page, worded for a lighting company. It now lives
// per workspace in the database (see
// supabase/migrations/20260815_brand_brain_v4_custom_schema.sql) so marketing
// can reshape each brand's brain from the web interface.
//
// Three brands, three genuinely different shapes: Arak has Suppliers and Key
// Projects, Aqeeq has a Service Menu with Arabic names and SAR prices, Alo
// Kheyatah has a Service Model field and a kids' price list. None of that is
// in the code — it's all rows.
//
// Same auth model as brandBrain.js: anon key for gateway routing, the user's
// session token so RLS resolves them as a real workspace member.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

async function getJson(url, accessToken) {
  try {
    const res = await fetch(url, { headers: authHeaders(accessToken) })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

// ─── The pure half lives in brandSchemaCore.js ─────────────────────────────
// Moved there, not copied, so there is still one implementation. The reason
// is the import boundary in AGENT.md §6: the Vercel functions under
// api/agent/ need these formatters, and they cannot load this file because
// line 1 reads Vite's `import.meta.env` through supabaseClient.
//
// Re-exported here so every existing call site keeps importing from
// './brandSchema' exactly as before.
export {
  isCustomField,
  COLUMN_TO_PROFILE_KEY,
  getFieldValue,
  setFieldValue,
  sortFieldsBySection,
  slugKey,
  nextSortOrder,
  buildDirectoryBlock,
} from './brandSchemaCore.js'

// Imported as well as re-exported: fetchBrandFieldDefs below calls it, and a
// re-export alone does not put a name in this module's scope.
import { sortFieldsBySection } from './brandSchemaCore.js'


// ─── Loading ───────────────────────────────────────────────────────────────

// Everything the settings page and the prompt builders need, in one round of
// parallel requests. Sections come back with their fields and directory
// columns already attached so callers never have to re-group by section_key.
export async function fetchBrandSchema(workspaceId, accessToken) {
  if (!workspaceId) return { sections: [], fields: [], columns: [] }
  const base = `${SUPABASE_URL}/rest/v1`
  const [sections, fields, columns] = await Promise.all([
    getJson(`${base}/brand_sections?workspace_id=eq.${workspaceId}&select=*&order=sort_order.asc`, accessToken),
    getJson(`${base}/brand_fields?workspace_id=eq.${workspaceId}&select=*&order=sort_order.asc`, accessToken),
    getJson(`${base}/brand_directory_columns?workspace_id=eq.${workspaceId}&select=*&order=sort_order.asc`, accessToken),
  ])
  return { sections, fields, columns }
}

// Just the field definitions — what buildInstructionsString needs to flatten
// a profile in the right order with the right headings.
//
// sort_order is scoped to a section, so ordering by it alone interleaves the
// sections: every section's first field, then every section's second, and a
// prompt that reads "Target audience / Always do / Market positioning". The
// sections are fetched alongside purely to rank fields by (section position,
// field position) so the blob reads section by section, as the page does.
export async function fetchBrandFieldDefs(workspaceId, accessToken) {
  if (!workspaceId) return []
  const base = `${SUPABASE_URL}/rest/v1`
  const [sections, fields] = await Promise.all([
    getJson(`${base}/brand_sections?workspace_id=eq.${workspaceId}&select=key,sort_order&order=sort_order.asc`, accessToken),
    getJson(`${base}/brand_fields?workspace_id=eq.${workspaceId}&enabled=eq.true&select=*&order=sort_order.asc`, accessToken),
  ])
  return sortFieldsBySection(fields, sections)
}


export async function fetchDirectoryRows(workspaceId, accessToken, sectionKey) {
  if (!workspaceId) return []
  const filter = sectionKey ? `&section_key=eq.${encodeURIComponent(sectionKey)}` : ''
  return getJson(
    `${SUPABASE_URL}/rest/v1/brand_directory_rows?workspace_id=eq.${workspaceId}${filter}&select=*&order=sort_order.asc,created_at.asc`,
    accessToken,
  )
}

// ─── Writing ───────────────────────────────────────────────────────────────

function makeCrud(table) {
  return {
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
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
          method: 'DELETE', headers: authHeaders(accessToken),
        })
        if (!res.ok) return { error: await res.text() }
        return { ok: true }
      } catch (err) {
        return { error: err.message }
      }
    },
  }
}

export const sectionsApi   = makeCrud('brand_sections')
export const fieldsApi     = makeCrud('brand_fields')
export const dirColumnsApi = makeCrud('brand_directory_columns')
export const dirRowsApi    = makeCrud('brand_directory_rows')

// ─── Key generation ────────────────────────────────────────────────────────
