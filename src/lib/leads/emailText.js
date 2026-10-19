// ─── An email's text, as a person should see it (2026-10-19) ───────────────
// We store the plain-text body Microsoft hands back, and its plain text is
// noisy: every picture becomes "[cid:…]", and every link is written twice,
// "www.example.com<http://www.example.com>", or "Download<https://…>". The
// owner: "the documents or links from the email are not shown properly".
//
// This turns the stored text into pieces the page draws: plain text, and
// links it can click. Only http(s) and mailto links are kept, and the page
// draws them as React elements, never as HTML. Pure, so it is tested.

const cleanUrl = (u) => String(u).replace(/[.,;:!?)\]]+$/, '')
const bare = (u) => String(u).toLowerCase().replace(/^(https?:\/\/|mailto:)/, '').replace(/^www\./, '').replace(/\/+$/, '')

/** "sharepoint.com" from a link, for a link whose words say nothing. */
export function hostOf(href) {
  try {
    const h = new URL(href).hostname.replace(/^www\./, '')
    return h.split('.').slice(-3).join('.')
  } catch { return '' }
}

/** The stored text with the picture placeholders and doubled links removed. */
export function tidyEmail(text = '') {
  return String(text ?? '')
    // Pictures (logos, signatures) as Microsoft writes them in plain text.
    .replace(/\[cid:[^\]\n]*\]/gi, '')
    // "name@x.com<mailto:name@x.com>": the address once.
    .replace(/([^\s<>]+)<mailto:([^>\s]+)>/gi, (m, label, addr) => (bare(label) === bare(addr) ? label : `${label} (${addr})`))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const LINKED = /([^\s<>]*)<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>]+)|(\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>]*)/gi

/**
 * The email as pieces: { text } and { link, href, host }. A doubled link
 * becomes one link; a link with its own words ("Download<https://…>") keeps
 * the words and shows where it goes.
 */
export function emailSegments(text = '') {
  const s = tidyEmail(text)
  const out = []
  const push = (piece) => {
    const last = out[out.length - 1]
    if (piece.text !== undefined && last?.text !== undefined) last.text += piece.text
    else out.push(piece)
  }
  let at = 0
  for (const m of s.matchAll(LINKED)) {
    if (m.index > at) push({ text: s.slice(at, m.index) })
    const [whole, label, angled, plain, www] = m
    if (angled) {
      const href = cleanUrl(angled)
      if (label && bare(label) !== bare(href) && !/^https?:\/\//i.test(label)) {
        push({ text: `${label} ` })
        push({ link: hostOf(href) || href, href, host: hostOf(href) })
      } else {
        push({ link: label || href, href, host: hostOf(href) })
      }
    } else {
      const raw = plain || www
      const href = cleanUrl(plain ? raw : `https://${raw}`)
      const shown = cleanUrl(raw)
      push({ link: shown, href, host: hostOf(href) })
      if (raw.length > shown.length) push({ text: raw.slice(shown.length) })
    }
    at = m.index + whole.length
  }
  if (at < s.length) push({ text: s.slice(at) })
  return out
}

/** The links in an email, once each, for "Links in this email". */
export function emailLinks(text = '') {
  const seen = new Set()
  return emailSegments(text).filter((p) => p.href && !/^mailto:/i.test(p.href) && !seen.has(bare(p.href)) && seen.add(bare(p.href)))
}

// Links that are almost certainly documents to download, not a website.
const FILE_HOSTS = /sharepoint\.com|onedrive|1drv\.ms|wetransfer|we\.tl|dropbox|drive\.google|docs\.google|box\.com|mega\.nz|transfernow|smash\.|filemail/i

/** True for a link that shares files (SharePoint, WeTransfer, Drive…). */
export const isFileLink = (href = '') => FILE_HOSTS.test(href) || /\.(pdf|xlsx?|docx?|dwg|zip|rar)(\?|$)/i.test(href)

/** "1.2 MB", "340 KB". */
export function fileSize(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} MB`
  return `${Math.max(1, Math.round(n / 1e3))} KB`
}
