import { useEffect, useRef } from 'react'
import { actions } from '../store/app'
import { useAuth } from '../store/auth'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'

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
  updatedAt:         null,
}

function rowToProfile(row) {
  if (!row) return null
  return {
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brand_profile?workspace_id=eq.${workspaceId}&select=*`, {
      headers: authHeaders(accessToken),
    })
    if (!res.ok) return null
    const rows = await res.json()
    return rows?.[0] ? rowToProfile(rows[0]) : { ...DEFAULT_BRAND_PROFILE }
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
    contact_info:        profile.contactInfo       || '',
    languages:           profile.languages         || '',
    compliance_notes:    profile.complianceNotes   || '',
    offers_ctas:         profile.offersCtas        || '',
    caption_language:    profile.captionLanguage   || 'both',
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
    return { ok: true, profile: rowToProfile(row || body) }
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
export const BRAND_BRAIN_SECTIONS = [
  { value: 'voice',       label: 'Brand Voice & Identity' },
  { value: 'assets',      label: 'Asset Library' },
  { value: 'suppliers',   label: 'Suppliers' },
  { value: 'competitors', label: 'Competitor Watch' },
  { value: 'products',    label: 'Products' },
]
export const DEFAULT_BRAND_BRAIN_SECTIONS = ['voice', 'assets']

const LIST_CAP = 30

function fmtSuppliers(rows) {
  const list = (rows || []).slice(0, LIST_CAP)
  if (!list.length) return ''
  const lines = list.map(s => {
    const bits = [s.category && `Category: ${s.category}`, s.brand_lines && `Brand lines: ${s.brand_lines}`, s.notes && `Notes: ${s.notes}`].filter(Boolean)
    return `- ${s.name}${bits.length ? ` — ${bits.join(' — ')}` : ''}`
  })
  return `Suppliers we work with:\n${lines.join('\n')}`
}

function fmtCompetitors(rows) {
  const list = (rows || []).slice(0, LIST_CAP)
  if (!list.length) return ''
  const lines = list.map(c => {
    const bits = [c.positioning && `Positioning: ${c.positioning}`, c.strengths && `Their strengths: ${c.strengths}`, c.how_we_differ && `How we differ: ${c.how_we_differ}`].filter(Boolean)
    return `- ${c.name}${bits.length ? ` — ${bits.join(' — ')}` : ''}`
  })
  return `Competitor watch (avoid copying their angles; differentiate instead):\n${lines.join('\n')}`
}

function fmtProducts(rows) {
  const list = (rows || []).slice(0, LIST_CAP)
  if (!list.length) return ''
  const lines = list.map(p => {
    const bits = [p.category && `Category: ${p.category}`, p.description && p.description, p.specs && `Specs: ${p.specs}`].filter(Boolean)
    return `- ${p.name}${bits.length ? ` — ${bits.join(' — ')}` : ''}`
  })
  return `Product range available to feature:\n${lines.join('\n')}`
}

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
// BRAND_BRAIN_SECTIONS). CampaignPlanner joins only the sections the user
// selected before sending them as the `instructions` payload.
export function buildSectionBlocks(profile, directory) {
  const { suppliers, competitors, products, assets } = directory || {}
  return {
    voice:       buildInstructionsString(profile, ''),
    suppliers:   fmtSuppliers(suppliers),
    competitors: fmtCompetitors(competitors),
    products:    fmtProducts(products),
    assets:      fmtAssets(assets),
  }
}

export function isBrandProfileEmpty(profile) {
  if (!profile) return true
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
