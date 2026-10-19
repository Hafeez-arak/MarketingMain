// ─── Technical: projects, their nine stages, submittals and health ─────────
// 2026-10-19 (v2). The owner's rule: Odoo Project manages the projects;
// Campai watches them. Projects, their stage and their project manager come
// from Odoo through the hourly mirror (odoo_records). Campai adds only what
// Odoo does not hold:
//
//   · when each project entered its stage (project_stage_log, written by the
//     mirror when it sees the stage change), so a stage can be late;
//   · the client's submittal rounds and their approval codes (A/B/C/D);
//   · the project manager's weekly update.
//
// Reminders and follow-ups are ordinary tasks (public.tasks), created by the
// monitor round (api/leads/_technical.js) and the database triggers, so they
// get the Tasks system's due-soon, overdue and morning digest for free.
//
// Pure: no React, no IO. Every rule here is tested in projects.test.js.

const DAY = 86_400_000

/**
 * The nine stages, in order. `days` is the default time a project may spend
 * in the stage before it turns red; the Technical manager changes them on
 * Technical → Settings (technical_settings.stage_days).
 */
export const STAGES = [
  { key: 'awarded',        days: 7,  en: 'Awarded',                      ar: 'تمت الترسية' },
  { key: 'submittal',      days: 14, en: 'Technical submittal',          ar: 'التقديم الفني' },
  { key: 'client_review',  days: 14, en: 'Client review',                ar: 'مراجعة العميل' },
  { key: 'purchase_order', days: 7,  en: 'Purchase order',               ar: 'أمر الشراء' },
  { key: 'production',     days: 60, en: 'Production & shipping',        ar: 'التصنيع والشحن' },
  { key: 'delivery',       days: 14, en: 'Delivery to site',             ar: 'التوريد للموقع' },
  { key: 'installation',   days: 30, en: 'Installation & commissioning', ar: 'التركيب والتشغيل' },
  { key: 'handover',       days: 14, en: 'Handover',                     ar: 'التسليم' },
  { key: 'collection',     days: 60, en: 'Collection & maintenance',     ar: 'التحصيل والصيانة' },
]
export const STAGE_KEYS = STAGES.map(s => s.key)
export const stageIndex = key => STAGE_KEYS.indexOf(key)
export const stageLabel = (key, lang = 'en') => STAGES.find(s => s.key === key)?.[lang] || ''

/**
 * The client's approval codes on a submittal, as consultants in the Gulf use
 * them. C and D send the submittal back for another round.
 */
export const CODES = {
  A: { en: 'Approved', ar: 'معتمد', again: false },
  B: { en: 'Approved as noted', ar: 'معتمد مع ملاحظات', again: false },
  C: { en: 'Revise and resubmit', ar: 'يُعدَّل ويُعاد تقديمه', again: true },
  D: { en: 'Rejected', ar: 'مرفوض', again: true },
}

export const DEFAULT_SETTINGS = {
  stage_days: Object.fromEntries(STAGES.map(s => [s.key, s.days])),
  update_every_days: 7,       // the PM's weekly update
  review_chase_days: 10,      // a submittal with the client this long → chase
  resubmit_days: 7,           // after a C or D, the next round is due in
}

/** The company's settings over the defaults (missing or bad values fall back). */
export function settingsOf(row = {}) {
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : d)
  const days = { ...DEFAULT_SETTINGS.stage_days }
  for (const k of STAGE_KEYS) if (row?.stage_days && k in row.stage_days) days[k] = n(row.stage_days[k], days[k])
  return {
    stage_days: days,
    update_every_days: n(row?.update_every_days, DEFAULT_SETTINGS.update_every_days),
    review_chase_days: n(row?.review_chase_days, DEFAULT_SETTINGS.review_chase_days),
    resubmit_days: n(row?.resubmit_days, DEFAULT_SETTINGS.resubmit_days),
  }
}

// Words in an Odoo stage name that say which of the nine it is, English or
// Arabic, checked in this order (client review before submittal: "Submittal
// review" is the client's review).
const STAGE_WORDS = [
  ['client_review', /review|approval|مراجع|اعتماد/],
  ['submittal', /submittal|submission|تقديم/],
  ['purchase_order', /purchase|\bp\.?o\b|أمر الشراء|امر الشراء/],
  ['production', /production|manufactur|shipping|تصنيع|شحن/],
  ['delivery', /deliver|توريد/],
  ['installation', /install|commission|تركيب|تشغيل/],
  ['handover', /hand[\s-]?over|تسليم/],
  ['collection', /collection|maintenance|تحصيل|صيانة/],
  ['awarded', /award|won|ترسي/],
]

/**
 * Odoo's project stages (project.project.stage) → { odooStageId: key }.
 * By name first; when names say nothing and Odoo has exactly nine stages,
 * by their order. A stage that matches nothing is left out (the project
 * shows "stage not one of the nine").
 */
export function stageMap(odooStages = []) {
  const map = {}
  const sorted = [...odooStages].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.id - b.id)
  for (const s of sorted) {
    const name = String(s.name || '').toLowerCase()
    const hit = STAGE_WORDS.find(([, re]) => re.test(name))
    if (hit) map[s.id] = hit[0]
  }
  if (!Object.keys(map).length && sorted.length === STAGES.length) {
    sorted.forEach((s, i) => { map[s.id] = STAGE_KEYS[i] })
  }
  return map
}

const m2oId = v => (Array.isArray(v) ? v[0] : null)
const m2oName = v => (Array.isArray(v) ? String(v[1] || '') : '')
/** Odoo's UTC datetime or date, as ms. */
export const odooTime = s => {
  if (!s) return null
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : `${String(s).replace(' ', 'T')}Z`)
  return Number.isFinite(t) ? t : null
}
const ms = v => (v == null ? null : typeof v === 'number' ? v : Date.parse(v) || odooTime(v))
const days = (from, to) => Math.floor((to - from) / DAY)

/**
 * Each submittal item's rounds, newest last, and where it stands:
 *   'waiting'   with the client, no code yet (days = since submitted)
 *   'again'     came back C or D and no later round yet (days = since returned)
 *   'approved'  A or B
 *   'draft'     a round not yet submitted
 */
export function submittalItems(rows = [], now = Date.now()) {
  const byItem = new Map()
  for (const r of rows) {
    const k = String(r.title || '').trim().toLowerCase()
    if (!byItem.has(k)) byItem.set(k, [])
    byItem.get(k).push(r)
  }
  const out = []
  for (const rounds of byItem.values()) {
    rounds.sort((a, b) => a.round - b.round)
    const last = rounds[rounds.length - 1]
    let state = 'draft', since = null
    if (last.code && CODES[last.code]) {
      state = CODES[last.code].again ? 'again' : 'approved'
      since = ms(last.returned_at) ?? ms(last.updated_at)
    } else if (last.submitted_at) {
      state = 'waiting'
      since = ms(last.submitted_at)
    }
    out.push({ title: last.title, rounds, last, round: last.round, state, days: since == null ? null : days(since, now) })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

/** The newest weekly update, from Campai or from Odoo's own project updates: { at, status, by, source } or null. */
export function latestUpdate(campai = [], odoo = []) {
  const all = [
    ...campai.map(u => ({ at: ms(u.written_at), status: u.status, by: u.written_by_name || '', source: 'campai', row: u })),
    ...odoo.map(u => ({ at: odooTime(u.date) ?? odooTime(u.write_date), status: u.status, by: m2oName(u.user_id), source: 'odoo', row: u })),
  ].filter(u => u.at != null)
  all.sort((a, b) => b.at - a.at)
  return all[0] || null
}

/**
 * One project's health. Red is what the CEO is told about:
 *   stage_late   longer in its stage than that stage allows
 *   past_end     the delivery date passed before handover
 *   off_track    the latest update says off track
 * Amber is for the PM: near the stage's limit (75%), at risk, weekly update
 * missing, a submittal waiting on the client, a resubmission due, or a stage
 * that is not one of the nine.
 *
 *   project   the Odoo record (project.project)
 *   stageKey  one of STAGE_KEYS, or null
 *   enteredAt when it entered that stage (ms or ISO)
 */
export function projectHealth({ project = {}, stageKey = null, enteredAt = null, update = null, submittals = [], settings = DEFAULT_SETTINGS, now = Date.now() }) {
  const s = settings.stage_days ? settings : settingsOf(settings)
  const reasons = []
  const entered = ms(enteredAt)
  const inStage = entered == null ? null : days(entered, now)
  const allowed = stageKey ? s.stage_days[stageKey] : null

  if (!stageKey) reasons.push({ kind: 'no_stage', level: 'amber' })
  else if (inStage != null && allowed) {
    if (inStage > allowed) reasons.push({ kind: 'stage_late', level: 'red', days: inStage - allowed, stage: stageKey })
    else if (inStage >= Math.ceil(allowed * 0.75)) reasons.push({ kind: 'stage_near', level: 'amber', days: allowed - inStage })
  }

  const end = odooTime(project.date)
  if (end != null && now - end >= DAY && (!stageKey || stageIndex(stageKey) < stageIndex('handover'))) {
    reasons.push({ kind: 'past_end', level: 'red', days: days(end, now) })
  }

  const status = update?.status || project.last_update_status || null
  if (status === 'off_track') reasons.push({ kind: 'off_track', level: 'red' })
  else if (status === 'at_risk') reasons.push({ kind: 'at_risk', level: 'amber' })

  const since = update ? days(update.at, now) : null
  if (since == null || since >= s.update_every_days) reasons.push({ kind: 'update_missing', level: 'amber', days: since })

  for (const it of submittals) {
    if (it.state === 'waiting' && it.days >= s.review_chase_days) reasons.push({ kind: 'review_waiting', level: 'amber', title: it.title, round: it.round, days: it.days })
    if (it.state === 'again') reasons.push({ kind: 'resubmit_due', level: it.days > s.resubmit_days ? 'red' : 'amber', title: it.title, round: it.round, code: it.last.code, days: it.days })
  }

  const level = reasons.some(r => r.level === 'red') ? 'red' : reasons.some(r => r.level === 'amber') ? 'amber' : 'green'
  return { level, reasons, inStage, allowed, updateDays: since }
}

/**
 * The projects board: each Odoo project with its stage, PM, health and
 * submittals. `log` = the open project_stage_log row per project (entered_at).
 */
export function projectBoard({ records = {}, log = [], submittals = [], updates = [], settings = {}, now = Date.now() }) {
  const s = settingsOf(settings)
  const map = stageMap(records['project.project.stage'] || [])
  const openLog = new Map(log.filter(l => !l.left_at).map(l => [Number(l.odoo_project_id), l]))
  const odooUpdates = groupBy(records['project.update'] || [], u => m2oId(u.project_id))
  const campaiUpdates = groupBy(updates, u => Number(u.odoo_project_id))
  const subs = groupBy(submittals, r => Number(r.odoo_project_id))
  const tasks = groupBy((records['project.task'] || []).filter(t => t.active !== false), t => m2oId(t.project_id))

  return (records['project.project'] || [])
    .filter(p => p.active !== false)
    .map(p => {
      const stageId = m2oId(p.stage_id)
      const stageKey = stageId != null ? map[stageId] || null : null
      const entry = openLog.get(p.id)
      const enteredAt = entry && entry.odoo_stage_id === stageId ? entry.entered_at : (odooTime(p.date_last_stage_update) ?? null)
      const update = latestUpdate(campaiUpdates.get(p.id) || [], odooUpdates.get(p.id) || [])
      const items = submittalItems(subs.get(p.id) || [], now)
      const health = projectHealth({ project: p, stageKey, enteredAt, update, submittals: items, settings: s, now })
      const open = (tasks.get(p.id) || []).filter(t => !['1_done', '1_canceled'].includes(t.state))
      return {
        id: p.id, name: p.name, customer: m2oName(p.partner_id), pmOdooId: m2oId(p.user_id), pm: m2oName(p.user_id),
        stageKey, stageName: m2oName(p.stage_id), enteredAt, endDate: p.date || null, startDate: p.date_start || null,
        update, submittals: items, health,
        tasksOpen: open.length,
        tasksLate: open.filter(t => (odooTime(t.date_deadline) ?? Infinity) < now - DAY).length,
      }
    })
    .sort((a, b) => LEVEL_ORDER[a.health.level] - LEVEL_ORDER[b.health.level] || stageIndex(a.stageKey) - stageIndex(b.stageKey) || a.name.localeCompare(b.name))
}
const LEVEL_ORDER = { red: 0, amber: 1, green: 2 }

function groupBy(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const k = key(r)
    if (k == null) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

/**
 * What the stage log should become after a mirror round. `log` is the open
 * rows; returns { close: [projectId], open: [{ odoo_project_id, odoo_stage_id,
 * stage_key, stage_name, entered_at, estimated }] }. A project seen for the
 * first time is given the stage date Odoo has, else its last change
 * (estimated); a stage that changed since is entered now.
 */
export function stageLogChanges({ records = {}, log = [], now = Date.now() }) {
  const map = stageMap(records['project.project.stage'] || [])
  const openLog = new Map(log.filter(l => !l.left_at).map(l => [Number(l.odoo_project_id), l]))
  const close = [], open = []
  for (const p of records['project.project'] || []) {
    if (p.active === false) continue
    const stageId = m2oId(p.stage_id)
    const cur = openLog.get(p.id)
    if (cur && cur.odoo_stage_id === stageId) continue
    if (stageId == null && !cur) continue
    if (cur) close.push(p.id)
    if (stageId == null) continue
    const known = odooTime(p.date_last_stage_update)
    const first = !cur
    const at = first ? (known ?? odooTime(p.write_date) ?? now) : now
    open.push({
      odoo_project_id: p.id, odoo_stage_id: stageId, stage_key: map[stageId] || null, stage_name: m2oName(p.stage_id),
      entered_at: new Date(at).toISOString(), estimated: first && known == null,
    })
  }
  return { close, open }
}

/**
 * The reminders the monitor round makes, each once (`auto_key`), assigned to
 * the project's manager in Campai (`pmUser`, null when Odoo's PM has no
 * Campai login: then the Technical managers see it, unassigned).
 *   stage_late     the stage is over its days     (key per stage entry)
 *   update_due     no weekly update for N days    (key per last update)
 *   review_chase   a submittal with the client N days (key per round)
 * Follow-ups after a C or D code are made by the database the moment the
 * code is saved (trigger project_submittals_follow), not here.
 * Also returns the open reminders that no longer apply (`close`: key prefixes).
 */
export function plannedReminders(board = [], { pmUsers = {}, logIds = {}, settings = {}, now = Date.now(), lang = 'en' } = {}) {
  const s = settingsOf(settings)
  const t = REMIND[lang] || REMIND.en
  const make = [], keep = new Set()
  const due = (d) => new Date(now + d * DAY).toISOString()
  for (const p of board) {
    const base = { odoo_project_id: p.id, assigned_to: pmUsers[p.id] || null }
    const late = p.health.reasons.find(r => r.kind === 'stage_late')
    if (late && logIds[p.id]) {
      const key = `stage_late:${p.id}:${logIds[p.id]}`
      keep.add(key)
      make.push({ ...base, auto_key: key, priority: 'high', due_at: due(1), title: t.stageLate(p, late), details: t.stageLateWhy(p, s) })
    }
    const missing = p.health.reasons.find(r => r.kind === 'update_missing')
    if (missing) {
      const key = `update_due:${p.id}:${p.update ? `${p.update.source}-${p.update.row?.id ?? p.update.at}` : 'none'}`
      keep.add(key)
      make.push({ ...base, auto_key: key, priority: 'normal', due_at: due(1), title: t.update(p), details: t.updateWhy(p, s) })
    }
    for (const r of p.health.reasons.filter(x => x.kind === 'review_waiting')) {
      const item = p.submittals.find(i => i.title === r.title)
      const key = `review_chase:${p.id}:${item?.last?.id ?? r.title}`
      keep.add(key)
      make.push({ ...base, auto_key: key, priority: 'normal', due_at: due(2), title: t.chase(p, r), details: t.chaseWhy(r) })
    }
  }
  return { make, keep }
}

const REMIND = {
  en: {
    stageLate: (p, r) => `${p.name}: ${r.days} day${r.days === 1 ? '' : 's'} over in ${stageLabel(p.stageKey)}`,
    stageLateWhy: (p, s) => `${stageLabel(p.stageKey)} is allowed ${s.stage_days[p.stageKey]} days. Move it on in Odoo, or say in this week's update what is holding it.`,
    update: p => `Weekly update for ${p.name}`,
    updateWhy: (p, s) => (p.update ? `The last update was ${p.health.updateDays} days ago; one is due every ${s.update_every_days} days.` : `No update has been written yet; one is due every ${s.update_every_days} days.`) + ' Write it on the project in Technical.',
    chase: (p, r) => `Chase the client: ${r.title} (round ${r.round}) on ${p.name}`,
    chaseWhy: r => `Submitted ${r.days} days ago and no code back yet.`,
  },
}
