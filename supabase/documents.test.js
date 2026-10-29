import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { describe, it, expect, beforeAll } from 'vitest'

// ─── Documents: the database's rules, as each kind of person ───────────────
// 2026-10-29, dev/erp-pilot/DOCUMENTS.md. Runs the Contacts, the shell and
// the four Documents migrations on an in-process Postgres and acts as
// different people (SET ROLE authenticated + a test uid, so RLS applies as it
// does through the API):
//
//   · company separation: nobody reads or writes another company's rows, and
//     no document can point at another company's type, employee or supplier;
//   · the levels: view reads the ordinary ones, work does the day-to-day and
//     the types, manage also holds confidential and employees' papers; HR
//     Manage reads employees' papers; a person reads their own;
//   · Musa's rules: draft → confirmed, archive not delete, versions append-
//     only, a renewal supersedes, required fields, gap-free numbering, the
//     access log before a restricted file opens, alerts once per threshold;
//   · the HR move: the old table takes nothing new.
//
// HR's and the storage schema's tables are stood in for below (the real ones
// come from the baseline); Contacts' real migrations are loaded.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migration = name => fs.readFileSync(path.join(ROOT, 'supabase/migrations', `${name}.sql`), 'utf8')

const PRELUDE = `
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.workspaces (id uuid primary key, name text not null);
create table public.workspace_members (workspace_id uuid references public.workspaces(id) on delete cascade, user_id uuid, primary key (workspace_id, user_id));
create table public.user_access (user_id uuid primary key, role text not null, status text not null default 'approved', full_name text, email text);
create table public.section_access (workspace_id uuid, user_id uuid, section text, level text, primary key (workspace_id, user_id, section));
create table public.meetings (id uuid primary key default gen_random_uuid(), section text);
create table public.tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid references public.workspaces(id) on delete cascade,
  title text, details text, assigned_to uuid, created_by uuid, due_at timestamptz, priority text, status text default 'todo', section text);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid, workspace_id uuid, kind text, title text, body text, link text,
  created_at timestamptz default now(), read_at timestamptz);

create function public.is_workspace_member(ws_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members wm where wm.workspace_id = ws_id and wm.user_id = auth.uid())
$$;
create function public.is_access_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_access ua where ua.user_id = auth.uid() and ua.role = 'admin' and ua.status = 'approved')
$$;
create function public.section_rank(l text) returns integer language sql immutable as $$
  select case l when 'view' then 1 when 'work' then 2 when 'manage' then 3 else 0 end
$$;
create function public.has_section(ws uuid, sec text, min_level text default 'view') returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_workspace_member(ws) and (
    public.is_access_admin()
    or exists (select 1 from public.section_access a where a.workspace_id = ws and a.user_id = auth.uid()
               and a.section = sec and public.section_rank(a.level) >= public.section_rank(min_level)))
$$;
grant execute on function public.has_section(uuid, text, text) to authenticated;

-- HR, as far as Documents touches it.
create table public.hr_employees (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid, name_en text not null, name_ar text, employee_no text, job_title text, work_email text, work_phone text, status text default 'active',
  constraint hr_employees_ws_id unique (workspace_id, id));
create table public.hr_documents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null, doc_type text not null, doc_number text not null default '', issue_date date, expiry_date date,
  notes text not null default '', created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  file_path text, file_name text, file_size integer, file_type text,
  constraint hr_documents_employee_fk foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id) on delete cascade);
create function public.hr_my_employee(ws uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from public.hr_employees where workspace_id = ws and user_id = auth.uid() and auth.uid() is not null
$$;

-- Storage, as far as Documents touches it.
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
`

const ARAK = '00000000-0000-0000-0000-000000000001'
const GHUSN = '00000000-0000-0000-0000-000000000002'
const U = {
  admin: '00000000-0000-0000-0000-0000000000a1',
  viewer: '00000000-0000-0000-0000-0000000000b1',
  worker: '00000000-0000-0000-0000-0000000000b2',
  manager: '00000000-0000-0000-0000-0000000000b3',
  outsider: '00000000-0000-0000-0000-0000000000b4', // an Arak member with no grant
  hrman: '00000000-0000-0000-0000-0000000000b5', // HR Manage, no Documents
  self: '00000000-0000-0000-0000-0000000000b6', // HR View, the login of employee e1
  ghusn: '00000000-0000-0000-0000-0000000000c1', // manages Documents in Ghusn only
}

let pg
const ids = {}

async function as(who, sql, params = []) {
  await pg.query(`select set_config('test.uid', $1, false)`, [U[who] || ''])
  await pg.exec('set role authenticated')
  try {
    return await pg.query(sql, params)
  } finally {
    await pg.exec('reset role')
  }
}

/** The DOCUMENT_… code (or the Postgres message) a refused statement gives; null when it went through. */
async function refusal(who, sql, params = []) {
  try {
    await as(who, sql, params)
    return null
  } catch (err) {
    return err.message
  }
}

const one = async (who, sql, params = []) => (await as(who, sql, params)).rows[0]
const sup = async (sql, params = []) => (await pg.query(sql, params)).rows
const typeId = async (ws, code) => (await sup('select id from public.document_types where workspace_id = $1 and code = $2', [ws, code]))[0].id

let n = 0
const sha = () => String(++n).padStart(64, '0')

async function addDoc(who, extra = {}) {
  const f = { ws: ARAK, type: ids.tLease, title: 'Head office lease (test)', kind: 'company', emp: null, sup: null, resp: null, conf: false, ...extra }
  return one(who, `insert into public.company_documents (workspace_id, type_id, title, link_kind, employee_id, supplier_id, responsible_id, confidential)
                   values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, document_no, link_kind`,
  [f.ws, f.type, f.title, f.kind, f.emp, f.sup, f.resp, f.conf])
}

async function addVersion(who, doc, ws = ARAK, extra = {}) {
  const f = { number: null, issuer: null, issue: null, expiry: null, sha: sha(), file: true, ...extra }
  const path = f.file ? `${ws}/${doc}/${f.sha.slice(-6)}.pdf` : null
  return one(who, `insert into public.company_document_versions
                     (workspace_id, document_id, file_bucket, file_path, file_name, file_type, file_size, sha256, number, issuer, issue_date, expiry_date, sources)
                   values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id, version_no, status`,
  [ws, doc, f.file ? 'company-documents' : null, path, f.file ? 'scan.pdf' : null, f.file ? 'application/pdf' : null, f.file ? 1000 : null,
    f.file ? f.sha : null, f.number, f.issuer, f.issue, f.expiry, JSON.stringify(f.sources || {})])
}

const confirm = (who, version) => one(who, `update public.company_document_versions set status = 'current' where id = $1 returning id`, [version])

/** A draft, one version, confirmed. */
async function confirmed(who, extra = {}, vextra = {}) {
  const d = await addDoc(who, extra)
  const v = await addVersion(who, d.id, extra.ws || ARAK, { expiry: '2030-01-01', ...vextra })
  await confirm(who, v.id)
  return { ...d, version: v.id }
}

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(PRELUDE)
  await pg.exec(`
    insert into public.workspaces values ('${ARAK}', 'Arak'), ('${GHUSN}', 'Ghusn');
    insert into auth.users (id) select unnest(array['${Object.values(U).join("','")}']::uuid[]);
    insert into public.user_access (user_id, role, full_name, email) values
      ('${U.admin}', 'admin', 'Omar', 'staff.admin@arak-sa.com'), ('${U.viewer}', 'member', 'Sara', 'staff.marketing@arak-sa.com'),
      ('${U.worker}', 'member', 'Faisal', 'staff.sales@arak-sa.com'), ('${U.manager}', 'member', 'Nasser', 'staff.ceo@arak-sa.com'),
      ('${U.outsider}', 'member', 'Tariq', 'staff.dev@arak-sa.com'), ('${U.hrman}', 'member', 'Hala (test)', 'hr.test@example.com'),
      ('${U.self}', 'member', 'Laila (test)', 'self.test@example.com'), ('${U.ghusn}', 'member', 'Ghusn (test)', 'outside.two@example.com');
    insert into public.workspace_members values ('${ARAK}', '${U.admin}'), ('${GHUSN}', '${U.admin}'), ('${ARAK}', '${U.viewer}'),
      ('${ARAK}', '${U.worker}'), ('${ARAK}', '${U.manager}'), ('${ARAK}', '${U.outsider}'), ('${ARAK}', '${U.hrman}'),
      ('${ARAK}', '${U.self}'), ('${GHUSN}', '${U.ghusn}');
    insert into public.section_access values ('${ARAK}', '${U.viewer}', 'documents', 'view'), ('${ARAK}', '${U.worker}', 'documents', 'work'),
      ('${ARAK}', '${U.manager}', 'documents', 'manage'), ('${ARAK}', '${U.hrman}', 'hr', 'manage'), ('${ARAK}', '${U.self}', 'hr', 'view'),
      ('${GHUSN}', '${U.ghusn}', 'documents', 'manage');
  `)
  const files = ['20261120_contacts_1_tables', '20261120_contacts_2_rules', '20261120_contacts_3_musa_parity',
    '20261201_documents_1_tables', '20261201_documents_2_rules', '20261201_documents_3_hr_move']
  for (const f of files) await pg.exec(migration(f))
  // Every file is safe to re-run.
  for (const f of files) await pg.exec(migration(f))
  // The search migration needs the shell's helpers (the module functions name tables not built here).
  await pg.exec(migration('20261127_shell_1_pins'))
  await pg.exec('set check_function_bodies = off')
  await pg.exec(migration('20261127_shell_2_search'))
  await pg.exec('set check_function_bodies = on')
  await pg.exec(migration('20261201_documents_4_search'))

  await pg.exec(`
    insert into public.hr_employees (id, workspace_id, user_id, name_en, employee_no) values
      ('00000000-0000-0000-0000-00000000e001', '${ARAK}', '${U.self}', 'Laila Sample (test)', 'E-1'),
      ('00000000-0000-0000-0000-00000000e002', '${ARAK}', null, 'Khaled Sample (test)', 'E-2'),
      ('00000000-0000-0000-0000-00000000e003', '${GHUSN}', null, 'Ghusn Person (test)', 'E-3');
    insert into public.contacts_orgs (id, workspace_id, name, roles) values
      ('00000000-0000-0000-0000-00000000f001', '${ARAK}', 'Supplier One (test)', array['supplier']),
      ('00000000-0000-0000-0000-00000000f002', '${ARAK}', 'Client Only (test)', array['client']),
      ('00000000-0000-0000-0000-00000000f003', '${GHUSN}', 'Ghusn Supplier (test)', array['supplier']);
  `)
  ids.e1 = '00000000-0000-0000-0000-00000000e001'
  ids.e2 = '00000000-0000-0000-0000-00000000e002'
  ids.eG = '00000000-0000-0000-0000-00000000e003'
  ids.sup = '00000000-0000-0000-0000-00000000f001'
  ids.notSup = '00000000-0000-0000-0000-00000000f002'
  ids.supG = '00000000-0000-0000-0000-00000000f003'
  for (const c of ['LEASE', 'CR', 'IQAMA', 'AGENCY', 'INSURANCE', 'VEHICLE_REG', 'ZAKAT_CERT']) ids['t' + c[0] + c.slice(1).toLowerCase()] = await typeId(ARAK, c)
  ids.tGhusnLease = await typeId(GHUSN, 'LEASE')
}, 60_000)

describe('the suggested types', () => {
  it('every company has its own set, with alerts at 90, 30 and 7 and a task at 30', async () => {
    for (const ws of [ARAK, GHUSN]) {
      const r = (await sup('select count(*)::int as n from public.document_types where workspace_id = $1', [ws]))[0]
      expect(r.n).toBe(19)
    }
    const t = (await sup('select alert_days, task_days_before, link_kinds from public.document_types where id = $1', [ids.tCr]))[0]
    expect(t.alert_days).toEqual([90, 30, 7])
    expect(t.task_days_before).toBe(30)
  })
  it('a new company gets them at once', async () => {
    await sup(`insert into public.workspaces values ('00000000-0000-0000-0000-000000000009', 'New (test)')`)
    expect((await sup(`select count(*)::int as n from public.document_types where workspace_id = '00000000-0000-0000-0000-000000000009'`))[0].n).toBe(19)
    await sup(`delete from public.workspaces where id = '00000000-0000-0000-0000-000000000009'`)
  })
  it('"suggest" brings back a removed one and changes nothing the company edited', async () => {
    await sup(`update public.document_types set name = 'سجلنا', alert_days = '{60}' where id = $1`, [ids.tCr])
    await sup('delete from public.document_types where id = $1', [ids.tZakat_cert])
    expect(await one('worker', `select public.documents_suggest_types($1) as n`, [ARAK])).toEqual({ n: 1 })
    const cr = (await sup('select name, alert_days from public.document_types where id = $1', [ids.tCr]))[0]
    expect(cr).toEqual({ name: 'سجلنا', alert_days: [60] })
    ids.tZakat_cert = await typeId(ARAK, 'ZAKAT_CERT')
    await sup(`update public.document_types set name = 'السجل التجاري', alert_days = '{90,30,7}' where id = $1`, [ids.tCr])
    expect(await refusal('viewer', `select public.documents_suggest_types($1)`, [ARAK])).toMatch(/DOCUMENT_NOT_ALLOWED/)
  })
  it('the code never changes; a bad pattern and a duplicate name are refused; alert days are kept largest first', async () => {
    expect(await refusal('worker', `update public.document_types set code = 'X_CODE' where id = $1`, [ids.tCr])).toMatch(/DOCUMENT_TYPE_LOCKED/)
    expect(await refusal('worker', `update public.document_types set number_pattern = '([' where id = $1`, [ids.tCr])).toMatch(/DOCUMENT_TYPE_PATTERN/)
    expect(await refusal('worker', `insert into public.document_types (workspace_id, name) values ($1, 'عقد إيجار')`, [ARAK])).toMatch(/duplicate key/)
    const t = await one('worker', `insert into public.document_types (workspace_id, name, name_en, alert_days) values ($1, 'رخصة خاصة (تجربة)', 'Own licence (test)', '{7,90,30,30}') returning alert_days, code`, [ARAK])
    expect(t).toEqual({ alert_days: [90, 30, 7], code: null })
  })
})

describe('company separation', () => {
  it('nobody reads or writes another company\'s rows', async () => {
    const d = await addDoc('manager')
    expect((await as('ghusn', 'select id from public.company_documents')).rows).toHaveLength(0)
    expect((await as('ghusn', 'select id from public.document_types where workspace_id = $1', [ARAK])).rows).toHaveLength(0)
    expect(await refusal('ghusn', `insert into public.company_documents (workspace_id, type_id, title, link_kind) values ($1, $2, 'x', 'company')`, [ARAK, ids.tLease])).toMatch(/row-level security/)
    expect(await refusal('ghusn', `update public.company_documents set title = 'taken' where id = $1`, [d.id])).toBeNull() // zero rows
    expect((await sup('select title from public.company_documents where id = $1', [d.id]))[0].title).not.toBe('taken')
    // And the admin of both sees each company's own when asked by company.
    expect((await as('admin', 'select id from public.company_documents where workspace_id = $1', [GHUSN])).rows).toHaveLength(0)
  })
  it('no document can name another company\'s type, employee or supplier', async () => {
    expect(await refusal('manager', `insert into public.company_documents (workspace_id, type_id, title, link_kind) values ($1, $2, 'x', 'company')`, [ARAK, ids.tGhusnLease])).toMatch(/company_documents_type_fk/)
    expect(await refusal('manager', `insert into public.company_documents (workspace_id, type_id, title, link_kind, employee_id) values ($1, $2, 'x', 'employee', $3)`, [ARAK, ids.tIqama, ids.eG])).toMatch(/company_documents_employee_fk/)
    expect(await refusal('manager', `insert into public.company_documents (workspace_id, type_id, title, link_kind, supplier_id) values ($1, $2, 'x', 'supplier', $3)`, [ARAK, ids.tAgency, ids.supG])).toMatch(/DOCUMENT_SUPPLIER|company_documents_supplier_fk/)
  })
  it('a row never moves company', async () => {
    const d = await addDoc('manager')
    expect(await refusal('admin', `update public.company_documents set workspace_id = $1 where id = $2`, [GHUSN, d.id])).toBeTruthy()
  })
  it('the people pickers are the company\'s own', async () => {
    const people = (await as('worker', 'select name from public.documents_people($1)', [ARAK])).rows.map(r => r.name)
    expect(people).toEqual(expect.arrayContaining(['Faisal', 'Nasser', 'Omar']))
    expect(people).not.toContain('Ghusn (test)')
    expect((await as('ghusn', 'select name from public.documents_people($1)', [ARAK])).rows).toHaveLength(0)
  })
})

describe('the levels', () => {
  it('view reads ordinary documents and cannot write', async () => {
    const d = await addDoc('worker')
    expect((await as('viewer', 'select id from public.company_documents where id = $1', [d.id])).rows).toHaveLength(1)
    expect(await refusal('viewer', `insert into public.company_documents (workspace_id, type_id, title, link_kind) values ($1, $2, 'x', 'company')`, [ARAK, ids.tLease])).toMatch(/row-level security/)
    expect((await as('viewer', 'select id from public.document_types where workspace_id = $1', [ARAK])).rows.length).toBeGreaterThan(10)
    expect(await refusal('viewer', `update public.document_types set name_en = 'x' where id = $1`, [ids.tLease])).toBeNull()
    expect((await sup('select name_en from public.document_types where id = $1', [ids.tLease]))[0].name_en).not.toBe('x')
  })
  it('a member with no grant sees nothing', async () => {
    expect((await as('outsider', 'select id from public.company_documents')).rows).toHaveLength(0)
    expect((await as('outsider', 'select id from public.document_types')).rows).toHaveLength(0)
    expect(await refusal('outsider', `insert into public.company_documents (workspace_id, type_id, title, link_kind) values ($1, $2, 'x', 'company')`, [ARAK, ids.tLease])).toMatch(/row-level security/)
  })
  it('work does the day-to-day, but confidential and employees\' papers need manage', async () => {
    expect((await addDoc('worker')).document_no).toMatch(/^DOC-\d{4}-\d{6}$/)
    expect(await refusal('worker', `insert into public.company_documents (workspace_id, type_id, title, link_kind, employee_id) values ($1, $2, 'x', 'employee', $3)`, [ARAK, ids.tIqama, ids.e1])).toMatch(/row-level security/)
    expect(await refusal('worker', `insert into public.company_documents (workspace_id, type_id, title, link_kind, confidential) values ($1, $2, 'x', 'company', true)`, [ARAK, ids.tLease])).toMatch(/row-level security/)
    const d = await addDoc('worker')
    expect(await refusal('worker', `update public.company_documents set confidential = true where id = $1`, [d.id])).toMatch(/row-level security/)
    const m = await addDoc('manager', { conf: true })
    expect((await as('worker', 'select id from public.company_documents where id = $1', [m.id])).rows).toHaveLength(0)
    expect((await as('viewer', 'select id from public.company_documents where id = $1', [m.id])).rows).toHaveLength(0)
    expect((await as('manager', 'select id from public.company_documents where id = $1', [m.id])).rows).toHaveLength(1)
    // Work cannot reach a confidential document's versions either.
    const v = await addVersion('manager', m.id)
    expect((await as('worker', 'select id from public.company_document_versions where id = $1', [v.id])).rows).toHaveLength(0)
    expect(await refusal('worker', `update public.company_document_versions set number = 'x' where id = $1`, [v.id])).toBeNull()
  })
  it('an employee\'s paper: manage and HR Manage read it (HR cannot write), the person reads their own, a colleague does not', async () => {
    const d = await addDoc('manager', { type: ids.tIqama, kind: 'employee', emp: ids.e1, title: 'Iqama — Laila (test)' })
    const other = await addDoc('manager', { type: ids.tIqama, kind: 'employee', emp: ids.e2, title: 'Iqama — Khaled (test)' })
    for (const who of ['manager', 'hrman', 'self', 'admin']) expect((await as(who, 'select id from public.company_documents where id = $1', [d.id])).rows).toHaveLength(1)
    for (const who of ['viewer', 'worker', 'outsider']) expect((await as(who, 'select id from public.company_documents where id = $1', [d.id])).rows).toHaveLength(0)
    expect((await as('self', 'select id from public.company_documents where id = $1', [other.id])).rows).toHaveLength(0)
    expect(await refusal('hrman', `update public.company_documents set title = 'x' where id = $1`, [d.id])).toBeNull()
    expect((await sup('select title from public.company_documents where id = $1', [d.id]))[0].title).toBe('Iqama — Laila (test)')
    expect(await refusal('hrman', `insert into public.company_documents (workspace_id, type_id, title, link_kind, employee_id) values ($1, $2, 'x', 'employee', $3)`, [ARAK, ids.tIqama, ids.e2])).toMatch(/row-level security/)
    // A confidential employee paper is for manage only, even HR and the person.
    const c = await addDoc('manager', { type: ids.tIqama, kind: 'employee', emp: ids.e1, conf: true })
    for (const who of ['hrman', 'self']) expect((await as(who, 'select id from public.company_documents where id = $1', [c.id])).rows).toHaveLength(0)
  })
  it('the history and the access log are for managers; alerts follow the document', async () => {
    expect((await as('manager', 'select id from public.document_history')).rows.length).toBeGreaterThan(0)
    expect((await as('worker', 'select id from public.document_history')).rows).toHaveLength(0)
    expect((await as('worker', 'select id from public.document_access_log')).rows).toHaveLength(0)
    expect(await refusal('manager', `insert into public.document_access_log (workspace_id, document_id, action) values ($1, gen_random_uuid(), 'view')`, [ARAK])).toBeTruthy()
    expect(await refusal('manager', `insert into public.document_history (workspace_id, table_name, row_id, action) values ($1, 'document_types', gen_random_uuid(), 'insert')`, [ARAK])).toBeTruthy()
  })
})

describe('numbering', () => {
  it('is DOC-year-000001, per company, gap-free, and a refused insert gives its number back', async () => {
    const before = (await sup(`select last from public.document_counters where workspace_id = $1`, [ARAK]))[0].last
    expect(await refusal('worker', `insert into public.company_documents (workspace_id, type_id, title, link_kind) values ($1, $2, '   ', 'company')`, [ARAK, ids.tLease])).toBeTruthy()
    const a = await addDoc('worker')
    const b = await addDoc('worker')
    const num = d => Number(d.document_no.split('-')[2])
    expect(num(a)).toBe(before + 1)
    expect(num(b)).toBe(before + 2)
    const g = await addDoc('ghusn', { ws: GHUSN, type: ids.tGhusnLease })
    expect(g.document_no).toMatch(/-000001$/)
    expect(await refusal('admin', `update public.company_documents set document_no = 'DOC-1' where id = $1`, [a.id])).toBeNull()
    expect((await sup('select document_no from public.company_documents where id = $1', [a.id]))[0].document_no).toBe(a.document_no)
  })
})

describe('draft → confirmed → archived', () => {
  it('a draft carries no number or dates, and its data cannot be written directly', async () => {
    expect(await refusal('worker', `insert into public.company_documents (workspace_id, type_id, title, link_kind, number) values ($1, $2, 'x', 'company', 'N1')`, [ARAK, ids.tLease])).toMatch(/DOCUMENT_LOCKED/)
    const d = await addDoc('worker')
    for (const set of ["number = 'N1'", "issuer = 'I'", "issue_date = '2026-01-01'", "expiry_date = '2027-01-01'", 'confirmed_at = now()']) {
      const r = await refusal('worker', `update public.company_documents set ${set} where id = $1`, [d.id])
      expect(r, set).toMatch(/DOCUMENT_LOCKED/)
    }
    expect(await refusal('worker', `update public.company_documents set created_by = null where id = $1`, [d.id])).toMatch(/DOCUMENT_LOCKED/)
  })
  it('the version\'s confirmation writes the document\'s number, issuer, dates and time', async () => {
    const d = await addDoc('worker')
    const v = await addVersion('worker', d.id, ARAK, { number: 'L-77', issuer: 'Landlord (test)', issue: '2026-01-01', expiry: '2027-01-01', sources: { number: 'manual' } })
    expect(v).toMatchObject({ version_no: 1, status: 'pending' })
    expect((await sup('select number, confirmed_at from public.company_documents where id = $1', [d.id]))[0]).toEqual({ number: null, confirmed_at: null })
    await confirm('worker', v.id)
    const row = (await sup('select number, issuer, issue_date::text as i, expiry_date::text as e, confirmed_at is not null as c from public.company_documents where id = $1', [d.id]))[0]
    expect(row).toEqual({ number: 'L-77', issuer: 'Landlord (test)', i: '2026-01-01', e: '2027-01-01', c: true })
    const ver = (await sup('select status, confirmed_by, confirmed_at is not null as c from public.company_document_versions where id = $1', [v.id]))[0]
    expect(ver).toEqual({ status: 'current', confirmed_by: U.worker, c: true })
  })
  it('only a draft is deleted; a confirmed document is archived with a written reason, then it is frozen', async () => {
    const draft = await addDoc('worker')
    await addVersion('worker', draft.id)
    expect(await refusal('worker', `delete from public.company_documents where id = $1`, [draft.id])).toBeNull()
    expect((await sup('select count(*)::int as n from public.company_documents where id = $1', [draft.id]))[0].n).toBe(0)
    expect((await sup('select count(*)::int as n from public.company_document_versions where document_id = $1', [draft.id]))[0].n).toBe(0)

    const c = await confirmed('worker')
    expect(await refusal('worker', `delete from public.company_documents where id = $1`, [c.id])).toMatch(/DOCUMENT_DELETE/)
    expect(await refusal('worker', `update public.company_documents set archived_at = now() where id = $1`, [c.id])).toMatch(/DOCUMENT_ARCHIVE_REASON|company_documents_archived/)
    expect(await refusal('worker', `update public.company_documents set archived_at = now(), archive_reason = '  ' where id = $1`, [c.id])).toMatch(/DOCUMENT_ARCHIVE_REASON|company_documents_archived/)
    const dr = await addDoc('worker')
    expect(await refusal('worker', `update public.company_documents set archived_at = now(), archive_reason = 'x' where id = $1`, [dr.id])).toMatch(/DOCUMENT_ARCHIVE_DRAFT|company_documents_archived/)
    expect(await refusal('worker', `update public.company_documents set archived_at = now(), archive_reason = 'Replaced by a new lease (test)' where id = $1`, [c.id])).toBeNull()
    const a = (await sup('select archived_by, archive_reason from public.company_documents where id = $1', [c.id]))[0]
    expect(a).toEqual({ archived_by: U.worker, archive_reason: 'Replaced by a new lease (test)' })
    expect(await refusal('worker', `update public.company_documents set title = 'later' where id = $1`, [c.id])).toMatch(/DOCUMENT_ARCHIVED/)
    expect(await refusal('worker', `delete from public.company_documents where id = $1`, [c.id])).toMatch(/DOCUMENT_DELETE/)
    expect(await refusal('worker', `insert into public.company_document_versions (workspace_id, document_id) values ($1, $2)`, [ARAK, c.id])).toMatch(/DOCUMENT_ARCHIVED/)
  })
  it('the type and the link of a confirmed document never change; a draft can still change them', async () => {
    const c = await confirmed('worker')
    expect(await refusal('worker', `update public.company_documents set type_id = $1 where id = $2`, [ids.tZakat_cert, c.id])).toMatch(/DOCUMENT_LOCKED/)
    const d = await addDoc('worker')
    expect(await refusal('worker', `update public.company_documents set type_id = $1 where id = $2`, [ids.tZakat_cert, d.id])).toBeNull()
  })
})

describe('versions', () => {
  it('a renewal is a new version: it supersedes the current one, which stays as it was', async () => {
    const c = await confirmed('worker', {}, { number: 'N-1', expiry: '2027-01-01' })
    const v2 = await addVersion('worker', c.id, ARAK, { number: 'N-2', issue: '2027-01-02', expiry: '2028-01-01' })
    expect(v2.version_no).toBe(2)
    // Pending: the document still shows the old data.
    expect((await sup('select number from public.company_documents where id = $1', [c.id]))[0].number).toBe('N-1')
    await confirm('worker', v2.id)
    const rows = (await sup('select version_no, status, number, superseded_at is not null as s from public.company_document_versions where document_id = $1 order by version_no', [c.id]))
    expect(rows).toEqual([{ version_no: 1, status: 'superseded', number: 'N-1', s: true }, { version_no: 2, status: 'current', number: 'N-2', s: false }])
    expect((await sup('select number, expiry_date::text as e from public.company_documents where id = $1', [c.id]))[0]).toEqual({ number: 'N-2', e: '2028-01-01' })
  })
  it('a confirmed or superseded version is final: never changed, never deleted', async () => {
    const c = await confirmed('worker', {}, { number: 'F-1' })
    const v2 = await addVersion('worker', c.id)
    await confirm('worker', v2.id)
    const first = (await sup(`select id from public.company_document_versions where document_id = $1 and version_no = 1`, [c.id]))[0].id
    for (const id of [first, c.version]) {
      expect(await refusal('worker', `update public.company_document_versions set number = 'x' where id = $1`, [id])).toMatch(/DOCUMENT_VERSION_FINAL/)
      expect(await refusal('worker', `delete from public.company_document_versions where id = $1`, [id])).toMatch(/DOCUMENT_VERSION_FINAL/)
    }
    expect(await refusal('admin', `update public.company_document_versions set status = 'pending' where id = $1`, [first])).toMatch(/DOCUMENT_VERSION_FINAL/)
  })
  it('one pending version at a time, one file once, and a pending file never changes', async () => {
    const c = await confirmed('worker')
    const p = await addVersion('worker', c.id)
    expect(await refusal('worker', `insert into public.company_document_versions (workspace_id, document_id) values ($1, $2)`, [ARAK, c.id])).toMatch(/DOCUMENT_VERSION_PENDING/)
    expect(await refusal('worker', `update public.company_document_versions set file_path = $2 where id = $1`, [p.id, `${ARAK}/${c.id}/other.pdf`])).toMatch(/DOCUMENT_VERSION_FILE/)
    expect(await refusal('worker', `update public.company_document_versions set number = 'edited while pending' where id = $1`, [p.id])).toBeNull()
    // The same file again (its checksum) is refused, once the pending one is gone.
    const used = (await sup('select sha256 from public.company_document_versions where id = $1', [c.version]))[0].sha256
    await as('worker', `delete from public.company_document_versions where id = $1`, [p.id])
    expect(await refusal('worker', `insert into public.company_document_versions (workspace_id, document_id, file_bucket, file_path, sha256) values ($1, $2, 'company-documents', $3, $4)`,
      [ARAK, c.id, `${ARAK}/${c.id}/again.pdf`, used])).toMatch(/DOCUMENT_FILE_REPEATED/)
  })
  it('a version starts pending, and a file lives in its own document\'s folder', async () => {
    const d = await addDoc('worker')
    expect(await refusal('worker', `insert into public.company_document_versions (workspace_id, document_id, status, confirmed_at) values ($1, $2, 'current', now())`, [ARAK, d.id])).toMatch(/DOCUMENT_VERSION_FINAL/)
    expect(await refusal('worker', `insert into public.company_document_versions (workspace_id, document_id, file_bucket, file_path, sha256) values ($1, $2, 'company-documents', $3, $4)`,
      [ARAK, d.id, `${ARAK}/${ids.e1}/x.pdf`, sha()])).toMatch(/company_document_versions_place/)
    expect(await refusal('worker', `insert into public.company_document_versions (workspace_id, document_id, file_bucket, file_path) values ($1, $2, 'company-documents', $3)`,
      [ARAK, d.id, `${ARAK}/${d.id}/nosha.pdf`])).toMatch(/company_document_versions_sha/)
    // A version without a file is allowed (data typed by hand).
    expect(await refusal('worker', `insert into public.company_document_versions (workspace_id, document_id) values ($1, $2)`, [ARAK, d.id])).toBeNull()
  })
  it('a document\'s version cannot be written into another company', async () => {
    const d = await addDoc('worker')
    expect(await refusal('ghusn', `insert into public.company_document_versions (workspace_id, document_id) values ($1, $2)`, [GHUSN, d.id])).toBeTruthy()
    expect(await refusal('admin', `insert into public.company_document_versions (workspace_id, document_id) values ($1, $2)`, [GHUSN, d.id])).toMatch(/company_document_versions_doc_fk/)
  })
  it('the type\'s required fields are needed to confirm, and a field\'s source is file, ai or manual', async () => {
    const d = await addDoc('worker', { type: ids.tCr })   // number required
    const v = await addVersion('worker', d.id, ARAK, { expiry: '2030-01-01' })
    expect(await refusal('worker', `update public.company_document_versions set status = 'current' where id = $1`, [v.id])).toMatch(/DOCUMENT_FIELDS/)
    await as('worker', `update public.company_document_versions set number = '1010000000' where id = $1`, [v.id])
    expect(await refusal('worker', `update public.company_document_versions set sources = '{"number":"guess"}' where id = $1`, [v.id])).toMatch(/DOCUMENT_SOURCES/)
    expect(await refusal('worker', `update public.company_document_versions set sources = '{"colour":"manual"}' where id = $1`, [v.id])).toMatch(/DOCUMENT_SOURCES/)
    expect(await refusal('worker', `update public.company_document_versions set sources = '{"number":"file","expiry_date":"ai"}' where id = $1`, [v.id])).toBeNull()
    expect(await refusal('worker', `update public.company_document_versions set status = 'current' where id = $1`, [v.id])).toBeNull()
    // Expiry not before issue.
    const e = await addDoc('worker')
    expect(await refusal('worker', `insert into public.company_document_versions (workspace_id, document_id, issue_date, expiry_date) values ($1, $2, '2026-05-01', '2026-04-01')`, [ARAK, e.id])).toMatch(/company_document_versions_dates/)
  })
})

describe('type, link and responsible', () => {
  it('the type must allow the link, be active, and a supplier must be a supplier', async () => {
    expect(await refusal('worker', `insert into public.company_documents (workspace_id, type_id, title, link_kind) values ($1, $2, 'x', 'company')`, [ARAK, ids.tAgency])).toMatch(/DOCUMENT_LINK/)
    await sup(`update public.document_types set is_active = false where id = $1`, [ids.tZakat_cert])
    expect(await refusal('worker', `insert into public.company_documents (workspace_id, type_id, title, link_kind) values ($1, $2, 'x', 'company')`, [ARAK, ids.tZakat_cert])).toMatch(/DOCUMENT_TYPE_INACTIVE/)
    await sup(`update public.document_types set is_active = true where id = $1`, [ids.tZakat_cert])
    expect(await refusal('worker', `insert into public.company_documents (workspace_id, type_id, title, link_kind, supplier_id) values ($1, $2, 'x', 'supplier', $3)`, [ARAK, ids.tAgency, ids.notSup])).toMatch(/DOCUMENT_SUPPLIER/)
    expect((await addDoc('worker', { type: ids.tAgency, kind: 'supplier', sup: ids.sup })).link_kind).toBe('supplier')
  })
  it('the link shape: an employee needs an employee and only one link at a time', async () => {
    expect(await refusal('manager', `insert into public.company_documents (workspace_id, type_id, title, link_kind) values ($1, $2, 'x', 'employee')`, [ARAK, ids.tIqama])).toMatch(/company_documents_link/)
    expect(await refusal('manager', `insert into public.company_documents (workspace_id, type_id, title, link_kind, employee_id, supplier_id) values ($1, $2, 'x', 'employee', $3, $4)`, [ARAK, ids.tIqama, ids.e1, ids.sup])).toMatch(/company_documents_link/)
  })
  it('a fixed asset link waits for its module: the kind exists, nothing takes it', async () => {
    expect(await refusal('worker', `insert into public.company_documents (workspace_id, type_id, title, link_kind, asset_id) values ($1, $2, 'x', 'asset', gen_random_uuid())`, [ARAK, ids.tVehicle_reg])).toMatch(/DOCUMENT_ASSET_WAITS/)
    const k = (await sup('select link_kinds from public.document_types where id = $1', [ids.tVehicle_reg]))[0].link_kinds
    expect(k).toEqual(['asset'])
  })
  it('the responsible is an approved member of the company with Documents', async () => {
    expect((await addDoc('worker', { resp: U.manager })).id).toBeTruthy()
    expect(await refusal('worker', `insert into public.company_documents (workspace_id, type_id, title, link_kind, responsible_id) values ($1, $2, 'x', 'company', $3)`, [ARAK, ids.tLease, U.outsider])).toMatch(/DOCUMENT_RESPONSIBLE/)
    expect(await refusal('worker', `insert into public.company_documents (workspace_id, type_id, title, link_kind, responsible_id) values ($1, $2, 'x', 'company', $3)`, [ARAK, ids.tLease, U.ghusn])).toMatch(/DOCUMENT_RESPONSIBLE/)
  })
})

describe('opening a file and the access log', () => {
  async function restricted() {
    const d = await confirmed('manager', { type: ids.tIqama, kind: 'employee', emp: ids.e1, title: 'Iqama — Laila (test)' }, { file: true })
    const v = (await sup('select file_bucket, file_path from public.company_document_versions where id = $1', [d.version]))[0]
    await sup(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [v.file_bucket, v.file_path])
    return { ...d, ...v }
  }
  it('an employee\'s file opens only after the opening is logged, and only for those who may read it', async () => {
    const d = await restricted()
    // Without the log the storage policy lets nothing through.
    expect((await as('manager', `select name from storage.objects where name = $1`, [d.file_path])).rows).toHaveLength(0)
    expect((await as('manager', `select * from public.documents_open_file($1, false)`, [d.version])).rows[0]).toMatchObject({ bucket: 'company-documents', path: d.file_path })
    expect((await as('manager', `select name from storage.objects where name = $1`, [d.file_path])).rows).toHaveLength(1)
    const log = (await sup('select action, user_id, version_no, file_path from public.document_access_log where document_id = $1', [d.id]))
    expect(log).toEqual([{ action: 'view', user_id: U.manager, version_no: 1, file_path: d.file_path }])
    await as('manager', `select * from public.documents_open_file($1, true)`, [d.version])
    expect((await sup(`select count(*)::int as n from public.document_access_log where document_id = $1 and action = 'download'`, [d.id]))[0].n).toBe(1)
    // Someone else's log is not yours.
    expect((await as('hrman', `select name from storage.objects where name = $1`, [d.file_path])).rows).toHaveLength(0)
    expect(await refusal('worker', `select * from public.documents_open_file($1, false)`, [d.version])).toMatch(/DOCUMENT_NOT_ALLOWED/)
    expect(await refusal('viewer', `select * from public.documents_open_file($1, false)`, [d.version])).toMatch(/DOCUMENT_NOT_ALLOWED/)
    // HR Manage and the person themselves read it, logged.
    for (const who of ['hrman', 'self']) {
      await as(who, `select * from public.documents_open_file($1, false)`, [d.version])
      expect((await as(who, `select name from storage.objects where name = $1`, [d.file_path])).rows).toHaveLength(1)
    }
    expect((await sup('select count(*)::int as n from public.document_access_log where document_id = $1', [d.id]))[0].n).toBe(4)
  })
  it('a confidential company document is logged too; an ordinary one is not', async () => {
    const c = await confirmed('manager', { conf: true })
    await as('manager', `select * from public.documents_open_file($1, false)`, [c.version])
    expect((await sup('select count(*)::int as n from public.document_access_log where document_id = $1', [c.id]))[0].n).toBe(1)
    const o = await confirmed('worker')
    const v = (await sup('select file_path from public.company_document_versions where id = $1', [o.version]))[0]
    await sup(`insert into storage.objects (bucket_id, name) values ('company-documents', $1)`, [v.file_path])
    await as('viewer', `select * from public.documents_open_file($1, false)`, [o.version])
    expect((await sup('select count(*)::int as n from public.document_access_log where document_id = $1', [o.id]))[0].n).toBe(0)
    expect((await as('viewer', `select name from storage.objects where name = $1`, [v.file_path])).rows).toHaveLength(1)
    expect((await as('outsider', `select name from storage.objects where name = $1`, [v.file_path])).rows).toHaveLength(0)
    expect((await as('ghusn', `select name from storage.objects where name = $1`, [v.file_path])).rows).toHaveLength(0)
  })
  it('a draft is opened without a log (his rule); the log itself is append-only', async () => {
    const d = await addDoc('manager', { type: ids.tIqama, kind: 'employee', emp: ids.e2 })
    const v = await addVersion('manager', d.id)
    await as('manager', `select * from public.documents_open_file($1, false)`, [v.id])
    expect((await sup('select count(*)::int as n from public.document_access_log where document_id = $1', [d.id]))[0].n).toBe(0)
    const row = (await sup('select id from public.document_access_log limit 1'))[0]
    expect(await refusal('admin', `update public.document_access_log set action = 'view' where id = $1`, [row.id])).toBeTruthy()
    await expect(sup(`update public.document_access_log set action = 'view' where id = $1`, [row.id])).rejects.toThrow(/DOCUMENT_LOG_FINAL/)
    await expect(sup(`delete from public.document_access_log where id = $1`, [row.id])).rejects.toThrow(/DOCUMENT_LOG_FINAL/)
  })
  it('uploading is for those who may write the document, into its own folder', async () => {
    const d = await addDoc('worker')
    expect(await refusal('worker', `insert into storage.objects (bucket_id, name) values ('company-documents', $1)`, [`${ARAK}/${d.id}/new.pdf`])).toBeNull()
    expect(await refusal('viewer', `insert into storage.objects (bucket_id, name) values ('company-documents', $1)`, [`${ARAK}/${d.id}/v.pdf`])).toBeTruthy()
    expect(await refusal('worker', `insert into storage.objects (bucket_id, name) values ('company-documents', $1)`, [`${ARAK}/${crypto.randomUUID()}/ghost.pdf`])).toBeTruthy()
    expect(await refusal('ghusn', `insert into storage.objects (bucket_id, name) values ('company-documents', $1)`, [`${ARAK}/${d.id}/x.pdf`])).toBeTruthy()
    expect(await refusal('worker', `insert into storage.objects (bucket_id, name) values ('company-documents', 'not-a-path')`)).toBeTruthy()
  })
})

describe('alerts', () => {
  const today = async () => (await sup('select public.documents_today()::text as d'))[0].d
  const plus = async days => (await sup(`select (public.documents_today() + $1::int)::text as d`, [days]))[0].d

  it('a notice for the nearest threshold, the farther ones covered, and one renewal task: once each', async () => {
    const d = await confirmed('worker', { resp: U.manager, title: 'Lease alert (test)' }, { expiry: await plus(25) })
    expect((await as('worker', `select public.documents_run_alerts_for($1) as n`, [ARAK])).rows[0].n).toBeGreaterThan(0)
    const rows = await sup(`select kind, days_before, status from public.document_alerts where document_id = $1 order by kind, days_before`, [d.id])
    // 25 days left: the 30 and 90 thresholds are reached; 30 is the nearest.
    const notices = rows.filter(r => r.kind === 'notice')
    expect(notices).toEqual([{ kind: 'notice', days_before: 30, status: 'sent' }, { kind: 'notice', days_before: 90, status: 'covered' }])
    expect(rows.filter(r => r.kind === 'task')).toEqual([{ kind: 'task', days_before: 30, status: 'sent' }])
    const task = (await sup(`select t.title, t.assigned_to, t.section, t.priority, t.due_at is not null as due from public.document_alerts a join public.tasks t on t.id = a.task_id where a.document_id = $1`, [d.id]))[0]
    expect(task).toMatchObject({ assigned_to: U.manager, section: 'documents', priority: 'high', due: true })
    expect(task.title).toContain(d.document_no)
    expect((await sup(`select count(*)::int as n from public.notifications where user_id = $1 and kind = 'document_expiring' and link like '%' || $2`, [U.manager, d.id]))[0].n).toBe(1)
    // Again: nothing new.
    await as('worker', `select public.documents_run_alerts_for($1) as n`, [ARAK])
    expect((await sup('select count(*)::int as n from public.document_alerts where document_id = $1', [d.id]))[0].n).toBe(3)
    expect((await sup('select count(*)::int as n from public.tasks where assigned_to = $1 and title like $2', [U.manager, '%' + d.document_no + '%']))[0].n).toBe(1)
  })
  it('a renewal with a new expiry starts them again; nobody is told about a document with no responsible, no expiry or archived', async () => {
    const d = await confirmed('worker', { resp: U.worker }, { expiry: await plus(5) })
    await sup('select public.documents_run_alerts()')
    const first = (await sup('select count(*)::int as n from public.document_alerts where document_id = $1', [d.id]))[0].n
    expect(first).toBeGreaterThan(0)
    const v2 = await addVersion('worker', d.id, ARAK, { expiry: await plus(400) })
    await confirm('worker', v2.id)
    await sup('select public.documents_run_alerts()')
    expect((await sup('select count(*)::int as n from public.document_alerts where document_id = $1', [d.id]))[0].n).toBe(first)   // 400 days: nothing reached
    const v3 = await addVersion('worker', d.id, ARAK, { expiry: await plus(20) })
    await confirm('worker', v3.id)
    await sup('select public.documents_run_alerts()')
    expect((await sup('select count(*)::int as n from public.document_alerts where document_id = $1', [d.id]))[0].n).toBeGreaterThan(first)

    const noResp = await confirmed('worker', {}, { expiry: await plus(3) })
    const noExp = await confirmed('worker', { resp: U.worker }, { expiry: null })
    const arch = await confirmed('worker', { resp: U.worker }, { expiry: await plus(3) })
    await sup(`update public.company_documents set archived_at = now(), archived_by = $2, archive_reason = 'old (test)' where id = $1`, [arch.id, U.worker])
    await sup('select public.documents_run_alerts()')
    for (const x of [noResp, noExp, arch]) expect((await sup('select count(*)::int as n from public.document_alerts where document_id = $1', [x.id]))[0].n).toBe(0)
  })
  it('an expired document gets its renewal task but no notice; the alerts are append-only; a viewer may run them, an outsider not', async () => {
    const d = await confirmed('worker', { resp: U.worker }, { expiry: await plus(-10) })
    await as('viewer', `select public.documents_run_alerts_for($1)`, [ARAK])
    const rows = await sup(`select kind from public.document_alerts where document_id = $1`, [d.id])
    expect(rows).toEqual([{ kind: 'task' }])
    expect(await refusal('outsider', `select public.documents_run_alerts_for($1)`, [ARAK])).toMatch(/DOCUMENT_NOT_ALLOWED/)
    await expect(sup(`delete from public.document_alerts where document_id = $1`, [d.id])).rejects.toThrow(/DOCUMENT_LOG_FINAL/)
    expect(await refusal('admin', `select public.documents_run_alerts()`)).toBeTruthy()   // the all-company run is not for the browser
    expect(await today()).toMatch(/^\d{4}-\d\d-\d\d$/)
  })
  it('a restricted document names its type, never its title, in the bell and the task', async () => {
    const d = await confirmed('manager', { type: ids.tIqama, kind: 'employee', emp: ids.e2, resp: U.manager, title: 'Iqama — Khaled Private (test)' }, { expiry: await plus(10) })
    await sup('select public.documents_run_alerts()')
    const n = (await sup(`select title from public.notifications where link like '%' || $1`, [d.id]))[0].title
    const t = (await sup(`select t.title from public.document_alerts a join public.tasks t on t.id = a.task_id where a.document_id = $1`, [d.id]))[0].title
    expect(n).not.toContain('Private')
    expect(t).not.toContain('Private')
  })
})

describe('the history', () => {
  it('records who changed what, field by field, and keeps a deleted draft\'s', async () => {
    const d = await addDoc('worker', { title: 'History (test)' })
    await as('worker', `update public.company_documents set title = 'History renamed (test)' where id = $1`, [d.id])
    const h = (await as('manager', `select action, label, changes, actor from public.document_history where document_id = $1 order by id`, [d.id])).rows
    expect(h.map(r => r.action)).toEqual(['insert', 'update'])
    expect(h[1].changes.title).toEqual(['History (test)', 'History renamed (test)'])
    expect(h[1].actor).toBe(U.worker)
    await as('worker', `delete from public.company_documents where id = $1`, [d.id])
    expect((await as('manager', `select action from public.document_history where document_id = $1 order by id`, [d.id])).rows.map(r => r.action)).toEqual(['insert', 'update', 'delete'])
  })
})

describe('HR\'s papers move here', () => {
  it('each paper becomes a confirmed employee document with its type, number, dates, notes and scan; run again, nothing doubles', async () => {
    // The old rows were written before the move; the guard is lifted for this fixture only.
    await sup('alter table public.hr_documents disable trigger hr_documents_moved')
    await sup(`insert into public.hr_documents (workspace_id, employee_id, doc_type, doc_number, issue_date, expiry_date, notes, file_path, file_name, file_size, file_type) values
      ($1, $2, 'iqama', '2000000001', '2025-01-01', '2028-01-01', 'renewed 2025', $3, 'iqama.pdf', 5000, 'application/pdf'),
      ($1, $2, 'other', '', null, null, 'Forklift licence (test)', null, null, null, null)`,
    [ARAK, ids.e2, `${ARAK}/${ids.e2}/old-scan.pdf`])
    await sup('alter table public.hr_documents enable trigger hr_documents_moved')
    expect((await sup('select public.documents_move_hr_papers($1) as n', [ARAK]))[0].n).toBe(2)
    expect((await sup('select public.documents_move_hr_papers($1) as n', [ARAK]))[0].n).toBe(0)
    const iq = (await sup(`select d.title, d.number, d.issue_date::text as i, d.expiry_date::text as e, d.notes, d.confirmed_at is not null as c, d.link_kind, t.code,
                                  v.file_bucket, v.file_path, v.file_name, v.status, v.sources
                             from public.company_documents d join public.document_types t on t.id = d.type_id join public.company_document_versions v on v.document_id = d.id
                            where d.legacy_hr_document_id is not null and d.number = '2000000001'`))[0]
    expect(iq).toMatchObject({ number: '2000000001', i: '2025-01-01', e: '2028-01-01', notes: 'renewed 2025', c: true, link_kind: 'employee', code: 'IQAMA',
      file_bucket: 'hr-papers', file_path: `${ARAK}/${ids.e2}/old-scan.pdf`, file_name: 'iqama.pdf', status: 'current' })
    expect(iq.title).toContain('Khaled Sample (test)')
    expect(iq.sources).toEqual({ number: 'manual', issue_date: 'manual', expiry_date: 'manual' })
    const other = (await sup(`select d.title, t.code from public.company_documents d join public.document_types t on t.id = d.type_id where d.title like 'Forklift%'`))[0]
    expect(other).toMatchObject({ code: 'EMPLOYEE_OTHER' })
  })
  it('the moved scan opens through Documents (logged), not only through HR', async () => {
    const d = (await sup(`select d.id, v.id as vid from public.company_documents d join public.company_document_versions v on v.document_id = d.id where d.number = '2000000001'`))[0]
    await sup(`insert into storage.objects (bucket_id, name) values ('hr-papers', $1)`, [`${ARAK}/${ids.e2}/old-scan.pdf`])
    expect((await as('manager', `select name from storage.objects where bucket_id = 'hr-papers'`)).rows).toHaveLength(0)
    const r = (await as('manager', `select * from public.documents_open_file($1, false)`, [d.vid])).rows[0]
    expect(r.bucket).toBe('hr-papers')
    expect((await as('manager', `select name from storage.objects where bucket_id = 'hr-papers'`)).rows).toHaveLength(1)
    expect((await as('viewer', `select name from storage.objects where bucket_id = 'hr-papers'`)).rows).toHaveLength(0)
    expect(await refusal('manager', `insert into storage.objects (bucket_id, name) values ('hr-papers', $1)`, [`${ARAK}/${ids.e2}/new.pdf`])).toBeTruthy()
  })
  it('the old table refuses any new write, and an employee\'s deletion still clears its rows', async () => {
    expect(await refusal('admin', `insert into public.hr_documents (workspace_id, employee_id, doc_type) values ($1, $2, 'passport')`, [ARAK, ids.e2])).toBeTruthy()
    await expect(sup(`insert into public.hr_documents (workspace_id, employee_id, doc_type) values ($1, $2, 'passport')`, [ARAK, ids.e2])).rejects.toThrow(/DOCUMENT_HR_MOVED/)
    await expect(sup(`update public.hr_documents set notes = 'x' where employee_id = $1`, [ids.e2])).rejects.toThrow(/DOCUMENT_HR_MOVED/)
    await expect(sup(`delete from public.hr_documents where employee_id = $1`, [ids.e2])).rejects.toThrow(/DOCUMENT_HR_MOVED/)
    // A person with documents is used: their file cannot be removed under them.
    await expect(sup(`delete from public.hr_employees where id = $1`, [ids.e2])).rejects.toThrow(/company_documents_employee_fk/)
    // A person with only the old rows (no document yet) goes with them.
    await sup(`insert into public.hr_employees (id, workspace_id, name_en) values ('00000000-0000-0000-0000-00000000e0ff', $1, 'Unused (test)')`, [ARAK])
    await sup(`alter table public.hr_documents disable trigger hr_documents_moved`)
    await sup(`insert into public.hr_documents (workspace_id, employee_id, doc_type) values ($1, '00000000-0000-0000-0000-00000000e0ff', 'passport')`, [ARAK])
    await sup(`alter table public.hr_documents enable trigger hr_documents_moved`)
    await sup(`delete from public.hr_employees where id = '00000000-0000-0000-0000-00000000e0ff'`)
    expect((await sup(`select count(*)::int as n from public.hr_documents where employee_id = '00000000-0000-0000-0000-00000000e0ff'`))[0].n).toBe(0)
  })
})

describe('search', () => {
  it('finds a document by title, DOC- number or the number on it, for those who may read it only', async () => {
    await confirmed('worker', { title: 'Warehouse lease Riyadh (test)' }, { number: 'WH-4421' })
    const emp = await confirmed('manager', { type: ids.tIqama, kind: 'employee', emp: ids.e1, title: 'Iqama — Searchable Person (test)' })
    const found = async (who, q) => (await as(who, 'select title, rank from public.shell_search_documents($1, $2, 5)', [ARAK, q])).rows.map(r => r.title)
    expect(await found('viewer', 'warehouse')).toEqual(['Warehouse lease Riyadh (test)'])
    expect(await found('viewer', 'WH-4421')).toEqual(['Warehouse lease Riyadh (test)'])
    expect(await found('viewer', emp.document_no)).toEqual([])
    expect(await found('manager', emp.document_no)).toEqual(['Iqama — Searchable Person (test)'])
    expect(await found('outsider', 'warehouse')).toEqual([])
    expect(await found('ghusn', 'warehouse')).toEqual([])
    expect((await as('ghusn', 'select title from public.shell_search_documents($1, $2, 5)', [ARAK, 'warehouse'])).rows).toEqual([])
  })
})

describe('deleting a whole company', () => {
  it('takes its documents, versions, alerts and logs with it, though confirmed ones are never deleted otherwise', async () => {
    // (A company with Contacts organisations cannot be deleted yet: a known Contacts bug, CRM.md trap 5.)
    const W = '00000000-0000-0000-0000-0000000000d1'
    await sup(`insert into public.workspaces values ('${W}', 'Doomed (test)')`)
    const type = await typeId(W, 'LEASE')
    const doc = (await sup(`insert into public.company_documents (workspace_id, type_id, title, link_kind) values ($1, $2, 'Doomed lease (test)', 'company') returning id`, [W, type]))[0].id
    const ver = (await sup(`insert into public.company_document_versions (workspace_id, document_id, expiry_date) values ($1, $2, '2030-01-01') returning id`, [W, doc]))[0].id
    await sup(`update public.company_document_versions set status = 'current' where id = $1`, [ver])
    await sup(`insert into public.document_alerts (workspace_id, document_id, expiry_date, kind, days_before) values ($1, $2, '2030-01-01', 'notice', 7)`, [W, doc])
    await sup(`insert into public.document_access_log (workspace_id, document_id, action) values ($1, $2, 'view')`, [W, doc])
    await expect(sup('delete from public.company_documents where id = $1', [doc])).rejects.toThrow(/DOCUMENT_DELETE/)
    await sup(`delete from public.workspaces where id = $1`, [W])
    for (const t of ['company_documents', 'company_document_versions', 'document_alerts', 'document_access_log', 'document_types', 'document_history', 'document_counters']) {
      expect((await sup(`select count(*)::int as n from public.${t} where workspace_id = $1`, [W]))[0].n, t).toBe(0)
    }
  })
})
