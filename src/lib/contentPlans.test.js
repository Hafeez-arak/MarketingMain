import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./supabaseClient', () => ({ SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon' }))
const { insertIdeas } = await import('./contentPlans')

// platform_options arrived in a hand-applied migration. Naming it on an insert
// against a database that has not had that migration fails the WHOLE insert —
// so an Instagram-only plan must never name it, and a batch that does must
// name it on every row, because PostgREST refuses rows with differing keys.

afterEach(() => vi.unstubAllGlobals())

async function sent(ideas) {
  let body
  vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
    body = JSON.parse(opts.body)
    return { ok: true, json: async () => body }
  }))
  await insertIdeas('ws-1', 'tok', 'plan-1', ideas)
  return body
}

describe('insertIdeas — platform_options', () => {
  it('leaves the column out of a plan with no options at all', async () => {
    const rows = await sent([{ platform: 'instagram', topic: 'a' }, { platform: 'linkedin', topic: 'b', platformOptions: {} }])
    expect(rows.every(r => !('platform_options' in r))).toBe(true)
  })

  it('names it on every row once any idea carries a poll', async () => {
    const poll = { question: 'Which?', options: ['a', 'b'], duration: 'SEVEN_DAYS' }
    const rows = await sent([{ platform: 'instagram', topic: 'a' }, { platform: 'linkedin', topic: 'b', platformOptions: { poll } }])
    expect(rows.map(r => r.platform_options)).toEqual([{}, { poll }])
  })
})
