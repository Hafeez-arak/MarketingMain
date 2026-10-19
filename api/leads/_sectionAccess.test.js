import { describe, it, expect, vi } from 'vitest'
import { sectionFor, hasSection, sectionGate } from './_sectionAccess.js'

describe('sectionGate', () => {
  const call = (f) => sectionGate({ url: 'http://db', apikey: 'k', token: 't', workspaceId: 'w', sections: ['marketing'], min: 'work', fetch: f })
  it('asks has_any_section with the caller\'s token', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => true }))
    expect(await call(f)).toBe(true)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('http://db/rest/v1/rpc/has_any_section')
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(JSON.parse(init.body)).toEqual({ ws: 'w', secs: ['marketing'], min_level: 'work' })
  })
  it('a false is no', async () => {
    expect(await call(async () => ({ ok: true, status: 200, json: async () => false }))).toBe(false)
  })
  it('lets v1 through only when the function does not exist yet', async () => {
    expect(await call(async () => ({ ok: false, status: 404, json: async () => ({ code: 'PGRST202' }) }))).toBe(true)
    expect(await call(async () => ({ ok: false, status: 401, json: async () => ({ code: 'PGRST301' }) }))).toBe(false)
    expect(await call(async () => ({ ok: false, status: 500, json: async () => ({}) }))).toBe(false)
    expect(await call(async () => { throw new Error('down') })).toBe(false)
  })
})

const SALES = new Set(['review', 'assign', 'lead_mark'])

describe('sectionFor', () => {
  it('maps the CEO panel\'s actions by level', () => {
    expect(sectionFor('control', SALES)).toEqual({ section: 'ceo', min: 'view' })
    expect(sectionFor('remind', SALES)).toEqual({ section: 'ceo', min: 'work' })
    expect(sectionFor('targets_save', SALES)).toEqual({ section: 'ceo', min: 'manage' })
  })
  it('a salesperson\'s actions need work; everything else in the lead agent needs manage', () => {
    expect(sectionFor('assign', SALES)).toEqual({ section: 'sales', min: 'work' })
    expect(sectionFor('save_key', SALES)).toEqual({ section: 'sales', min: 'manage' })
    expect(sectionFor('mail_connect_start', SALES)).toEqual({ section: 'sales', min: 'manage' })
  })
})

describe('hasSection', () => {
  it('asks has_section with the caller\'s token and believes only a true', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => true }))
    expect(await hasSection({ url: 'http://db', apikey: 'k', token: 't', workspaceId: 'w', section: 'sales', min: 'work', fetch: f })).toBe(true)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('http://db/rest/v1/rpc/has_section')
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(JSON.parse(init.body)).toEqual({ ws: 'w', sec: 'sales', min_level: 'work' })
  })
  it('says no when the function is missing (production before v2) or anything fails', async () => {
    expect(await hasSection({ url: 'u', token: 't', fetch: async () => ({ ok: false, json: async () => ({}) }) })).toBe(false)
    expect(await hasSection({ url: 'u', token: 't', fetch: async () => { throw new Error('down') } })).toBe(false)
    expect(await hasSection({ url: 'u', token: 't', fetch: async () => ({ ok: true, json: async () => 'yes' }) })).toBe(false)
  })
})
