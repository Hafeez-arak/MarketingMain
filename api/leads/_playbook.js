import { playbookCardFields } from '../../src/lib/sales/playbook.js'
import { PLAYBOOK_COLUMNS } from './_card.js'

// ─── The sales playbook's library (battle cards Part 2, 2026-11-07) ────────
// Everyone with the leads (the company's admin, its sales seats) reads it;
// the access admin and the sales admins edit it and mark cards reviewed.
// [action].js checks who is asking before any of this runs. See
// src/lib/sales/playbook.js for the card and its rules.

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))

/** The library, in its order. */
export async function listPlaybook(deps, workspaceId) {
  return await deps.db(`playbook_cards?workspace_id=eq.${workspaceId}&select=${PLAYBOOK_COLUMNS}&order=position`) || []
}

/**
 * Save a card: a new one at the end of the library, or the one named by
 * `id`. An edited card goes back to draft until someone marks it reviewed.
 * Returns { card } or { status, error }.
 */
export async function savePlaybookCard(deps, { workspaceId, user, body = {} }) {
  const fields = playbookCardFields(body)
  if (fields.error) return { status: 400, error: fields.error }
  const now = deps.now().toISOString()
  const owner = String(body.owner_label ?? '').trim().slice(0, 120)
  if (body.id) {
    if (!isUuid(body.id)) return { status: 400, error: 'Which card?' }
    const [row] = await deps.db(`playbook_cards?id=eq.${body.id}&workspace_id=eq.${workspaceId}&select=${PLAYBOOK_COLUMNS}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { ...fields.values, ...(body.owner_label !== undefined ? { owner_label: owner } : {}), status: 'draft', updated_at: now, updated_by: user?.id || null },
    }) || []
    return row ? { card: row } : { status: 404, error: 'That card is not in this company\'s playbook.' }
  }
  const [last] = await deps.db(`playbook_cards?workspace_id=eq.${workspaceId}&select=position&order=position.desc&limit=1`) || []
  const [row] = await deps.db(`playbook_cards?select=${PLAYBOOK_COLUMNS}`, {
    method: 'POST', prefer: 'return=representation',
    body: { workspace_id: workspaceId, position: (last?.position || 0) + 1, ...fields.values, owner_label: owner, status: 'draft', updated_at: now, updated_by: user?.id || null },
  }) || []
  return { card: row }
}

/** Mark a card reviewed (approved), or send it back to draft. */
export async function reviewPlaybookCard(deps, { workspaceId, user, id, approved = true }) {
  if (!isUuid(id)) return { status: 400, error: 'Which card?' }
  const now = deps.now().toISOString()
  const [row] = await deps.db(`playbook_cards?id=eq.${id}&workspace_id=eq.${workspaceId}&select=${PLAYBOOK_COLUMNS}`, {
    method: 'PATCH', prefer: 'return=representation',
    body: approved
      ? { status: 'approved', reviewed_at: now, reviewed_by: user?.id || null, updated_at: now }
      : { status: 'draft', updated_at: now },
  }) || []
  return row ? { card: row } : { status: 404, error: 'That card is not in this company\'s playbook.' }
}

/** Remove a card from the library. */
export async function deletePlaybookCard(deps, { workspaceId, id }) {
  if (!isUuid(id)) return { status: 400, error: 'Which card?' }
  const gone = await deps.db(`playbook_cards?id=eq.${id}&workspace_id=eq.${workspaceId}`, { method: 'DELETE', prefer: 'return=representation' }) || []
  return gone.length ? { deleted: id } : { status: 404, error: 'That card is not in this company\'s playbook.' }
}
