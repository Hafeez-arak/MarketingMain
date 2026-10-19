// ─── The CEO's control panel ───────────────────────────────────────────────
// 2026-10-18, from the CEO's requirements (Campai_Requirements.xlsx). His
// design rules, which every function here serves:
//
//   · at most six numbers on his home screen, each red / amber / green
//     against a target HE sets (company_targets), grey when there is none;
//   · show only what needs action, at most three decisions, each with an
//     owner and one button;
//   · Odoo is the single source of truth. A number Odoo will own and that we
//     cannot honestly compute yet says "waiting for Odoo"; it never shows a
//     zero that looks like a fact.
//
// Pure: rows in, tiles / decisions / rows out, no IO. The rows are gathered
// in api/leads/_control.js, so every number here is tested without a
// database. Everything shown is { ar, en }: Arabic first, English on a switch.

import { effectiveVerdict, projectOf } from '../leads/view.js'
import { money } from '../agent/ceoBrief.js'
import { leadRegion } from './region.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** A lead older than this is backlog: counted, never alerted lead by lead. */
export const LOOKBACK_DAYS = 30
export const MAX_DECISIONS = 3
export const KEY_ACCOUNTS = 10
export const OPPORTUNITIES_PER_WEEK = 5

export const DEFAULT_TARGETS = {
  revenue_month_sar: null, pipeline_sar: null, quotes_week: null, win_rate_pct: null,
  first_reply_hours: 4, quote_hours: 72, key_account_quiet_days: 30, amber_pct: 10,
  brief_emails: [], alert_emails: [], routing_enabled: false, routing_since: null, routing_fallback: null,
}

export const targetsOf = row => ({ ...DEFAULT_TARGETS, ...Object.fromEntries(Object.entries(row || {}).filter(([, v]) => v !== undefined)) })

const group = n => Math.round(Number(n) || 0).toLocaleString('en-US')
const same = s => ({ en: s, ar: s })
const t = iso => { const v = Date.parse(iso || ''); return Number.isFinite(v) ? v : null }
const arrived = l => t(l?.received_at) ?? t(l?.created_at)
const hours = h => (h < 10 ? (Math.round(h * 10) / 10).toString() : group(h))
/** Arabic counts 3–10 take the plural (ساعات); the rest the singular. */
const arHours = h => `${hours(h)} ${Number(hours(h)) >= 3 && Number(hours(h)) <= 10 ? 'ساعات' : 'ساعة'}`

// ── Red / amber / green ──

/**
 * The colour of a number against its target. `better` says which way is
 * good. Within `amberPct` percent of the target (on the wrong side) is
 * amber; further is red. No target, or no value, is 'none' (grey): a tile
 * is never green just because nobody set the bar.
 */
export function rag(value, target, { better = 'higher', amberPct = 10 } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'none'
  if (target === null || target === undefined || !Number.isFinite(Number(target))) return 'none'
  const v = Number(value), g = Number(target), a = Math.max(0, Number(amberPct) || 0) / 100
  if (better === 'higher') {
    if (v >= g) return 'good'
    return v >= g * (1 - a) ? 'watch' : 'bad'
  }
  if (v <= g) return 'good'
  // A zero target ("no unowned leads") has no percentage band: one over is amber.
  return (g === 0 ? v <= 1 : v <= g * (1 + a)) ? 'watch' : 'bad'
}

// ── Leads ──

/** Closed when its stage says so (the Pipeline, #244, or Odoo later). */
export const isClosed = l => l?.stage === 'won' || l?.stage === 'lost'

/** A lead sales owes something: qualified, not a duplicate, not closed. */
export const isOpenQualified = l => effectiveVerdict(l) === 'qualified' && !l?.duplicate_of && !isClosed(l)

/**
 * Where a lead stands against the two clocks, both counted from when it
 * arrived. `late` only while the thing is still not done.
 */
export function deadlines(lead, targets = DEFAULT_TARGETS, now = new Date()) {
  const start = arrived(lead)
  const n = now.getTime()
  const clock = (doneAt, hrs) => {
    if (start === null) return { due: null, late: false, done: Boolean(doneAt), hoursLate: 0 }
    const due = start + Number(hrs) * HOUR
    const done = Boolean(t(doneAt))
    const late = !done && n > due
    return { due: new Date(due).toISOString(), late, done, hoursLate: late ? (n - due) / HOUR : 0 }
  }
  return {
    reply: clock(lead?.first_reply_at, targets.first_reply_hours),
    // A quote also counts as a reply, but not the other way round.
    quote: clock(lead?.quote_sent_at, targets.quote_hours),
  }
}

const recent = (l, now, days = LOOKBACK_DAYS) => (arrived(l) ?? 0) >= now.getTime() - days * DAY

/** First matching rule (lowest position), else the fallback, else null. */
export function routeLead(lead, rules = [], fallback = null) {
  const region = leadRegion(lead)
  const project = projectOf(lead) || ''
  const sorted = [...rules].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  for (const r of sorted) {
    if (r.sender_type && r.sender_type !== lead.sender_type) continue
    if (r.region && r.region !== region) continue
    if (r.project_type && r.project_type !== project) continue
    if (r.assign_to) return { to: r.assign_to, ruleId: r.id || null, region }
  }
  return fallback ? { to: fallback, ruleId: null, region } : null
}

/**
 * The leads routing should give an owner now: qualified, unowned, not a
 * duplicate, and arrived after routing was switched on (so turning it on
 * does not forward months of old enquiries in one go).
 */
export function leadsToRoute(leads = [], targets = DEFAULT_TARGETS) {
  if (!targets.routing_enabled) return []
  const since = t(targets.routing_since) ?? Infinity
  return leads.filter(l => isOpenQualified(l) && !l.assigned_to && (arrived(l) ?? 0) >= since)
}

// ── The six numbers ──

const WAITING = (key, label, why) => ({
  key, label, source: 'odoo', tone: 'waiting',
  value: same('—'),
  sub: why,
})

/**
 * The six tiles, in the CEO's order (requirement 1, as revised in 15).
 * `facts` = { leads, odoo, targets, now }. `odoo` is null until the Odoo
 * sync exists; its numbers then replace the waiting tiles.
 */
export function controlKpis({ leads = [], odoo = null, targets: tRow = null, now = new Date() } = {}) {
  const targets = targetsOf(tRow)
  const amberPct = targets.amber_pct
  const open = leads.filter(isOpenQualified)
  const tiles = []

  // 1. Open pipeline (SAR)
  if (odoo?.pipeline_sar != null) {
    tiles.push({
      key: 'pipeline', source: 'odoo',
      label: { en: 'Open pipeline', ar: 'قيمة الفرص المفتوحة' },
      value: money(odoo.pipeline_sar),
      sub: { en: `${group(odoo.pipeline_deals)} open deals in Odoo`, ar: `${group(odoo.pipeline_deals)} صفقة مفتوحة في أودو` },
      tone: rag(odoo.pipeline_sar, targets.pipeline_sar, { better: 'higher', amberPct }),
    })
  } else {
    const quoted = open.filter(l => l.quote_sent_at && Number(l.deal_value_sar) > 0)
    const sum = quoted.reduce((s, l) => s + Number(l.deal_value_sar), 0)
    tiles.push(quoted.length ? {
      key: 'pipeline', source: 'campai',
      label: { en: 'Open pipeline', ar: 'قيمة الفرص المفتوحة' },
      value: money(sum),
      sub: { en: `${group(quoted.length)} open quote${quoted.length === 1 ? '' : 's'} · Odoo not linked yet`, ar: `${group(quoted.length)} عرض سعر مفتوح · أودو غير مربوط بعد` },
      tone: rag(sum, targets.pipeline_sar, { better: 'higher', amberPct }),
    } : WAITING('pipeline', { en: 'Open pipeline', ar: 'قيمة الفرص المفتوحة' },
      { en: 'Shows once Odoo is linked', ar: 'يظهر بعد ربط أودو' }))
  }

  // 2. Average response time (median hours, arrival → first reply), last 30 days
  const window = open.filter(l => recent(l, now))
  const replied = window.map(l => (t(l.first_reply_at) ?? t(l.quote_sent_at)) !== null
    ? ((t(l.first_reply_at) ?? t(l.quote_sent_at)) - arrived(l)) / HOUR : null).filter(h => h !== null && h >= 0)
  const lateReplies = window.filter(l => deadlines(l, targets, now).reply.late && !l.quote_sent_at).length
  const med = replied.length ? median(replied) : null
  tiles.push({
    key: 'response', source: odoo?.response_hours != null ? 'odoo' : 'campai',
    label: { en: 'Average first reply', ar: 'متوسط وقت الرد الأول' },
    value: med === null ? same('—') : { en: `${hours(med)} h`, ar: arHours(med) },
    sub: med === null
      ? (lateReplies
        ? { en: `No replies marked · ${group(lateReplies)} past ${hours(targets.first_reply_hours)} h`, ar: `لم يُسجَّل رد · ${group(lateReplies)} تجاوزت ${arHours(targets.first_reply_hours)}` }
        : { en: 'No replies marked yet', ar: 'لم يُسجَّل أي رد بعد' })
      : { en: `Target ${hours(targets.first_reply_hours)} h · ${group(lateReplies)} late now`, ar: `الهدف ${arHours(targets.first_reply_hours)} · ${group(lateReplies)} متأخرة الآن` },
    tone: med === null ? (lateReplies ? 'bad' : 'none') : worst(rag(med, targets.first_reply_hours, { better: 'lower', amberPct }), lateReplies ? 'watch' : 'good'),
  })

  // 3. Revenue this month vs target: Odoo only (invoiced / confirmed orders).
  tiles.push(odoo?.revenue_month_sar != null ? {
    key: 'revenue', source: 'odoo',
    label: { en: 'Revenue this month', ar: 'إيرادات هذا الشهر' },
    value: money(odoo.revenue_month_sar),
    // Which number it is, said on the tile: invoiced (Odoo Accounting) or
    // confirmed orders (no Accounting).
    sub: {
      en: `${odoo.revenue_basis === 'orders' ? 'Confirmed orders' : 'Invoiced'} · ${targets.revenue_month_sar != null ? `target ${money(targets.revenue_month_sar).en}` : 'no target set'}`,
      ar: `${odoo.revenue_basis === 'orders' ? 'طلبات مؤكدة' : 'مفوتر'} · ${targets.revenue_month_sar != null ? `الهدف ${money(targets.revenue_month_sar).ar}` : 'لم يُحدَّد هدف'}`,
    },
    tone: rag(odoo.revenue_month_sar, targets.revenue_month_sar, { better: 'higher', amberPct }),
  } : WAITING('revenue', { en: 'Revenue this month', ar: 'إيرادات هذا الشهر' },
    { en: 'Shows once Odoo is linked', ar: 'يظهر بعد ربط أودو' }))

  // 4. Leads with no owner: the last 30 days, older ones named in the sub.
  const unowned = open.filter(l => !l.assigned_to)
  const unownedNow = unowned.filter(l => recent(l, now)).length
  const older = unowned.length - unownedNow
  tiles.push({
    key: 'unowned', source: 'campai',
    label: { en: 'Leads with no owner', ar: 'استفسارات بلا مسؤول' },
    value: same(group(unownedNow)),
    sub: older
      ? { en: `Last ${LOOKBACK_DAYS} days · ${group(older)} older too`, ar: `آخر ${LOOKBACK_DAYS} يومًا · و${group(older)} أقدم` }
      : { en: `Last ${LOOKBACK_DAYS} days`, ar: `آخر ${LOOKBACK_DAYS} يومًا` },
    tone: rag(unownedNow, 0, { better: 'lower' }),
  })

  // 5. Projects at risk: Odoo Project.
  tiles.push(odoo?.projects_at_risk != null ? {
    key: 'projects', source: 'odoo',
    label: { en: 'Projects at risk', ar: 'مشاريع متعثرة' },
    value: same(group(odoo.projects_at_risk)),
    sub: { en: `of ${group(odoo.projects_open)} running`, ar: `من ${group(odoo.projects_open)} قيد التنفيذ` },
    tone: rag(odoo.projects_at_risk, 0, { better: 'lower' }),
  } : WAITING('projects', { en: 'Projects at risk', ar: 'مشاريع متعثرة' },
    { en: 'Needs Odoo Project in use', ar: 'يتطلب استخدام تطبيق المشاريع في أودو' }))

  // 6. Overdue unpaid invoices: Odoo Accounting.
  tiles.push(odoo?.overdue_invoices_sar != null ? {
    key: 'invoices', source: 'odoo',
    label: { en: 'Overdue invoices', ar: 'فواتير متأخرة التحصيل' },
    value: money(odoo.overdue_invoices_sar),
    sub: { en: `${group(odoo.overdue_invoices)} unpaid over 60 days`, ar: `${group(odoo.overdue_invoices)} غير مدفوعة منذ أكثر من 60 يومًا` },
    tone: rag(odoo.overdue_invoices_sar, 0, { better: 'lower' }),
  } : WAITING('invoices', { en: 'Overdue invoices', ar: 'فواتير متأخرة التحصيل' },
    { en: 'Needs Odoo Accounting in use', ar: 'يتطلب استخدام المحاسبة في أودو' }))

  return tiles
}

const ORDER = ['bad', 'watch', 'good', 'none', 'waiting']
const worst = (...tones) => tones.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0]

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ── Who the lead is from, in one line ──

export const leadWho = l => String(l?.company || l?.name || l?.email || 'An enquiry').replace(/\s+/g, ' ').trim().slice(0, 60)

const daysAgo = (ms, now) => Math.max(0, Math.floor((now.getTime() - ms) / DAY))
const agoText = (ms, now) => {
  const d = daysAgo(ms, now)
  const h = Math.floor((now.getTime() - ms) / HOUR)
  if (d >= 1) return { en: d === 1 ? '1 day' : `${d} days`, ar: d === 1 ? 'يوم' : `${d} أيام` }
  return { en: `${h} h`, ar: arHours(h) }
}

// ── "Needs my decision": at most three, each with one button ──

/**
 * The few things only a manager can unblock, worst first: a late quote
 * (money waiting), a lead with no owner, a late first reply, a key account
 * gone quiet, and a new research project nobody has sent to sales. One of
 * each kind before a second of any, so three items cover three problems.
 *
 * Each: { key, kind, title, why, owner, action: { type, … } }.
 */
export function controlDecisions({ leads = [], accounts = [], opportunities = [], team = [], rules = [], targets: tRow = null, now = new Date() } = {}) {
  const targets = targetsOf(tRow)
  const nameOf = id => team.find(p => p.id === id)?.name || ''
  const open = leads.filter(l => isOpenQualified(l) && recent(l, now))
  const kinds = []

  const lateQuotes = open
    .filter(l => l.assigned_to && deadlines(l, targets, now).quote.late)
    .sort((a, b) => arrived(a) - arrived(b))
    .map(l => {
      const who = nameOf(l.assigned_to)
      const age = agoText(arrived(l), now)
      return {
        key: `quote:${l.id}`, kind: 'late_quote',
        title: { en: `No quote yet for ${leadWho(l)}`, ar: `لم يُرسل عرض سعر إلى ${leadWho(l)}` },
        why: { en: `Arrived ${age.en} ago; the quote was due in ${hours(targets.quote_hours)} h`, ar: `وصل قبل ${age.ar}؛ موعد العرض كان ${arHours(targets.quote_hours)}` },
        owner: who,
        action: { type: 'remind', leadId: l.id, userId: l.assigned_to },
      }
    })
  kinds.push(lateQuotes)

  const unowned = open
    .filter(l => !l.assigned_to)
    .sort((a, b) => arrived(a) - arrived(b))
    .map(l => {
      const age = agoText(arrived(l), now)
      const suggested = routeLead(l, rules, targets.routing_fallback)
      return {
        key: `owner:${l.id}`, kind: 'unassigned',
        title: { en: `${leadWho(l)} has no owner`, ar: `${leadWho(l)} بلا مسؤول` },
        why: { en: `Qualified ${age.en} ago${l.summary ? `: ${clip(l.summary, 80)}` : ''}`, ar: `مؤهَّل منذ ${age.ar}${l.summary ? `: ${clip(l.summary, 80)}` : ''}` },
        owner: '',
        action: { type: 'assign', leadId: l.id, suggested: suggested?.to || null },
      }
    })
  kinds.push(unowned)

  const lateReplies = open
    .filter(l => l.assigned_to && !l.quote_sent_at && deadlines(l, targets, now).reply.late && !deadlines(l, targets, now).quote.late)
    .sort((a, b) => arrived(a) - arrived(b))
    .map(l => ({
      key: `reply:${l.id}`, kind: 'late_reply',
      title: { en: `${leadWho(l)} has had no reply`, ar: `لم يُرد على ${leadWho(l)}` },
      why: { en: `Past the ${hours(targets.first_reply_hours)} h first-reply target`, ar: `تجاوز هدف الرد الأول (${arHours(targets.first_reply_hours)})` },
      owner: nameOf(l.assigned_to),
      action: { type: 'remind', leadId: l.id, userId: l.assigned_to },
    }))
  kinds.push(lateReplies)

  const quiet = keyAccounts(accounts, tRow, now).filter(a => a.tone === 'bad')
    .map(a => ({
      key: `account:${a.id}`, kind: 'account_quiet',
      title: { en: `${a.name}: no contact for ${a.quietDays === null ? 'a long time' : `${a.quietDays} days`}`, ar: `${a.name}: لا تواصل منذ ${a.quietDays === null ? 'مدة طويلة' : `${a.quietDays} يومًا`}` },
      why: a.open_value_sar
        ? { en: `${money(a.open_value_sar).en} in open deals`, ar: `${money(a.open_value_sar).ar} في صفقات مفتوحة` }
        : { en: `${money(a.value_sar).en} bought from us so far`, ar: `${money(a.value_sar).ar} مشتريات سابقة` },
      owner: a.owner || '',
      action: { type: 'contacted', accountId: a.id },
    }))
  kinds.push(quiet)

  const fresh = topOpportunities(opportunities, now).map(o => ({
    key: `opp:${o.id}`, kind: 'opportunity',
    title: { en: `New project: ${clip(o.name, 70)}`, ar: `مشروع جديد: ${clip(o.name, 70)}` },
    why: o.package_value_sar
      ? { en: `Our share about ${money(o.package_value_sar).en}${o.client ? ` · ${clip(o.client, 40)}` : ''}`, ar: `حصتنا نحو ${money(o.package_value_sar).ar}${o.client ? ` · ${clip(o.client, 40)}` : ''}` }
      : same(clip(o.client || o.location || '', 80)),
    owner: '',
    action: { type: 'send_to_sales', opportunityId: o.id },
  }))
  kinds.push(fresh)

  // Round-robin across kinds, worst kind first.
  const out = []
  for (let i = 0; out.length < MAX_DECISIONS && kinds.some(k => k.length > i); i++) {
    for (const k of kinds) {
      if (out.length >= MAX_DECISIONS) break
      if (k[i]) out.push(k[i])
    }
  }
  return out
}

const clip = (v, n) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

// ── One row per salesperson ──

const sameMonth = (iso, now) => {
  const d = new Date(iso || '')
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()
}

/**
 * requirement 7: open leads, quotes sent this month, late items, won value
 * this month. Won value needs a won stage and a deal value: until the
 * Pipeline (#244) or Odoo provides them it is null, shown as "—".
 */
export function repRows({ leads = [], team = [], targets: tRow = null, now = new Date() } = {}) {
  const targets = targetsOf(tRow)
  const stagesKnown = leads.some(l => l.stage !== undefined)
  return team.map(p => {
    const mine = leads.filter(l => l.assigned_to === p.id && effectiveVerdict(l) === 'qualified' && !l.duplicate_of)
    const open = mine.filter(l => !isClosed(l))
    const late = open.filter(l => recent(l, now)).filter(l => {
      const d = deadlines(l, targets, now)
      return d.quote.late || (d.reply.late && !l.quote_sent_at)
    })
    const won = mine.filter(l => l.stage === 'won' && sameMonth(l.stage_at, now))
    return {
      id: p.id, name: p.name, email: p.email,
      open: open.length,
      quotes: mine.filter(l => sameMonth(l.quote_sent_at, now)).length,
      late: late.length,
      lateLeads: late.map(l => ({ id: l.id, who: leadWho(l) })),
      wonValue: stagesKnown ? won.reduce((s, l) => s + (Number(l.deal_value_sar) || 0), 0) : null,
      tone: late.length ? 'bad' : open.length ? 'good' : 'none',
    }
  }).sort((a, b) => b.late - a.late || b.open - a.open || a.name.localeCompare(b.name))
}

// ── The top ten customers ──

/**
 * requirement 8: the ten biggest customers by what they have bought, red
 * when nobody has spoken to them for `key_account_quiet_days` (30), amber
 * when no contact has ever been recorded (we do not know, so we do not say
 * red), or when the agreed next step is overdue.
 */
export function keyAccounts(accounts = [], tRow = null, now = new Date()) {
  const targets = targetsOf(tRow)
  return [...accounts]
    .filter(a => a.status !== 'parked')
    .sort((a, b) => (Number(b.value_sar) || 0) - (Number(a.value_sar) || 0))
    .slice(0, KEY_ACCOUNTS)
    .map(a => {
      const last = t(a.last_contact_at)
      const quietDays = last === null ? null : daysAgo(last, now)
      const nextOverdue = Boolean(a.next_step_on) && t(`${a.next_step_on}T23:59:59Z`) < now.getTime()
      const tone = quietDays !== null && quietDays >= targets.key_account_quiet_days ? 'bad'
        : quietDays === null || nextOverdue ? 'watch' : 'good'
      return { ...a, quietDays, nextOverdue, tone }
    })
}

// ── New projects from the research, five a week ──

const REL = { high: 0, medium: 1, low: 2 }

/** requirement 9: this week's new projects nobody has sent to sales, best five. */
export function topOpportunities(opps = [], now = new Date()) {
  const since = now.getTime() - 7 * DAY
  return opps
    .filter(o => !o.sent_at && (o.status || 'new') === 'new' && (t(o.first_seen_at) ?? 0) >= since && o.relevance !== 'low')
    .sort((a, b) => (REL[a.relevance] ?? 1) - (REL[b.relevance] ?? 1)
      || (Number(b.package_value_sar) || 0) - (Number(a.package_value_sar) || 0))
    .slice(0, OPPORTUNITIES_PER_WEEK)
}

// ── Marketing in three numbers ──

/**
 * requirement 10: posts this month against the plan, leads from the website
 * this month, LinkedIn followers. Leads from social media are not counted:
 * nothing captures them yet, and the tile says so rather than showing 0.
 */
export function marketingNumbers({ planned = 0, published = 0, websiteLeads = 0, linkedinFollowers = null } = {}) {
  return [
    {
      key: 'posts',
      label: { en: 'Posts this month vs plan', ar: 'المنشورات هذا الشهر مقابل الخطة' },
      value: same(`${group(published)} / ${group(planned)}`),
      tone: planned ? rag(published, planned, { better: 'higher', amberPct: 25 }) : 'none',
    },
    {
      key: 'website_leads',
      label: { en: 'Leads from the website this month', ar: 'استفسارات من الموقع هذا الشهر' },
      value: same(group(websiteLeads)),
      sub: { en: 'Social media leads are not tracked yet', ar: 'استفسارات التواصل الاجتماعي غير متتبَّعة بعد' },
      tone: 'none',
    },
    {
      key: 'linkedin',
      label: { en: 'LinkedIn followers', ar: 'متابعو لينكدإن' },
      value: linkedinFollowers === null ? same('—') : same(group(linkedinFollowers)),
      tone: 'none',
    },
  ]
}

// ── The Sunday summary: five lines ──

const pct = (a, b) => (b ? Math.round((a / b) * 100) : null)

/**
 * requirement 13: what improved, what got worse, the decisions needed (at
 * most three), win rate, quotes sent. The first two come from the week's
 * brief (the model's judgement, already written); the rest are counted here.
 */
export function weeklyLines({ brief = null, decisions = [], leads = [], outcomes = [], odoo = null, targets: tRow = null, now = new Date() } = {}) {
  const targets = targetsOf(tRow)
  const found = brief?.found || []
  const good = found.find(f => f.tone === 'good')
  const bad = found.find(f => f.tone === 'bad') || found.find(f => f.tone === 'watch')

  const since = now.getTime() - 7 * DAY
  // Odoo's numbers when the mirror has them (quotes made there, deals won
  // and lost there); the marks in Campai before that.
  const quotes = odoo?.quotes_week ?? leads.filter(l => (t(l.quote_sent_at) ?? 0) >= since).length

  // Win rate over 90 days: the leads' own stages when they exist, else the
  // recorded deal outcomes.
  const from90 = now.getTime() - 90 * DAY
  const closed = leads.filter(l => isClosed(l) && (t(l.stage_at) ?? 0) >= from90)
  const fromOdoo = Boolean(odoo?.decided)
  const won = fromOdoo ? odoo.won : closed.length ? closed.filter(l => l.stage === 'won').length : outcomes.filter(o => o.outcome === 'won').length
  const decided = fromOdoo ? odoo.decided : closed.length || outcomes.filter(o => o.outcome === 'won' || o.outcome === 'lost').length
  const rate = pct(won, decided)

  const dec = decisions.slice(0, MAX_DECISIONS)
  return [
    {
      key: 'improved',
      en: `Improved: ${good?.text?.en || 'nothing stood out this week.'}`,
      ar: `تحسّن: ${good?.text?.ar || 'لا شيء لافت هذا الأسبوع.'}`,
    },
    {
      key: 'worse',
      en: `Got worse: ${bad?.text?.en || 'nothing got worse this week.'}`,
      ar: `تراجع: ${bad?.text?.ar || 'لم يتراجع شيء هذا الأسبوع.'}`,
    },
    {
      key: 'decisions',
      en: `Decisions needed: ${dec.length ? dec.map((d, i) => `(${i + 1}) ${d.title.en}`).join('; ') : 'none.'}`,
      ar: `قرارات مطلوبة: ${dec.length ? dec.map((d, i) => `(${i + 1}) ${d.title.ar}`).join('؛ ') : 'لا شيء.'}`,
    },
    {
      key: 'win_rate',
      en: rate === null ? 'Win rate: not measurable yet, no deals are marked won or lost.' : `Win rate: ${rate}% (${won} of ${decided} in 90 days)${targets.win_rate_pct != null ? `, target ${targets.win_rate_pct}%` : ''}.`,
      ar: rate === null ? 'نسبة الفوز: لا يمكن قياسها بعد، لا توجد صفقات مسجلة كفوز أو خسارة.' : `نسبة الفوز: ${rate}٪ (${won} من ${decided} خلال 90 يومًا)${targets.win_rate_pct != null ? `، والهدف ${targets.win_rate_pct}٪` : ''}.`,
    },
    {
      key: 'quotes',
      en: `Quotes sent this week: ${group(quotes)}${targets.quotes_week != null ? ` (target ${group(targets.quotes_week)})` : ''}.`,
      ar: `عروض الأسعار المرسلة هذا الأسبوع: ${group(quotes)}${targets.quotes_week != null ? ` (الهدف ${group(targets.quotes_week)})` : ''}.`,
    },
  ]
}

// ── The daily alert ──

/**
 * requirement 12: once a day, only late quotes, late first replies,
 * unassigned leads and key accounts at risk. Each lead's lateness is told
 * once per kind (lead.late_alerted), so tomorrow's email has only what is
 * new; the counts still show the whole picture.
 */
export function dailyAlertItems({ leads = [], accounts = [], team = [], odoo = null, targets: tRow = null, now = new Date() } = {}) {
  const targets = targetsOf(tRow)
  const nameOf = id => team.find(p => p.id === id)?.name || 'someone'
  const open = leads.filter(l => isOpenQualified(l) && recent(l, now))
  const told = (l, k) => Boolean(l.late_alerted?.[k])
  const items = []
  for (const l of open) {
    const d = deadlines(l, targets, now)
    if (!l.assigned_to) {
      if (!told(l, 'unassigned')) items.push({ kind: 'unassigned', leadId: l.id, en: `${leadWho(l)}: qualified, no owner`, ar: `${leadWho(l)}: مؤهَّل وبلا مسؤول` })
    } else if (d.quote.late) {
      if (!told(l, 'late_quote')) items.push({ kind: 'late_quote', leadId: l.id, userId: l.assigned_to, en: `${leadWho(l)}: no quote after ${hours(targets.quote_hours)} h (${nameOf(l.assigned_to)})`, ar: `${leadWho(l)}: لا عرض سعر بعد ${arHours(targets.quote_hours)} (${nameOf(l.assigned_to)})` })
    } else if (d.reply.late && !l.quote_sent_at) {
      if (!told(l, 'late_reply')) items.push({ kind: 'late_reply', leadId: l.id, userId: l.assigned_to, en: `${leadWho(l)}: no first reply after ${hours(targets.first_reply_hours)} h (${nameOf(l.assigned_to)})`, ar: `${leadWho(l)}: لا رد أول بعد ${arHours(targets.first_reply_hours)} (${nameOf(l.assigned_to)})` })
    }
  }
  for (const a of keyAccounts(accounts, tRow, now).filter(x => x.tone === 'bad')) {
    items.push({ kind: 'account_quiet', accountId: a.id, en: `${a.name}: no contact for ${a.quietDays} days${a.owner ? ` (${a.owner})` : ''}`, ar: `${a.name}: لا تواصل منذ ${a.quietDays} يومًا${a.owner ? ` (${a.owner})` : ''}` })
  }
  // Requirement 33: what is missing in Odoo, one line per kind, every day
  // until it is fixed there (the CEO's dashboards are only as good as it).
  const missing = odoo?.missing || []
  for (const kind of ['deal_no_owner', 'deal_no_value', 'project_no_date']) {
    const xs = missing.filter(m => m.kind === kind)
    if (!xs.length) continue
    const word = { deal_no_owner: ['deal', 'with no salesperson', 'صفقة بلا مندوب'], deal_no_value: ['deal', 'with no expected value', 'صفقة بلا قيمة متوقعة'], project_no_date: ['project', 'with no delivery date', 'مشروع بلا تاريخ تسليم'] }[kind]
    items.push({ kind: 'odoo_missing', en: `${xs.length} ${word[0]}${xs.length === 1 ? '' : 's'} ${word[1]}: ${xs.slice(0, 3).map(x => x.name).join(', ')}${xs.length > 3 ? '…' : ''}`, ar: `${xs.length} ${word[2]}: ${xs.slice(0, 3).map(x => x.name).join('، ')}${xs.length > 3 ? '…' : ''}` })
  }
  return items
}

const KIND_TITLE = {
  late_quote: { en: 'Late quotes', ar: 'عروض أسعار متأخرة' },
  late_reply: { en: 'No first reply yet', ar: 'لم يُرد عليها بعد' },
  unassigned: { en: 'Leads with no owner', ar: 'استفسارات بلا مسؤول' },
  account_quiet: { en: 'Key accounts at risk', ar: 'عملاء رئيسيون في خطر' },
  odoo_missing: { en: 'To fix in Odoo', ar: 'بيانات ناقصة في أودو' },
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** The daily alert email, Arabic first then English. null when there is nothing new. */
export function dailyAlertEmail(items = [], { company = 'Arak', pageUrl = '' } = {}) {
  if (!items.length) return null
  const groups = Object.keys(KIND_TITLE).map(k => [k, items.filter(i => i.kind === k)]).filter(([, xs]) => xs.length)
  const subject = `${company}: ${items.length} item${items.length === 1 ? '' : 's'} need action today · ${items.length} بنود تحتاج إجراء اليوم`
  const block = lang => groups.map(([k, xs]) => `${KIND_TITLE[k][lang]} (${xs.length})\n${xs.slice(0, 15).map(i => `• ${i[lang]}`).join('\n')}${xs.length > 15 ? `\n• … +${xs.length - 15}` : ''}`).join('\n\n')
  const text = `${block('ar')}\n\n— English —\n\n${block('en')}${pageUrl ? `\n\n${pageUrl}` : ''}`
  const htmlBlock = (lang, dir) => `<div dir="${dir}" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">${groups.map(([k, xs]) =>
    `<p><b>${esc(KIND_TITLE[k][lang])} (${xs.length})</b><br>${xs.slice(0, 15).map(i => `• ${esc(i[lang])}`).join('<br>')}${xs.length > 15 ? `<br>• … +${xs.length - 15}` : ''}</p>`).join('')}</div>`
  const html = `${htmlBlock('ar', 'rtl')}<hr>${htmlBlock('en', 'ltr')}${pageUrl ? `<p><a href="${esc(pageUrl)}">Open the CEO page / افتح صفحة المدير التنفيذي</a></p>` : ''}`
  return { subject, text, html }
}

/** The Sunday summary email: five lines in Arabic, then in English. */
export function weeklyEmail(lines = [], { company = 'Arak', pageUrl = '', weekOf = '' } = {}) {
  const subject = `${company}: الملخص الأسبوعي · Weekly summary${weekOf ? ` · ${weekOf}` : ''}`
  const text = `${lines.map(l => l.ar).join('\n')}\n\n— English —\n\n${lines.map(l => l.en).join('\n')}${pageUrl ? `\n\n${pageUrl}` : ''}`
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7">${lines.map(l => `<p style="margin:0 0 8px">${esc(l.ar)}</p>`).join('')}</div><hr>`
    + `<div dir="ltr" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#444">${lines.map(l => `<p style="margin:0 0 6px">${esc(l.en)}</p>`).join('')}</div>`
    + (pageUrl ? `<p><a href="${esc(pageUrl)}">افتح صفحة المدير التنفيذي · Open the CEO page</a></p>` : '')
  return { subject, text, html }
}
