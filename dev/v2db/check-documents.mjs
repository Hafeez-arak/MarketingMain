#!/usr/bin/env node
// ─── Check Documents on the running local stack, as real local logins ──────
// 2026-10-29, dev/erp-pilot/DOCUMENTS.md. supabase/documents.test.js proves
// every rule on an in-process Postgres; this asks the running local stack
// the main questions through the API (REST, RPC and Storage), as the app
// does, with real logins:
//
//   staff.admin@arak-sa.com      the access admin (every section, at manage)
//   staff.dev@arak-sa.com        given Documents at Work, then at Manage, for the check
//   staff.marketing@arak-sa.com  given Documents at View, and HR at Manage for one step
//   outside.two@example.com      not a member of Arak Lighting at all
//
// The grants it gives are taken away again, and so is everything it makes.
// A confirmed document can never be deleted through the API, by design, so
// the cleanup removes the check's rows with the database owner's own
// connection (docker exec, triggers off for that one transaction) and puts
// the DOC- counter back, so the real numbering has no gap. Local database
// only. Exits 1 on any failure.
//
//   node dev/v2db/check-documents.mjs

import { execFileSync } from 'node:child_process'
import { asUser } from './check-sections.mjs'

const URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const ARAK = '00000000-0000-0000-0000-000000000001'

async function signIn(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'arak-v2-local' }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`sign in ${email}: ${JSON.stringify(j).slice(0, 200)}`)
  return j.access_token
}
const uid = t => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub

const psql = sql => execFileSync('docker', ['exec', '-i', 'supabase_db_arak-v2', 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]).toString().trim()

let failed = 0
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++ }
const code = r => String(r.rows?.message || r.rows || '')

const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)
const plus = n => new Date(Date.parse(`${today()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// A tiny but real PDF; each upload is made different so no two share a checksum.
let uniq = 0
const pdf = () => Buffer.from(`%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\n% check ${Date.now()}-${++uniq}\ntrailer<</Root 1 0 R>>\n%%EOF\n`)
const sha = async buf => Buffer.from(await crypto.subtle.digest('SHA-256', buf)).toString('hex')

async function upload(token, path, buf, type = 'application/pdf') {
  const r = await fetch(`${URL}/storage/v1/object/company-documents/${path}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': type }, body: buf,
  })
  return { ok: r.ok, status: r.status }
}
async function sign(token, bucket, path) {
  const r = await fetch(`${URL}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.signedURL) return { ok: false, status: r.status }
  const f = await fetch(`${URL}/storage/v1${j.signedURL}`)
  return { ok: f.ok, status: f.status, bytes: f.ok ? Buffer.from(await f.arrayBuffer()) : null }
}

const admin = await signIn('staff.admin@arak-sa.com')
const worker = await signIn('staff.dev@arak-sa.com')
const viewer = await signIn('staff.marketing@arak-sa.com')
const stranger = await signIn('outside.two@example.com')
const WORKER = uid(worker), VIEWER = uid(viewer)

const typeId = async code => (await asUser(admin, `document_types?workspace_id=eq.${ARAK}&code=eq.${code}&select=id`)).rows[0].id
const grant = (user, section, level) => asUser(admin, 'section_access?on_conflict=workspace_id,user_id,section', {
  method: 'POST', prefer: 'resolution=merge-duplicates', body: { workspace_id: ARAK, user_id: user, section, level },
})
const revoke = (user, section) => asUser(admin, `section_access?workspace_id=eq.${ARAK}&user_id=eq.${user}&section=eq.${section}`, { method: 'DELETE' })

const made = []            // document ids the check created
const objects = []         // storage paths it uploaded
const counterBefore = Number(psql(`select coalesce((select last from document_counters where workspace_id = '${ARAK}' and year = extract(year from now() at time zone 'Asia/Riyadh')::int), 0)`))
const taskIds = []

/** A draft with one pending version and its file. */
async function draft(token, extra = {}, { file = true } = {}) {
  const row = { workspace_id: ARAK, type_id: await typeId('LEASE'), title: 'Check lease (test)', link_kind: 'company', ...extra }
  const d = await asUser(token, 'company_documents', { method: 'POST', prefer: 'return=representation', body: row })
  if (!d.ok) return { d }
  made.push(d.rows[0].id)
  const v = { workspace_id: ARAK, document_id: d.rows[0].id }
  if (file) {
    const buf = pdf()
    const path = `${ARAK}/${d.rows[0].id}/${crypto.randomUUID()}.pdf`
    const up = await upload(token, path, buf)
    if (!up.ok) return { d, up }
    objects.push(path)
    Object.assign(v, { file_bucket: 'company-documents', file_path: path, sha256: await sha(buf), file_name: 'check.pdf', file_size: buf.length, file_type: 'application/pdf' })
  }
  const ver = await asUser(token, 'company_document_versions', { method: 'POST', prefer: 'return=representation', body: v })
  return { d, ver, doc: d.rows[0], version: ver.rows?.[0], path: v.file_path }
}
const confirm = (token, doc, values = {}, fields = {}) => asUser(token, 'rpc/documents_review_save', {
  method: 'POST', body: { doc, doc_fields: { responsible_id: WORKER, ...fields }, ver_fields: { number: 'CHK-1', expiry_date: plus(400), sources: { number: 'manual' }, ...values }, confirm: true },
})

try {
  // ── Setup: the grants the check needs ──
  await grant(WORKER, 'documents', 'work')
  await grant(VIEWER, 'documents', 'view')

  // ── Company separation, and what the move left ──
  const all = (await asUser(admin, `company_documents?workspace_id=eq.${ARAK}&select=id,link_kind`)).rows
  check(all.filter(d => d.link_kind === 'employee').length >= 9, `the admin reads Arak's documents, including the employees' papers HR moved (${all.length})`)
  check((await asUser(admin, `document_types?workspace_id=eq.${ARAK}&select=id`)).rows.length >= 19, 'Arak has its suggested types')
  const ghusnTypes = (await asUser(admin, 'document_types?select=workspace_id')).rows.filter(t => t.workspace_id !== ARAK)
  check(ghusnTypes.length >= 19, 'and every other company has its own (a separate set)')
  check((await asUser(stranger, `company_documents?workspace_id=eq.${ARAK}&select=id`)).rows.length === 0, 'someone outside Arak reads none of its documents')
  check(!(await asUser(stranger, 'company_documents', { method: 'POST', body: { workspace_id: ARAK, type_id: await typeId('LEASE'), title: 'Intruder (test)', link_kind: 'company' } })).ok, 'and cannot add one')
  check((await asUser(stranger, 'rpc/documents_run_alerts_for', { method: 'POST', body: { ws: ARAK } })).rows?.message === 'DOCUMENT_NOT_ALLOWED', 'or run its alerts')

  // ── View ──
  check(!(await asUser(viewer, 'company_documents', { method: 'POST', body: { workspace_id: ARAK, type_id: await typeId('LEASE'), title: 'Viewer (test)', link_kind: 'company' } })).ok, 'View cannot add a document')
  check((await asUser(viewer, `company_documents?workspace_id=eq.${ARAK}&link_kind=eq.employee&select=id`)).rows.length === 0, 'View reads none of the employees\' papers')
  check(!(await asUser(viewer, `document_types?id=eq.${await typeId('LEASE')}`, { method: 'PATCH', prefer: 'return=representation', body: { name_en: 'Hacked' } })).rows?.length, 'and cannot change a type')

  // ── Work: upload, review, confirm ──
  const a = await draft(worker)
  check(a.d.ok && /^DOC-\d{4}-\d{6}$/.test(a.doc?.document_no) && a.version?.version_no === 1 && a.version?.status === 'pending' && a.version?.uploaded_by === WORKER,
    `Work uploads a document: ${a.doc?.document_no}, a draft, version 1 pending, the uploader recorded by the database`)
  check((await asUser(worker, `company_documents?id=eq.${a.doc.id}`, { method: 'PATCH', body: { number: 'X' } })).rows?.message === 'DOCUMENT_LOCKED', 'its data cannot be written directly')
  const cr = await draft(worker, { type_id: await typeId('CR'), title: 'Check register (test)' })
  const noNumber = await asUser(worker, 'rpc/documents_review_save', { method: 'POST', body: { doc: cr.doc.id, doc_fields: {}, ver_fields: { expiry_date: plus(400), sources: {} }, confirm: true } })
  check(code(noNumber) === 'DOCUMENT_FIELDS', 'a type that requires a number is not confirmed without it')
  const done = await confirm(worker, a.doc.id, { number: 'LS-100', issuer: 'Landlord (test)', issue_date: plus(-10), expiry_date: plus(20), sources: { number: 'manual', issuer: 'manual' } })
  const after = (await asUser(worker, `company_documents?id=eq.${a.doc.id}&select=number,issuer,expiry_date,confirmed_at`)).rows[0]
  check(done.ok && after.number === 'LS-100' && after.expiry_date === plus(20) && after.confirmed_at, 'confirming makes the version current and writes its data onto the document')
  const file1 = await sign(viewer, 'company-documents', a.path)
  check(file1.ok && file1.bytes.toString().startsWith('%PDF'), 'View opens an ordinary document\'s file (no log needed)')
  check((await asUser(admin, `document_access_log?document_id=eq.${a.doc.id}&select=id`)).rows.length === 0, 'and nothing is logged for it')
  check(!(await sign(stranger, 'company-documents', a.path)).ok, 'someone outside Arak cannot open the file')

  // ── Work: employees' papers and confidentiality need Manage ──
  const employee = (await asUser(admin, `hr_employees?workspace_id=eq.${ARAK}&status=eq.active&select=id&limit=1`)).rows[0].id
  const emp = await asUser(worker, 'company_documents', { method: 'POST', body: { workspace_id: ARAK, type_id: await typeId('IQAMA'), title: 'Iqama (test)', link_kind: 'employee', employee_id: employee } })
  check(!emp.ok, 'Work cannot add an employee\'s paper')
  const conf = await asUser(worker, 'company_documents', { method: 'POST', body: { workspace_id: ARAK, type_id: await typeId('LEASE'), title: 'Secret (test)', link_kind: 'company', confidential: true } })
  check(!conf.ok, 'or a confidential document')
  const asset = await asUser(admin, 'company_documents', { method: 'POST', body: { workspace_id: ARAK, type_id: await typeId('VEHICLE_REG'), title: 'Car (test)', link_kind: 'asset', asset_id: crypto.randomUUID() } })
  check(code(asset) === 'DOCUMENT_ASSET_WAITS', 'a fixed-asset link waits for its module')

  // ── Renewal: a new version supersedes, the old stays ──
  const r2 = await asUser(worker, 'company_document_versions', { method: 'POST', prefer: 'return=representation', body: { workspace_id: ARAK, document_id: a.doc.id, number: 'LS-100', issuer: 'Landlord (test)' } })
  check(r2.ok && r2.rows[0].version_no === 2 && r2.rows[0].status === 'pending', 'a renewal is version 2, pending')
  check(code(await asUser(worker, 'company_document_versions', { method: 'POST', body: { workspace_id: ARAK, document_id: a.doc.id } })) === 'DOCUMENT_VERSION_PENDING', 'a second pending one is refused')
  const c2 = await confirm(worker, a.doc.id, { number: 'LS-101', expiry_date: plus(500), sources: { number: 'manual' } })
  const vers = (await asUser(worker, `company_document_versions?document_id=eq.${a.doc.id}&select=version_no,status,number&order=version_no`)).rows
  check(c2.ok && vers.map(v => `${v.version_no}:${v.status}`).join() === '1:superseded,2:current', 'confirming it supersedes version 1, which stays')
  check(code(await asUser(worker, `company_document_versions?id=eq.${a.version.id}`, { method: 'PATCH', body: { number: 'changed' } })) === 'DOCUMENT_VERSION_FINAL', 'a superseded version is final')
  check(code(await asUser(worker, `company_documents?id=eq.${a.doc.id}`, { method: 'DELETE' })) === 'DOCUMENT_DELETE', 'a confirmed document is never deleted')

  // ── Alerts ──
  const al = await draft(worker, { title: 'Check alert (test)' }, { file: false })
  await confirm(worker, al.doc.id, { number: 'AL-1', expiry_date: plus(25) })
  const run1 = await asUser(worker, 'rpc/documents_run_alerts_for', { method: 'POST', body: { ws: ARAK } })
  const n1 = (await asUser(admin, `document_alerts?document_id=eq.${al.doc.id}&select=kind,days_before,status,task_id&order=kind,days_before`)).rows
  check(run1.ok && n1.filter(x => x.kind === 'notice').map(x => `${x.days_before}:${x.status}`).join() === '30:sent,90:covered' && n1.filter(x => x.kind === 'task').length === 1,
    `25 days left: one notice for 30 (90 covered by it) and one renewal task (${n1.map(x => `${x.kind}${x.days_before}`).join(' ')})`)
  taskIds.push(...n1.filter(x => x.task_id).map(x => x.task_id))
  await asUser(worker, 'rpc/documents_run_alerts_for', { method: 'POST', body: { ws: ARAK } })
  check((await asUser(admin, `document_alerts?document_id=eq.${al.doc.id}&select=id`)).rows.length === n1.length, 'running them again adds nothing')
  const note = (await asUser(worker, `notifications?kind=eq.document_expiring&link=like.*${al.doc.id}&select=title`)).rows
  check(note.length === 1, 'the person responsible has the notice in the bell')
  const task = (await asUser(worker, `tasks?id=eq.${taskIds[0]}&select=assigned_to,section,priority,status`)).rows[0]
  check(task?.assigned_to === WORKER && task.section === 'documents' && task.priority === 'high', 'and the renewal task, assigned to them')
  check(!(await asUser(worker, `document_alerts?document_id=eq.${al.doc.id}`, { method: 'DELETE' })).ok
    && (await asUser(admin, `document_alerts?document_id=eq.${al.doc.id}&select=id`)).rows.length === n1.length, 'the alerts cannot be deleted')

  // ── Archive ──
  check(code(await asUser(worker, `company_documents?id=eq.${al.doc.id}`, { method: 'PATCH', body: { archived_at: new Date().toISOString() } })) !== '', 'archiving without a reason is refused')
  const arch = await asUser(worker, `company_documents?id=eq.${al.doc.id}`, { method: 'PATCH', prefer: 'return=representation', body: { archived_at: new Date().toISOString(), archive_reason: 'Check (test)' } })
  check(arch.ok && arch.rows[0].archived_by === WORKER, 'Work archives it with a reason; the database records who')
  check(code(await asUser(worker, `company_documents?id=eq.${al.doc.id}`, { method: 'PATCH', body: { title: 'later' } })) === 'DOCUMENT_ARCHIVED', 'an archived document is frozen')

  // ── Manage: an employee's paper, the log, and the file behind it ──
  await grant(WORKER, 'documents', 'manage')
  const e = await draft(worker, { type_id: await typeId('IQAMA'), title: 'Iqama check (test)', link_kind: 'employee', employee_id: employee })
  check(e.d.ok, 'at Manage, the same person adds an employee\'s paper')
  await confirm(worker, e.doc.id, { number: 'EQ-1', expiry_date: plus(300) })
  check(!(await sign(worker, 'company-documents', e.path)).ok, 'its file will not open on a direct storage call (no log first)')
  const opened = await asUser(worker, 'rpc/documents_open_file', { method: 'POST', body: { version: e.version.id, download: false } })
  const row = Array.isArray(opened.rows) ? opened.rows[0] : opened.rows
  check(opened.ok && row?.path === e.path, 'documents_open_file logs the opening and names the file')
  check((await sign(worker, 'company-documents', e.path)).ok, 'now it opens')
  await asUser(worker, 'rpc/documents_open_file', { method: 'POST', body: { version: e.version.id, download: true } })
  const log = (await asUser(worker, `document_access_log?document_id=eq.${e.doc.id}&select=action,user_id,version_no&order=at`)).rows
  check(log.length === 2 && log.map(l => l.action).join() === 'view,download' && log.every(l => l.user_id === WORKER && l.version_no === 1), 'the log says who viewed and who downloaded, from the database\'s own clock and login')
  check(!(await asUser(viewer, `company_documents?id=eq.${e.doc.id}&select=id`)).rows.length, 'View does not see it at all')
  check(code(await asUser(viewer, 'rpc/documents_open_file', { method: 'POST', body: { version: e.version.id } })) === 'DOCUMENT_NOT_ALLOWED', 'nor open its file')
  const secret = await draft(worker, { title: 'Secret check (test)', confidential: true })
  await confirm(worker, secret.doc.id, { number: 'S-1' })
  check((await asUser(viewer, `company_documents?id=eq.${secret.doc.id}&select=id`)).rows.length === 0, 'a confidential document is hidden from View')

  // ── HR Manage reads employees' papers, and cannot change them ──
  await grant(VIEWER, 'hr', 'manage')
  const hrSees = (await asUser(viewer, `company_documents?id=eq.${e.doc.id}&select=id`)).rows.length === 1
  const hrNoSecret = (await asUser(viewer, `company_documents?id=eq.${secret.doc.id}&select=id`)).rows.length === 0
  check(hrSees && hrNoSecret, 'HR Manage reads an employee\'s paper (not a confidential document)')
  check(!(await asUser(viewer, `company_documents?id=eq.${e.doc.id}`, { method: 'PATCH', prefer: 'return=representation', body: { title: 'HR edit' } })).rows?.length, 'and cannot change it')
  const hrOpen = await asUser(viewer, 'rpc/documents_open_file', { method: 'POST', body: { version: e.version.id } })
  const hrLog = (await asUser(admin, `document_access_log?document_id=eq.${e.doc.id}&user_id=eq.${VIEWER}&select=action`)).rows
  check(hrOpen.ok && hrLog.length === 1, 'and opens its file, logged against HR\'s own login')

  // ── The old table, the search ──
  const hrOld = await asUser(admin, 'hr_documents', { method: 'POST', body: { workspace_id: ARAK, employee_id: employee, doc_type: 'passport' } })
  check(code(hrOld) === 'DOCUMENT_HR_MOVED', 'the old HR papers table takes nothing new')
  await revoke(VIEWER, 'hr')
  const found = (await asUser(viewer, 'rpc/shell_search_documents', { method: 'POST', body: { ws: ARAK, q: 'Check lease', lim: 5 } })).rows
  check(Array.isArray(found) && found.some(f => f.id === a.doc.id), 'the search finds an ordinary document for View')
  const hidden = (await asUser(viewer, 'rpc/shell_search_documents', { method: 'POST', body: { ws: ARAK, q: 'Iqama check', lim: 5 } })).rows
  check(Array.isArray(hidden) && hidden.length === 0, 'and not an employee\'s paper')
} finally {
  // Put everything back: the check's rows (with the triggers off for this one transaction),
  // its files, its tasks and notices, the numbering, and the grants.
  try {
    for (const p of objects) {
      await fetch(`${URL}/storage/v1/object/company-documents/${p}`, { method: 'DELETE', headers: { apikey: ANON, Authorization: `Bearer ${admin}` } })
    }
    if (made.length) {
      const ids = made.map(i => `'${i}'`).join(',')
      psql(`begin; set local session_replication_role = replica;
        delete from tasks where id in (select task_id from document_alerts where document_id in (${ids}) and task_id is not null);
        delete from notifications where link in (${made.map(i => `'/documents/document?id=${i}'`).join(',')});
        delete from document_access_log where document_id in (${ids});
        delete from document_alerts where document_id in (${ids});
        delete from document_history where document_id in (${ids});
        delete from company_document_versions where document_id in (${ids});
        delete from company_documents where id in (${ids});
        update document_counters set last = ${counterBefore} where workspace_id = '${ARAK}' and year = extract(year from now() at time zone 'Asia/Riyadh')::int;
        commit;`)
    }
  } finally {
    await revoke(WORKER, 'documents'); await revoke(VIEWER, 'documents'); await revoke(VIEWER, 'hr')
  }
  const left = psql(`select count(*) from company_documents where title like '%(test)' and title like 'Check%' or title like 'Iqama check%' or title like 'Secret check%'`)
  check(left === '0', 'cleanup: nothing of the check is left, the numbering is back where it was, the grants are taken away')
  const stillGranted = psql(`select count(*) from section_access where workspace_id = '${ARAK}' and section = 'documents' and user_id in ('${WORKER}', '${VIEWER}')`)
  check(stillGranted === '0', 'cleanup: staff.dev@ and staff.marketing@ have no Documents grant again')
}
console.log(failed ? `\n${failed} failed.` : '\nAll as intended.')
process.exitCode = failed ? 1 : 0
