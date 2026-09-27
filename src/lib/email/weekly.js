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
//     9. Market activity: open sales leads reduced to a project TYPE, stage
//        and area ("a hotel in Diriyah, at design stage"). Never their names
//        or descriptions: they are other companies' projects.
//    10. The website and its service pages (from Brand Brain's business
//        lines), as the only links the model may use.
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

/**
 * The brand's website, as an https URL with no trailing slash.
 * Brand Brain keeps it as a custom field ("arak-sa.com", no scheme); older
 * profiles may only have it written into the contact details.
 */
export function websiteOf(profile) {
  const raw = String(profile?.customFields?.website || '').trim()
    || (String(profile?.contactInfo || '').match(/https?:\/\/[^\s,;)]+|\bwww\.[^\s,;)]+/i) || [''])[0]
  if (!raw) return ''
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`
  try {
    const u = new URL(withScheme)
    return `https://${u.host}${u.pathname.replace(/\/+$/, '')}`
  } catch { return '' }
}

/**
 * Pages on the website an email may link to: the service pages Brand Brain
 * lists under business lines ("lighting | Lighting | /services/facade-lighting,
 * …"). A button to the relevant service page beats one to the homepage.
 */
export function sitePages(profile, website = websiteOf(profile), max = 10) {
  if (!website) return []
  const out = []
  for (const m of String(profile?.customFields?.business_lines || '').matchAll(/(?:^|[\s,|])(\/[a-z0-9][a-z0-9\-/]*)/gi)) {
    const url = `${website}${m[1].replace(/\/+$/, '')}`
    if (!out.includes(url)) out.push(url)
    if (out.length >= max) break
  }
  return out
}

/** Turn a provider error into a sentence for the Marketing tab. */
export function explainModelError(error) {
  const e = String(error || '')
  if (/credit balance is too low|billing/i.test(e)) return 'The AI account has run out of credit, so nothing was written and nothing was charged.'
  if (/overloaded|529/i.test(e)) return 'The AI service was overloaded. Nothing was charged; try again in a few minutes.'
  if (/rate.?limit|429/i.test(e)) return 'The AI service was busy (rate limit). Nothing was charged; try again shortly.'
  if (/timed? ?out|deadline/i.test(e)) return 'The AI took too long and was stopped. Try again.'
  return e.slice(0, 300) || 'The drafts could not be written.'
}

/**
 * The first day of `now`'s week, in Riyadh time, as YYYY-MM-DD. SUNDAY: the
 * Saudi working week runs Sunday to Thursday, so Monday-start weeks would
 * label a Sunday as the end of last week.
 */
export function weekOf(now = new Date()) {
  const key = brandDateKey(now)
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
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
  '- cta_url must be the website or one of the listed pages, or empty. When empty, the CTA is a',
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
            cta_url: { type: 'string', description: 'The website or one of the listed pages, or empty.' },
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
 *
 * Measured on the real 2026-09-17 brief (33 findings, 15 tagged marketing):
 * most "marketing" findings are about US — our Instagram average, LinkedIn
 * impressions, search rankings, a post stuck mid-publish. Useful to the team,
 * useless to a customer. So selection is by LENS first:
 *
 *   keep  category (industry, regulation, standards: good teaching material),
 *         demand, events that are still ahead, calendar dates still ahead
 *   drop  ourselves, search (our own numbers); rivals (an email never names a
 *         competitor); openings (sales leads — they reach the prompt only as
 *         sector signals, separately and labelled)
 *
 * and then drops the brief talking about itself ("could not confirm",
 * "not reached") and anything already over.
 */
const EMAIL_LENSES = new Set(['category', 'demand', 'events', 'calendar', 'market'])
const SELF_TALK = /could not (be )?confirm|not reached|unresearched|remain(s)? (genuinely )?unresolved|search budget|this run\b/i
const OVER = /\bended\b|\bwas held\b|\btook place\b|\bconcluded\b/i

export function marketingFindings(findings, { today = '', max = WEEKLY_MAX.findings } = {}) {
  const list = Array.isArray(findings) ? findings : []
  const out = []
  const seen = new Set()
  for (const f of list) {
    const lens = String(f?.lens || '')
    const whom = String(f?.for_whom || '')
    if (!EMAIL_LENSES.has(lens)) continue
    if (whom && !/marketing|both/i.test(whom)) continue
    const headline = clip(f?.headline || f?.line || f?.finding, 160)
    const detail = clip(f?.detail, WEEKLY_MAX.field)
    if (!headline || seen.has(headline)) continue
    if (SELF_TALK.test(headline)) continue
    if (OVER.test(`${headline} ${detail}`)) continue
    const date = String(f?.evidence?.date || '')
    if (today && date && date < today) continue
    seen.add(headline)
    out.push({ headline, detail, lens, novelty: String(f?.novelty || '') })
    if (out.length >= max) break
  }
  return out
}

/**
 * Published posts worth telling the model about. Test posts ("fsklfmlsek",
 * "this is a good video") are real rows in production; anything under six
 * words is not a story an email can extend.
 */
export function storyPosts(posts, max = WEEKLY_MAX.posts) {
  return (posts || [])
    .map(p => ({ ...p, text: String(p.topic || p.caption || '').replace(/\s+/g, ' ').trim() }))
    .filter(p => !/\btest\b|delete me/i.test(p.text))
    .filter(p => p.text.split(' ').filter(w => /\p{L}{2,}/u.test(w)).length >= 6)
    .slice(0, max)
}

/**
 * What KIND of project a lead is, from a fixed vocabulary — never its words.
 *
 * Masking names out of a lead's description does not work: the same project
 * is "Qiddiya National Athletics Stadium" in one field and "Qiddiya's
 * National Athletics Stadium" in the next, and a mask that misses once hands
 * the model a name it was told never to use. A newsletter only needs the
 * sector signal ("hotel developments are busy in Riyadh"), so that is all
 * that is sent: a type from this list, the stage and the area.
 */
const PROJECT_TYPES = [
  ['hotel', /\bhotels?\b|hospitality|resort/i],
  ['stadium or sports venue', /stadium|arena|sports/i],
  ['mixed-use development', /mixed[- ]use/i],
  ['airport', /airport/i],
  ['hospital or healthcare', /hospital|clinic|healthcare|medical/i],
  ['mall or retail', /\bmall\b|retail/i],
  ['office tower', /office|tower|headquarters/i],
  ['residential', /residential|villas?\b|housing|apartments?/i],
  ['museum or cultural venue', /museum|cultural|theatre|theater|opera/i],
  ['education campus', /school|university|campus/i],
  ['transport or metro', /metro|railway|station|transit/i],
  ['streets and public realm', /street|boulevard|public realm|park\b|landscape/i],
  ['giga-project', /giga|neom|qiddiya|diriyah|red sea|roshn|murabba/i],
]

export function projectTypes(text) {
  const t = String(text || '')
  const out = PROJECT_TYPES.filter(([, re]) => re.test(t)).map(([label]) => label)
  return out.length ? out.slice(0, 2) : ['construction project']
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

  push(`Today is ${i.today} (Riyadh). These drafts are for the working week starting Sunday ${i.weekOf}.`)
  push(i.website ? `Website (links must start with this): ${i.website}` : 'No website is on file: every CTA is a reply.')
  if (i.website && i.pages?.length) push(`Pages you may link to (prefer the one that fits the angle): ${i.pages.join(', ')}`)
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
  for (const p of i.posts) push(`- ${p.date} ${p.platform}: ${clip(p.text || p.topic || p.caption, 200)}`)

  push('', '## Research (use for timely angles; never present old research as this week\'s news)')
  if (!i.research) {
    push('No completed research run yet.')
  } else {
    // The run's own headline is NOT sent: it is written for sales and names
    // projects and rivals. The filtered findings carry what an email can use.
    push(`Latest completed run: ${i.research.finished_on} — ${i.research.age_days} day(s) ago${i.research.age_days > 10 ? ' (STALE: prefer calendar, events and evergreen angles)' : ''}.`)
    if (!i.research.findings.length) push('Nothing in it suits a customer email this week.')
    for (const f of i.research.findings) push(`- ${f.headline}${f.detail ? ` — ${f.detail}` : ''}`)
  }

  push('', '## Coming up (dated; an email a week or two ahead of a date lands better than one on the day)')
  const dated = [...i.calendar, ...i.events]
  if (!dated.length) push('Nothing dated in the next six weeks.')
  for (const c of i.calendar) push(`- ${c.date} (${c.days_until} days): ${clip(c.name, 100)}${c.note ? ` — ${clip(c.note, 160)}` : ''}`)
  for (const e of i.events) {
    // Name, date, place and what we decided — not the research's
    // recommendation, which is a note to our sales team.
    push(`- ${e.start_date || 'date tbc'}: ${clip(e.name, 100)}${e.city ? `, ${e.city}` : ''}${e.decision && e.decision !== 'undecided' ? ` — we are ${e.decision}` : ''}`)
  }

  push('', '## Market activity (OTHER companies\' projects: sector signals only — never name them, never imply we are involved)')
  if (!i.leads.length) push('None recorded.')
  for (const l of i.leads) {
    // Type, stage and area only. See projectTypes for why no words from the
    // lead itself are sent.
    const area = clip(String(l.location || '').split(',')[0], 30)
    push(`- A ${projectTypes(`${l.name} ${l.headline}`).join(' / ')}${area ? ` in ${area}` : ''}${l.stage ? `, at ${clip(l.stage, 40)} stage` : ''}`)
  }

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
    pages: i.pages?.length || 0,
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
