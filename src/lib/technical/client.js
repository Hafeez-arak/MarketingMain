import { supabase } from '../supabaseClient'
import { readModels, readSyncState } from '../odooMirror'
import { projectBoard, settingsOf, STAGE_KEYS, PROJECT_MODELS } from './projects'
import { financeFacts } from '../finance/finance'

// ─── Technical: reads and writes from the browser (v2) ─────────────────────
// 2026-10-19. The database decides who sees which project (can_see_project)
// and who may record on it (can_work_project), migration 20261105. Every
// read throws on failure, so the screens say "could not load", never "no
// projects".

const MODELS = [...PROJECT_MODELS, 'res.users']
// Contract value, % collected and margin on the project page: the database
// returns these only to the CEO and Finance, so others simply get none.
const MONEY = ['sale.order', 'account.move', 'account.analytic.line']

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data }

/** Everything the projects board needs, and the board itself. */
export async function loadTechnical(workspaceId) {
  const [records, sync, log, submittals, updates, settingsRow, people, myOdooUid] = await Promise.all([
    readModels(workspaceId, [...MODELS, ...MONEY]),
    readSyncState(workspaceId),
    supabase.from('project_stage_log').select('*').eq('workspace_id', workspaceId).order('entered_at').then(must),
    supabase.from('project_submittals').select('*').eq('workspace_id', workspaceId).order('round').then(must),
    supabase.from('project_updates').select('*').eq('workspace_id', workspaceId).order('written_at', { ascending: false }).then(must),
    supabase.from('technical_settings').select('*').eq('workspace_id', workspaceId).maybeSingle().then(must),
    supabase.rpc('task_people', { ws: workspaceId }).then(must),
    // Which Odoo user you are (by email), for "your projects".
    supabase.rpc('my_odoo_uid', { ws: workspaceId }).then(must),
  ])
  const settings = settingsOf(settingsRow || {})
  const names = Object.fromEntries((people || []).map(p => [p.user_id, p.name]))
  const named = (updates || []).map(u => ({ ...u, written_by_name: names[u.written_by] || '' }))
  const now = Date.now()
  const board = projectBoard({ records, log: log || [], submittals: submittals || [], updates: named, settings, now })
  const moneyKnown = MONEY.some(m => (records[m] || []).length)
  const money = moneyKnown
    ? Object.fromEntries(financeFacts(records, { now, models: sync?.models || [], url: sync?.odoo_url || '' }).projects.map(p => [p.id, p]))
    : {}
  return { records, sync, log: log || [], submittals: submittals || [], updates: named, settings, settingsRow, board, names, now, myOdooUid: myOdooUid ?? null, money, moneyKnown }
}

/** The Campai follow-up tasks on one project (the database shows only the ones you may see). */
export async function projectTasks(workspaceId, projectId) {
  return supabase.from('tasks').select('id,title,status,due_at,assigned_to,priority,auto_key,created_at')
    .eq('workspace_id', workspaceId).eq('odoo_project_id', projectId)
    .order('created_at', { ascending: false }).limit(50).then(must)
}

/** A new submittal round. Round 1 unless `round` is given. */
export async function addSubmittal(workspaceId, me, { projectId, title, round = 1, submitted_at = null, notes = '', odoo_task_id = null }) {
  const { error } = await supabase.from('project_submittals').insert({
    workspace_id: workspaceId, odoo_project_id: projectId, title: String(title || '').trim(), round,
    submitted_at: submitted_at || null, notes, odoo_task_id, created_by: me,
  })
  return { error: error ? friendly(error) : null }
}

/** The client's answer on a round: a code A–D (null clears it), the date it came back, notes. */
export async function setSubmittal(workspaceId, id, fields) {
  const body = {}
  for (const k of ['code', 'returned_at', 'submitted_at', 'notes']) if (k in fields) body[k] = fields[k] || (k === 'notes' ? '' : null)
  const { error } = await supabase.from('project_submittals').update(body).eq('id', id).eq('workspace_id', workspaceId)
  return { error: error ? friendly(error) : null }
}

export async function deleteSubmittal(workspaceId, id) {
  const { error } = await supabase.from('project_submittals').delete().eq('id', id).eq('workspace_id', workspaceId)
  return { error: error ? friendly(error) : null }
}

/** The project manager's weekly update. */
export async function writeUpdate(workspaceId, me, { projectId, status, done = '', next = '', blockers = '', expected_delivery = '' }) {
  const { error } = await supabase.from('project_updates').insert({
    workspace_id: workspaceId, odoo_project_id: projectId, status, done, next, blockers, written_by: me,
    expected_delivery: expected_delivery || null,
  })
  return { error: error ? friendly(error) : null }
}

/** Days allowed per stage and the reminder timings (Technical manage). */
export async function saveSettings(workspaceId, me, s) {
  const stage_days = Object.fromEntries(STAGE_KEYS.map(k => [k, Math.round(Number(s.stage_days[k]))]))
  const { error } = await supabase.from('technical_settings').upsert({
    workspace_id: workspaceId, stage_days,
    update_every_days: Math.round(Number(s.update_every_days)),
    review_chase_days: Math.round(Number(s.review_chase_days)),
    resubmit_days: Math.round(Number(s.resubmit_days)),
    updated_by: me, updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' })
  return { error: error ? friendly(error) : null }
}

/** The database's refusals in words a person can act on. */
function friendly(error) {
  const m = String(error.message || error)
  if (/row-level security|permission denied/i.test(m)) return 'You can record only on projects you manage in Odoo.'
  if (/project_submittals_round_idx|duplicate key/i.test(m)) return 'That round is already recorded for this item.'
  if (/check constraint/i.test(m)) return 'One of the values is out of range.'
  return m
}
