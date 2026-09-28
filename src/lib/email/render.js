// ─── Turning a written email into what is sent ─────────────────────────────
// ONE renderer for the preview and the send, so what a person approved on
// screen is byte-for-byte what leaves. Pure, so the server can import it.
//
// The body is plain text with a little formatting — the format a person (or
// the AI) can write without an editor:
//
//   blank line          new paragraph
//   **bold**            bold
//   [label](https://…)  link
//   - item              bullet list
//   {{first_name}}      merge tag; {{first_name|there}} gives a fallback
//
// Two looks, one per lane:
//   marketing  a branded, simple HTML letter with a real footer: company
//              address, why you are receiving this, and unsubscribe.
//   cold       what a person would type. No template, no images, no tracking
//              pixels in the design — a cold email that looks like a
//              newsletter is read as one, by people and by filters.

const MERGE_FIELDS = {
  first_name: c => c?.first_name,
  last_name: c => c?.last_name,
  full_name: c => [c?.first_name, c?.last_name].filter(Boolean).join(' '),
  company: c => c?.company,
  job_title: c => c?.job_title,
  city: c => c?.city,
  email: c => c?.email,
}

export const MERGE_TAGS = Object.keys(MERGE_FIELDS)

// Links made per recipient at send time, not contact fields. Written as the
// target of a link: [Send me the guide]({{subscribe_url}}). Not offered in the
// "Insert field" list; the composer has its own button for it.
const LINK_FIELDS = {
  // The one-click newsletter sign-up (api/email/[action].js, /subscribe).
  subscribe_url: links => links?.subscribeUrl,
}

export const LINK_TAGS = Object.keys(LINK_FIELDS)

/** The sign-up button a cold email carries: label → link to {{subscribe_url}}. */
export function subscribeButton(label) {
  return `[${String(label || '').replace(/[[\]]/g, '').trim() || 'Subscribe'}]({{subscribe_url}})`
}

/**
 * Fill {{tags}}. An unknown tag is left exactly as written so a typo is
 * visible in the preview rather than silently becoming empty. A known tag with
 * no value and no fallback becomes empty, and the whitespace it leaves is
 * tidied ("Hi {{first_name}}," with no name → "Hi,").
 * @param {object} [links]  { subscribeUrl } for the link tags
 */
export function applyMergeTags(text, contact, links = {}) {
  return String(text || '')
    .replace(/\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi, (whole, key, fallback) => {
      const k = key.toLowerCase()
      const get = MERGE_FIELDS[k]
      if (!get) return LINK_FIELDS[k] ? String(LINK_FIELDS[k](links) || '') : whole
      const value = String(get(contact) || '').trim()
      return value || (fallback ?? '')
    })
    // A link whose target came out empty (no sign-up link for this send) is
    // left as its words, never as "[label]()".
    .replace(/\[([^\]]+)\]\(\s*\)/g, '$1')
    .replace(/ +([,.!?،])/g, '$1')
    .replace(/ {2,}/g, ' ')
}

/** Tags that are written but not known — shown as a warning in the composer. */
export function unknownMergeTags(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(/\{\{\s*([a-z_]+)[^}]*\}\}/gi)) {
    const k = m[1].toLowerCase()
    if (!MERGE_FIELDS[k] && !LINK_FIELDS[k]) out.add(m[1])
  }
  return [...out]
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Only http(s) and mailto links survive. A javascript: URL in an email body
// is not something any sender needs.
export function safeHref(url) {
  const u = String(url || '').trim()
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : ''
}

/** Inline formatting on ONE already-escaped-safe line. */
export function inline(line, { linkStyle = '' } = {}) {
  let out = escapeHtml(line)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, url) => {
    const href = safeHref(url.replace(/&amp;/g, '&'))
    return href ? `<a href="${escapeHtml(href)}"${linkStyle ? ` style="${linkStyle}"` : ''}>${label}</a>` : label
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return out
}

/** Body text → blocks of paragraphs and bullet lists. */
export function blocks(text) {
  const out = []
  for (const chunk of String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n').map(l => l.trimEnd()).filter(l => l.trim())
    if (!lines.length) continue
    if (lines.every(l => /^\s*[-•]\s+/.test(l))) {
      out.push({ type: 'list', items: lines.map(l => l.replace(/^\s*[-•]\s+/, '')) })
    } else {
      out.push({ type: 'p', lines })
    }
  }
  return out
}

// The direction of one paragraph, from its first letter: Arabic (or Hebrew)
// reads right to left, a Latin letter left to right. This is what lets one
// email carry an English half and an Arabic half, each laid out correctly,
// in Outlook too (which ignores dir="auto").
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const LTR_CHAR = /[A-Za-z\u00C0-\u024F]/
export function textDirection(text, fallback = 'ltr') {
  // Link targets and tags are not what a reader sees first.
  const seen = String(text || '').replace(/\]\([^)]*\)/g, ']').replace(/\{\{[^}]*\}\}/g, '')
  for (const ch of seen) {
    if (RTL_CHAR.test(ch)) return 'rtl'
    if (LTR_CHAR.test(ch)) return 'ltr'
  }
  return fallback
}

/** A paragraph that is one link and nothing else: shown as a button. */
const BUTTON_LINE = /^\s*\[([^\]]+)\]\(([^)\s]+)\)\s*$/

/** Body text → plain text, links written as "label (url)". */
export function toPlainText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*•\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const FOOTER_COPY = {
  en: {
    why: name => `You are receiving this because you are in touch with ${name}.`,
    unsubscribe: 'Unsubscribe',
    view: 'Stop these emails',
  },
  ar: {
    why: name => `تصلك هذه الرسالة لأنك على تواصل مع ${name}.`,
    unsubscribe: 'إلغاء الاشتراك',
    view: 'إيقاف هذه الرسائل',
  },
}

/**
 * Render one email for one contact.
 *
 * @param {object} args
 * @param {'marketing'|'cold'} args.audience
 * @param {string} args.subject
 * @param {string} [args.preheader]      marketing only: the grey line inbox previews show
 * @param {string} args.body
 * @param {'en'|'ar'} [args.language]
 * @param {object} [args.contact]
 * @param {object} [args.sender]         { from_name, company_address }
 * @param {string} [args.unsubscribeUrl]
 * @param {string} [args.signature]      cold only: the sending mailbox's signature
 * @param {string} [args.subscribeUrl]   cold only: this recipient's newsletter sign-up link
 * @returns {{ subject: string, html: string, text: string }}
 */
export function renderEmail({
  audience, subject, preheader = '', body, language = 'en', contact = null,
  sender = {}, unsubscribeUrl = '', signature = '', subscribeUrl = '',
}) {
  const rtl = language === 'ar'
  const dir = rtl ? 'rtl' : 'ltr'
  const align = rtl ? 'right' : 'left'
  const links = { subscribeUrl }
  const filledSubject = applyMergeTags(subject, contact, links).trim()
  const filledBody = applyMergeTags(body, contact, links)
  const brand = String(sender.from_name || '').trim()

  if (audience === 'cold') {
    // As plain as a hand-typed email: no images, no pixel, no layout. Each
    // paragraph takes its own direction, so an email written in English and
    // then Arabic reads right in both halves.
    const parts = blocks(filledBody)
    const dirOf = b => textDirection(b.type === 'list' ? b.items[0] : b.lines[0], dir)
    const dirs = new Set(parts.map(dirOf))
    // The opt-out is a sentence, the way a person would write it, and it is
    // always there, in every language the email is written in.
    const OPT_OUT = {
      en: 'If this is not relevant to you, just reply "stop" and I will not email again.',
      ar: 'إذا لم تكن الشخص المناسب أو لا ترغب في رسائل أخرى، يكفي أن ترد بكلمة "توقف".',
    }
    const optOuts = dirs.size > 1 ? [OPT_OUT.en, OPT_OUT.ar] : [rtl ? OPT_OUT.ar : OPT_OUT.en]
    // The sending mailbox's signature (name, role, phone), as typed text.
    const sig = String(signature || '').replace(/\r\n/g, '\n').trim()
    const text = `${toPlainText(filledBody)}${sig ? `\n\n${sig}` : ''}\n\n${optOuts.join('\n')}`
    const attrs = d => `dir="${d}" style="text-align:${d === 'rtl' ? 'right' : 'left'}"`
    const paras = parts.map(b => {
      const d = dirOf(b)
      if (b.type === 'list') return `<ul ${attrs(d)}>${b.items.map(i => `<li>${inline(i)}</li>`).join('')}</ul>`
      // A paragraph that is only a link is the email's one call to action.
      const btn = b.lines.length === 1 && b.lines[0].match(BUTTON_LINE)
      const href = btn && safeHref(btn[2])
      if (href) {
        return `<p ${attrs(d)}><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold">${escapeHtml(btn[1])}</a></p>`
      }
      return `<p ${attrs(d)}>${b.lines.map(l => inline(l)).join('<br>')}</p>`
    }).join('\n')
    const sigHtml = sig ? `\n<p ${attrs(textDirection(sig, dir))}>${sig.split('\n').map(escapeHtml).join('<br>')}</p>` : ''
    const optHtml = optOuts.map(o => `<p dir="${textDirection(o)}" style="color:#777;font-size:12px;text-align:${textDirection(o) === 'rtl' ? 'right' : 'left'}">${escapeHtml(o)}</p>`).join('\n')
    const html = `<div dir="${dir}" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222;text-align:${align}">\n${paras}${sigHtml}\n${optHtml}\n</div>`
    return { subject: filledSubject, html, text }
  }

  const copy = FOOTER_COPY[language] || FOOTER_COPY.en
  const address = String(sender.company_address || '').trim()
  const linkStyle = 'color:#1a1a1a;text-decoration:underline'
  const content = blocks(filledBody).map(b => b.type === 'list'
    ? `<ul style="margin:0 0 16px;padding-${rtl ? 'right' : 'left'}:20px;list-style-type:disc">${b.items.map(i => `<li style="margin:0 0 6px">${inline(i, { linkStyle })}</li>`).join('')}</ul>`
    : `<p style="margin:0 0 16px">${b.lines.map(l => inline(l, { linkStyle })).join('<br>')}</p>`).join('\n')

  const footerLines = [
    brand ? escapeHtml(copy.why(brand)) : '',
    address ? escapeHtml(address).replace(/\n/g, '<br>') : '',
    unsubscribeUrl ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#888;text-decoration:underline">${copy.unsubscribe}</a>` : '',
  ].filter(Boolean)

  const html = `<!doctype html>
<html lang="${language}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(filledSubject)}</title></head>
<body style="margin:0;padding:0;background:#f4f3f0">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(applyMergeTags(preheader, contact))}</div>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3f0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:8px">
${brand ? `<tr><td dir="${dir}" style="padding:24px 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a5c;text-align:${align}">${escapeHtml(brand)}</td></tr>` : ''}
<tr><td dir="${dir}" style="padding:20px 32px 12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;text-align:${align}">
${content}
</td></tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px"><tr><td dir="${dir}" style="padding:16px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#888;text-align:${align}">
${footerLines.join('<br>\n')}
</td></tr></table>
</td></tr></table>
</body>
</html>`

  const text = [
    toPlainText(filledBody),
    '',
    '—',
    brand ? copy.why(brand) : '',
    address,
    unsubscribeUrl ? `${copy.view}: ${unsubscribeUrl}` : '',
  ].filter((l, i) => l || i < 3).join('\n').trim()

  return { subject: filledSubject, html, text }
}

/** What a marketing email is missing before it may be sent. Empty = ready. */
export function marketingProblems({ subject, body, sender }) {
  const out = []
  if (!String(subject || '').trim()) out.push('Add a subject line.')
  if (!String(body || '').trim()) out.push('Write the email body.')
  if (!String(sender?.from_email || '').trim()) out.push('Set the sender address in Settings.')
  if (!String(sender?.company_address || '').trim()) out.push('Add the company address in Settings. It goes in every footer.')
  const unknown = [...unknownMergeTags(subject), ...unknownMergeTags(body)]
  if (unknown.length) out.push(`Unknown merge tag: ${unknown.map(t => `{{${t}}}`).join(', ')}.`)
  return out
}
