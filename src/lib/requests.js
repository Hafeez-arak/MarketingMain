import { supabase } from './supabaseClient'

// ─── Requests and the inbox, from the browser ──────────────────────────────
// 2026-10-18, PR 2 of docs/CEO-ASSISTANT-PLAN.md. Thin wrappers over the
// requests, request_events and notifications tables with the signed-in
// person's own token; RLS decides what each person sees (admins: the whole
// board; everyone else: what they asked for or own). Notifications are
// written by the requests_notify trigger, never here, so every write sets
// `updated_by` to the person acting.

export const STATUS_LABEL = { new: 'New', in_progress: 'In progress', done: 'Done', declined: 'Declined' }
export const KIND_LABEL = { improvement: 'Improvement', bug: 'Bug', content: 'Content', question: 'Question', task: 'Task' }
/** The same in Arabic (v2, lib/i18n.js). */
export const AR_LABELS = {
  status: { new: 'جديد', in_progress: 'قيد التنفيذ', done: 'منجز', declined: 'مرفوض' },
  kind: { improvement: 'تحسين', bug: 'خلل', content: 'محتوى', question: 'سؤال', task: 'مهمة' },
}

/** The board's three columns. Declined sits with done: both are closed. */
export function columnOf(status) {
  if (status === 'in_progress') return 'in_progress'
  if (status === 'done' || status === 'declined') return 'closed'
  return 'new'
}

/** Filter the board by whose requests they are. */
export function filterRequests(rows = [], view = 'all', userId = '') {
  if (view === 'mine') return rows.filter(r => r.created_by === userId)
  if (view === 'assigned') return rows.filter(r => r.assigned_to === userId)
  return rows
}

const REQUEST_COLS = 'id,kind,title,body,brief,page,status,resolution,link,created_by,assigned_to,chat_id,created_at,updated_at,closed_at'

export async function fetchRequests(workspaceId) {
  if (!workspaceId) return { rows: [], error: null }
  const { data, error } = await supabase
    .from('requests')
    .select(REQUEST_COLS)
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(300)
  return { rows: data || [], error: error?.message || null }
}

export async function fetchEvents(requestId) {
  const { data, error } = await supabase
    .from('request_events')
    .select('id,kind,body,actor,from_status,to_status,created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })
  return { rows: data || [], error: error?.message || null }
}

/** user_id -> name for everyone in this company, via a SECURITY DEFINER function. */
export async function fetchPeople(workspaceId) {
  if (!workspaceId) return new Map()
  const { data } = await supabase.rpc('workspace_people', { ws: workspaceId })
  return new Map((data || []).map(p => [p.user_id, p.name]))
}

/** Who can be tagged here: [{ user_id, name, label }]. */
export async function fetchTaggable(workspaceId) {
  if (!workspaceId) return []
  const { data } = await supabase.rpc('taggable_people', { ws: workspaceId })
  return data || []
}

export async function updateRequest(id, workspaceId, userId, patch) {
  const { error } = await supabase
    .from('requests')
    .update({ ...patch, updated_by: userId })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
  return error?.message || null
}

export async function addComment(requestId, workspaceId, userId, body) {
  const text = String(body || '').trim()
  if (!text) return null
  const { error } = await supabase
    .from('request_events')
    .insert({ request_id: requestId, workspace_id: workspaceId, actor: userId, kind: 'comment', body: text.slice(0, 2000) })
  return error?.message || null
}

/** Open requests that need this person: new ones for an admin, theirs to do for anyone. */
export async function countWaiting(workspaceId, userId, isAdmin) {
  if (!workspaceId || !userId) return 0
  let q = supabase.from('requests').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
  q = isAdmin
    ? q.or(`status.eq.new,and(assigned_to.eq.${userId},status.in.(new,in_progress))`)
    : q.eq('assigned_to', userId).in('status', ['new', 'in_progress'])
  const { count } = await q
  return count || 0
}

// ── The inbox ──

export async function fetchInbox(limit = 30) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id,kind,title,body,link,request_id,workspace_id,created_at,read_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  return { rows: data || [], error: error?.message || null }
}

export async function markRead(ids = []) {
  if (!ids.length) return null
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null)
  return error?.message || null
}
