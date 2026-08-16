import { useEffect, useRef } from 'react'
import { actions } from '../store/app'
import { useAuth } from '../store/auth'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { fetchBrandFieldDefs, getFieldValue, buildDirectoryBlock } from './brandSchema'

// ─── Brand Brain ─────────────────────────────────────────────────────────
// A single, canonical brand profile stored in Supabase (table: brand_profile,
// one row per workspace) that every AI generation call across every
// platform pulls from, instead of each platform keeping its own free-text
// "instructions" blob. Platform-specific notes still exist and layer on top
// — they supplement the profile, they don't replace it.
//
// Auth model: `apikey` is always the project's fixed anon key (required by
// Supabase's gateway for routing); `Authorization` carries the signed-in
// user's session token so RLS resolves the request as `authenticated` and
// scopes it to workspaces they're actually a member of.

export const DEFAULT_BRAND_PROFILE = {
  // Identity & voice
  mission:           '',
  positioning:       '',
  valueProposition:  '',
  brandStory:        '',
  companyFacts:      '',
  voiceDescriptors:  '',
  // Guardrails
  toneDos:           '',
  toneDonts:         '',
  // Audience
  targetPersonas:    '',
  // Visual
  visualIdentity:    '',
  visualStyleNotes:  '',
  brandColors:       '',
  // Market & references
  marketContext:     '',
  keyProjects:       '',
  // Products (managed via uploads, not free-text — see brand_assets / sheet)
  productSheetPath:  '',
  productIndex:      '',
  // Knowledge centre — powers WhatsApp + email too
  contactInfo:       '',
  languages:         '',
  complianceNotes:   '',
  offersCtas:        '',
  captionLanguage:   'both',   // ar | en | both — which language(s) captions are written in
  arabicDialect:     'saudi',
  // Values for schema-defined fields that don't map to a fixed column above
  // (see brandSchema.js). Keyed by the field's `key`.
  customFields:      {},
  // The workspace's field definitions, in display order — attached at fetch
  // so buildInstructionsString can flatten the profile without every caller
  // having to plumb the schema through. Empty = fall back to the legacy order.
  fieldDefs:         [],
  updatedAt:         null,
}

function rowToProfile(row, fieldDefs) {
  if (!row) return null
  return {
    customFields:     row.custom_fields       || {},
    arabicDialect:    row.arabic_dialect      || 'saudi',
    fieldDefs:        fieldDefs               || [],
    mission:          row.mission             || '',
    positioning:      row.positioning         || '',
    valueProposition: row.value_proposition   || '',
    brandStory:       row.brand_story         || '',
    companyFacts:     row.company_facts        || '',
    voiceDescriptors: row.voice_descriptors   || '',
    toneDos:          row.tone_dos            || '',
    toneDonts:        row.tone_donts          || '',
    targetPersonas:   row.target_personas     || '',
    visualIdentity:   row.visual_identity     || '',
    visualStyleNotes: row.visual_style_notes  || '',
    brandColors:      row.brand_colors        || '',
    marketContext:    row.market_context      || '',
    keyProjects:      row.key_projects        || '',
    productSheetPath: row.product_sheet_path  || '',
    productIndex:     row.product_index       || '',
    contactInfo:      row.contact_info        || '',
    languages:        row.languages           || '',
    complianceNotes:  row.compliance_notes    || '',
    offersCtas:       row.offers_ctas         || '',
    captionLanguage:  row.caption_language    || 'both',
    updatedAt:        row.updated_at          || null,
  }
}

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

export async function fetchBrandProfile(workspaceId, accessToken) {
  if (!workspaceId) return null
  try {
    // The values and the field definitions that describe them are fetched
    // together: a profile without its schema would flatten into the prompt in
    // the legacy lighting-company order, which is right for no one now.
    const [res, fieldDefs] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/brand_profile?workspace_id=eq.${workspaceId}&select=*`, {
        headers: authHeaders(accessToken),
      }),
      fetchBrandFieldDefs(workspaceId, accessToken),
    ])
    if (!res.ok) return null
    const rows = await res.json()
    return rows?.[0]
      ? rowToProfile(rows[0], fieldDefs)
      : { ...DEFAULT_BRAND_PROFILE, fieldDefs }
  } catch {
    return null
  }
}

export async function saveBrandProfile(workspaceId, accessToken, profile) {
  if (!workspaceId) return { error: 'No active workspace. Try signing out and back in.' }
  const body = {
    workspace_id:        workspaceId,
    mission:             profile.mission           || '',
    positioning:         profile.positioning       || '',
    value_proposition:   profile.valueProposition  || '',
    brand_story:         profile.brandStory        || '',
    company_facts:       profile.companyFacts      || '',
    voice_descriptors:   profile.voiceDescriptors  || '',
    tone_dos:            profile.toneDos           || '',
    tone_donts:          profile.toneDonts         || '',
    target_personas:     profile.targetPersonas    || '',
    visual_identity:     profile.visualIdentity    || '',
    visual_style_notes:  profile.visualStyleNotes  || '',
    brand_colors:        profile.brandColors       || '',
    market_context:      profile.marketContext     || '',
    key_projects:        profile.keyProjects       || '',
    // Aqeeq and Alo Kheyatah both bind a schema field (the service-menu /
    // price-list summary) to this column, so it has to round-trip. It was
    // absent from this payload before v4, which meant edits to it were
    // silently dropped on save.
    product_index:       profile.productIndex      || '',
    contact_info:        profile.contactInfo       || '',
    languages:           profile.languages         || '',
    compliance_notes:    profile.complianceNotes   || '',
    offers_ctas:         profile.offersCtas        || '',
    caption_language:    profile.captionLanguage   || 'both',
    arabic_dialect:      profile.arabicDialect     || 'saudi',
    custom_fields:       profile.customFields      || {},
    updated_at:          new Date().toISOString(),
  }
  try {
    // on_conflict=workspace_id: one profile per workspace, upserted against
    // that unique constraint rather than the (now-random) primary key.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brand_profile?on_conflict=workspace_id`, {
      method: 'POST',
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const err = await res.text(); return { error: err } }
    // Some setups accept the write but return no representation (e.g. a missing
    // SELECT RLS policy, or Prefer stripped by a proxy). Fall back to the body
    // we just saved — it's already snake_case with updated_at — so a successful
    // save never reports back a null profile that would blank the app's state.
    let row = null
    try { const rows = await res.json(); row = Array.isArray(rows) ? rows[0] : rows } catch { /* empty body */ }
    // Carry the field defs across: they describe the values, aren't stored on
    // this row, and losing them here would drop the page back to the legacy
    // field order right after a successful save.
    return { ok: true, profile: rowToProfile(row || body, profile.fieldDefs) }
  } catch (err) {
    return { error: err.message }
  }
}

// Flatten the structured profile + optional platform-specific notes into the
// single "instructions" string the existing n8n webhooks already expect.
// Keeps the webhook contract unchanged — workflows don't need to be rebuilt,
// they just receive a richer instructions block.
export function buildInstructionsString(profile, platformNotes) {
  if (!profile) profile = DEFAULT_BRAND_PROFILE

  // Schema-driven path: emit the workspace's own fields, in its own order,
  // under its own headings. A field marked include_in_prompt = false is
  // stored and editable but never sent — that's how a brand keeps, say, an
  // internal note out of every generation.
  if (profile.fieldDefs?.length) {
    const blocks = profile.fieldDefs
      .filter(f => f.enabled !== false && f.include_in_prompt !== false)
      .map(f => {
        const value = String(getFieldValue(profile, f) || '').trim()
        if (!value) return ''
        const heading = f.prompt_label?.trim() || f.label
        // Multi-line values read better under their heading than beside it.
        return value.includes('\n') ? `${heading}:\n${value}` : `${heading}: ${value}`
      })
      .filter(Boolean)
    if (platformNotes?.trim()) blocks.push(`Platform-specific notes:\n${platformNotes.trim()}`)
    return blocks.join('\n\n')
  }

  // Legacy path — used only when a workspace has no field definitions yet
  // (a brand new workspace, or a failed schema fetch). Keeps generation
  // working rather than sending an empty instructions block.
  const sections = [
    // Identity first — this is the company persona the AI writes *as*.
    profile.mission          && `Mission: ${profile.mission}`,
    profile.positioning      && `Market positioning: ${profile.positioning}`,
    profile.valueProposition && `Value proposition: ${profile.valueProposition}`,
    profile.brandStory       && `Brand story:\n${profile.brandStory}`,
    profile.companyFacts     && `Facts the brand can state:\n${profile.companyFacts}`,
    profile.voiceDescriptors && `Brand voice: ${profile.voiceDescriptors}`,
    profile.toneDos          && `Always do:\n${profile.toneDos}`,
    profile.toneDonts        && `Never do:\n${profile.toneDonts}`,
    profile.targetPersonas   && `Target audience:\n${profile.targetPersonas}`,
    profile.marketContext    && `Market context:\n${profile.marketContext}`,
    profile.keyProjects      && `Reference when relevant:\n${profile.keyProjects}`,
    profile.productIndex     && `Product range (ask for the full sheet for specifics):\n${profile.productIndex}`,
    profile.visualIdentity   && `Visual identity:\n${profile.visualIdentity}`,
    profile.brandColors      && `Brand colours:\n${profile.brandColors}`,
    profile.visualStyleNotes && `Visual style defaults:\n${profile.visualStyleNotes}`,
    profile.languages        && `Languages:\n${profile.languages}`,
    profile.contactInfo      && `Contact & conversion details:\n${profile.contactInfo}`,
    profile.offersCtas       && `Offers & calls-to-action to push:\n${profile.offersCtas}`,
    profile.complianceNotes  && `Compliance rules (esp. WhatsApp/email):\n${profile.complianceNotes}`,
    platformNotes?.trim()    && `Platform-specific notes:\n${platformNotes.trim()}`,
  ].filter(Boolean)
  return sections.join('\n\n')
}

// ─── Selectable Brand Brain sections for plan generation ──────────────────
// CampaignPlanner lets the user pick which of these feed the plan prompt.
// "voice" is the existing brand_profile block (buildInstructionsString);
// the rest are directory tables that were never wired into plan generation.
// Fallback picker options, used only before a workspace's schema loads.
// The real list is per-workspace — see getBrandBrainSections below.
export const BRAND_BRAIN_SECTIONS = [
  { value: 'voice',  label: 'Brand Voice & Identity' },
  { value: 'assets', label: 'Asset Library' },
]
export const DEFAULT_BRAND_BRAIN_SECTIONS = ['voice', 'assets']

// The sections CampaignPlanner lets a user tick when generating a plan.
// "voice" is the flattened field blob, "assets" is the file library, and
// every enabled directory the workspace has defined shows up under its own
// name — "Service Menu" for Aqeeq, "Suppliers" for Arak, and so on.
export function getBrandBrainSections(schema) {
  const directories = (schema?.sections || [])
    .filter(s => s.kind === 'directory' && s.enabled !== false)
    .map(s => ({ value: s.key, label: s.title }))
  return [...BRAND_BRAIN_SECTIONS, ...directories]
}

// Cap on how many rows of any one list get flattened into a prompt — a
// 27-service menu is useful context, an unbounded list is just token burn.
const LIST_CAP = 30

function fmtAssets(rows) {
  const projectPhotos = (rows || []).filter(a => a.kind === 'project_photo')
  const groups = {}
  const individual = []
  for (const a of projectPhotos) {
    if (a.project) (groups[a.project] ||= []).push(a)
    else individual.push(a)
  }
  const groupLines = Object.entries(groups).slice(0, LIST_CAP).map(([name, photos]) => {
    const tags = [...new Set(photos.flatMap(p => p.tags || []))].slice(0, 6)
    return `- "${name}" — ${photos.length} photo${photos.length === 1 ? '' : 's'}${tags.length ? ` — tags: ${tags.join(', ')}` : ''}`
  })
  const hasLogo = (rows || []).some(a => a.kind === 'logo')
  const lines = [...groupLines]
  if (individual.length) lines.push(`- ${individual.length} individual project photo${individual.length === 1 ? '' : 's'} not grouped to a named project`)
  if (hasLogo) lines.push(`- Brand logo asset available`)
  if (!lines.length) return ''
  return `Visual assets on hand (reference these when suggesting shots/formats, exact photo files are picked separately):\n${lines.join('\n')}`
}

// Builds one formatted text block per selectable section (see
// getBrandBrainSections). CampaignPlanner joins only the sections the user
// selected before sending them as the `instructions` payload.
//
// `directory` is { schema, rowsBySection, assets }: the workspace's own
// section/column definitions plus its rows, so a directory renders into the
// prompt under its own name with its own columns.
export function buildSectionBlocks(profile, directory) {
  const { schema, rowsBySection, assets } = directory || {}
  const blocks = {
    voice:  buildInstructionsString(profile, ''),
    assets: fmtAssets(assets),
  }
  for (const section of schema?.sections || []) {
    if (section.kind !== 'directory' || section.enabled === false) continue
    const columns = (schema.columns || []).filter(c => c.section_key === section.key)
    blocks[section.key] = buildDirectoryBlock(section, columns, rowsBySection?.[section.key])
  }
  return blocks
}

export function isBrandProfileEmpty(profile) {
  if (!profile) return true
  // A brand whose schema is mostly custom fields (Aqeeq, Alo Kheyatah) can be
  // richly filled in while every fixed column below is still blank — checking
  // only those would report a fully-trained brain as empty.
  if (Object.values(profile.customFields || {}).some(v => String(v || '').trim())) return false
  return !profile.mission && !profile.positioning && !profile.valueProposition &&
    !profile.brandStory && !profile.companyFacts && !profile.voiceDescriptors &&
    !profile.toneDos && !profile.toneDonts && !profile.targetPersonas &&
    !profile.marketContext && !profile.keyProjects && !profile.visualIdentity &&
    !profile.visualStyleNotes && !profile.brandColors && !profile.contactInfo &&
    !profile.languages && !profile.complianceNotes && !profile.offersCtas
}

// ─── Edit feedback ─────────────────────────────────────────────────────────
// Every time a human edits AI-generated copy before approving it, that diff
// is a free training signal. We just capture it for now — mining it into
// prompt refinements is a later phase — but the data needs to start
// accumulating today, not once that phase starts.
export async function logEditFeedback(workspaceId, accessToken, { platform, postId, field, original, edited }) {
  if (!workspaceId) return
  if (!original || !edited || original === edited) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/brand_edit_feedback`, {
      method: 'POST',
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        platform,
        post_id: postId,
        field,
        original_text: original,
        edited_text: edited,
      }),
    })
  } catch {
    // best-effort — never block the user's save on this
  }
}

// ─── Sync hook ──────────────────────────────────────────────────────────────
// Pulls the canonical profile into app state for the signed-in user's active
// workspace. Safe to call from multiple pages — only fetches once per app
// session unless the profile is explicitly updated via SET_BRAND_PROFILE.
export function useBrandProfileSync(state, dispatch) {
  const { activeWorkspaceId, accessToken } = useAuth()
  // A ref, not state: "have I already tried" changes nothing on screen, so
  // storing it in state meant every first load rendered twice for no visible
  // difference. AppProvider is keyed on the workspace (see App.jsx), so this
  // resets when you switch companies, exactly as the state version did.
  const attempted = useRef(false)

  useEffect(() => {
    if (!activeWorkspaceId) return
    if (attempted.current || state.brandProfile) return
    attempted.current = true
    fetchBrandProfile(activeWorkspaceId, accessToken).then(profile => {
      if (profile) dispatch(actions.setBrandProfile(profile))
    })
  }, [activeWorkspaceId, accessToken, state.brandProfile])
}
