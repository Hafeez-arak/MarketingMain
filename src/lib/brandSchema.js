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

// A field whose storage_column is blank stores its value in
// brand_profile.custom_fields under the field key. Everything else reads and
// writes one of brand_profile's original text columns, which is what keeps
// the existing n8n payload and every current consumer working unchanged.
export function isCustomField(field) {
  return !field?.storage_column
}

// snake_case column name → the camelCase key brandBrain.js exposes on the
// profile object. Kept as an explicit map rather than a generic transform so
// a typo in a storage_column can't silently invent a new profile key.
export const COLUMN_TO_PROFILE_KEY = {
  mission:            'mission',
  positioning:        'positioning',
  value_proposition:  'valueProposition',
  brand_story:        'brandStory',
  company_facts:      'companyFacts',
  voice_descriptors:  'voiceDescriptors',
  tone_dos:           'toneDos',
  tone_donts:         'toneDonts',
  target_personas:    'targetPersonas',
  visual_identity:    'visualIdentity',
  visual_style_notes: 'visualStyleNotes',
  brand_colors:       'brandColors',
  market_context:     'marketContext',
  key_projects:       'keyProjects',
  product_index:      'productIndex',
  product_sheet_path: 'productSheetPath',
  contact_info:       'contactInfo',
  languages:          'languages',
  compliance_notes:   'complianceNotes',
  offers_ctas:        'offersCtas',
  caption_language:   'captionLanguage',
  arabic_dialect:     'arabicDialect',
}

// Read one field's value off a profile, wherever it happens to live.
export function getFieldValue(profile, field) {
  if (!profile || !field) return ''
  if (isCustomField(field)) return profile.customFields?.[field.key] || ''
  const key = COLUMN_TO_PROFILE_KEY[field.storage_column]
  return (key && profile[key]) || ''
}

// Write one field's value onto a profile, returning a new profile object.
export function setFieldValue(profile, field, value) {
  if (isCustomField(field)) {
    return { ...profile, customFields: { ...(profile.customFields || {}), [field.key]: value } }
  }
  const key = COLUMN_TO_PROFILE_KEY[field.storage_column]
  if (!key) return profile
  return { ...profile, [key]: value }
}

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

// A field in a section that no longer exists sorts to the end rather than to
// the front, which is what a bare `|| 0` would do.
export function sortFieldsBySection(fields, sections) {
  const rank = new Map((sections || []).map(s => [s.key, s.sort_order ?? 0]))
  const LAST = Number.MAX_SAFE_INTEGER
  return [...(fields || [])].sort((a, b) => {
    const sa = rank.has(a.section_key) ? rank.get(a.section_key) : LAST
    const sb = rank.has(b.section_key) ? rank.get(b.section_key) : LAST
    return sa - sb || (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })
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
// Keys are the JSON keys inside custom_fields / directory row data, so they
// have to be stable and unique per workspace. Derive from the label the user
// typed, then de-duplicate — a second "Notes" becomes notes_2, not a unique
// violation the user has to decode.
export function slugKey(label, taken = []) {
  const base = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'field'
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}_${n}`)) n++
  return `${base}_${n}`
}

// New rows go to the end. Sort orders are spaced by 10 so a future drag-to-
// reorder can slot between two neighbours without renumbering everything.
export function nextSortOrder(rows) {
  if (!rows?.length) return 10
  return Math.max(...rows.map(r => r.sort_order || 0)) + 10
}

// ─── Prompt formatting for directories ─────────────────────────────────────
// One text block per directory section, built from that section's own
// columns. Columns flagged in_prompt = false (prices, typically) are stored
// and editable but never pushed into a generation.
const ROW_CAP = 40

export function buildDirectoryBlock(section, columns, rows) {
  const cols = (columns || []).filter(c => c.enabled !== false && c.in_prompt !== false)
  const list = (rows || []).slice(0, ROW_CAP)
  if (!cols.length || !list.length) return ''
  const [first, ...rest] = cols
  const lines = list.map(row => {
    const data = row.data || {}
    const head = String(data[first.key] || '').trim()
    const bits = rest
      .map(c => {
        const v = String(data[c.key] || '').trim()
        return v ? `${c.label}: ${v}` : ''
      })
      .filter(Boolean)
    if (!head && !bits.length) return ''
    return `- ${head || '(unnamed)'}${bits.length ? ` — ${bits.join(' — ')}` : ''}`
  }).filter(Boolean)
  if (!lines.length) return ''
  const heading = section?.description?.trim()
    ? `${section.title} (${section.description.trim()})`
    : section?.title || 'Directory'
  return `${heading}:\n${lines.join('\n')}`
}
