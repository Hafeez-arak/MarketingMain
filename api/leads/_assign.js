// ─── Assigning a lead to a salesperson ─────────────────────────────────────
// The owner's decisions (2026-10-13):
//   · a sales admin (or the access admin) assigns a lead, at any time, to
//     one person on the company's sales team (a sales seat);
//   · assigning forwards the customer's email to them at once (_mail.js
//     forwardLead), so assigning and forwarding never disagree;
//   · Approve needs someone assigned (_crm.js), and the lead goes into Odoo
//     with them as its salesperson; reassigning a lead already in Odoo moves
//     it there too;
//   · a salesperson sees only their own leads (can_see_lead, 20261018), so
//     an approved lead cannot be left with no one: it can only change hands.
//
//   deps: as in _crm.js (db, fetch, now, open) plus ms for the mailboxes.

import { crmConnection, odooOwner, odooCfg } from './_crm.js'
import { forwardLead } from './_mail.js'
import { findUserId, setLeadOwner } from './_odoo.js'

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))

/** A forward that has not finished in this long is taken to have died, and may be retried. */
export const FORWARD_STUCK_MS = 2 * 60_000

const LEAD_SELECT = 'id,workspace_id,source,mailbox,assigned_to,assigned_at,assigned_by,forward_status,forward_to,forward_error,forwarded_at,crm_status,crm_id,crm_error,approved_at,updated_at'

/** One person on this company's sales team, or null. */
export async function teamMember(deps, workspaceId, userId) {
  if (!isUuid(userId)) return null
  const [[seat], [person]] = await Promise.all([
    deps.db(`sales_seats?user_id=eq.${userId}&workspace_id=eq.${workspaceId}&select=user_id`).then((r) => r || []),
    deps.db(`user_access?user_id=eq.${userId}&select=user_id,email,full_name,status,role`).then((r) => r || []),
  ])
  if (!seat || !person || person.status !== 'approved' || person.role !== 'sales') return null
  return { id: userId, email: person.email, name: person.full_name || '' }
}

/** "Arif" (or the address) for the note on top of the forward. */
async function nameOfUser(deps, userId) {
  if (!isUuid(userId)) return ''
  const [u] = await deps.db(`user_access?user_id=eq.${userId}&select=email,full_name`) || []
  return u ? u.full_name || u.email : ''
}

/**
 * Assign (or reassign) a lead and forward its email to that person.
 * `to` null takes it off everyone, allowed only before it is approved.
 * Assigning it to the person who already has it sends the email again
 * (the "Try again" after a failed forward).
 * Returns { lead, forward: { ok, from? , error? }, odooError } or { status, error }.
 */
export async function assignLead(deps, { workspaceId, leadId, to, user, appUrl = '' }) {
  if (!isUuid(leadId)) return { status: 400, error: 'Which lead?' }
  const [lead] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}&select=${LEAD_SELECT}`) || []
  if (!lead) return { status: 404, error: 'That lead is not in this company.' }
  const now = deps.now()

  if (!to) {
    if (lead.approved_at || lead.crm_status) return { status: 409, error: 'An approved lead always has someone on it. Assign it to someone else instead.' }
    const [row] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { assigned_to: null, assigned_at: null, assigned_by: null, forward_status: null, forward_to: '', forward_error: '', forwarded_at: null, updated_at: now.toISOString() },
    }) || []
    return { lead: row || lead, forward: null, odooError: '' }
  }

  const person = await teamMember(deps, workspaceId, to)
  if (!person) return { status: 400, error: 'That person is not on this company\'s sales team.' }
  const changed = lead.assigned_to !== person.id

  // The claim: only one request forwards a lead at a time (a double click
  // would otherwise send the email twice). A forward that died is retried.
  const stuck = new Date(now.getTime() - FORWARD_STUCK_MS).toISOString()
  const [claimed] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}&or=(forward_status.is.null,forward_status.neq.sending,updated_at.lt.${stuck})`, {
    method: 'PATCH', prefer: 'return=representation',
    body: {
      ...(changed ? { assigned_to: person.id, assigned_at: now.toISOString(), assigned_by: user.id } : {}),
      forward_status: 'sending', forward_to: person.email, forward_error: '', updated_at: now.toISOString(),
    },
  }) || []
  if (!claimed) return { status: 409, error: 'This lead is being forwarded right now. Wait a moment and refresh.' }

  // Already in Odoo: the salesperson there changes with it.
  let odooError = ''
  if (changed && lead.crm_status === 'sent' && lead.crm_id) {
    try {
      const conn = await crmConnection(deps, workspaceId)
      if (!conn?.ready) throw new Error('Odoo is not connected, so its salesperson was not changed.')
      await setLeadOwner(deps.fetch, odooCfg(conn), lead.crm_id, await odooOwner(deps, conn, workspaceId, person.id))
    } catch (err) {
      odooError = String(err.message || err).slice(0, 300)
    }
  }

  const forward = await forwardLead(deps, {
    workspaceId, leadId, to: { email: person.email, name: person.name }, by: await nameOfUser(deps, user.id), appUrl,
  }).catch((err) => ({ ok: false, error: String(err.message || err) }))
  const [row] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}`, {
    method: 'PATCH', prefer: 'return=representation',
    body: forward.ok
      ? { forward_status: 'sent', forward_error: '', forwarded_at: deps.now().toISOString(), updated_at: deps.now().toISOString() }
      : { forward_status: 'failed', forward_error: String(forward.error || 'The email was not forwarded.').slice(0, 400), updated_at: deps.now().toISOString() },
  }) || []
  return { lead: row || claimed, forward, odooError }
}

// ─── The sales team, on Agent settings (admin only) ────────────────────────

/**
 * Everyone with a sales seat here: name, sales admin or not, whether they
 * also see every website enquiry, and who they are in Odoo.
 */
export async function teamList(deps, workspaceId) {
  const seats = await deps.db(`sales_seats?workspace_id=eq.${workspaceId}&select=user_id,all_website_leads,odoo_login,odoo_user_id`) || []
  if (!seats.length) return []
  const people = await deps.db(`user_access?user_id=in.(${seats.map((s) => s.user_id).join(',')})&select=user_id,email,full_name,status,role,leads_approver`) || []
  const byId = new Map(people.map((p) => [p.user_id, p]))
  return seats
    .map((s) => ({ s, p: byId.get(s.user_id) }))
    .filter(({ p }) => p && p.status === 'approved' && p.role === 'sales')
    .map(({ s, p }) => ({
      user_id: s.user_id, email: p.email, full_name: p.full_name || '', approver: Boolean(p.leads_approver),
      all_website_leads: Boolean(s.all_website_leads), odoo_login: s.odoo_login || '', odoo_user_id: s.odoo_user_id || null,
    }))
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email))
}

/**
 * Change one seat: { all_website_leads?, odoo_login? }. A new Odoo login
 * forgets the Odoo user found for the old one.
 */
export async function teamSave(deps, workspaceId, body = {}) {
  if (!isUuid(body.user_id)) return { status: 400, error: 'Which person?' }
  const patch = {}
  if (typeof body.all_website_leads === 'boolean') patch.all_website_leads = body.all_website_leads
  if (body.odoo_login !== undefined) {
    const login = String(body.odoo_login || '').trim().toLowerCase().slice(0, 200)
    patch.odoo_login = login
    patch.odoo_user_id = null
  }
  if (!Object.keys(patch).length) return { status: 400, error: 'Nothing to change.' }
  const saved = await deps.db(`sales_seats?user_id=eq.${body.user_id}&workspace_id=eq.${workspaceId}`, { method: 'PATCH', prefer: 'return=representation', body: patch }) || []
  if (!saved.length) return { status: 404, error: 'That person has no seat in this company.' }
  return { team: await teamList(deps, workspaceId) }
}

/**
 * Look every salesperson up in Odoo now, so a missing user shows before a
 * lead is approved rather than after. Returns { team, missing: [email] }.
 */
export async function teamCheckOdoo(deps, workspaceId) {
  const conn = await crmConnection(deps, workspaceId)
  if (!conn?.ready) return { status: 409, error: 'Connect Odoo first.' }
  const team = await teamList(deps, workspaceId)
  const missing = []
  for (const m of team) {
    const login = m.odoo_login || m.email
    const id = await findUserId(deps.fetch, odooCfg(conn), login).catch(() => null)
    if (!id) missing.push(login)
    if ((id || null) !== m.odoo_user_id) {
      await deps.db(`sales_seats?user_id=eq.${m.user_id}&workspace_id=eq.${workspaceId}`, { method: 'PATCH', prefer: 'return=minimal', body: { odoo_user_id: id || null } })
    }
  }
  return { team: await teamList(deps, workspaceId), missing }
}
