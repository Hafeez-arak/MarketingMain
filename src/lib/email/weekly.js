import { brandDateKey } from '../brandTime.js'

// ─── The weekly email drafts: what the model is told, and what comes back ──
// Every Monday the agent container writes three marketing-email options for
// the week. This module decides the CONTEXT, which is the whole job: a model
// given the brand alone writes generic newsletters; a model given everything
// writes about whatever was loudest. So each input is chosen for one reason,
// trimmed to what that reason needs, and labelled with how to use it.
//
//   SYSTEM (cached, stable between Brand Brain edits)
//     1. Identity: what a weekly email is for, and the rules that never bend.
//     2. Brand block: buildContext() via loadBrandContext — who we are, what
//        we sell, tone, audiences, compliance. The one source of brand truth.
//
//   USER TURN (this week only, ~2-4k tokens, every field capped)
//     3. Dates: today and the week, in Riyadh time.
//     4. Audience: how many marketing contacts, what kinds, which language,
//        and the groups by name — so an option can say who it is for, and
//        Arabic is written when enough of the list reads Arabic.
//     5. What we already emailed: the last campaigns with their open and
//        click rates, and last week's AI angles — so nothing repeats and
//        what worked is visible.
//     6. What we posted: recent published social posts — the stories we are
//        already telling, which an email can extend rather than contradict.
//     7. Research: the latest completed run's headline and its marketing
//        findings, with the run's AGE stated — a stale brief must not be
//        presented as this week's news.
//     8. Events and the calendar: dated things coming up, computed or
//        researched, with what we decided about them (exhibiting, visiting).
//     9. Market activity: open sales leads as SECTOR signals only. They are
//        other companies' projects; the model is told never to imply we
//        worked on them or to name them.
//    10. The website, as the only link the model may use unprompted.
//
// Deliberately NOT sent: contact names or addresses (the model does not need
// a single person to write a newsletter), prices, competitor detail beyond
// what the findings say (and the model is told not to name competitors), and
// the full research report (33 findings, most for sales or technical).
//
// Pure: server/agentHandlers/emailWeekly.js does the reads and the call.

export const WEEKLY_MAX = {
  groups: 8,
  campaigns: 6,
  lastWeek: 6,
  posts: 8,
  findings: 8,
  events: 6,
  leads: 5,
  calendar: 6,
  field: 280,
}

const clip = (s, n = WEEKLY_MAX.field) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** The Monday of `now`'s week, in Riyadh time, as YYYY-MM-DD. */
export function weekOf(now = new Date()) {
  const key = brandDateKey(now)
  const d = new Date(`${key}T00:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

export function daysBetweenIso(a, b) {
  const x = Date.parse(a)
  const y = Date.parse(b)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return Math.round((y - x) / 86_400_000)
}

export const WEEKLY_IDENTITY = [
  'You plan and write the weekly marketing email for one B2B company, in its own voice.',
  'Each Monday you propose THREE options for this week\'s email. A person picks one,',
  'edits it, and sends it to people who already know the company: customers, partners,',
  'consultants and contractors. It is not cold outreach and not an advert.',
  '',
  'What makes a good option:',
  '- One idea, useful to the reader, tied to something real this week: a date, an event,',
  '  a market movement from the research, or a story we are already telling on social.',
  '- 90 to 180 words. Short paragraphs. One clear next step (the CTA).',
  '- The three options take genuinely different angles, not three rewordings.',
  '',
  'Rules that never bend:',
  '- Use only facts in the brand block and in this week\'s inputs. Never invent projects,',
  '  clients, numbers, awards, dates, prices, delivery times or discounts.',
  '- "Market activity" items are OTHER companies\' projects. You may say a sector is busy',
  '  (for example hotel construction in Riyadh); you must never name those projects or',
  '  imply the company worked on them.',
  '- Never name a competitor.',
  '- Do not repeat a subject or angle from the recent emails or last week\'s drafts.',
  '- If the research is more than 10 days old, do not present it as this week\'s news;',
  '  lean on the calendar, events and evergreen usefulness instead, and say so in `note`.',
  '- No exclamation marks in subjects, no ALL CAPS, no spam words ("free", "guarantee",',
  '  "act now", "limited time").',
  '',
  'Format of `body`:',
  '- Blank line between paragraphs, **bold**, and "- " bullets only. No HTML, no headings.',
  '- Do NOT put the CTA link in the body: it becomes a button from cta_label and cta_url.',
  '- No signature and no unsubscribe line; both are added when it is sent.',
  '- Merge tags allowed: {{first_name|there}}, {{company}}. No others.',
  '',
  'The CTA:',
  '- cta_url must be the website given in the inputs, or empty. When empty, the CTA is a',
  '  reply ("Reply to this email and …") written into the body, and cta_label is empty.',
  '',
  'Arabic:',
  '- When the inputs ask for Arabic, fill the ar_ fields with natural Gulf business Arabic',
  '  (فصحى مبسطة) written for the same angle — not a word-for-word translation.',
  '- When they do not, every ar_ field is an empty string.',
].join('\n')

export const WEEKLY_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['note', 'options'],
    properties: {
      note: { type: 'string', description: 'One sentence: what this week\'s inputs were strong or thin on (e.g. research is 11 days old). Empty string if nothing to say.' },
      options: {
        type: 'array',
        description: 'Exactly three options, strongest first.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['angle', 'why_now', 'audience', 'subject', 'preheader', 'body', 'cta_label', 'cta_url', 'ar_subject', 'ar_preheader', 'ar_body', 'ar_cta_label'],
          properties: {
            angle: { type: 'string', description: 'Four to eight words naming the angle.' },
            why_now: { type: 'string', description: 'One sentence: which input this comes from and why it fits this week.' },
            audience: { type: 'string', description: 'A group name from the inputs, or "All marketing contacts".' },
            subject: { type: 'string', description: 'Under 60 characters.' },
            preheader: { type: 'string', description: 'Under 90 characters; adds to the subject.' },
            body: { type: 'string' },
            cta_label: { type: 'string', description: 'Two to four words, or empty.' },
            cta_url: { type: 'string', description: 'The website from the inputs, or empty.' },
            ar_subject: { type: 'string' },
            ar_preheader: { type: 'string' },
            ar_body: { type: 'string' },
            ar_cta_label: { type: 'string' },
          },
        },
      },
    },
  },
}

/**
 * The research findings a marketing email can use.
 * Marketing-tagged findings first, then the lenses that are about the market
 * or the calendar. Sales and technical findings stay out: they are leads and
 * specs, and a newsletter built on them reads like a pitch.
 */
export function marketingFindings(findings, max = WEEKLY_MAX.findings) {
  const list = Array.isArray(findings) ? findings : []
  const forMarketing = f => /marketing/i.test(String(f?.for_whom || ''))
  const marketLens = f => ['calendar', 'events', 'demand', 'category', 'market'].includes(String(f?.lens || ''))
  const ranked = [
    ...list.filter(forMarketing),
    ...list.filter(f => !forMarketing(f) && marketLens(f) && !/sales|technical/i.test(String(f?.for_whom || ''))),
  ]
  const seen = new Set()
  const out = []
  for (const f of ranked) {
    const headline = clip(f?.headline || f?.line || f?.finding, 160)
    if (!headline || seen.has(headline)) continue
    seen.add(headline)
    out.push({ headline, detail: clip(f?.detail, WEEKLY_MAX.field), lens: String(f?.lens || ''), novelty: String(f?.novelty || '') })
    if (out.length >= max) break
  }
  return out
}

/** Contacts → the audience summary (counts only, no people). */
export function audienceSummary({ contacts = [], groups = [], members = [] }) {
  const total = contacts.length
  const arabic = contacts.filter(c => c.language === 'ar').length
  const byType = new Map()
  for (const c of contacts) {
    const t = String(c.contact_type || '').trim() || 'Unspecified'
    byType.set(t, (byType.get(t) || 0) + 1)
  }
  const sizes = new Map()
  for (const m of members) sizes.set(m.group_id, (sizes.get(m.group_id) || 0) + 1)
  return {
    total,
    arabic_share: total ? Math.round((arabic / total) * 100) / 100 : 0,
    types: [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([type, n]) => ({ type, n })),
    groups: groups.slice(0, WEEKLY_MAX.groups).map(g => ({ name: clip(g.name, 60), size: sizes.get(g.id) || 0, description: clip(g.description, 120) })),
  }
}

/** Ask for Arabic when at least a fifth of the list prefers it. */
export const wantsArabic = audience => (audience?.arabic_share || 0) >= 0.2

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a')

/**
 * The user turn. Every section says what it is FOR, because a model told
 * "here are the leads" writes about the leads.
 */
export function weeklyPrompt(i) {
  const lines = []
  const push = (...xs) => lines.push(...xs)
  const arabic = wantsArabic(i.audience)

  push(`Today is ${i.today} (Riyadh). These drafts are for the week of ${i.weekOf}.`)
  push(i.website ? `Website (the only link you may use): ${i.website}` : 'No website is on file: every CTA is a reply.')
  push(arabic
    ? `Arabic: YES — ${Math.round((i.audience.arabic_share || 0) * 100)}% of the list prefers Arabic. Fill every ar_ field.`
    : 'Arabic: NO — leave every ar_ field empty.')

  push('', '## Who receives it (use to pick `audience` and the tone)')
  push(`${i.audience.total} marketing contacts.`)
  if (i.audience.types.length) push(`Kinds: ${i.audience.types.map(t => `${t.type} ${t.n}`).join(', ')}.`)
  for (const g of i.audience.groups) push(`- Group "${g.name}" (${g.size})${g.description ? `: ${g.description}` : ''}`)
  if (!i.audience.total) push('The list is empty so far; write for existing customers and partners in general.')

  push('', '## Emails already sent (do not repeat these subjects or angles; notice what got clicks)')
  if (!i.campaigns.length) push('None yet. This may be the first marketing email: a warm, useful re-introduction works well.')
  for (const c of i.campaigns) {
    push(`- ${c.sent_on}: "${clip(c.subject, 90)}" to ${c.recipients}, opened ${pct(c.opened, c.sent)}, clicked ${pct(c.clicked, c.sent)}`)
  }
  if (i.lastWeek.length) {
    push('Last week\'s AI draft angles (do not propose these again):')
    for (const a of i.lastWeek) push(`- ${clip(a, 120)}`)
  }

  push('', '## What we posted on social recently (stories we are already telling; an email may go deeper on one)')
  if (!i.posts.length) push('Nothing published in the last 30 days.')
  for (const p of i.posts) push(`- ${p.date} ${p.platform}: ${clip(p.topic || p.caption, 200)}`)

  push('', '## Research (use for timely angles; never present old research as this week\'s news)')
  if (!i.research) {
    push('No completed research run yet.')
  } else {
    push(`Latest completed run: ${i.research.finished_on} — ${i.research.age_days} day(s) ago${i.research.age_days > 10 ? ' (STALE: prefer calendar, events and evergreen angles)' : ''}.`)
    if (i.research.headline) push(`Headline: ${clip(i.research.headline, 400)}`)
    for (const f of i.research.findings) push(`- ${f.headline}${f.detail ? ` — ${f.detail}` : ''}`)
  }

  push('', '## Coming up (dated; an email a week or two ahead of a date lands better than one on the day)')
  const dated = [...i.calendar, ...i.events]
  if (!dated.length) push('Nothing dated in the next six weeks.')
  for (const c of i.calendar) push(`- ${c.date} (${c.days_until} days): ${clip(c.name, 100)}${c.note ? ` — ${clip(c.note, 160)}` : ''}`)
  for (const e of i.events) {
    push(`- ${e.start_date || 'date tbc'}: ${clip(e.name, 100)}${e.city ? `, ${e.city}` : ''}${e.decision && e.decision !== 'undecided' ? ` — we are ${e.decision}` : ''}${e.recommendation ? ` — ${clip(e.recommendation, 160)}` : ''}`)
  }

  push('', '## Market activity (OTHER companies\' projects: sector signals only — never name them, never imply we are involved)')
  if (!i.leads.length) push('None recorded.')
  for (const l of i.leads) push(`- ${clip([l.stage, l.headline || l.name].filter(Boolean).join(': '), 160)}${l.location ? ` (${clip(l.location, 40)})` : ''}`)

  push('', 'Write three options now, strongest first.')
  return lines.join('\n')
}

/** What the model was given, as counts and dates, for the row's `inputs`. */
export function inputsSummary(i) {
  return {
    today: i.today,
    week_of: i.weekOf,
    contacts: i.audience.total,
    arabic_share: i.audience.arabic_share,
    arabic_requested: wantsArabic(i.audience),
    groups: i.audience.groups.length,
    campaigns: i.campaigns.length,
    last_week_angles: i.lastWeek.length,
    posts: i.posts.length,
    research_finished_on: i.research?.finished_on || null,
    research_age_days: i.research?.age_days ?? null,
    findings: i.research?.findings.length || 0,
    calendar: i.calendar.length,
    events: i.events.length,
    leads: i.leads.length,
    website: i.website || '',
  }
}

/**
 * The model's JSON → clean options. Drops anything without a subject and a
 * body, blanks Arabic that was not asked for, and keeps the CTA to the
 * website (or nothing) whatever the model wrote.
 */
export function parseWeekly(text, { arabic = false, website = '' } = {}) {
  let json
  try { json = JSON.parse(text) } catch { return { ok: false, options: [], note: '', error: 'The drafts came back unreadable.' } }
  const site = String(website || '').replace(/\/$/, '')
  const options = (Array.isArray(json?.options) ? json.options : []).map(o => {
    const str = k => String(o?.[k] ?? '').trim()
    const url = str('cta_url')
    const urlOk = site && url && url.replace(/\/$/, '').startsWith(site)
    return {
      angle: str('angle'),
      why_now: str('why_now'),
      audience: str('audience') || 'All marketing contacts',
      subject: str('subject'),
      preheader: str('preheader'),
      body: str('body'),
      cta_label: urlOk ? str('cta_label') : '',
      cta_url: urlOk ? url : '',
      ar_subject: arabic ? str('ar_subject') : '',
      ar_preheader: arabic ? str('ar_preheader') : '',
      ar_body: arabic ? str('ar_body') : '',
      ar_cta_label: arabic && urlOk ? str('ar_cta_label') : '',
    }
  }).filter(o => o.subject && o.body).slice(0, 3)
  if (!options.length) return { ok: false, options: [], note: '', error: 'No usable draft came back.' }
  return { ok: true, options, note: String(json?.note || '').trim(), error: '' }
}

/** One option → the plain body a campaign starts from (CTA as a lone link line, which the designer turns into a button). */
export function optionBody(option, language = 'en') {
  const ar = language === 'ar' && option.ar_body
  const body = ar ? option.ar_body : option.body
  const label = ar ? (option.ar_cta_label || option.cta_label) : option.cta_label
  return option.cta_url && label ? `${body}\n\n[${label}](${option.cta_url})` : body
}
