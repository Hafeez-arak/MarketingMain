// ─── What a sender's website says about them ───────────────────────────────
// The sales team verifies who is writing from the email signature, and when
// that is not enough, from the company's website (2026-10-11). The fetch and
// the cache are in api/leads/_website.js; this file is the pure part: which
// addresses may be fetched at all, and the few lines of a page the model reads.

const decode = (s) => String(s || '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' ' })
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => { const c = parseInt(n, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' ' })

const squash = (s) => decode(s).replace(/\s+/g, ' ').trim()

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`, 'i')
  const tag = html.match(re)?.[0] || ''
  return squash(tag.match(/content\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/content\s*=\s*'([^']*)'/i)?.[1] ?? '')
}

/**
 * A page's title, description and the start of its visible text. Scripts,
 * styles and markup go; what is left is short enough for a prompt.
 */
export function pageSummary(html, { maxText = 1200 } = {}) {
  const h = String(html || '')
  const title = squash(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 200)
  const description = (meta(h, 'description') || meta(h, 'og:description')).slice(0, 400)
  const siteName = meta(h, 'og:site_name').slice(0, 120)
  const body = h
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
  return {
    title: siteName && !title.includes(siteName) ? `${siteName}: ${title}`.slice(0, 240) : title,
    description,
    text: squash(body).slice(0, maxText),
  }
}

/** A host we may fetch: a plain public name, never an IP literal, localhost or an internal name. */
export function fetchableHost(host) {
  const h = String(host || '').toLowerCase()
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return false
  if (/^\d+(\.\d+){3}$/.test(h)) return false
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|invalid|example)$/.test(h)) return false
  return h.length <= 253
}

/**
 * Is this resolved address on the public internet? Private, loopback,
 * link-local (cloud metadata lives at 169.254.169.254), carrier-grade NAT,
 * multicast and reserved ranges are refused, in IPv4 and IPv6.
 */
export function publicAddress(ip) {
  const a = String(ip || '').toLowerCase()
  const v4 = a.replace(/^::ffff:/, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [p, q] = v4.split('.').map(Number)
    if (p === 0 || p === 10 || p === 127 || p >= 224) return false
    if (p === 169 && q === 254) return false
    if (p === 172 && q >= 16 && q <= 31) return false
    if (p === 192 && q === 168) return false
    if (p === 100 && q >= 64 && q <= 127) return false
    if (p === 198 && (q === 18 || q === 19)) return false
    return true
  }
  if (!a.includes(':')) return false
  if (a === '::' || a === '::1') return false
  if (/^(fc|fd|fe[89ab]|ff)/.test(a)) return false
  return true
}
