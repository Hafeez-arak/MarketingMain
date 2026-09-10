// ─── Brand Brain schema — the pure half ────────────────────────────────────
// Deliberately free of any import, exactly like n8nWebhookPaths.js and for
// exactly the same reason: this module is loaded both by the browser bundle
// (src/lib/brandSchema.js) and by the Vercel functions under api/agent/,
// which run in Node with no `import.meta.env`. brandSchema.js reads
// SUPABASE_URL from Vite's env at module scope, so importing it from a Node
// function throws before a single line of the function runs. Verified, not
// assumed — a plain import() of brandContext.js under Node fails on
// './supabaseClient'.
//
// The split is the one AGENT.md §6 calls for. Every function below was
// already pure — shaping rows into text, reading a value off a profile — and
// none of them ever needed the network. Only their neighbours did.
//
// brandSchema.js re-exports everything here, so no existing call site changes
// and there is still exactly one implementation of each function.

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
