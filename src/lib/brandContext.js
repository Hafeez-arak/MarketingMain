import { useCallback, useEffect, useState } from 'react'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { fetchBrandSchema, fetchDirectoryRows } from './brandSchema'
import { fetchBrandAssets } from './brandAssets'

// ─── Brand context assembly ────────────────────────────────────────────────
// The single entry point every AI call goes through to turn the Brand Brain
// into the text a model actually reads.
//
// It exists because that assembly used to happen five different ways in five
// different files, and because the persona line above the brand context was
// hardcoded to one company — so a spa was told it manufactured lighting and
// then handed a spa's brand brain underneath. Identity now comes from the
// brain like everything else.
//
// This module WRAPS the existing flatteners rather than replacing them:
// buildInstructionsString / buildSectionBlocks (brandBrain.js) and
// buildDirectoryBlock (brandSchema.js) still do the formatting. What's new
// is task scoping, the identity line, learned memory, and one shape the
// preview panel and the payload builder can share — the preview calls this
// exact function, so what a user sees cannot drift from what is sent.

// ─── The pure half lives in brandContextCore.js ────────────────────────────
// buildContext() moved there, not copied, and that move is the point of the
// whole exercise: the agent's Vercel functions have to call THIS builder, and
// they could not load this file because line 2 reaches Vite's
// `import.meta.env` through supabaseClient. AGENT.md §6.
//
// Re-exported here so every existing call site keeps importing from
// './brandContext' exactly as before.
export {
  TASKS,
  TASK_LABELS,
  matchesTask,
  matchFeaturedRows,
  getBrandIdentity,
  SCOPE_TASKS,
  memoryTasks,
  buildContext,
} from './brandContextCore.js'

// Imported as well as re-exported: useBrandContext below binds it, and a
// re-export alone does not put a name in this module's scope.
import { buildContext } from './brandContextCore.js'


// ─── useBrandContext ───────────────────────────────────────────────────────
// Loads the three things buildContext needs beyond the profile — schema,
// directory rows/assets, and memory — and returns a builder already bound to
// them, so a page can ask for `ctx('caption')` without growing its own
// three-fetch effect.
//
// Studio and the planner keep their own loaders: they need the raw schema and
// directory for other things (the section chips, the featurable-row list), so
// routing them through here would mean fetching the same rows twice. This is
// for the surfaces that had no brand wiring beyond the flattened profile blob.
//
// Returns a builder rather than a context object because the task differs per
// call site within a page — the Instagram page writes captions AND rewrites
// image prompts, and those want different slices of the brain.
export function useBrandContext(workspaceId, accessToken, profile) {
  const [schema, setSchema] = useState({ sections: [], fields: [], columns: [] })
  const [directory, setDirectory] = useState({ rowsBySection: {}, assets: [] })
  const [memory, setMemory] = useState([])

  useEffect(() => {
    if (!workspaceId) return
    let alive = true
    Promise.all([
      fetchBrandSchema(workspaceId, accessToken),
      fetchDirectoryRows(workspaceId, accessToken),
      fetchBrandAssets(workspaceId, accessToken),
      fetchBrandMemory(workspaceId, accessToken),
    ]).then(([nextSchema, rows, assets, nextMemory]) => {
      if (!alive) return
      const rowsBySection = {}
      for (const r of rows) (rowsBySection[r.section_key] ||= []).push(r)
      setSchema(nextSchema)
      setDirectory({ rowsBySection, assets })
      setMemory(nextMemory)
    })
    // A failed load leaves the empty defaults in place, which degrades to the
    // profile-only context this replaced rather than to no context at all.
    return () => { alive = false }
  }, [workspaceId, accessToken])

  return useCallback(
    (task, options = {}) => buildContext(profile, schema, directory, memory, { task, ...options }),
    [profile, schema, directory, memory],
  )
}

// ─── brand_memory data access ──────────────────────────────────────────────
// Same auth model as the rest of the brand_* tables: anon key routes the
// request, the user's token makes RLS resolve them as a real member.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

// `status` defaults to active because that is what generation needs; the
// Brand Brain page asks for all of them so a human can review proposals.
export async function fetchBrandMemory(workspaceId, accessToken, { status = 'active' } = {}) {
  if (!workspaceId) return []
  // The workspace_id filter is explicit and required: RLS here is per-user,
  // and the operators belong to all three workspaces, so RLS alone would
  // return every brand's rules at once.
  const statusFilter = status === 'all' ? '' : `&status=eq.${status}`
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/brand_memory?workspace_id=eq.${workspaceId}${statusFilter}&select=*&order=created_at.desc`,
      { headers: authHeaders(accessToken) },
    )
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

export async function createBrandMemory(workspaceId, accessToken, row) {
  if (!workspaceId) return { error: 'No active workspace.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brand_memory`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ workspace_id: workspaceId, ...row }),
    })
    if (!res.ok) return { error: await res.text() }
    const [created] = await res.json()
    return { ok: true, row: created }
  } catch (err) { return { error: err.message } }
}

export async function updateBrandMemory(accessToken, id, patch) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brand_memory?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return { error: await res.text() }
    const [row] = await res.json()
    return { ok: true, row }
  } catch (err) { return { error: err.message } }
}

export async function deleteBrandMemory(accessToken, id) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brand_memory?id=eq.${id}`, {
      method: 'DELETE', headers: authHeaders(accessToken),
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true }
  } catch (err) { return { error: err.message } }
}

// ─── idea_events ───────────────────────────────────────────────────────────
// The decision log. Append-only and strictly best-effort: this is telemetry
// about the user's work, and a failure to record it must never block the
// work itself — same contract as logEditFeedback.
export async function logIdeaEvent(workspaceId, accessToken, { planId, ideaId, event, reason, before, after, actor }) {
  if (!workspaceId || !event) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/idea_events`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        plan_id: planId || null,
        idea_id: ideaId || null,
        event,
        reason: reason || '',
        before: before || {},
        after: after || {},
        actor: actor || null,
      }),
    })
  } catch {
    // best-effort — never block the user's action on the audit trail
  }
}

// Bulk variant — one request for the whole batch. "Reject all" on a
// thirty-idea plan is a single decision and should cost a single insert, not
// thirty; firing them individually also made the log's timestamps imply a
// deliberation that never happened.
export async function logIdeaEvents(workspaceId, accessToken, events) {
  if (!workspaceId || !events?.length) return
  const rows = events
    .filter(e => e && e.event)
    .map(e => ({
      workspace_id: workspaceId,
      plan_id: e.planId || null,
      idea_id: e.ideaId || null,
      event: e.event,
      reason: e.reason || '',
      before: e.before || {},
      after: e.after || {},
      actor: e.actor || null,
    }))
  if (!rows.length) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/idea_events`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    })
  } catch {
    // best-effort, same contract as logIdeaEvent
  }
}

// Only the fields worth diffing. Storing the whole idea row on every edit
// would make the log mostly noise and mostly duplicate.
export const IDEA_EVENT_FIELDS = [
  'title', 'topic', 'angle', 'tone', 'occasion', 'content_pillar',
  'objective', 'cta', 'image_idea', 'format', 'status', 'scheduled_date',
]

export function ideaSnapshot(idea) {
  if (!idea) return {}
  const out = {}
  for (const key of IDEA_EVENT_FIELDS) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    const value = idea[key] ?? idea[camel]
    if (value !== undefined && value !== null && value !== '') out[key] = value
  }
  return out
}
