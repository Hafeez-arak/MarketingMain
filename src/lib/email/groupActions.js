// ─── What a group action on selected contacts will change ──────────────────
// The Contacts bulk bar plans an action here first, so the person sees what
// it will do before it runs and what it did after. Pure: no database.
//
//   add     join the group; anyone already in it is left alone
//   move    join the group and leave every OTHER group of that lane; anyone
//           already in it only leaves the others
//   remove  leave the group; anyone not in it is left alone
//   lane    switch Newsletter ⇄ Outreach; they leave the old lane's groups,
//           where campaigns would skip them anyway
//
// A group belongs to one lane, and a campaign skips a contact of the other
// lane, so add/move never put someone into the other lane's group: they are
// counted as skipped and said so.
//
// Automatic groups (managed_by, filled by the lead agent): a person's edit
// wins. Taking someone out is remembered in the database and the agent never
// puts them back (supabase/migrations/20261017_group_hand_edits.sql), so the
// plan flags it for the confirmation to say.

import { AUDIENCES } from './contacts.js'

export const isAutomatic = g => Boolean(g?.managed_by)

/**
 * @param {{kind:'add'|'move'|'remove'|'lane', groupId?:string, lane?:'marketing'|'cold'}} action
 * @param {{contacts:object[], groups:object[], members:{group_id:string,contact_id:string}[]}} state
 *   contacts = the SELECTED contacts only
 * @returns {{ add: string[], groupId: string|null, remove: {groupId:string, contactIds:string[]}[],
 *             patch: object|null, patchIds: string[], counts: object, automaticLeft: string[], summary: string, empty: boolean }}
 */
export function planGroupAction(action, { contacts, groups, members }) {
  const byId = new Map(groups.map(g => [g.id, g]))
  const groupsOf = new Map(contacts.map(c => [c.id, new Set()]))
  for (const m of members) groupsOf.get(m.contact_id)?.add(m.group_id)

  const plan = { add: [], groupId: null, remove: [], patch: null, patchIds: [], counts: {}, automaticLeft: [] }
  const leave = new Map()   // groupId → contactIds
  const out = (gid, cid) => { if (!leave.has(gid)) leave.set(gid, []); leave.get(gid).push(cid) }

  if (action.kind === 'lane') {
    const lane = action.lane === 'cold' ? 'cold' : 'marketing'
    const moving = contacts.filter(c => c.audience !== lane)
    plan.patchIds = moving.map(c => c.id)
    plan.patch = lane === 'cold' ? { audience: 'cold', consent: 'none' } : { audience: 'marketing', consent: 'business_contact' }
    for (const c of moving) for (const gid of groupsOf.get(c.id)) if (byId.get(gid)?.audience !== lane) out(gid, c.id)
    plan.counts = { moving: moving.length, already: contacts.length - moving.length }
  } else {
    const g = byId.get(action.groupId)
    if (!g) throw new Error('That group no longer exists. Reload the page.')
    plan.groupId = g.id
    if (action.kind === 'remove') {
      const inIt = contacts.filter(c => groupsOf.get(c.id).has(g.id))
      for (const c of inIt) out(g.id, c.id)
      plan.counts = { changed: inIt.length, notIn: contacts.length - inIt.length }
    } else {
      const fits = contacts.filter(c => c.audience === g.audience)
      const wrongLane = contacts.length - fits.length
      let already = 0
      let changed = 0
      for (const c of fits) {
        const mine = groupsOf.get(c.id)
        let touched = false
        if (mine.has(g.id)) already++
        else { plan.add.push(c.id); touched = true }
        if (action.kind === 'move') {
          for (const gid of mine) {
            if (gid !== g.id && byId.get(gid)?.audience === g.audience) { out(gid, c.id); touched = true }
          }
        }
        if (touched) changed++
      }
      plan.counts = { changed, already, wrongLane }
    }
  }

  plan.remove = [...leave].map(([groupId, contactIds]) => ({ groupId, contactIds }))
  plan.automaticLeft = plan.remove.filter(r => isAutomatic(byId.get(r.groupId))).map(r => byId.get(r.groupId).name)
  plan.empty = !plan.add.length && !plan.remove.length && !plan.patchIds.length
  plan.summary = summarize(action, plan, byId)
  return plan
}

const people = n => `${n.toLocaleString()} ${n === 1 ? 'contact' : 'contacts'}`
const names = list => list.map(n => `“${n}”`).join(', ')

function summarize(action, plan, byId) {
  const c = plan.counts
  const leftNames = plan.remove.filter(r => r.groupId !== plan.groupId).map(r => byId.get(r.groupId)?.name).filter(Boolean)
  const parts = []
  if (action.kind === 'lane') {
    const label = AUDIENCES[action.lane === 'cold' ? 'cold' : 'marketing'].label
    if (!c.moving) return `Nothing to change: all ${people(c.already)} are already in ${label}.`
    parts.push(`${people(c.moving)} ${c.moving === 1 ? 'moves' : 'move'} to ${label}.`)
    if (leftNames.length) parts.push(`They leave ${names(leftNames)}, where campaigns would skip them.`)
    if (c.already) parts.push(`${people(c.already)} ${c.already === 1 ? 'was' : 'were'} already in ${label}.`)
    return parts.join(' ')
  }
  const g = byId.get(plan.groupId)
  if (action.kind === 'remove') {
    if (!c.changed) return `Nothing to change: none of them are in “${g.name}”.`
    parts.push(`${people(c.changed)} ${c.changed === 1 ? 'leaves' : 'leave'} “${g.name}”.`)
    if (c.notIn) parts.push(`${people(c.notIn)} ${c.notIn === 1 ? 'was' : 'were'} not in it.`)
  } else {
    const skipped = c.wrongLane
      ? `${people(c.wrongLane)} skipped: “${g.name}” is a ${AUDIENCES[g.audience].label} group and they are in ${AUDIENCES[g.audience === 'cold' ? 'marketing' : 'cold'].label}.`
      : ''
    if (!c.changed) {
      const why = c.already
        ? `Nothing to change: ${c.already === 1 ? 'they are' : `all ${people(c.already)} are`} already in “${g.name}”${action.kind === 'move' ? ' and in no other group' : ''}.`
        : 'Nothing to change.'
      return [why, skipped].filter(Boolean).join(' ')
    }
    if (plan.add.length) parts.push(`${action.kind === 'move' ? 'Moves' : 'Adds'} ${people(plan.add.length)} to “${g.name}”.`)
    if (leftNames.length) parts.push(`They leave ${names(leftNames)}.`)
    if (c.already) parts.push(`${people(c.already)} ${c.already === 1 ? 'was' : 'were'} already in “${g.name}”.`)
    if (skipped) parts.push(skipped)
  }
  if (plan.automaticLeft.length) parts.push(`${names(plan.automaticLeft)} ${plan.automaticLeft.length === 1 ? 'is' : 'are'} automatic: the lead agent will not add them back.`)
  return parts.join(' ')
}

/** The summary, said after it ran: "Moves 2 contacts to …" → "Moved 2 contacts to …". */
export function doneText(summary) {
  return String(summary)
    .replace(/\bAdds\b/g, 'Added').replace(/\bMoves\b/g, 'Moved')
    .replace(/\bmoves? to\b/g, 'moved to')
    .replace(/\bleaves\b/g, 'left').replace(/\bThey leave\b/g, 'They left').replace(/ leave “/g, ' left “')
}
