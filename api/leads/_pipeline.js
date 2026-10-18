import crypto from 'node:crypto'
import { manualLead, trackFields } from '../../src/lib/leads/pipeline.js'
import { openCard } from './_card.js'

// ─── The pipeline: leads added by hand, and each lead's stage ─────────────
// The owner's decisions (2026-10-18): anyone on the sales team adds a lead
// by hand, and it is theirs; a sales admin (or the access admin) may add one
// for someone else. A hand-added lead joins the pipeline at once with its
// battle card. Anyone who can see a lead in the pipeline moves its stage and
// sets its next step and follow-up date. See src/lib/leads/pipeline.js for
// the rules, 20261024_lead_pipeline for the columns.
//
// Writes use the service key, after [action].js has checked the caller.

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))

/** Is this person on the company's sales team? */
async function hasSeat(deps, workspaceId, userId) {
  if (!isUuid(userId)) return false
  const rows = await deps.db(`sales_seats?workspace_id=eq.${workspaceId}&user_id=eq.${userId}&select=user_id`) || []
  return rows.length === 1
}

/**
 * Add a lead by hand. `canAssign`: the caller is a sales admin or the access
 * admin, who may give it to anyone on the team (or, not being on the team
 * themselves, to no one yet). Everyone else's lead is their own.
 * Returns { lead, card } or { status, error }.
 */
export async function addLead(deps, { workspaceId, user, body = {}, canAssign = false }) {
  const shaped = manualLead(body)
  if (shaped.error) return { status: 400, error: shaped.error }
  let owner = user.id
  if (canAssign && body.assign_to !== undefined) {
    owner = body.assign_to || null
    if (owner && !(await hasSeat(deps, workspaceId, owner))) return { status: 400, error: 'That person is not on this company\'s sales team.' }
  } else if (!(await hasSeat(deps, workspaceId, user.id))) {
    // The access admin, not on the team: they choose who has it, or no one.
    owner = null
  }
  const now = deps.now().toISOString()
  const [lead] = await deps.db('leads', {
    method: 'POST', prefer: 'return=representation',
    body: {
      ...shaped.row,
      workspace_id: workspaceId,
      source_ref: `manual:${crypto.randomUUID()}`,
      received_at: now, created_at: now, updated_at: now,
      reviewed_by: user.id, reviewed_at: now, added_by: user.id,
      stage_at: now, stage_by: user.id,
      assigned_to: owner, assigned_at: owner ? now : null, assigned_by: owner ? user.id : null,
      project_set_by: shaped.row.human_project_type ? user.id : null,
      project_set_at: shaped.row.human_project_type ? now : null,
    },
  }) || []
  if (!lead) return { status: 500, error: 'The lead was not saved. Try again.' }
  const card = await openCard(deps, { workspaceId, leadId: lead.id }).catch(() => null)
  return { lead, card: card?.card || null }
}

/**
 * Move a lead's stage, or set its next step and follow-up date. Only a lead
 * in the pipeline (approved, or added by hand) has a stage to move.
 * Returns { lead } or { status, error }.
 */
export async function trackLead(deps, { workspaceId, leadId, user, body = {} }) {
  if (!isUuid(leadId)) return { status: 400, error: 'Which lead?' }
  const t = trackFields(body)
  if (t.error) return { status: 400, error: t.error }
  if (!Object.keys(t.values).length) return { status: 400, error: 'Nothing to change.' }
  const [cur] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}&select=id,stage`) || []
  if (!cur) return { status: 404, error: 'That lead is not in this company.' }
  if (!cur.stage) return { status: 409, error: 'This lead joins the pipeline when it is approved.' }
  const now = deps.now().toISOString()
  const patch = { ...t.values, updated_at: now }
  if (t.values.stage && t.values.stage !== cur.stage) Object.assign(patch, { stage_at: now, stage_by: user.id })
  const [lead] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}`, { method: 'PATCH', prefer: 'return=representation', body: patch }) || []
  if (!lead) return { status: 404, error: 'That lead is not in this company.' }
  return { lead }
}
