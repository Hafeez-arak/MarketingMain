import { supabase } from '../supabaseClient'
import { getLang } from '../i18n'
import { errorText as contactsErrorText } from '../contacts/client'
import { leadRow, LIST_TABLES } from './logic'

// ─── CRM: the browser's reads and writes ───────────────────────────────────
// 2026-10-28, dev/erp-pilot/CRM.md. Straight to the database with the
// person's own login: RLS (the crm section grant) and the triggers in
// 20261125_crm_2_rules.sql decide what goes through. Every query names its
// company: RLS is membership, not isolation.

const LEAD_COLS = 'id,workspace_id,lead_no,title,contact_name,organization,phone,email,city,client_org_id,consultant,project_owner,bid_due_date,tender_ref,stage_id,source_id,assigned_to,status,expected_revenue,probability,expected_close_date,priority,lost_reason_id,lost_note,closed_at,closed_by,notes,created_by,created_at,updated_at'
const ACTIVITY_COLS = 'id,workspace_id,lead_id,activity_type,summary,due_date,assigned_to,done_at,done_by,outcome,created_by,created_at'
const LIST_COLS = { stages: 'id,workspace_id,name,name_en,sequence,is_active,auto_event,created_at', tags: 'id,workspace_id,name,name_en,color,is_active,created_at' }
const listCols = kind => LIST_COLS[kind] || 'id,workspace_id,name,name_en,is_active,created_at'

// The API returns at most 1,000 rows a request; a company's pipeline is read whole.
const PAGE = 1000

async function readAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) return { rows, error }
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return { rows, error: null }
  }
}

// What the database's refusals mean, in both languages. Each CRM_ code is
// raised by 20261125_crm_2_rules.sql; CONTACTS_ codes (linking a client can
// touch its Contacts record) are worded by lib/contacts/client.js.
export const ERROR_WORDS = {
  en: {
    CRM_LEAD_TRANSITION: 'An opportunity starts open, then is marked won or lost.',
    CRM_LEAD_WON: 'This opportunity is won, and a won one is final: it is not changed any more.',
    CRM_LEAD_LOST: 'This opportunity is lost. Reopen it first, then change it.',
    CRM_LEAD_CLOSED: 'This opportunity is closed: nothing new is planned on it and its tags stay as they are.',
    CRM_LEAD_DELETE: 'Only an open opportunity with no done activities can be deleted. Mark it lost instead.',
    CRM_WON_NEEDS_CLIENT: 'Set the opportunity\'s client first (link an organisation from Contacts or create one), then mark it won.',
    CRM_LOST_NEEDS_REASON: 'Choose why it was lost.',
    CRM_STAGE_INACTIVE: 'That stage is switched off. Choose an active stage.',
    CRM_SOURCE_INACTIVE: 'That source is switched off. Choose an active one.',
    CRM_REASON_INACTIVE: 'That loss reason is switched off. Choose an active one.',
    CRM_TAG_INACTIVE: 'That tag is switched off. Choose an active one.',
    CRM_ASSIGNEE: 'That person does not have the CRM in this company.',
    CRM_CLIENT_ARCHIVED: 'That organisation is archived in Contacts. Restore it first.',
    CRM_ACTIVITY_DONE: 'A done activity is history: it is neither changed nor deleted.',
    CRM_ACTIVITY_MOVED: 'An activity stays on its opportunity.',
    CRM_WORKSPACE_FIXED: 'A record cannot move to another company.',
    CRM_NEEDS_MANAGE: 'This needs Manage access to the CRM.',
    CRM_STAGES_EXIST: 'There are stages already. Change them or add one.',
    someone: 'Name a contact or an organisation, or choose a client.',
    nameTaken: 'That name is already used in this list.',
    eventTaken: 'Another stage already moves on that event. One stage per event.',
    notAllowed: 'You do not have access to do that in the CRM.',
    notFound: 'That opportunity is not there any more, or you cannot see it.',
    failed: 'It did not work. Try again.',
  },
  ar: {
    CRM_LEAD_TRANSITION: 'تبدأ الفرصة مفتوحة، ثم تُسجَّل مكسوبة أو خاسرة.',
    CRM_LEAD_WON: 'هذه الفرصة مكسوبة، والمكسوبة نهائية: لا تُعدَّل بعد ذلك.',
    CRM_LEAD_LOST: 'هذه الفرصة خاسرة. أعد فتحها أولًا ثم عدّلها.',
    CRM_LEAD_CLOSED: 'هذه الفرصة مغلقة: لا يُخطَّط عليها نشاط جديد، وتبقى وسومها كما هي.',
    CRM_LEAD_DELETE: 'لا تُحذف إلا فرصة مفتوحة ليس لها أنشطة منجزة. سجّلها خاسرة بدلًا من ذلك.',
    CRM_WON_NEEDS_CLIENT: 'حدّد عميل الفرصة أولًا (اربطها بجهة من جهات الاتصال أو أنشئ واحدة)، ثم سجّلها مكسوبة.',
    CRM_LOST_NEEDS_REASON: 'اختر سبب الخسارة.',
    CRM_STAGE_INACTIVE: 'هذه المرحلة موقوفة. اختر مرحلة نشطة.',
    CRM_SOURCE_INACTIVE: 'هذا المصدر موقوف. اختر مصدرًا نشطًا.',
    CRM_REASON_INACTIVE: 'سبب الخسارة هذا موقوف. اختر سببًا نشطًا.',
    CRM_TAG_INACTIVE: 'هذا الوسم موقوف. اختر وسمًا نشطًا.',
    CRM_ASSIGNEE: 'هذا الشخص ليست لديه صلاحية إدارة الفرص في هذه الشركة.',
    CRM_CLIENT_ARCHIVED: 'هذه الجهة مؤرشفة في جهات الاتصال. استعدها أولًا.',
    CRM_ACTIVITY_DONE: 'النشاط المنجز سجلّ تاريخي: لا يُعدَّل ولا يُحذف.',
    CRM_ACTIVITY_MOVED: 'يبقى النشاط على فرصته.',
    CRM_WORKSPACE_FIXED: 'لا يمكن نقل سجل إلى شركة أخرى.',
    CRM_NEEDS_MANAGE: 'يحتاج هذا صلاحية الإدارة في إدارة الفرص.',
    CRM_STAGES_EXIST: 'توجد مراحل مسبقًا. عدّلها أو أضف مرحلة.',
    someone: 'اذكر جهة الاتصال أو المنشأة أو اختر عميلًا.',
    nameTaken: 'هذا الاسم مستخدم في هذه القائمة.',
    eventTaken: 'توجد مرحلة أخرى تنتقل إليها الفرص عند هذا الحدث. لكل حدث مرحلة واحدة.',
    notAllowed: 'ليست لديك صلاحية لهذا في إدارة الفرص.',
    notFound: 'هذه الفرصة لم تعد موجودة، أو لا يمكنك رؤيتها.',
    failed: 'لم ينجح ذلك. حاول مجددًا.',
  },
}

// Check constraints and indexes, by name, for a race past the screen's own checks.
const CONSTRAINTS = {
  crm_leads_someone: 'someone', crm_leads_won_client: 'CRM_WON_NEEDS_CLIENT', crm_leads_lost_reason: 'CRM_LOST_NEEDS_REASON',
  crm_stages_name_uq: 'nameTaken', crm_sources_name_uq: 'nameTaken', crm_lost_reasons_name_uq: 'nameTaken', crm_tags_name_uq: 'nameTaken',
  crm_stages_event_uq: 'eventTaken',
}

/** A refusal from the database (or a code) in the reader's language. */
export function errorText(err, lang = getLang()) {
  const W = ERROR_WORDS[lang] || ERROR_WORDS.en
  const msg = String(err?.message || err || '')
  if (W[msg]) return W[msg]
  if (msg.startsWith('CONTACTS_')) return contactsErrorText(err, lang)
  const named = Object.keys(CONSTRAINTS).find(c => msg.includes(c))
  if (named) return W[CONSTRAINTS[named]]
  if (err?.code === '42501' || msg.includes('row-level security')) return W.notAllowed
  return msg && !/^[A-Z_]+$/.test(msg) ? msg : W.failed
}

const fail = error => ({ error: errorText(error) })

// ── The company's lists ──

/** One list: 'stages' | 'sources' | 'reasons' | 'tags'. */
export async function fetchList(ws, kind) {
  if (!ws) return { rows: [] }
  const { data, error } = await supabase.from(LIST_TABLES[kind]).select(listCols(kind)).eq('workspace_id', ws).order('name').limit(1000)
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}

/** Add (no id) or change one list item (managing only). */
export async function saveListItem(ws, kind, id, fields) {
  const row = { name: String(fields.name || '').trim(), name_en: String(fields.name_en || '').trim() || null }
  if ('is_active' in fields) row.is_active = Boolean(fields.is_active)
  if (kind === 'stages') {
    row.sequence = Number(fields.sequence)
    row.auto_event = fields.auto_event || null
  }
  if (kind === 'tags') row.color = Number(fields.color || 0)
  const q = id
    ? supabase.from(LIST_TABLES[kind]).update(row).eq('workspace_id', ws).eq('id', id)
    : supabase.from(LIST_TABLES[kind]).insert({ ...row, workspace_id: ws })
  const { data, error } = await q.select(listCols(kind)).maybeSingle()
  if (error) return fail(error)
  return data ? { item: data } : { error: errorText('notAllowed') }
}

/** Switch a list item on or off (managing only). */
export async function toggleListItem(ws, kind, id, isActive) {
  const { data, error } = await supabase.from(LIST_TABLES[kind]).update({ is_active: isActive }).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle()
  if (error) return fail(error)
  return data ? {} : { error: errorText('notAllowed') }
}

/** His one-click starting pipeline, when the company has no stage yet. */
export async function suggestStages(ws) {
  const { error } = await supabase.rpc('crm_suggest_stages', { ws })
  return error ? fail(error) : {}
}

/** Who an opportunity or activity can be given to. */
export async function fetchPeople(ws) {
  if (!ws) return { rows: [] }
  const { data, error } = await supabase.rpc('crm_people', { ws })
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}

/** The company's organisations as the CRM sees them (to pick and to name a client). */
export async function fetchClients(ws) {
  if (!ws) return { rows: [] }
  const { data, error } = await supabase.rpc('crm_clients', { ws })
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}

// ── Opportunities ──

export async function fetchLeads(ws, { clientId = '' } = {}) {
  if (!ws) return { rows: [] }
  const { rows, error } = await readAll(() => {
    let q = supabase.from('crm_leads').select(LEAD_COLS).eq('workspace_id', ws)
    if (clientId) q = q.eq('client_org_id', clientId)
    return q.order('created_at', { ascending: false }).order('id')
  })
  return error ? { rows, ...fail(error) } : { rows }
}

export async function fetchLead(ws, id) {
  const { data, error } = await supabase.from('crm_leads').select(LEAD_COLS).eq('workspace_id', ws).eq('id', id).maybeSingle()
  return error ? fail(error) : { lead: data }
}

/** Every tag on every opportunity of the company: [{ lead_id, tag_id }]. */
export async function fetchLeadTags(ws, { leadId = '' } = {}) {
  if (!ws) return { rows: [] }
  const { rows, error } = await readAll(() => {
    let q = supabase.from('crm_lead_tags').select('lead_id,tag_id').eq('workspace_id', ws)
    if (leadId) q = q.eq('lead_id', leadId)
    return q.order('lead_id').order('tag_id')
  })
  return error ? { rows, ...fail(error) } : { rows }
}

async function setTags(ws, leadId, tagIds) {
  const { error } = await supabase.rpc('crm_set_tags', { ws, lead: leadId, tag_ids: tagIds || [] })
  return error ? fail(error) : {}
}

/** Create one (the database numbers it and starts it open), then its tags. */
export async function createLead(ws, fields) {
  const { data, error } = await supabase.from('crm_leads').insert({ ...leadRow(fields), workspace_id: ws }).select(LEAD_COLS).single()
  if (error) return fail(error)
  if (fields.tag_ids?.length) {
    const t = await setTags(ws, data.id, fields.tag_ids)
    if (t.error) return { lead: data, error: t.error }
  }
  return { lead: data }
}

export async function updateLead(ws, id, fields) {
  const { data, error } = await supabase.from('crm_leads').update(leadRow(fields)).eq('workspace_id', ws).eq('id', id).select(LEAD_COLS).maybeSingle()
  if (error) return fail(error)
  if (!data) return { error: errorText('notAllowed') }
  const t = await setTags(ws, id, fields.tag_ids)
  return t.error ? { lead: data, error: t.error } : { lead: data }
}

/** One change: { stage_id } to move, { client_org_id } to link, { status: 'won' }, { status: 'lost', lost_reason_id, lost_note }, { status: 'open' } to reopen. */
export async function patchLead(ws, id, change) {
  const { data, error } = await supabase.from('crm_leads').update(change).eq('workspace_id', ws).eq('id', id).select(LEAD_COLS).maybeSingle()
  if (error) return fail(error)
  return data ? { lead: data } : { error: errorText('notAllowed') }
}

export async function deleteLead(ws, id) {
  const { data, error } = await supabase.from('crm_leads').delete().eq('workspace_id', ws).eq('id', id).select('id')
  if (error) return fail(error)
  return data?.length ? {} : { error: errorText('notAllowed') }
}

// ── Activities ──

/** The company's activities: not done ones only (`open`), or one opportunity's. */
export async function fetchActivities(ws, { leadId = '', open = false } = {}) {
  if (!ws) return { rows: [] }
  const { rows, error } = await readAll(() => {
    let q = supabase.from('crm_activities').select(ACTIVITY_COLS).eq('workspace_id', ws)
    if (leadId) q = q.eq('lead_id', leadId)
    if (open) q = q.is('done_at', null)
    return q.order('due_date').order('id')
  })
  return error ? { rows, ...fail(error) } : { rows }
}

export async function addActivity(ws, leadId, a) {
  const row = { workspace_id: ws, lead_id: leadId, activity_type: a.activity_type, summary: String(a.summary || '').trim(), due_date: a.due_date, assigned_to: a.assigned_to }
  const { error } = await supabase.from('crm_activities').insert(row)
  return error ? fail(error) : {}
}

/** Mark done, with an optional outcome; the database stamps who and when. */
export async function markActivityDone(ws, id, outcome) {
  const { data, error } = await supabase.from('crm_activities')
    .update({ done_at: new Date().toISOString(), outcome: String(outcome || '').trim() || null })
    .eq('workspace_id', ws).eq('id', id).select('id').maybeSingle()
  if (error) return fail(error)
  return data ? {} : { error: errorText('notAllowed') }
}

/** Delete a planned activity (a done one is history: refused). */
export async function deleteActivity(ws, id) {
  const { data, error } = await supabase.from('crm_activities').delete().eq('workspace_id', ws).eq('id', id).select('id')
  if (error) return fail(error)
  return data?.length ? {} : { error: errorText('notAllowed') }
}

// ── The history (managing only; RLS returns nothing to the rest) ──

export async function fetchHistory(ws, leadId, limit = 50) {
  const { data, error } = await supabase.from('crm_history')
    .select('id,lead_id,activity_id,action,label,changes,actor,at')
    .eq('workspace_id', ws).eq('lead_id', leadId).order('id', { ascending: false }).limit(limit)
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}
