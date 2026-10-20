// ─── The battle card in Odoo, both ways (2026-10-20, simplified) ───────────
// The owner's decisions: everything in Odoo, kept simple (see
// src/lib/sales/odooCard.js for where each part goes): the prep is the brief
// in the lead's Internal Notes, written once when it is pushed (_crm.js);
// the outcome is six fields on the lead; the next step is an Odoo Activity.
// A change saved here is written to Odoo at once, with one line in the lead's
// history; Odoo is the master, read back twice a day (07:50 and 13:00 Riyadh)
// through the five-minute heartbeat, and what changed there replaces ours.
//
// What changed where is decided against a snapshot of the values as last
// synced (lead_cards.crm_props: the six fields, plus `act`, the activity): a
// save here writes only what changed here since, so it never undoes an edit
// made in Odoo meanwhile; a read takes only what changed in Odoo.
//
// Nothing here fails an approval or a save: a failed write is kept on the
// card (crm_sync_error) and tried again before the next read.

import {
  cardToProps, propsFromRead, propsToCard, changedProps, mergeProps, changeNote,
  mergeDefinition, definitionCurrent, pullDue, lastSlot, activityOf, sameActivity, PREFIX,
} from '../../src/lib/sales/odooCard.js'
import {
  listTeams, readTeamDefinition, writeTeamDefinition, readLeadProps, writeLeadProps, postNote,
  createActivity, writeActivity, doneActivity, readActivities,
} from './_odoo.js'
import { crmConnection, odooCfg } from './_crm.js'
import { openCard } from './_card.js'

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))
const errText = (err) => String(err?.message || err).slice(0, 400)

const CARD_SYNC_COLUMNS = 'lead_id,card,decision,quote_due,target_price,decides,competitors,crm_props,crm_sync_error,crm_activity_id'
const LEAD_SYNC_COLUMNS = 'id,crm_id,crm_status,next_step,follow_up'

/** "Ammar Ahmed" (or the address) for the history note. */
async function personName(deps, userId) {
  if (!isUuid(userId)) return ''
  const [u] = await deps.db(`user_access?user_id=eq.${userId}&select=email,full_name`) || []
  return u ? u.full_name || u.email : ''
}

const snapshotOf = (row) => (row?.crm_props && typeof row.crm_props === 'object' ? row.crm_props : {})
const onlyOurs = (values) => Object.fromEntries(Object.entries(values || {}).filter(([k]) => k.startsWith(PREFIX)).map(([k, v]) => [k, v || false]))

/**
 * Make sure the team our leads go into carries the card fields: ours
 * rewritten to the current version, anyone else's kept. Needs Sales:
 * Administrator in Odoo. Returns { ok, changed } or throws Odoo's words.
 */
export async function ensureTeamFields(deps, conn) {
  if (!conn?.team_id) return { ok: false, changed: false }
  const team = await readTeamDefinition(deps.fetch, odooCfg(conn), conn.team_id)
  if (definitionCurrent(team.lead_properties_definition)) return { ok: true, changed: false }
  await writeTeamDefinition(deps.fetch, odooCfg(conn), conn.team_id, mergeDefinition(team.lead_properties_definition))
  return { ok: true, changed: true }
}

/** Odoo's sales teams, and which one our leads go into. */
export async function crmTeams(deps, workspaceId) {
  const conn = await crmConnection(deps, workspaceId)
  if (!conn?.ready) return { status: 409, error: 'Connect Odoo first.' }
  const teams = await listTeams(deps.fetch, odooCfg(conn))
  return {
    current: conn.team_id || null,
    teams: teams.map((t) => ({ id: t.id, name: t.name, leader: Array.isArray(t.user_id) ? t.user_id[1] : '', members: (t.member_ids || []).length, useLeads: Boolean(t.use_leads) })),
  }
}

/**
 * Send our leads into this Odoo team from now on, after giving the team the
 * card fields. A team Odoo will not let us add them to (no Sales:
 * Administrator right) is not chosen: its leads would arrive without them.
 * Returns { ok, changed } or { status, error }.
 */
export async function setCrmTeam(deps, workspaceId, teamId) {
  const conn = await crmConnection(deps, workspaceId)
  if (!conn?.ready) return { status: 409, error: 'Connect Odoo first.' }
  const id = Number(teamId)
  if (!Number.isInteger(id) || id <= 0) return { status: 400, error: 'Which team?' }
  let name
  let changed
  try {
    name = (await readTeamDefinition(deps.fetch, odooCfg(conn), id)).name || ''
    ;({ changed } = await ensureTeamFields(deps, { ...conn, team_id: id }))
  } catch (err) {
    return { status: 409, error: `Odoo did not let us add the battle-card fields to that team: ${errText(err)} (the Odoo user needs Sales: Administrator).` }
  }
  await deps.db(`lead_crm?workspace_id=eq.${workspaceId}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { team_id: id, team_name: name, updated_at: deps.now().toISOString() },
  })
  return { ok: true, changed }
}

/**
 * The next step as the lead's activity: created, moved, or marked done
 * when it was cleared here. Returns the activity id now held (or null).
 */
async function syncActivity(deps, cfg, { crmId, activityId, act, ownerId }) {
  const open = activityId ? (await readActivities(deps.fetch, cfg, [activityId]))[String(activityId)] : null
  if (!act) {
    if (open) await doneActivity(deps.fetch, cfg, activityId, 'Cleared on the Arak leads platform.')
    return null
  }
  if (open) {
    await writeActivity(deps.fetch, cfg, activityId, { summary: act.summary, date: act.date, userId: ownerId })
    return activityId
  }
  return createActivity(deps.fetch, cfg, crmId, { summary: act.summary, date: act.date, userId: ownerId })
}

/**
 * Write the lead's card to its Odoo lead: the fields changed here since the
 * last sync (all filled ones the first time), merged into what Odoo holds
 * now; the next step as its activity; one line in its history. `title` marks
 * the first push, whose note is just that line.
 * Returns { ok, changed: [names], activity } or { ok: false, error }; never throws.
 */
export async function pushCard(deps, { conn, workspaceId, leadId, by = '', title = '' }) {
  try {
    conn = conn || await crmConnection(deps, workspaceId)
    if (!conn?.ready) return { ok: false, error: 'Odoo is not connected.' }
    const [lead] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}&select=${LEAD_SYNC_COLUMNS}`) || []
    if (!lead?.crm_id) return { ok: false, error: 'This lead is not in Odoo yet.' }
    let [row] = await deps.db(`lead_cards?lead_id=eq.${leadId}&workspace_id=eq.${workspaceId}&select=${CARD_SYNC_COLUMNS}`) || []
    if (!row) {
      await openCard(deps, { workspaceId, leadId })
      ;[row] = await deps.db(`lead_cards?lead_id=eq.${leadId}&workspace_id=eq.${workspaceId}&select=${CARD_SYNC_COLUMNS}`) || []
    }
    if (!row) return { ok: false, error: 'This lead has no battle card.' }

    const ours = cardToProps(row.card, row)
    const snapshot = snapshotOf(row)
    const names = changedProps(snapshot, ours)
    const act = activityOf(lead)
    const actChanged = !sameActivity(snapshot.act || null, act)
    // The first push always leaves its line in the history, even with
    // nothing filled yet; later saves only when something changed.
    if (!names.length && !actChanged && !title) {
      if (row.crm_sync_error) await deps.db(`lead_cards?lead_id=eq.${leadId}`, { method: 'PATCH', prefer: 'return=minimal', body: { crm_sync_error: '' } })
      return { ok: true, changed: [] }
    }

    const cfg = odooCfg(conn)
    const now = (await readLeadProps(deps.fetch, cfg, [lead.crm_id]))[String(lead.crm_id)]
    let merged = onlyOurs(snapshot)
    if (names.length) {
      const odooNow = Object.fromEntries((now?.props || []).filter((p) => p.type !== 'separator').map((p) => [p.name, Array.isArray(p.value) ? p.value[0] : p.value]))
      merged = mergeProps(odooNow, ours, names)
      await writeLeadProps(deps.fetch, cfg, lead.crm_id, merged)
    }
    let activityId = row.crm_activity_id || null
    if (actChanged) activityId = await syncActivity(deps, cfg, { crmId: lead.crm_id, activityId, act, ownerId: now?.userId })

    const note = title ? `<p>${String(title).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</p>` : changeNote(names, ours, by, actChanged ? act : undefined)
    await postNote(deps.fetch, cfg, lead.crm_id, note).catch(() => null)
    await deps.db(`lead_cards?lead_id=eq.${leadId}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { crm_props: { ...onlyOurs(merged), act }, crm_activity_id: activityId, crm_synced_at: deps.now().toISOString(), crm_sync_error: '' },
    })
    return { ok: true, changed: [...names, ...(actChanged ? ['next_step'] : [])], activity: activityId }
  } catch (err) {
    await deps.db(`lead_cards?lead_id=eq.${leadId}`, { method: 'PATCH', prefer: 'return=minimal', body: { crm_sync_error: errText(err) } }).catch(() => null)
    return { ok: false, error: errText(err) }
  }
}

/** A card saved here, for a lead already in Odoo: write it there now. */
export async function pushCardAfterSave(deps, { workspaceId, leadId, user }) {
  const [lead] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}&select=crm_status,crm_id`) || []
  if (lead?.crm_status !== 'sent' || !lead.crm_id) return null
  return pushCard(deps, { workspaceId, leadId, by: await personName(deps, user?.id) })
}

/**
 * Read every pushed lead's card back from Odoo. Odoo is the master: what
 * differs from the last synced value was changed there, and replaces ours;
 * the activity done or deleted there clears our next step. Writes still
 * waiting (an earlier failure) are sent first, so a change made here is
 * never lost to the read.
 * Returns { read, updated, failed }.
 */
export async function pullCards(deps, workspaceId, { conn = null } = {}) {
  conn = conn || await crmConnection(deps, workspaceId)
  if (!conn?.ready) return { read: 0, updated: 0, failed: 0, error: 'Odoo is not connected.' }
  const leads = await deps.db(`leads?workspace_id=eq.${workspaceId}&crm_status=eq.sent&crm_id=neq.&select=${LEAD_SYNC_COLUMNS}&limit=2000`) || []
  if (!leads.length) return { read: 0, updated: 0, failed: 0 }
  const cards = await deps.db(`lead_cards?workspace_id=eq.${workspaceId}&lead_id=in.(${leads.map((l) => l.id).join(',')})&select=${CARD_SYNC_COLUMNS}`) || []
  const cardOf = new Map(cards.map((c) => [c.lead_id, c]))

  let failed = 0
  for (const c of cards.filter((x) => x.crm_sync_error)) {
    const out = await pushCard(deps, { conn, workspaceId, leadId: c.lead_id })
    if (!out.ok) failed++
    else Object.assign(c, (await deps.db(`lead_cards?lead_id=eq.${c.lead_id}&select=${CARD_SYNC_COLUMNS}`) || [])[0] || {})
  }

  const cfg = odooCfg(conn)
  let read = 0
  let updated = 0
  for (let i = 0; i < leads.length; i += 100) {
    const batch = leads.slice(i, i + 100)
    const got = await readLeadProps(deps.fetch, cfg, batch.map((l) => l.crm_id))
    const actIds = batch.map((l) => cardOf.get(l.id)?.crm_activity_id).filter(Boolean)
    const acts = await readActivities(deps.fetch, cfg, actIds)
    for (const lead of batch) {
      const row = cardOf.get(lead.id)
      const odoo = got[String(lead.crm_id)]
      if (!row || !odoo) continue
      const theirs = propsFromRead(odoo.props)
      if (!Object.keys(theirs).length) continue // that team has no card fields
      read++
      const snapshot = snapshotOf(row)
      const names = changedProps(snapshot, theirs)
      // The activity as Odoo holds it now: gone means done (or deleted) there.
      const theirAct = row.crm_activity_id ? acts[String(row.crm_activity_id)] || null : snapshot.act || null
      const actChanged = !sameActivity(snapshot.act || null, theirAct)
      if (!names.length && !actChanged) continue
      const now = deps.now().toISOString()
      // Only what changed in Odoo: a change made here that has not reached
      // Odoo yet (its write failed again above) stays, and goes next time.
      const fromOdoo = Object.fromEntries(names.map((k) => [k, theirs[k]]))
      const next = propsToCard(fromOdoo, row.card, row)
      await deps.db(`lead_cards?lead_id=eq.${lead.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: {
          card: next.card, ...next.after, crm_props: { ...snapshot, ...fromOdoo, act: theirAct },
          crm_activity_id: theirAct ? row.crm_activity_id : null, crm_pulled_at: now, updated_at: now, updated_by: null,
        },
      })
      if (actChanged) {
        await deps.db(`leads?id=eq.${lead.id}`, {
          method: 'PATCH', prefer: 'return=minimal',
          body: { next_step: theirAct ? theirAct.summary : '', follow_up: theirAct ? theirAct.date : null, updated_at: now },
        })
      }
      updated++
    }
  }
  return { read, updated, failed }
}

/**
 * The heartbeat's check: if a read from Odoo is due (07:50 / 13:00 Riyadh),
 * claim it, so the next heartbeat does not run it again, and run it.
 * Returns the read's counts, or null when none was due.
 */
export async function maybePullCards(deps, { workspaceId }) {
  const conn = await crmConnection(deps, workspaceId)
  if (!conn?.ready || !conn.team_id) return null
  const now = deps.now()
  if (!pullDue(now, conn.last_pull_at)) return null
  const slot = lastSlot(now).toISOString()
  const claim = conn.last_pull_at ? `&or=(last_pull_at.is.null,last_pull_at.lt.${slot})` : ''
  const [claimed] = await deps.db(`lead_crm?workspace_id=eq.${workspaceId}${claim}`, {
    method: 'PATCH', prefer: 'return=representation', body: { last_pull_at: now.toISOString() },
  }) || []
  if (!claimed) return null
  try {
    const out = await pullCards(deps, workspaceId, { conn })
    await deps.db(`lead_crm?workspace_id=eq.${workspaceId}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_pull_error: out.error || '', last_pull_counts: out } })
    return out
  } catch (err) {
    await deps.db(`lead_crm?workspace_id=eq.${workspaceId}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_pull_error: errText(err) } })
    return { error: errText(err) }
  }
}
