// ─── Technical: the monitor round ──────────────────────────────────────────
// 2026-10-19 (v2). Runs after each Odoo mirror round (_odooSync.js step 5),
// so at most hourly per company. Odoo manages the projects; this only
// watches them (src/lib/technical/projects.js has every rule):
//
//   1. the stage log: a project whose Odoo stage changed leaves the old one
//      and enters the new one now;
//   2. each project's health (red / amber / green) into project_flags; a
//      project that turns red is marked for the CEO's daily alert;
//   3. reminders, as tasks for the project's manager, each made once:
//      a stage over its days, the weekly update missing, a submittal waiting
//      on the client;
//   4. reminders that no longer apply (the stage moved on, the client
//      answered) are closed.
// Follow-ups after a C or D code, and closing the update reminder when the
// update is written, happen in the database at once (20261105 triggers).
//
//   deps: db (service key), now

import { stageLogChanges, projectBoard, plannedReminders, settingsOf } from '../../src/lib/technical/projects.js'

const ws = id => `workspace_id=eq.${encodeURIComponent(id)}`
const PROJECT_MODELS = ['project.project', 'project.project.stage', 'project.task', 'project.update']
/** The reminder kinds this round owns (and may close). */
const OWNED = ['stage_late:', 'update_due:', 'review_chase:']

/** Every row of a PostgREST read, a page at a time (the API returns at most 1,000 per request). */
export async function readAll(db, path, page = 1000) {
  const out = []
  for (let offset = 0; ; offset += page) {
    const rows = await db(`${path}&limit=${page}&offset=${offset}`) || []
    out.push(...rows)
    if (rows.length < page) return out
  }
}

/** The mirrored records of these models, as { model: [data…] }. */
export async function mirrorRecords(db, workspaceId, models) {
  const rows = await readAll(db, `odoo_records?${ws(workspaceId)}&model=in.(${models.map(encodeURIComponent).join(',')})&select=model,data&order=model.asc,odoo_id.asc`)
  const records = {}
  for (const r of rows) (records[r.model] ||= []).push(r.data)
  return records
}

export async function monitorProjects(deps, { workspaceId }) {
  const now = deps.now().getTime()
  const iso = new Date(now).toISOString()
  const records = await mirrorRecords(deps.db, workspaceId, PROJECT_MODELS)

  const [log0, submittals, updates, [settingsRow], managers, flags] = await Promise.all([
    readAll(deps.db, `project_stage_log?${ws(workspaceId)}&left_at=is.null&select=*&order=id.asc`),
    readAll(deps.db, `project_submittals?${ws(workspaceId)}&select=*&order=id.asc`),
    readAll(deps.db, `project_updates?${ws(workspaceId)}&select=id,odoo_project_id,status,written_at&order=written_at.desc`),
    deps.db(`technical_settings?${ws(workspaceId)}&select=*`).then(r => r || []),
    deps.db('rpc/project_managers', { method: 'POST', body: { ws: workspaceId } }).then(r => r || []),
    readAll(deps.db, `project_flags?${ws(workspaceId)}&select=odoo_project_id,level,red_since,alerted_at&order=odoo_project_id.asc`),
  ])
  const settings = settingsOf(settingsRow || {})

  // 1. The stage log.
  const changes = stageLogChanges({ records, log: log0, now })
  for (const pid of changes.close) {
    await deps.db(`project_stage_log?${ws(workspaceId)}&odoo_project_id=eq.${pid}&left_at=is.null`, { method: 'PATCH', prefer: 'return=minimal', body: { left_at: iso } })
  }
  let opened = []
  if (changes.open.length) {
    opened = await deps.db('project_stage_log', { method: 'POST', prefer: 'return=representation', body: changes.open.map(r => ({ workspace_id: workspaceId, ...r })) }) || []
  }
  const closed = new Set(changes.close)
  const log = [...log0.filter(l => !closed.has(Number(l.odoo_project_id))), ...opened]

  // 2. Health.
  const board = projectBoard({ records, log, submittals, updates, settings, now })
  const prev = new Map(flags.map(f => [Number(f.odoo_project_id), f]))
  const turnedRed = []
  const flagRows = board.map(p => {
    const before = prev.get(p.id)
    const red = p.health.level === 'red'
    const wasRed = before?.level === 'red'
    if (red && !wasRed) turnedRed.push(p.id)
    return {
      workspace_id: workspaceId, odoo_project_id: p.id, name: p.name, level: p.health.level, reasons: p.health.reasons,
      red_since: red ? (wasRed ? before.red_since : iso) : null,
      alerted_at: red && wasRed ? before.alerted_at : null,
      updated_at: iso,
    }
  })
  if (flagRows.length) {
    await deps.db('project_flags?on_conflict=workspace_id,odoo_project_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: flagRows })
  }
  const gone = [...prev.keys()].filter(id => !board.some(p => p.id === id))
  if (gone.length) await deps.db(`project_flags?${ws(workspaceId)}&odoo_project_id=in.(${gone.join(',')})`, { method: 'DELETE', prefer: 'return=minimal' })

  // 3. Reminders, each once.
  const pmUsers = Object.fromEntries(managers.filter(m => m.user_id).map(m => [m.odoo_project_id, m.user_id]))
  const logIds = Object.fromEntries(log.map(l => [Number(l.odoo_project_id), l.id]))
  const { make, keep } = plannedReminders(board, { pmUsers, logIds, settings, now })
  let made = []
  if (make.length) {
    made = await deps.db('tasks?on_conflict=workspace_id,auto_key', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
      body: make.map(t => ({ workspace_id: workspaceId, section: 'technical', status: 'todo', details: '', ...t })),
    }) || []
  }

  // A reminder made before its project manager had a Campai login (or a
  // follow-up the database made then) is given to them once they do.
  for (const [pid, user] of Object.entries(pmUsers)) {
    await deps.db(`tasks?${ws(workspaceId)}&odoo_project_id=eq.${pid}&auto_key=not.is.null&assigned_to=is.null&status=in.(todo,in_progress,waiting)`, {
      method: 'PATCH', prefer: 'return=minimal', body: { assigned_to: user },
    })
  }

  // 4. Reminders that no longer apply.
  const open = await readAll(deps.db, `tasks?${ws(workspaceId)}&auto_key=not.is.null&status=in.(todo,in_progress,waiting)&select=id,auto_key&order=id.asc`)
  const stale = open.filter(t => OWNED.some(k => t.auto_key.startsWith(k)) && !keep.has(t.auto_key)).map(t => t.id)
  if (stale.length) {
    await deps.db(`tasks?id=in.(${stale.join(',')})`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'done' } })
  }

  return {
    projects: board.length,
    red: board.filter(p => p.health.level === 'red').length,
    turnedRed: turnedRed.length,
    stageChanges: changes.open.length,
    reminders: made.length,
    closed: stale.length,
    unmatchedManagers: board.filter(p => p.pmOdooId && !pmUsers[p.id]).length,
  }
}
