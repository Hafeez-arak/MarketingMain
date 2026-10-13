import { describe, it, expect } from 'vitest'
import { planGroupAction, doneText } from './groupActions.js'

const groups = [
  { id: 'gA', name: 'Customers', audience: 'marketing' },
  { id: 'gB', name: 'Consultants', audience: 'marketing' },
  { id: 'gAuto', name: 'Previously contacted Arak', audience: 'marketing', managed_by: 'lead_agent' },
  { id: 'gCold', name: 'Riyadh hotels', audience: 'cold' },
]
const c = (id, audience = 'marketing') => ({ id, audience })
const m = (contact_id, group_id) => ({ contact_id, group_id })
const plan = (action, contacts, members = []) => planGroupAction(action, { contacts, groups, members })

describe('add to group', () => {
  it('adds only those not already in it, and says who was', () => {
    const p = plan({ kind: 'add', groupId: 'gA' }, [c('1'), c('2'), c('3')], [m('2', 'gA')])
    expect(p.add).toEqual(['1', '3'])
    expect(p.remove).toEqual([])
    expect(p.summary).toBe('Adds 2 contacts to “Customers”. 1 contact was already in “Customers”.')
  })

  it('adding people to the group they are already in changes nothing', () => {
    const p = plan({ kind: 'add', groupId: 'gA' }, [c('1'), c('2')], [m('1', 'gA'), m('2', 'gA')])
    expect(p.empty).toBe(true)
    expect(p.summary).toBe('Nothing to change: all 2 contacts are already in “Customers”.')
  })

  it('keeps their other groups', () => {
    const p = plan({ kind: 'add', groupId: 'gA' }, [c('1')], [m('1', 'gB')])
    expect(p.add).toEqual(['1'])
    expect(p.remove).toEqual([])
  })

  it('never puts an Outreach contact in a Newsletter group, and says so', () => {
    const p = plan({ kind: 'add', groupId: 'gA' }, [c('1'), c('2', 'cold')])
    expect(p.add).toEqual(['1'])
    expect(p.summary).toBe('Adds 1 contact to “Customers”. 1 contact skipped: “Customers” is a Newsletter group and they are in Outreach.')
  })
})

describe('move to group', () => {
  it('joins the group and leaves every other group of that lane', () => {
    const p = plan({ kind: 'move', groupId: 'gB' }, [c('1')], [m('1', 'gA'), m('1', 'gAuto')])
    expect(p.add).toEqual(['1'])
    expect(p.remove).toEqual([{ groupId: 'gA', contactIds: ['1'] }, { groupId: 'gAuto', contactIds: ['1'] }])
    expect(p.summary).toBe('Moves 1 contact to “Consultants”. They leave “Customers”, “Previously contacted Arak”. “Previously contacted Arak” is automatic: the lead agent will not add them back.')
  })

  it('moving into the group they are already in only takes them out of the others', () => {
    const p = plan({ kind: 'move', groupId: 'gA' }, [c('1'), c('2')], [m('1', 'gA'), m('1', 'gB'), m('2', 'gA')])
    expect(p.add).toEqual([])
    expect(p.remove).toEqual([{ groupId: 'gB', contactIds: ['1'] }])
    expect(p.counts).toMatchObject({ changed: 1, already: 2 })
    expect(p.summary).toBe('They leave “Consultants”. 2 contacts were already in “Customers”.')
  })

  it('moving into the only group they are in changes nothing', () => {
    const p = plan({ kind: 'move', groupId: 'gA' }, [c('1')], [m('1', 'gA')])
    expect(p.empty).toBe(true)
    expect(p.summary).toBe('Nothing to change: they are already in “Customers” and in no other group.')
  })

  it('leaves groups of the other lane alone', () => {
    const p = plan({ kind: 'move', groupId: 'gB' }, [c('1')], [m('1', 'gA'), m('1', 'gCold')])
    expect(p.remove).toEqual([{ groupId: 'gA', contactIds: ['1'] }])
  })
})

describe('remove from group', () => {
  it('removes only those in it', () => {
    const p = plan({ kind: 'remove', groupId: 'gA' }, [c('1'), c('2')], [m('1', 'gA')])
    expect(p.remove).toEqual([{ groupId: 'gA', contactIds: ['1'] }])
    expect(p.summary).toBe('1 contact leaves “Customers”. 1 contact was not in it.')
  })

  it('from an automatic group: says the agent will not add them back', () => {
    const p = plan({ kind: 'remove', groupId: 'gAuto' }, [c('1')], [m('1', 'gAuto')])
    expect(p.automaticLeft).toEqual(['Previously contacted Arak'])
    expect(p.summary).toMatch(/automatic: the lead agent will not add them back\.$/)
  })

  it('nobody in it: nothing to change', () => {
    expect(plan({ kind: 'remove', groupId: 'gA' }, [c('1')]).empty).toBe(true)
  })
})

describe('switch lane', () => {
  it('moves only those in the other lane and takes them out of its groups', () => {
    const p = plan({ kind: 'lane', lane: 'cold' }, [c('1'), c('2', 'cold')], [m('1', 'gA'), m('1', 'gAuto'), m('2', 'gCold')])
    expect(p.patchIds).toEqual(['1'])
    expect(p.patch).toEqual({ audience: 'cold', consent: 'none' })
    expect(p.remove).toEqual([{ groupId: 'gA', contactIds: ['1'] }, { groupId: 'gAuto', contactIds: ['1'] }])
    expect(p.summary).toMatch(/^1 contact moves to Outreach\. They leave “Customers”, “Previously contacted Arak”, where campaigns would skip them\. 1 contact was already in Outreach\./)
  })

  it('everyone already there: nothing to change', () => {
    const p = plan({ kind: 'lane', lane: 'marketing' }, [c('1')])
    expect(p.empty).toBe(true)
  })
})

it('says what it did, in the past tense', () => {
  expect(doneText('Moves 1 contact to “B”. They leave “A”.')).toBe('Moved 1 contact to “B”. They left “A”.')
  expect(doneText('2 contacts leave “A”. 1 contact was not in it.')).toBe('2 contacts left “A”. 1 contact was not in it.')
  expect(doneText('1 contact moves to Outreach.')).toBe('1 contact moved to Outreach.')
  expect(doneText('Adds 2 contacts to “A”.')).toBe('Added 2 contacts to “A”.')
})

it('a group deleted meanwhile is refused with a reason', () => {
  expect(() => plan({ kind: 'add', groupId: 'gone' }, [c('1')])).toThrow(/no longer exists/)
})
