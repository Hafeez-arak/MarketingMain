import { supabase } from '../supabaseClient'
import { getLang } from '../i18n'
import { errorKey, filePath, sha256Hex, FIELDS } from './logic'

// ─── Documents: the browser's reads and writes ─────────────────────────────
// 2026-10-29, dev/erp-pilot/DOCUMENTS.md. Straight to the database with the
// person's own login: RLS (the documents section, HR Manage for employees'
// papers) and the triggers in 20261201_documents_2_rules.sql decide what goes
// through. Every query names its company: RLS is membership, not isolation.

const BUCKET = 'company-documents'
const TYPE_COLS = 'id,workspace_id,code,name,name_en,link_kinds,number_required,issuer_required,issue_date_required,expiry_required,number_pattern,company_field,is_required,alert_days,task_days_before,confidential_default,is_active,sequence'
const DOC_COLS = 'id,workspace_id,document_no,type_id,title,link_kind,employee_id,supplier_id,asset_id,responsible_id,confidential,notes,number,issuer,issue_date,expiry_date,confirmed_at,archived_at,archived_by,archive_reason,legacy_hr_document_id,created_by,created_at,updated_at'
const VERSION_COLS = 'id,workspace_id,document_id,version_no,file_bucket,file_path,file_name,file_size,file_type,sha256,number,issuer,issue_date,expiry_date,suggestions,sources,page_count,status,uploaded_by,created_at,confirmed_by,confirmed_at,superseded_at'

// The API returns at most 1,000 rows a request; a company's documents are read whole.
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

// What the database's refusals mean, in both languages. Each DOCUMENT_ code is
// raised by 20261201_documents_2_rules.sql.
export const ERROR_WORDS = {
  en: {
    DOCUMENT_LOCKED: 'The number, issuer and dates change by confirming a version (a renewal). The type and link of a confirmed document never change.',
    DOCUMENT_ARCHIVED: 'This document is archived: it is not changed and gets no new version.',
    DOCUMENT_ARCHIVE_DRAFT: 'A draft is deleted, not archived.',
    DOCUMENT_ARCHIVE_REASON: 'Archiving needs a written reason.',
    DOCUMENT_DELETE: 'A confirmed document is never deleted. Archive it with a reason.',
    DOCUMENT_LINK: 'This type of document cannot be linked to that kind of record. Change it under Document types.',
    DOCUMENT_ASSET_WAITS: 'Fixed assets are not in this app yet, so a document cannot be linked to one.',
    DOCUMENT_SUPPLIER: 'That organisation is not a supplier in Contacts.',
    DOCUMENT_RESPONSIBLE: 'The person responsible must belong to this company and have Documents.',
    DOCUMENT_TYPE_INACTIVE: 'This document type is stopped. Switch it on under Document types, or choose another.',
    DOCUMENT_TYPE_LOCKED: 'The code of a suggested type never changes. You can rename it and change its settings.',
    DOCUMENT_TYPE_PATTERN: 'The number pattern is not a valid expression.',
    DOCUMENT_VERSION_FINAL: 'A confirmed version is final: it is never changed or deleted. Add a renewal instead.',
    DOCUMENT_VERSION_FILE: 'A version\'s file never changes; a new file is a new version.',
    DOCUMENT_VERSION_PENDING: 'This document has a version waiting to be confirmed. Confirm or cancel it first.',
    DOCUMENT_FILE_REPEATED: 'This same file is already a version of the document.',
    DOCUMENT_SOURCES: 'Each field comes from the file, the assistant or the user.',
    DOCUMENT_FIELDS: 'Fill in the fields this type of document requires, then confirm.',
    DOCUMENT_LOG_FINAL: 'The alerts and the access log are never changed.',
    DOCUMENT_HR_MOVED: 'Employees\' papers are kept in Documents now.',
    DOCUMENT_NO_FILE: 'This version has no file.',
    DOCUMENT_NO_PENDING: 'There is no version waiting to be confirmed.',
    DOCUMENT_NOT_ALLOWED: 'You do not have access to do that in Documents.',
    DOCUMENT_WORKSPACE_FIXED: 'A record cannot move to another company.',
    nameTaken: 'That name is already used in the list of types.',
    dates: 'The expiry date cannot be before the issue date.',
    employeeUsed: 'This person has documents, so they cannot be removed.',
    notAllowed: 'You do not have access to do that in Documents.',
    uploadFailed: 'The file could not be uploaded. Nothing was saved.',
    notFound: 'That document is not there any more, or you cannot see it.',
    failed: 'It did not work. Try again.',
  },
  ar: {
    DOCUMENT_LOCKED: 'الرقم والتواريخ والجهة المصدرة تتغير بتأكيد نسخة (تجديد). ونوع المستند المؤكَّد وجهته لا يتغيران.',
    DOCUMENT_ARCHIVED: 'هذا المستند مؤرشف: لا يُعدَّل ولا تُضاف له نسخة.',
    DOCUMENT_ARCHIVE_DRAFT: 'المسودة تُحذف ولا تُؤرشف.',
    DOCUMENT_ARCHIVE_REASON: 'الأرشفة تحتاج سببًا مكتوبًا.',
    DOCUMENT_DELETE: 'المستند المؤكَّد لا يُحذف أبدًا. أرشفه مع ذكر السبب.',
    DOCUMENT_LINK: 'لا يُربط هذا النوع من المستندات بهذه الجهة. غيّره من أنواع المستندات.',
    DOCUMENT_ASSET_WAITS: 'الأصول الثابتة ليست في التطبيق بعد، فلا يُربط بها مستند.',
    DOCUMENT_SUPPLIER: 'هذه الجهة ليست موردًا في جهات الاتصال.',
    DOCUMENT_RESPONSIBLE: 'المسؤول يجب أن يكون من هذه الشركة ولديه صلاحية المستندات.',
    DOCUMENT_TYPE_INACTIVE: 'نوع المستند موقوف. شغّله من أنواع المستندات أو اختر نوعًا آخر.',
    DOCUMENT_TYPE_LOCKED: 'رمز النوع المقترح لا يتغير. يمكنك تغيير اسمه وإعداداته.',
    DOCUMENT_TYPE_PATTERN: 'نمط الرقم ليس تعبيرًا صحيحًا.',
    DOCUMENT_VERSION_FINAL: 'النسخة المؤكَّدة نهائية: لا تُعدَّل ولا تُحذف. أضف تجديدًا بدلًا من ذلك.',
    DOCUMENT_VERSION_FILE: 'ملف النسخة لا يتغير؛ الملف الجديد نسخة جديدة.',
    DOCUMENT_VERSION_PENDING: 'للمستند نسخة بانتظار التأكيد. أكّدها أو ألغها أولًا.',
    DOCUMENT_FILE_REPEATED: 'هذا الملف نفسه نسخة سابقة من المستند.',
    DOCUMENT_SOURCES: 'مصدر كل خانة: الملف أو المساعد أو المستخدم.',
    DOCUMENT_FIELDS: 'عبّئ الخانات التي يطلبها هذا النوع من المستندات ثم أكّد.',
    DOCUMENT_LOG_FINAL: 'التنبيهات وسجل الاطلاع لا يُعدَّلان.',
    DOCUMENT_HR_MOVED: 'وثائق الموظفين تُحفظ الآن في المستندات.',
    DOCUMENT_NO_FILE: 'هذه النسخة بلا ملف.',
    DOCUMENT_NO_PENDING: 'لا توجد نسخة بانتظار التأكيد.',
    DOCUMENT_NOT_ALLOWED: 'ليست لديك صلاحية لهذا في المستندات.',
    DOCUMENT_WORKSPACE_FIXED: 'لا يمكن نقل سجل إلى شركة أخرى.',
    nameTaken: 'هذا الاسم مستخدم في قائمة الأنواع.',
    dates: 'تاريخ الانتهاء لا يسبق تاريخ الإصدار.',
    employeeUsed: 'لهذا الشخص مستندات، فلا يمكن حذفه.',
    notAllowed: 'ليست لديك صلاحية لهذا في المستندات.',
    uploadFailed: 'تعذّر رفع الملف. لم يُحفظ شيء.',
    notFound: 'هذا المستند لم يعد موجودًا، أو لا يمكنك رؤيته.',
    failed: 'لم ينجح ذلك. حاول مجددًا.',
  },
}

/** A refusal from the database (or a key) in the reader's language. */
export function errorText(err, lang = getLang()) {
  const W = ERROR_WORDS[lang] || ERROR_WORDS.en
  const msg = String(err?.message || err || '')
  if (W[msg]) return W[msg]
  const key = errorKey(err)
  if (key && W[key]) return W[key]
  return msg && !/^[A-Z_]+$/.test(msg) && !/violates|constraint|policy|syntax/.test(msg) ? msg : W.failed
}

const fail = error => ({ error: errorText(error) })

// ── Types ──

export async function fetchTypes(ws) {
  if (!ws) return { rows: [] }
  const { data, error } = await supabase.from('document_types').select(TYPE_COLS).eq('workspace_id', ws).order('sequence').order('name').limit(1000)
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}

/** Add (no id) or change a type. `fields.alert_days` is a list of days. */
export async function saveType(ws, id, fields) {
  const row = {
    name: String(fields.name || '').trim(), name_en: String(fields.name_en || '').trim() || null,
    link_kinds: fields.link_kinds, alert_days: fields.alert_days?.length ? fields.alert_days : null,
    task_days_before: fields.task_days_before === '' || fields.task_days_before == null ? null : Number(fields.task_days_before),
    number_pattern: String(fields.number_pattern || '').trim() || null, company_field: fields.company_field || null,
    number_required: Boolean(fields.number_required), issuer_required: Boolean(fields.issuer_required),
    issue_date_required: Boolean(fields.issue_date_required), expiry_required: Boolean(fields.expiry_required),
    is_required: Boolean(fields.is_required), confidential_default: Boolean(fields.confidential_default), is_active: Boolean(fields.is_active),
  }
  if (!id) row.sequence = Number(fields.nextSequence || 0)
  const q = id
    ? supabase.from('document_types').update(row).eq('workspace_id', ws).eq('id', id)
    : supabase.from('document_types').insert({ ...row, workspace_id: ws })
  const { data, error } = await q.select(TYPE_COLS).maybeSingle()
  if (error) return fail(error)
  return data ? { item: data } : { error: errorText('notAllowed') }
}

/** The suggested types the company removed or never had (none is overwritten). */
export async function suggestTypes(ws) {
  const { data, error } = await supabase.rpc('documents_suggest_types', { ws })
  return error ? fail(error) : { added: data || 0 }
}

// ── People, employees, suppliers ──

export async function fetchPeople(ws) {
  if (!ws) return { rows: [] }
  const { data, error } = await supabase.rpc('documents_people', { ws })
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}
export async function fetchEmployees(ws) {
  if (!ws) return { rows: [] }
  const { data, error } = await supabase.rpc('documents_employees', { ws })
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}
export async function fetchSuppliers(ws) {
  if (!ws) return { rows: [] }
  const { data, error } = await supabase.rpc('documents_suppliers', { ws })
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}

// ── Documents ──

/** The company's documents this person may read (RLS decides), or one employee's. */
export async function fetchDocuments(ws, { employeeId = '', kind = '' } = {}) {
  if (!ws) return { rows: [] }
  const { rows, error } = await readAll(() => {
    let q = supabase.from('company_documents').select(DOC_COLS).eq('workspace_id', ws)
    if (employeeId) q = q.eq('employee_id', employeeId)
    if (kind) q = q.eq('link_kind', kind)
    return q.order('created_at', { ascending: false }).order('id')
  })
  return error ? { rows, ...fail(error) } : { rows }
}

export async function fetchDocument(ws, id) {
  const { data, error } = await supabase.from('company_documents').select(DOC_COLS).eq('workspace_id', ws).eq('id', id).maybeSingle()
  return error ? fail(error) : { doc: data }
}

export async function fetchVersions(ws, documentId) {
  const { data, error } = await supabase.from('company_document_versions').select(VERSION_COLS).eq('workspace_id', ws).eq('document_id', documentId).order('version_no', { ascending: false })
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}

/** The ids of documents with a version waiting for confirmation. */
export async function fetchPendingIds(ws) {
  if (!ws) return { ids: new Set() }
  const { rows, error } = await readAll(() => supabase.from('company_document_versions').select('document_id').eq('workspace_id', ws).eq('status', 'pending').order('document_id'))
  return error ? { ids: new Set(), ...fail(error) } : { ids: new Set(rows.map(r => r.document_id)) }
}

export async function fetchAlerts(ws, documentId = '') {
  if (!ws) return { rows: [] }
  const { rows, error } = await readAll(() => {
    let q = supabase.from('document_alerts').select('id,document_id,expiry_date,kind,days_before,status,sent_to,task_id,sent_at').eq('workspace_id', ws)
    if (documentId) q = q.eq('document_id', documentId)
    return q.order('sent_at').order('id')
  })
  return error ? { rows, ...fail(error) } : { rows }
}

/** Renewal tasks by the task's own state, for the ones this person may see: { task_id: status }. */
export async function fetchTaskStates(ws, taskIds) {
  const ids = [...new Set((taskIds || []).filter(Boolean))]
  if (!ids.length) return { states: {} }
  const { data, error } = await supabase.from('tasks').select('id,status').eq('workspace_id', ws).in('id', ids.slice(0, 500))
  return error ? { states: {}, ...fail(error) } : { states: Object.fromEntries((data || []).map(t => [t.id, t.status])) }
}

export async function fetchAccessLog(ws, documentId) {
  const { data, error } = await supabase.from('document_access_log').select('id,version_no,action,user_id,at').eq('workspace_id', ws).eq('document_id', documentId).order('at', { ascending: false }).limit(100)
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}

export async function fetchHistory(ws, documentId) {
  const { data, error } = await supabase.from('document_history').select('id,table_name,action,label,changes,actor,at').eq('workspace_id', ws).eq('document_id', documentId).order('id', { ascending: false }).limit(200)
  return error ? { rows: [], ...fail(error) } : { rows: data || [] }
}

/** Run the company's alerts once (the database makes each one once only). Quiet on failure. */
export async function runAlerts(ws) {
  if (!ws) return
  await supabase.rpc('documents_run_alerts_for', { ws })
}

// ── Files ──

async function putFile(ws, documentId, file) {
  const path = filePath(ws, documentId, file)
  const buf = await file.arrayBuffer()
  const sha256 = await sha256Hex(buf)
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) return { error: errorText('uploadFailed') }
  return { path, sha256 }
}

async function dropFiles(paths) {
  const list = (paths || []).filter(Boolean)
  if (!list.length) return
  try { await supabase.storage.from(BUCKET).remove(list) } catch { /* the company folder is cleaned when the company is deleted */ }
}

/** A pending version: the file (if any) uploaded first, then the row; a failed row removes the file again. */
async function addVersion(ws, documentId, file, start = {}) {
  let put = null
  if (file) {
    put = await putFile(ws, documentId, file)
    if (put.error) return put
  }
  const row = {
    workspace_id: ws, document_id: documentId, number: start.number || null, issuer: start.issuer || null,
    ...(put ? { file_bucket: BUCKET, file_path: put.path, sha256: put.sha256, file_name: file.name.slice(0, 200), file_size: file.size, file_type: file.type } : {}),
  }
  const { data, error } = await supabase.from('company_document_versions').insert(row).select(VERSION_COLS).single()
  if (error) {
    if (put) await dropFiles([put.path])
    return fail(error)
  }
  return { version: data }
}

/**
 * Upload a document: a draft (the database numbers it) with its first
 * version, pending until reviewed. Without a file the data is typed by hand.
 */
export async function createDocument(ws, f) {
  const row = {
    workspace_id: ws, type_id: f.type_id, link_kind: f.link_kind, title: f.title,
    employee_id: f.link_kind === 'employee' ? f.employee_id : null,
    supplier_id: f.link_kind === 'supplier' ? f.supplier_id : null,
    confidential: Boolean(f.confidential), responsible_id: f.responsible_id || null,
  }
  const { data: doc, error } = await supabase.from('company_documents').insert(row).select(DOC_COLS).single()
  if (error) return fail(error)
  const v = await addVersion(ws, doc.id, f.file)
  if (v.error) {
    // The draft goes with it: nothing half made is left behind.
    await supabase.from('company_documents').delete().eq('workspace_id', ws).eq('id', doc.id)
    return v
  }
  return { doc, version: v.version }
}

/** A renewal: the new file (or none) as the pending version, starting from the current number and issuer. */
export async function renewDocument(ws, doc, file) {
  return addVersion(ws, doc.id, file, { number: doc.number, issuer: doc.issuer })
}

/**
 * Save the review form: as a draft, or confirmed (one transaction in the
 * database). `fields` = { title, responsible_id, notes, confidential, [type_id,
 * link_kind, employee_id, supplier_id for a draft] }, `values` = { number,
 * issuer, issue_date, expiry_date }, `sources` = where each came from.
 */
export async function saveReview(ws, documentId, fields, values, sources, confirm) {
  const ver = {}
  for (const k of FIELDS) ver[k] = values[k] ?? null
  ver.sources = sources
  const { error } = await supabase.rpc('documents_review_save', { doc: documentId, doc_fields: fields, ver_fields: ver, confirm: Boolean(confirm) })
  return error ? fail(error) : {}
}

/** The management details of a confirmed document. */
export async function saveDetails(ws, id, fields) {
  const { data, error } = await supabase.from('company_documents').update({
    title: String(fields.title || '').trim(), responsible_id: fields.responsible_id || null,
    confidential: Boolean(fields.confidential), notes: String(fields.notes || '').trim() || null,
  }).eq('workspace_id', ws).eq('id', id).select('id').maybeSingle()
  if (error) return fail(error)
  return data ? {} : { error: errorText('notAllowed') }
}

/** Drop a draft (with its version) or a renewal started by mistake. */
export async function discardPending(ws, doc, version) {
  const files = version?.file_bucket === BUCKET ? [version.file_path] : []
  const q = doc.confirmed_at
    ? supabase.from('company_document_versions').delete().eq('workspace_id', ws).eq('id', version.id)
    : supabase.from('company_documents').delete().eq('workspace_id', ws).eq('id', doc.id)
  const { error } = await q.select('id')
  if (error) return fail(error)
  await dropFiles(files)
  return {}
}

/** Archive with a reason (a renewal waiting is dropped first). */
export async function archiveDocument(ws, doc, pending, reason) {
  if (pending) {
    const d = await discardPending(ws, doc, pending)
    if (d.error) return d
  }
  const { error } = await supabase.from('company_documents').update({ archived_at: new Date().toISOString(), archive_reason: String(reason || '').trim() }).eq('workspace_id', ws).eq('id', doc.id)
  return error ? fail(error) : {}
}

/** A short-lived link to a version's file; opening a restricted document is logged by the database first. */
export async function fileUrl(versionId, { download = false } = {}) {
  const { data, error } = await supabase.rpc('documents_open_file', { version: versionId, download })
  if (error) return fail(error)
  const f = Array.isArray(data) ? data[0] : data
  if (!f?.path) return { error: errorText('DOCUMENT_NO_FILE') }
  const r = await supabase.storage.from(f.bucket).createSignedUrl(f.path, 120, download ? { download: f.name } : undefined)
  return r.error ? fail(r.error) : { url: r.data.signedUrl }
}
