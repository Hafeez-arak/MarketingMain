import { useEffect, useRef } from 'react'
import { actions } from '../store/app'
import { useAuth } from '../store/auth'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { fetchBrandFieldDefs } from './brandSchema'

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

// ─── The pure half lives in brandBrainCore.js ──────────────────────────────
// Moved there, not copied. This file imports React, the app store and
// supabaseClient at module scope, so a Vercel function cannot load it — and
// the agent has to use these exact flatteners rather than its own, or the
// brand the server sees and the brand the browser previews start to differ.
// AGENT.md §6.
//
// Re-exported here so every existing call site keeps importing from
// './brandBrain' exactly as before.
export {
  DEFAULT_BRAND_PROFILE,
  rowToProfile,
  buildInstructionsString,
  BRAND_BRAIN_SECTIONS,
  DEFAULT_BRAND_BRAIN_SECTIONS,
  getBrandBrainSections,
  buildSectionBlocks,
  isBrandProfileEmpty,
} from './brandBrainCore.js'

// Imported as well as re-exported: fetchBrandProfile and saveBrandProfile
// below both call these, and a re-export alone does not put a name in this
// module's scope.
import { DEFAULT_BRAND_PROFILE, rowToProfile } from './brandBrainCore.js'


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
