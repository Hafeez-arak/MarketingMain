import { describe, it, expect } from 'vitest'
import { websiteSignup } from './_engine.js'
import { WEBSITE_GROUP } from '../../src/lib/email/contacts.js'

const WS = '00000000-0000-0000-0000-000000000001'
const KEY = 'site_key_0123456789abcdef'

function world({ existing = null, insertWins = true } = {}) {
  const calls = []
  const db = async (path, opts = {}) => {
    const method = opts.method || 'GET'
    calls.push({ method, path, body: opts.body })
    if (method === 'GET' && path.startsWith('email_settings?website_signup_key=eq.')) return path.includes(KEY) ? [{ workspace_id: WS }] : []
    if (method === 'GET' && path.startsWith('email_contacts?')) return existing ? [existing] : []
    if (method === 'POST' && path.startsWith('email_contacts?')) return insertWins ? [{ id: 'c-new', workspace_id: WS }] : []
    if (method === 'GET' && path.startsWith('email_groups?')) return [{ id: 'g-cold', name: 'Riyadh hotels', audience: 'cold' }]
    if (method === 'POST' && path === 'email_groups') return [{ id: 'g-web', name: WEBSITE_GROUP }]
    return method === 'GET' ? [] : null
  }
  return { db, calls }
}
const sign = (w, input, key = KEY) => websiteSignup({ db: w.db }, { key, input, now: new Date('2026-09-29T08:00:00Z') })
const ENQUIRY = { name: 'Sara Al Qahtani', email: ' Sara@Hotel.SA ', company: 'Hotel Co', phone: '+966 5', projectType: 'Hotel / hospitality', lang: 'ar', consent: true }

describe('websiteSignup', () => {
  it('refuses an unknown or malformed form key, touching nothing', async () => {
    for (const key of ['', 'short', 'nope_nope_nope_nope_nope']) {
      const w = world()
      expect(await sign(w, ENQUIRY, key)).toMatchObject({ ok: false, status: 403 })
      expect(w.calls.filter(c => c.method !== 'GET')).toHaveLength(0)
    }
  })

  it('adds nobody when the marketing box was unticked', async () => {
    const w = world()
    expect(await sign(w, { ...ENQUIRY, consent: false })).toEqual({ ok: true, added: false, reason: 'no consent' })
    expect(w.calls.filter(c => c.method !== 'GET')).toHaveLength(0)
  })

  it('a new address becomes an opted-in marketing contact in the website group', async () => {
    const w = world()
    expect(await sign(w, ENQUIRY)).toMatchObject({ ok: true, added: true, created: true })
    const [row] = w.calls.find(c => c.method === 'POST' && c.path.startsWith('email_contacts')).body
    expect(row).toMatchObject({
      workspace_id: WS, email: 'sara@hotel.sa', first_name: 'Sara', last_name: 'Al Qahtani', company: 'Hotel Co',
      language: 'ar', audience: 'marketing', consent: 'opted_in', source: 'website', status: 'active',
    })
    expect(row.notes).toBe('Website enquiry 2026-09-29: Hotel / hospitality')
    const member = w.calls.find(c => c.method === 'POST' && c.path.startsWith('email_group_members'))
    expect(member.body[0]).toMatchObject({ group_id: 'g-web', contact_id: 'c-new' })
  })

  it('a cold prospect moves to marketing, and their outreach stops', async () => {
    const w = world({ existing: { id: 'c-1', workspace_id: WS, audience: 'cold', status: 'active', consent: 'none', notes: 'From research' } })
    expect(await sign(w, ENQUIRY)).toMatchObject({ added: true, created: false, moved: true })
    const patch = w.calls.find(c => c.method === 'PATCH' && c.path.startsWith('email_contacts?id=eq.c-1'))
    expect(patch.body).toMatchObject({ audience: 'marketing', consent: 'opted_in', notes: 'From research\nWebsite enquiry 2026-09-29: Hotel / hospitality' })
    expect(w.calls.find(c => c.method === 'PATCH' && c.path.startsWith('email_sends')).body).toMatchObject({ status: 'cancelled' })
    expect(w.calls.find(c => c.method === 'DELETE' && c.path.includes('group_id=in.("g-cold")'))).toBeTruthy()
  })

  it('never overrides an unsubscribe, a bounce or a spam report', async () => {
    for (const status of ['unsubscribed', 'bounced', 'complained']) {
      const w = world({ existing: { id: 'c-1', workspace_id: WS, audience: 'marketing', status } })
      expect(await sign(w, ENQUIRY)).toEqual({ ok: true, added: false, reason: status })
      expect(w.calls.filter(c => c.method !== 'GET')).toHaveLength(0)
    }
  })

  it('refuses a malformed address', async () => {
    expect(await sign(world(), { ...ENQUIRY, email: 'not-an-email' })).toMatchObject({ ok: false, status: 400 })
  })
})
