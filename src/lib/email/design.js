import { applyMergeTags, escapeHtml, inline, blocks as paragraphs, safeHref, toPlainText, FOOTER_COPY } from './render.js'

// ─── Designed emails: blocks in, email HTML out ────────────────────────────
// The drag-and-drop editor edits a small document — a style and a list of
// blocks — and this file turns that document into the HTML that is sent. The
// editor's canvas, the preview, the test email and the real send all call
// renderDesign, so what someone arranged on screen is what arrives.
//
// Email HTML is not web HTML. The rules this follows, because inboxes
// (Outlook above all) ignore most CSS:
//   • tables for layout, every style inline, a 600px column
//   • no background images, no web fonts, no scripts, no forms
//   • buttons are table cells with padding, so they stay buttons in Outlook
//   • "image beside text" is two inline-blocks that stack on a phone without
//     needing a media query (Gmail's app strips <style>)
//   • every image has alt text, because many inboxes block images at first
//
// Pure: the server imports it (api/email/_engine.js).

export const FONTS = {
  arial:   { label: 'Arial',   stack: 'Arial, Helvetica, sans-serif' },
  tahoma:  { label: 'Tahoma (good for Arabic)', stack: 'Tahoma, Arial, sans-serif' },
  georgia: { label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  verdana: { label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
}

export const DEFAULT_STYLE = Object.freeze({
  background: '#f4f3f0',
  panel: '#ffffff',
  text: '#1a1a1a',
  accent: '#4c5e61',
  font: 'arial',
})

// What each block is, what it starts as, and what the palette calls it.
export const BLOCK_TYPES = {
  logo:    { label: 'Logo',            hint: 'Your logo from Brand Brain',          make: () => ({ src: '', alt: '', width: 140, align: 'center', href: '' }) },
  heading: { label: 'Heading',         hint: 'A large title',                       make: () => ({ text: 'Your headline', size: 'lg', align: 'left' }) },
  text:    { label: 'Text',            hint: 'Paragraphs, bold, links, bullets',    make: () => ({ text: 'Write something here.', align: 'left' }) },
  image:   { label: 'Image',           hint: 'A photo, full width or smaller',      make: () => ({ src: '', alt: '', href: '', width: 100, align: 'center' }) },
  button:  { label: 'Button',          hint: 'One clear action',                    make: () => ({ label: 'Learn more', href: 'https://', align: 'left', color: '' }) },
  columns: { label: 'Image + text',    hint: 'Side by side; stacks on a phone',     make: () => ({ src: '', alt: '', href: '', text: '**A short title**\n\nA sentence or two about it.', imageSide: 'left' }) },
  divider: { label: 'Divider',         hint: 'A thin line between sections',        make: () => ({ color: '#e2e2e2' }) },
  spacer:  { label: 'Space',           hint: 'Empty room between blocks',           make: () => ({ height: 24 }) },
  social:  { label: 'Links row',       hint: 'Website, LinkedIn, Instagram…',       make: () => ({ links: [{ label: 'Website', href: 'https://' }, { label: 'LinkedIn', href: 'https://' }, { label: 'Instagram', href: 'https://' }] }) },
}

let seq = 0
export function newId() {
  seq += 1
  return `b${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function makeBlock(type, props = {}) {
  const def = BLOCK_TYPES[type]
  if (!def) throw new Error(`Unknown block type: ${type}`)
  return { id: newId(), type, ...def.make(), ...props }
}

// ── Guards ──
// Values come from a browser and end up inside an HTML attribute. Only a
// colour that is a colour, and only a URL that is a web URL, gets through.
export function safeColor(value, fallback) {
  const v = String(value || '').trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback
}
export function safeImage(url) {
  const u = String(url || '').trim()
  return /^https:\/\//i.test(u) ? u : ''
}
/** A link that goes somewhere: a web or mailto URL, not the empty "https://" a new block starts with. */
export function realLink(url) {
  const href = safeHref(url)
  return href && !/^https?:\/\/?$/i.test(href) ? href : ''
}
const clamp = (n, lo, hi, d) => {
  const x = Number(n)
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d
}
const ALIGN = new Set(['left', 'center', 'right'])
const alignOf = (a, rtl) => (ALIGN.has(a) ? (rtl && a === 'left' ? 'right' : rtl && a === 'right' ? 'left' : a) : (rtl ? 'right' : 'left'))

/** A design object with every field present and valid. */
export function normalizeDesign(design) {
  const style = { ...DEFAULT_STYLE, ...(design?.style || {}) }
  return {
    version: 1,
    style: {
      background: safeColor(style.background, DEFAULT_STYLE.background),
      panel: safeColor(style.panel, DEFAULT_STYLE.panel),
      text: safeColor(style.text, DEFAULT_STYLE.text),
      accent: safeColor(style.accent, DEFAULT_STYLE.accent),
      font: FONTS[style.font] ? style.font : DEFAULT_STYLE.font,
    },
    blocks: (Array.isArray(design?.blocks) ? design.blocks : [])
      .filter(b => b && BLOCK_TYPES[b.type])
      .map(b => ({ ...BLOCK_TYPES[b.type].make(), ...b, id: b.id || newId() })),
  }
}

export function hasDesign(design) {
  return Array.isArray(design?.blocks) && design.blocks.length > 0
}

// ── One block → HTML ──

function textHtml(text, contact, { color, font, size = 15, align, linkColor }) {
  const linkStyle = `color:${linkColor};text-decoration:underline`
  return paragraphs(applyMergeTags(text, contact)).map(p => p.type === 'list'
    ? `<ul style="margin:0 0 14px;padding-${align === 'right' ? 'right' : 'left'}:20px;list-style-type:disc;font-family:${font};font-size:${size}px;line-height:1.6;color:${color};text-align:${align}">${p.items.map(i => `<li style="margin:0 0 6px">${inline(i, { linkStyle })}</li>`).join('')}</ul>`
    : `<p style="margin:0 0 14px;font-family:${font};font-size:${size}px;line-height:1.6;color:${color};text-align:${align}">${p.lines.map(l => inline(l, { linkStyle })).join('<br>')}</p>`).join('')
}

function imgTag({ src, alt, href, widthPx, maxWidth = '100%' }) {
  const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="${widthPx}" style="display:block;width:100%;max-width:${maxWidth === '100%' ? `${widthPx}px` : maxWidth};height:auto;border:0;outline:none;text-decoration:none">`
  const link = realLink(href)
  return link ? `<a href="${escapeHtml(link)}" target="_blank">${img}</a>` : img
}

function row(inner, { pad = '8px 32px', align = 'left' } = {}) {
  return `<tr><td style="padding:${pad};text-align:${align}">${inner}</td></tr>`
}

export function blockHtml(block, { style, contact, rtl }) {
  const font = FONTS[style.font].stack
  const align = alignOf(block.align, rtl)
  switch (block.type) {
    case 'logo': {
      const src = safeImage(block.src)
      if (!src) return ''
      const w = clamp(block.width, 40, 400, 140)
      return row(`<table role="presentation" cellspacing="0" cellpadding="0" align="${align}" style="margin:${align === 'center' ? '0 auto' : '0'}"><tr><td>${imgTag({ src, alt: block.alt || 'Logo', href: block.href, widthPx: w })}</td></tr></table>`, { pad: '24px 32px 8px', align })
    }
    case 'heading': {
      const size = block.size === 'md' ? 20 : 26
      return row(`<h1 style="margin:0;font-family:${font};font-size:${size}px;line-height:1.25;font-weight:bold;color:${style.text};text-align:${align}">${escapeHtml(applyMergeTags(block.text, contact))}</h1>`, { pad: '16px 32px 8px', align })
    }
    case 'text':
      return row(textHtml(block.text, contact, { color: style.text, font, align, linkColor: style.accent }), { pad: '4px 32px 2px', align })
    case 'image': {
      const src = safeImage(block.src)
      if (!src) return ''
      const pct = clamp(block.width, 20, 100, 100)
      const px = Math.round(536 * pct / 100)
      return row(`<table role="presentation" cellspacing="0" cellpadding="0" align="${align}" width="${px}" style="width:${pct}%;max-width:${px}px;margin:${align === 'center' ? '0 auto' : '0'}"><tr><td>${imgTag({ src, alt: block.alt, href: block.href, widthPx: px })}</td></tr></table>`, { pad: '8px 32px', align })
    }
    case 'button': {
      const href = realLink(block.href)
      const bg = safeColor(block.color, style.accent)
      const label = escapeHtml(applyMergeTags(block.label, contact))
      if (!href || !label) return ''
      return row(`<table role="presentation" cellspacing="0" cellpadding="0" align="${align}" style="margin:${align === 'center' ? '0 auto' : '0'}"><tr><td style="background:${bg};border-radius:4px"><a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${font};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none">${label}</a></td></tr></table>`, { pad: '12px 32px', align })
    }
    case 'columns': {
      const src = safeImage(block.src)
      const imageCell = src
        ? `<div style="display:inline-block;width:100%;max-width:256px;vertical-align:top">${imgTag({ src, alt: block.alt, href: block.href, widthPx: 256 })}</div>`
        : ''
      const textCell = `<div style="display:inline-block;width:100%;max-width:${src ? 256 : 536}px;vertical-align:top;text-align:${rtl ? 'right' : 'left'}">${textHtml(block.text, contact, { color: style.text, font, align: rtl ? 'right' : 'left', linkColor: style.accent })}</div>`
      // Direction decides which cell comes first; the gap is a spacer div so
      // the pair still fits 536px when side by side and stacks cleanly below.
      const imageFirst = (block.imageSide !== 'right') !== rtl
      const gap = src ? '<div style="display:inline-block;width:24px;font-size:0;line-height:0">&nbsp;</div>' : ''
      const cells = imageFirst ? `${imageCell}${gap}${textCell}` : `${textCell}${gap}${imageCell}`
      return row(`<div style="font-size:0;text-align:${rtl ? 'right' : 'left'}" dir="${rtl ? 'rtl' : 'ltr'}">${cells}</div>`, { pad: '12px 32px' })
    }
    case 'divider':
      return row(`<div style="border-top:1px solid ${safeColor(block.color, '#e2e2e2')};font-size:0;line-height:0">&nbsp;</div>`, { pad: '12px 32px' })
    case 'spacer':
      return `<tr><td style="height:${clamp(block.height, 4, 120, 24)}px;font-size:0;line-height:0">&nbsp;</td></tr>`
    case 'social': {
      const links = (block.links || []).map(l => ({ label: String(l?.label || '').trim(), href: realLink(l?.href) }))
        .filter(l => l.label && l.href)
      if (!links.length) return ''
      const sep = `<span style="color:#bbbbbb">&nbsp;·&nbsp;</span>`
      return row(`<p style="margin:0;font-family:${font};font-size:13px;color:${style.text};text-align:center">${links.map(l => `<a href="${escapeHtml(l.href)}" target="_blank" style="color:${style.accent};text-decoration:none;font-weight:bold">${escapeHtml(l.label)}</a>`).join(sep)}</p>`, { pad: '12px 32px', align: 'center' })
    }
    default:
      return ''
  }
}

function blockText(block, contact) {
  switch (block.type) {
    case 'heading': return applyMergeTags(block.text, contact).toUpperCase()
    case 'text': return toPlainText(applyMergeTags(block.text, contact))
    case 'image': return realLink(block.href) ? `${block.alt || 'Image'}: ${block.href}` : ''
    case 'button': return realLink(block.href) ? `${applyMergeTags(block.label, contact)}: ${block.href}` : ''
    case 'columns': return [toPlainText(applyMergeTags(block.text, contact)), realLink(block.href)].filter(Boolean).join('\n')
    case 'divider': return '—'
    case 'social': return (block.links || []).filter(l => realLink(l?.href)).map(l => `${l.label}: ${l.href}`).join('\n')
    default: return ''
  }
}

/**
 * Render a designed email for one recipient.
 * Same shape and footer rules as renderEmail: the footer (why you get this,
 * the postal address, unsubscribe) is always added and cannot be removed.
 */
export function renderDesign({ design, subject, preheader = '', language = 'en', contact = null, sender = {}, unsubscribeUrl = '' }) {
  const d = normalizeDesign(design)
  const rtl = language === 'ar'
  const dir = rtl ? 'rtl' : 'ltr'
  const font = FONTS[d.style.font].stack
  const brand = String(sender.from_name || '').trim()
  const address = String(sender.company_address || '').trim()
  const copy = FOOTER_COPY[language] || FOOTER_COPY.en
  const filledSubject = applyMergeTags(subject, contact).trim()

  const body = d.blocks.map(b => blockHtml(b, { style: d.style, contact, rtl })).join('\n')
  const footer = [
    brand ? escapeHtml(copy.why(brand)) : '',
    address ? escapeHtml(address).replace(/\n/g, '<br>') : '',
    unsubscribeUrl ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#888888;text-decoration:underline">${copy.unsubscribe}</a>` : '',
  ].filter(Boolean).join('<br>\n')

  const html = `<!doctype html>
<html lang="${language}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(filledSubject)}</title></head>
<body style="margin:0;padding:0;background:${d.style.background}">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(applyMergeTags(preheader, contact))}</div>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${d.style.background}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" dir="${dir}" style="max-width:600px;background:${d.style.panel}">
${body}
<tr><td style="height:16px;font-size:0;line-height:0">&nbsp;</td></tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px"><tr><td dir="${dir}" style="padding:16px 32px;font-family:${font};font-size:12px;line-height:1.5;color:#888888;text-align:${rtl ? 'right' : 'left'}">
${footer}
</td></tr></table>
</td></tr></table>
</body>
</html>`

  const text = [
    d.blocks.map(b => blockText(b, contact)).filter(Boolean).join('\n\n'),
    '',
    '—',
    brand ? copy.why(brand) : '',
    address,
    unsubscribeUrl ? `${copy.view}: ${unsubscribeUrl}` : '',
  ].filter((l, i) => l || i < 3).join('\n').trim()

  return { subject: filledSubject, html, text }
}

/**
 * What stops a design going out, and what would hurt it in the inbox.
 * `problems` block sending; `warnings` are advice.
 */
export function designChecks(design) {
  const d = normalizeDesign(design)
  const problems = []
  const warnings = []
  if (!d.blocks.length) problems.push('Add at least one block to the email.')
  let words = 0
  let images = 0
  for (const b of d.blocks) {
    if (['image', 'logo', 'columns'].includes(b.type) && b.src && !safeImage(b.src)) {
      problems.push(`${BLOCK_TYPES[b.type].label}: the picture address must start with https://`)
    }
    if (['image', 'columns'].includes(b.type) && safeImage(b.src)) {
      images++
      if (!String(b.alt || '').trim()) warnings.push(`${BLOCK_TYPES[b.type].label}: add a short description (alt text). Many inboxes hide pictures until the reader allows them.`)
    }
    if (b.type === 'image' && !safeImage(b.src)) warnings.push('An image block has no picture yet. It is left out of the email.')
    if (b.type === 'button' && !realLink(b.href)) problems.push(`Button “${b.label || 'untitled'}” needs a link.`)
    if (b.type === 'text' || b.type === 'columns') words += String(b.text || '').split(/\s+/).filter(Boolean).length
    if (b.type === 'heading') words += String(b.text || '').split(/\s+/).filter(Boolean).length
  }
  // Spam filters read an email that is mostly pictures as an advert, and a
  // reader with images off sees nothing. Roughly: a picture wants ~50 words.
  if (images && words < images * 50) {
    warnings.push(`Mostly pictures: ${images} image${images === 1 ? '' : 's'} and about ${words} words. Add some text so filters and readers with images off still get the message.`)
  }
  return { problems, warnings }
}

/** Plain body text (from AI or the plain editor) → a design to start from. */
export function designFromText({ body, subject = '', logo = '', style = {} }) {
  const blocksOut = []
  if (safeImage(logo)) blocksOut.push(makeBlock('logo', { src: logo, alt: 'Logo' }))
  if (subject) blocksOut.push(makeBlock('heading', { text: subject }))
  const chunks = String(body || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
  let textBuf = []
  const flush = () => { if (textBuf.length) { blocksOut.push(makeBlock('text', { text: textBuf.join('\n\n') })); textBuf = [] } }
  for (const chunk of chunks) {
    // A paragraph that is only a link becomes a button: that is almost always
    // what "[See the project](url)" on its own line is for.
    const m = /^\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/.exec(chunk)
    if (m) { flush(); blocksOut.push(makeBlock('button', { label: m[1], href: m[2] })); continue }
    if (chunk.trim()) textBuf.push(chunk.trim())
  }
  flush()
  return normalizeDesign({ style, blocks: blocksOut })
}

/** Hex colours written anywhere in the Brand Brain's colour notes. */
export function brandSwatches(brandColors) {
  const out = []
  for (const m of String(brandColors || '').matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) {
    const c = m[0].toLowerCase()
    if (!out.includes(c)) out.push(c)
  }
  return out.slice(0, 8)
}

/** Starting points. `logo` is the Brand Brain logo URL, when there is one. */
export function templates({ logo = '', accent = DEFAULT_STYLE.accent, website = 'https://arak-sa.com' } = {}) {
  const logoBlock = () => (safeImage(logo) ? [makeBlock('logo', { src: logo, alt: 'Logo' })] : [])
  const style = { ...DEFAULT_STYLE, accent: safeColor(accent, DEFAULT_STYLE.accent) }
  return [
    {
      key: 'letter', label: 'Simple letter', hint: 'Logo and text. Reads like a personal note; best for deliverability.',
      design: { style, blocks: [
        ...logoBlock(),
        makeBlock('text', { text: 'Hi {{first_name|there}},\n\nWrite your message here.\n\nBest regards,\nThe team' }),
      ] },
    },
    {
      key: 'project', label: 'Project showcase', hint: 'A finished project: photo, story, link.',
      design: { style, blocks: [
        ...logoBlock(),
        makeBlock('heading', { text: 'A project we just finished' }),
        makeBlock('image', { alt: 'The finished project' }),
        makeBlock('text', { text: 'Hi {{first_name|there}},\n\nA few lines about the project: the client, the challenge, and what we did.\n\n- What made it difficult\n- How the lighting solved it' }),
        makeBlock('button', { label: 'See the project', href: website }),
      ] },
    },
    {
      key: 'newsletter', label: 'Newsletter', hint: 'Two or three short stories, each with a picture.',
      design: { style, blocks: [
        ...logoBlock(),
        makeBlock('heading', { text: 'News from us this month' }),
        makeBlock('text', { text: 'Hi {{first_name|there}},\n\nHere is what has been happening.' }),
        makeBlock('columns', { text: '**First story**\n\nOne or two sentences about it.', imageSide: 'left' }),
        makeBlock('divider'),
        makeBlock('columns', { text: '**Second story**\n\nOne or two sentences about it.', imageSide: 'right' }),
        makeBlock('button', { label: 'Visit our website', href: website, align: 'center' }),
        makeBlock('social', { links: [{ label: 'Website', href: website }, { label: 'LinkedIn', href: 'https://' }, { label: 'Instagram', href: 'https://' }] }),
      ] },
    },
    {
      key: 'event', label: 'Event invitation', hint: 'Date, place, one button to reply or register.',
      design: { style, blocks: [
        ...logoBlock(),
        makeBlock('heading', { text: 'You are invited', align: 'center' }),
        makeBlock('image', { alt: 'Event' }),
        makeBlock('text', { text: 'Hi {{first_name|there}},\n\n**Date:** …\n**Place:** …\n\nA sentence on why it is worth coming.', align: 'center' }),
        makeBlock('button', { label: 'Reserve your place', href: website, align: 'center' }),
      ] },
    },
  ].map(t => ({ ...t, design: normalizeDesign(t.design) }))
}
