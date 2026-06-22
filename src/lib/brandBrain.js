import { useEffect, useState } from 'react'
import { actions } from '../store/appStore'
import { useAuth } from '../store/AuthContext'
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
  voiceDescriptors:  '',
  toneDos:           '',
  toneDonts:         '',
  targetPersonas:    '',
  keyProjects:       '',
  visualStyleNotes:  '',
  updatedAt:         null,
}

function rowToProfile(row) {
  if (!row) return null
  return {
    voiceDescriptors: row.voice_descriptors || '',
    toneDos:          row.tone_dos          || '',
    toneDonts:        row.tone_donts        || '',
    targetPersonas:   row.target_personas   || '',
    keyProjects:       row.key_projects      || '',
    visualStyleNotes: row.visual_style_notes || '',
    updatedAt:        row.updated_at        || null,
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
    voice_descriptors:   profile.voiceDescriptors || '',
    tone_dos:            profile.toneDos          || '',
    tone_donts:          profile.toneDonts        || '',
    target_personas:     profile.targetPersonas   || '',
    key_projects:        profile.keyProjects      || '',
    visual_style_notes:  profile.visualStyleNotes || '',
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
    const [row] = await res.json()
    return { ok: true, profile: rowToProfile(row) }
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
    profile.voiceDescriptors && `Brand voice: ${profile.voiceDescriptors}`,
    profile.toneDos          && `Always do:\n${profile.toneDos}`,
    profile.toneDonts        && `Never do:\n${profile.toneDonts}`,
    profile.targetPersonas   && `Target audience:\n${profile.targetPersonas}`,
    profile.keyProjects      && `Reference when relevant:\n${profile.keyProjects}`,
    profile.visualStyleNotes && `Visual style defaults:\n${profile.visualStyleNotes}`,
    platformNotes?.trim()    && `Platform-specific notes:\n${platformNotes.trim()}`,
  ].filter(Boolean)
  return sections.join('\n\n')
}

export function isBrandProfileEmpty(profile) {
  if (!profile) return true
  return !profile.voiceDescriptors && !profile.toneDos && !profile.toneDonts &&
    !profile.targetPersonas && !profile.keyProjects && !profile.visualStyleNotes
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
  const [attempted, setAttempted] = useState(false)

  useEffect(() => {
    if (!activeWorkspaceId) return
    if (attempted || state.brandProfile) return
    setAttempted(true)
    fetchBrandProfile(activeWorkspaceId, accessToken).then(profile => {
      if (profile) dispatch(actions.setBrandProfile(profile))
    })
  }, [activeWorkspaceId, accessToken, attempted, state.brandProfile])
}
