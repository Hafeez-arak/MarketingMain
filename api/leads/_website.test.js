import { describe, it, expect } from 'vitest'
import { checkWebsite, fetchSite } from './_website.js'

const NOW = new Date('2026-10-11T12:00:00Z')
function world({ pages = {}, ips = {}, cached = [] } = {}) {
  const state = { rows: [...cached], fetched: [] }
  const deps = {
    now: () => NOW,
    resolve: async (h) => ips[h] || ['93.184.216.34'],
    db: async (path, init = {}) => {
      if (path.startsWith('lead_domains?domain=eq.')) return state.rows.filter((r) => path.endsWith(encodeURIComponent(r.domain) + '&select=*'))
      if (path.startsWith('lead_domains?on_conflict')) { state.rows = state.rows.filter((r) => r.domain !== init.body.domain).concat(init.body); return [] }
      throw new Error(path)
    },
    fetch: async (url) => {
      state.fetched.push(url)
      const p = pages[url]
      if (!p) throw new TypeError('fetch failed')
      return new Response(p.body ?? '', { status: p.status ?? 200, headers: p.headers ?? { 'content-type': 'text/html' } })
    },
  }
  return { state, deps }
}

describe('checkWebsite', () => {
  it('reads the homepage once and remembers it', async () => {
    const w = world({ pages: { 'https://nour.sa/': { body: '<title>Nour Contracting</title><p>MEP works</p>' } } })
    const a = await checkWebsite(w.deps, 'Nour.sa')
    expect(a).toMatchObject({ domain: 'nour.sa', ok: true, title: 'Nour Contracting', cached: false })
    const b = await checkWebsite(w.deps, 'nour.sa')
    expect(b).toMatchObject({ ok: true, cached: true })
    expect(w.state.fetched).toHaveLength(1)
  })
  it('falls back to www. and follows a checked redirect', async () => {
    const w = world({ pages: {
      'https://www.nour.sa/': { status: 301, headers: { location: '/en' } },
      'https://www.nour.sa/en': { body: '<title>Nour</title>' },
    } })
    expect(await fetchSite(w.deps, 'nour.sa')).toMatchObject({ ok: true, title: 'Nour' })
  })
  it('never fetches a domain that resolves to a private address, or a redirect into one', async () => {
    const w = world({ ips: { 'evil.example': ['169.254.169.254'], 'www.evil.example': ['10.0.0.1'] } })
    expect(await fetchSite(w.deps, 'evil.example')).toMatchObject({ ok: false, error: 'not a public address' })
    const r = world({ ips: { 'inside.example': ['127.0.0.1'] }, pages: { 'https://ok.example/': { status: 302, headers: { location: 'http://inside.example/' } } } })
    expect(await fetchSite(r.deps, 'ok.example')).toMatchObject({ ok: false, error: 'not a public address' })
    expect(w.state.fetched).toHaveLength(0)
  })
  it('a dead site is a result, remembered briefly, never an exception', async () => {
    const w = world()
    expect(await checkWebsite(w.deps, 'dead.example')).toMatchObject({ ok: false })
    expect(w.state.rows[0]).toMatchObject({ domain: 'dead.example', ok: false })
  })
})
