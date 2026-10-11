import { describe, it, expect } from 'vitest'
import { pageSummary, fetchableHost, publicAddress } from './website.js'

describe('pageSummary', () => {
  it('keeps the title, description and visible text, drops scripts and markup', () => {
    const html = `<html><head><title>Nour Contracting &amp; Co</title>
      <meta name="description" content="MEP contractor for hotels in Riyadh">
      <meta property="og:site_name" content="Nour"></head>
      <body><script>var x = "secret"</script><style>.a{}</style><h1>Projects</h1><p>Hotels&nbsp;and schools</p></body></html>`
    const s = pageSummary(html)
    expect(s.title).toBe('Nour Contracting & Co') // the site name is already in the title
    expect(s.description).toBe('MEP contractor for hotels in Riyadh')
    expect(s.text).toContain('Projects Hotels and schools')
    expect(s.text).not.toContain('secret')
  })
  it('caps the text', () => expect(pageSummary(`<p>${'a '.repeat(5000)}</p>`).text.length).toBeLessThanOrEqual(1200))
})

describe('the fetch guard', () => {
  it('only plain public names', () => {
    expect(fetchableHost('besix.com')).toBe(true)
    for (const h of ['localhost', '127.0.0.1', 'intranet.corp', 'box.local', 'nodot', 'a b.com']) expect(fetchableHost(h)).toBe(false)
  })
  it('refuses private, loopback, link-local and metadata addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.1.5', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(publicAddress(ip)).toBe(false)
    }
    expect(publicAddress('8.8.8.8')).toBe(true)
    expect(publicAddress('2606:4700::1111')).toBe(true)
  })
})
