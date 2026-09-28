import { describe, it, expect } from 'vitest'
import { subscribe, subscribeUrl } from './_engine.js'

const WS = '11111111-1111-1111-1111-111111111111'
const TOKEN = '22222222-2222-2222-2222-222222222222'

/** A PostgREST stand-in that answers by path and records every write. */
function world({ contact, send = null, groups = [] } = {}) {
  const writes = []
  const db = async (path, opts = {}) => {
    const method = opts.method || 'GET'
    if (method !== 'GET') { writes.push({ method, path, body: opts.body }) }
    if (method === 'GET') {
      if (path.startsWith('email_contacts?unsubscribe_token=')) return contact && path.includes(TOKEN) ? [contact] : []
      if (path.startsWith('email_sends?')) return send ? [send] : []
      if (path.startsWith('email_groups?')) return groups
      if (path.startsWith('email_settings?')) return [{ newsletter_name: 'After Dark' }]
      return []
    }
    if (method === 'POST' && path === 'email_groups') return [{ id: 'g-new', ...opts.body }]
    return []
  }
  return { db, writes }
}

const coldContact = { id: 'c1', workspace_id: WS, email: 'p@x.com', status: 'active', subscribed_at: null }

describe('subscribe from an outreach email', () => {
  it('moves the prospect to the marketing lane, into the subscribers group, out of outreach', async () => {
    const w = world({
      contact: coldContact,
      send: { id: 's1', campaign_id: 'camp1', subscribed_at: null },
      groups: [{ id: 'cold1', name: 'Hotels', audience: 'cold' }],
    })
    const out = await subscribe({ db: w.db }, TOKEN, new Date('2026-10-01T08:00:00Z'))
    expect(out).toMatchObject({ ok: true, email: 'p@x.com', already: false })
    expect(out.settings.newsletter_name).toBe('After Dark')

    const contactPatch = w.writes.find(x => x.path.startsWith('email_contacts?id=eq.c1'))
    expect(contactPatch.body).toMatchObject({
      audience: 'marketing', consent: 'opted_in', status: 'active',
      subscribed_at: '2026-10-01T08:00:00.000Z', subscribed_campaign_id: 'camp1',
    })
    expect(w.writes.find(x => x.path === 'email_sends?id=eq.s1').body.subscribed_at).toBe('2026-10-01T08:00:00.000Z')
    expect(w.writes.find(x => x.path.includes('status=eq.queued')).body).toMatchObject({ status: 'cancelled' })
    expect(w.writes.find(x => x.method === 'DELETE').path).toContain('group_id=in.("cold1")')
    expect(w.writes.find(x => x.path === 'email_groups').body).toMatchObject({ name: 'Newsletter subscribers', audience: 'marketing' })
    expect(w.writes.find(x => x.path.startsWith('email_group_members?on_conflict')).body).toEqual([{ group_id: 'g-new', contact_id: 'c1', workspace_id: WS }])
  })

  it('reuses the subscribers group and keeps the first sign-up date', async () => {
    const w = world({
      contact: { ...coldContact, subscribed_at: '2026-09-30T00:00:00Z' },
      groups: [{ id: 'g1', name: 'Newsletter subscribers', audience: 'marketing' }],
    })
    const out = await subscribe({ db: w.db }, TOKEN)
    expect(out.already).toBe(true)
    expect(w.writes.find(x => x.path.startsWith('email_contacts?id=eq.c1')).body.subscribed_at).toBeUndefined()
    expect(w.writes.some(x => x.path === 'email_groups')).toBe(false)
    expect(w.writes.find(x => x.path.startsWith('email_group_members?on_conflict')).body[0].group_id).toBe('g1')
  })

  it('does nothing for a token that is not a contact', async () => {
    const w = world({ contact: coldContact })
    expect(await subscribe({ db: w.db }, 'not-a-token')).toEqual({ ok: false })
    expect(await subscribe({ db: w.db }, '33333333-3333-3333-3333-333333333333')).toEqual({ ok: false })
    expect(w.writes).toEqual([])
  })

  it('builds the link only when it has both halves', () => {
    expect(subscribeUrl('https://app.test/', TOKEN)).toBe(`https://app.test/api/email/subscribe?t=${TOKEN}`)
    expect(subscribeUrl('', TOKEN)).toBe('')
    expect(subscribeUrl('https://app.test', '')).toBe('')
  })
})
