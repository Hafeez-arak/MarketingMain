-- ─── HR: the database's rules, tested (LOCAL v2 database only) ─────────────
-- 2026-10-28. Who may read and change what, company separation, and the
-- business rules of 20261112_hr_*.sql, checked the way the browser reaches
-- them: role `authenticated` with a login in request.jwt.claims. Runs on the
-- live local database AFTER seed.sql, inside one transaction that is rolled
-- back, so it leaves nothing behind.
--
--   dev/erp-pilot/hr/run-tests.sh
--
-- Logins of the local copy used here (their HR grants are made in the test):
--   staff.admin@arak-sa.com     access admin: Manage everywhere
--   staff.ceo@arak-sa.com     access admin (the CEO), linked to a test employee
--   staff.dev@arak-sa.com     member of every company; HR Work in Arak Lighting
--   staff.marketing@arak-sa.com     member of Arak Lighting and Ghusn; HR View in Arak
--                          Lighting only, linked to the sales manager (test)
--   outside.two@example.com member of Aqeeq and Alo Kheyatah only

\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

create temp table t (n serial, name text, ok boolean, detail text);
grant all on t to public;
grant all on sequence t_n_seq to public;
\o /dev/null

-- Run one query as a login (null = signed out) and return its single value as text.
create function pg_temp.q(p_email text, p_sql text) returns text as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text end, true);
  execute case when p_email is null then 'set local role anon' else 'set local role authenticated' end;
  execute p_sql into v;
  reset role;
  return v;
end $$ language plpgsql;

-- Run as a login; the error it raised, or 'no error'.
create function pg_temp.err(p_email text, p_sql text) returns text as $$
begin
  begin
    perform pg_temp.q(p_email, p_sql);
  exception when others then
    reset role;
    return sqlerrm;
  end;
  reset role;
  return 'no error';
end $$ language plpgsql;

create function pg_temp.eq(p_name text, p_actual anyelement, p_expected anyelement) returns void as $$
  insert into t (name, ok, detail) values (p_name, p_actual is not distinct from p_expected, format('actual=%s expected=%s', p_actual, p_expected));
$$ language sql;

create function pg_temp.refused(p_name text, p_email text, p_sql text, p_needle text) returns void as $$
declare e text := pg_temp.err(p_email, p_sql);
begin
  insert into t (name, ok, detail) values (p_name, position(p_needle in e) > 0, e);
end $$ language plpgsql;

create function pg_temp.uid(p_email text) returns uuid as $$ select id from auth.users where email = p_email $$ language sql;
create function pg_temp.emp(p_no text) returns uuid as $$ select id from public.hr_employees where employee_no = p_no $$ language sql;
create function pg_temp.typ(p_name text) returns uuid as $$
  select id from public.hr_leave_types where workspace_id = '00000000-0000-0000-0000-000000000001' and name_en = p_name
$$ language sql;

\set arak '''00000000-0000-0000-0000-000000000001'''
select set_config('hr.ghusn', (select id::text from public.workspaces where name = 'Ghusn'), true);

-- Grants for this test only (rolled back).
insert into public.section_access (workspace_id, user_id, section, level) values
  (:arak, pg_temp.uid('staff.dev@arak-sa.com'), 'hr', 'work'),
  (:arak, pg_temp.uid('staff.marketing@arak-sa.com'), 'hr', 'view')
on conflict (workspace_id, user_id, section) do update set level = excluded.level;

-- ══ Reading: access levels and company separation ══
select pg_temp.eq('read: signed out sees no employee',
  pg_temp.q(null, 'select count(*) from public.hr_employees'), '0');
select pg_temp.eq('read: a member without HR in Ghusn sees none of Ghusn''s',
  pg_temp.q('staff.marketing@arak-sa.com', format('select count(*) from public.hr_employees where workspace_id = %L', current_setting('hr.ghusn'))), '0');
select pg_temp.eq('read: View sees the Arak Lighting directory',
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from public.hr_employees where workspace_id = ''00000000-0000-0000-0000-000000000001'''), '9');
select pg_temp.eq('read: View sees only Arak Lighting even without a filter',
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(distinct workspace_id) from public.hr_employees'), '1');
select pg_temp.eq('read: a login outside the company sees nothing',
  pg_temp.q('outside.two@example.com', 'select count(*) from public.hr_employees'), '0');
select pg_temp.eq('read: the admin reads Ghusn''s two',
  pg_temp.q('staff.admin@arak-sa.com', format('select count(*) from public.hr_employees where workspace_id = %L', current_setting('hr.ghusn'))), '2');
select pg_temp.eq('read: View does not read papers',
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from public.hr_documents'), '0');
select pg_temp.eq('read: View does not read contracts',
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from public.hr_contracts'), '0');
select pg_temp.eq('read: Manage reads every paper of the company',
  pg_temp.q('staff.admin@arak-sa.com', 'select count(*) from public.hr_documents where workspace_id = ''00000000-0000-0000-0000-000000000001'''), '9');
select pg_temp.eq('read: View reads attendance and leave',
  pg_temp.q('staff.marketing@arak-sa.com', 'select (select count(*) > 300 from public.hr_attendance) and (select count(*) = 7 from public.hr_leave_requests)'), 'true');
select pg_temp.eq('read: the work-email listing of logins is Manage''s',
  pg_temp.q('staff.dev@arak-sa.com', 'select count(*) from public.hr_logins(''00000000-0000-0000-0000-000000000001'')'), '0');
select pg_temp.eq('read: Manage lists the company''s logins',
  pg_temp.q('staff.admin@arak-sa.com', 'select count(*) > 0 from public.hr_logins(''00000000-0000-0000-0000-000000000001'')'), 'true');

-- ══ Departments ══
select pg_temp.refused('departments: Work cannot add one', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_departments (workspace_id, name_en, created_by) values (%L, 'Marketing (test)', %L) returning id$s$, :arak, pg_temp.uid('staff.dev@arak-sa.com')),
  'row-level security');
select pg_temp.eq('departments: Manage adds one',
  pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.hr_departments (workspace_id, name_en, name_ar, created_by) values (%L, 'Marketing (test)', 'التسويق (تجربة)', %L) returning name_en$s$, :arak, pg_temp.uid('staff.admin@arak-sa.com'))),
  'Marketing (test)');
select pg_temp.refused('departments: names are unique in a company', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_departments (workspace_id, name_en, created_by) values (%L, 'marketing (TEST)', %L) returning id$s$, :arak, pg_temp.uid('staff.admin@arak-sa.com')),
  'hr_departments_name_en_uq');
select pg_temp.refused('departments: a name is needed', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_departments (workspace_id, created_by) values (%L, %L) returning id$s$, :arak, pg_temp.uid('staff.admin@arak-sa.com')),
  'hr_departments_named');
select pg_temp.eq('departments: a delete removes nothing (no policy: archive instead)',
  pg_temp.q('staff.admin@arak-sa.com', $s$with d as (delete from public.hr_departments where name_en = 'Marketing (test)' returning 1) select count(*) from d$s$), '0');

-- ══ Employees ══
-- (Parity pass, 20261129_hr_parity_1: his hr.manage is Manage here; Work is his hr.attendance.)
select pg_temp.refused('employees: View cannot add one', 'staff.marketing@arak-sa.com',
  format($s$insert into public.hr_employees (workspace_id, name_en, hire_date, created_by) values (%L, 'X (test)', '2026-01-01', %L) returning id$s$, :arak, pg_temp.uid('staff.marketing@arak-sa.com')),
  'row-level security');
select pg_temp.refused('employees: Work (attendance) cannot add one', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_employees (workspace_id, name_en, hire_date, created_by) values (%L, 'X (test)', '2026-01-01', %L) returning id$s$, :arak, pg_temp.uid('staff.dev@arak-sa.com')),
  'row-level security');
-- A person for the tests below, made as the database owner so the number is T-100
-- (people made through the app get a system number, tested next).
select set_config('request.jwt.claims', '', true);
insert into public.hr_employees (workspace_id, employee_no, name_ar, hire_date, created_by)
values (:arak, 'T-100', 'جديد (تجربة)', '2026-10-01', pg_temp.uid('staff.admin@arak-sa.com'));
select pg_temp.eq('employees: Manage adds one, and the system makes the number',
  pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.hr_employees (workspace_id, name_ar, hire_date, created_by) values (%L, 'ثان (تجربة)', '2026-10-01', %L) returning employee_no ~ '^E-[0-9]{4}-[0-9]{6}$'$s$, :arak, pg_temp.uid('staff.admin@arak-sa.com'))),
  'true');
select pg_temp.eq('employees: a number typed by hand is ignored',
  pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.hr_employees (workspace_id, employee_no, name_ar, hire_date, created_by) values (%L, 'ZZZ-1', 'ثالث (تجربة)', '2026-10-01', %L) returning employee_no <> 'ZZZ-1'$s$, :arak, pg_temp.uid('staff.admin@arak-sa.com'))),
  'true');
select pg_temp.eq('employees: numbers are made in order, one counter per company',
  (select count(*) from public.hr_employees where workspace_id = :arak and employee_no ~ '^E-[0-9]{4}-[0-9]{6}$')::text, '2');
select pg_temp.refused('employees: a number never changes', 'staff.admin@arak-sa.com',
  $s$update public.hr_employees set employee_no = 'X-1' where employee_no = 'T-100' returning id$s$, 'HR_NUMBER_LOCKED');
select pg_temp.refused('employees: a hire date is required', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_employees (workspace_id, name_en, created_by) values (%L, 'Y (test)', %L) returning id$s$, :arak, pg_temp.uid('staff.admin@arak-sa.com')),
  'hire_date');
select pg_temp.refused('employees: Manage cannot add one to a company they cannot manage', 'outside.two@example.com',
  format($s$insert into public.hr_employees (workspace_id, name_en, hire_date, created_by) values (%L, 'G (test)', '2026-01-01', %L) returning id$s$, current_setting('hr.ghusn'), pg_temp.uid('outside.two@example.com')),
  'row-level security');
select pg_temp.refused('employees: a department of another company is refused', 'staff.admin@arak-sa.com',
  format($s$update public.hr_employees set department_id = (select id from public.hr_departments where workspace_id = %L limit 1) where employee_no = 'T-100' returning id$s$, current_setting('hr.ghusn')),
  'hr_employees_department_fk');
select pg_temp.refused('employees: a manager of another company is refused', 'staff.admin@arak-sa.com',
  $s$update public.hr_employees set manager_id = (select id from public.hr_employees where employee_no = 'G-001') where employee_no = 'T-100' returning id$s$,
  'hr_employees_manager_fk');
select pg_temp.refused('employees: the reporting line cannot loop', 'staff.admin@arak-sa.com',
  $s$update public.hr_employees set manager_id = (select id from public.hr_employees where employee_no = 'T-003') where employee_no = 'T-002' returning id$s$,
  'HR_MANAGER_LOOP');
select pg_temp.eq('employees: Work (attendance) cannot edit one',
  pg_temp.q('staff.dev@arak-sa.com', $s$with u as (update public.hr_employees set trade = 'x' where employee_no = 'T-008' returning 1) select count(*) from u$s$), '0');
select pg_temp.eq('employees: Work cannot change anyone''s manager (the old self-approval worry is closed twice: Manage only, and a manager decides nothing)',
  pg_temp.q('staff.dev@arak-sa.com', $s$with u as (update public.hr_employees set manager_id = null where employee_no = 'T-003' returning 1) select count(*) from u$s$), '0');
select pg_temp.refused('employees: ending employment needs a reason', 'staff.admin@arak-sa.com',
  $s$update public.hr_employees set status = 'ended', end_date = '2026-10-20' where employee_no = 'T-100' returning id$s$,
  'hr_employees_ended');
select pg_temp.eq('employees: Manage ends employment with date and reason',
  pg_temp.q('staff.admin@arak-sa.com', $s$update public.hr_employees set status = 'ended', end_date = '2026-10-20', end_reason = 'Test ended' where employee_no = 'T-100' returning status$s$),
  'ended');
select pg_temp.refused('employees: a login from outside the company cannot be linked', 'staff.admin@arak-sa.com',
  format($s$update public.hr_employees set user_id = %L where employee_no = 'T-008' returning id$s$, pg_temp.uid('outside.two@example.com')),
  'HR_LOGIN_NOT_IN_COMPANY');
-- Links used by the leave tests below.
select pg_temp.eq('employees: Manage links logins (sara → sales manager, tariq → sales engineer, nasser → GM)',
  pg_temp.q('staff.admin@arak-sa.com', format($s$with a as (update public.hr_employees set user_id = %L where employee_no = 'T-002' returning 1),
    b as (update public.hr_employees set user_id = %L where employee_no = 'T-003' returning 1),
    c as (update public.hr_employees set user_id = %L where employee_no = 'T-001' returning 1)
    select (select count(*) from a) + (select count(*) from b) + (select count(*) from c)$s$,
    pg_temp.uid('staff.marketing@arak-sa.com'), pg_temp.uid('staff.dev@arak-sa.com'), pg_temp.uid('staff.ceo@arak-sa.com'))),
  '3');
select pg_temp.refused('employees: one login, one employee per company', 'staff.admin@arak-sa.com',
  format($s$update public.hr_employees set user_id = %L where employee_no = 'T-004' returning id$s$, pg_temp.uid('staff.marketing@arak-sa.com')),
  'hr_employees_user_uq');

-- ══ Papers and contracts ══
select pg_temp.eq('papers: a linked View person reads their own only',
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from public.hr_documents'), '1');
select pg_temp.eq('papers: Work (attendance) reads none',
  pg_temp.q('staff.dev@arak-sa.com', 'select count(*) from public.hr_documents where workspace_id = ''00000000-0000-0000-0000-000000000001'' and employee_id <> (select id from public.hr_employees where employee_no = ''T-003'')'), '0');
select pg_temp.refused('papers: "other" says what it is', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_documents (workspace_id, employee_id, doc_type) values (%L, %L, 'other') returning id$s$, :arak, pg_temp.emp('T-004')),
  'hr_documents_other_named');
select pg_temp.refused('papers: expiry is not before issue', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_documents (workspace_id, employee_id, doc_type, issue_date, expiry_date) values (%L, %L, 'passport', '2026-01-01', '2025-01-01') returning id$s$, :arak, pg_temp.emp('T-004')),
  'hr_documents_dates');
select pg_temp.refused('papers: View cannot add one', 'staff.marketing@arak-sa.com',
  format($s$insert into public.hr_documents (workspace_id, employee_id, doc_type) values (%L, %L, 'passport') returning id$s$, :arak, pg_temp.emp('T-002')),
  'row-level security');
select pg_temp.refused('papers: Work (attendance) cannot add one', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_documents (workspace_id, employee_id, doc_type) values (%L, %L, 'passport') returning id$s$, :arak, pg_temp.emp('T-004')),
  'row-level security');
select pg_temp.refused('papers: an employee of another company is refused', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_documents (workspace_id, employee_id, doc_type) values (%L, %L, 'passport') returning id$s$, :arak, pg_temp.emp('G-001')),
  'hr_documents_employee_fk');
select pg_temp.refused('papers: a file belongs in its own company and employee folder', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_documents (workspace_id, employee_id, doc_type, file_path, file_name, file_size, file_type) values (%L, %L, 'passport', 'elsewhere/x.pdf', 'x.pdf', 10, 'application/pdf') returning id$s$, :arak, pg_temp.emp('T-004')),
  'hr_documents_file_place');
select pg_temp.eq('papers: Manage adds one with its file',
  pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.hr_documents (workspace_id, employee_id, doc_type, doc_number, file_path, file_name, file_size, file_type) values (%L, %L, 'passport', 'FILE-1', %L, 'scan.pdf', 1200, 'application/pdf') returning file_name$s$,
    :arak, pg_temp.emp('T-004'), :arak || '/' || pg_temp.emp('T-004')::text || '/test-scan.pdf')),
  'scan.pdf');
-- ── Contracts: his workflow (20261129_hr_parity_3) ──
select pg_temp.eq('contracts: View and Work read none',
  pg_temp.q('staff.dev@arak-sa.com', 'select count(*) from public.hr_contracts where employee_id <> (select id from public.hr_employees where employee_no = ''T-003'')') || '/' || pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from public.hr_contracts where employee_id <> (select id from public.hr_employees where employee_no = ''T-002'')'), '0/0');
select pg_temp.eq('contracts: the old ones kept their meaning (ended → expired, current → running)',
  (select string_agg(distinct status, ',' order by status) from public.hr_contracts where workspace_id = :arak), 'expired,running');
select pg_temp.refused('contracts: Work cannot make one', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_contracts (workspace_id, employee_id, contract_type, start_date, end_date, created_by) values (%L, %L, 'fixed', '2027-01-01', '2027-12-31', %L) returning id$s$, :arak, pg_temp.emp('T-004'), pg_temp.uid('staff.dev@arak-sa.com')),
  'row-level security');
select pg_temp.refused('contracts: fixed term has an end date', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_contracts (workspace_id, employee_id, contract_type, start_date, created_by) values (%L, %L, 'fixed', '2027-01-01', %L) returning id$s$, :arak, pg_temp.emp('T-004'), pg_temp.uid('staff.admin@arak-sa.com')),
  'hr_contracts_fixed_ends');
select pg_temp.refused('contracts: weekly hours are at most 168', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_contracts (workspace_id, employee_id, contract_type, start_date, weekly_hours, created_by) values (%L, %L, 'open', '2027-01-01', 169, %L) returning id$s$, :arak, pg_temp.emp('T-004'), pg_temp.uid('staff.admin@arak-sa.com')),
  'hr_contracts_weekly_hours');
select pg_temp.refused('contracts: only for someone still employed', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_contracts (workspace_id, employee_id, contract_type, start_date, created_by) values (%L, %L, 'open', '2027-01-01', %L) returning id$s$, :arak, pg_temp.emp('T-009'), pg_temp.uid('staff.admin@arak-sa.com')),
  'HR_EMPLOYEE_NOT_ACTIVE');
select pg_temp.refused('contracts: it cannot be born finished', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_contracts (workspace_id, employee_id, contract_type, start_date, status, created_by) values (%L, %L, 'open', '2027-01-01', 'expired', %L) returning id$s$, :arak, pg_temp.emp('T-004'), pg_temp.uid('staff.admin@arak-sa.com')),
  'HR_CONTRACT_TRANSITION');
select set_config('hr.c1', pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.hr_contracts (workspace_id, employee_id, contract_type, start_date, end_date, weekly_hours, created_by) values (%L, %L, 'fixed', '2027-01-01', '2027-12-31', 48, %L) returning id$s$, :arak, pg_temp.emp('T-004'), pg_temp.uid('staff.admin@arak-sa.com'))), true);
select pg_temp.eq('contracts: a new one is a draft with a system number',
  (select status || ':' || (contract_no ~ '^HC-[0-9]{4}-[0-9]{6}$')::text from public.hr_contracts where id = current_setting('hr.c1')::uuid), 'draft:true');
select pg_temp.eq('contracts: a draft''s terms can still change',
  pg_temp.q('staff.admin@arak-sa.com', format($s$update public.hr_contracts set weekly_hours = 40 where id = %L returning weekly_hours$s$, current_setting('hr.c1'))), '40.00');
select pg_temp.refused('contracts: one running at a time', 'staff.admin@arak-sa.com',
  format($s$update public.hr_contracts set status = 'running' where id = %L returning id$s$, current_setting('hr.c1')), 'hr_contracts_one_running');
select pg_temp.refused('contracts: a draft cannot be closed', 'staff.admin@arak-sa.com',
  format($s$update public.hr_contracts set status = 'expired' where id = %L returning id$s$, current_setting('hr.c1')), 'HR_CONTRACT_TRANSITION');
select pg_temp.eq('contracts: closing the running one sets its end',
  pg_temp.q('staff.admin@arak-sa.com', $s$update public.hr_contracts set status = 'expired', end_date = '2026-12-31' where employee_id = (select id from public.hr_employees where employee_no = 'T-004') and status = 'running' returning status$s$), 'expired');
select pg_temp.eq('contracts: ...then the next can start',
  pg_temp.q('staff.admin@arak-sa.com', format($s$update public.hr_contracts set status = 'running' where id = %L returning status$s$, current_setting('hr.c1'))), 'running');
select pg_temp.refused('contracts: terms are locked once running', 'staff.admin@arak-sa.com',
  format($s$update public.hr_contracts set weekly_hours = 30 where id = %L returning id$s$, current_setting('hr.c1')), 'HR_CONTRACT_LOCKED');
select pg_temp.refused('contracts: a running contract''s end is only set by closing it', 'staff.admin@arak-sa.com',
  format($s$update public.hr_contracts set end_date = '2027-06-30' where id = %L returning id$s$, current_setting('hr.c1')), 'HR_CONTRACT_LOCKED');
select pg_temp.refused('contracts: the number and owner are fixed', 'staff.admin@arak-sa.com',
  format($s$update public.hr_contracts set contract_no = 'HC-X' where id = %L returning id$s$, current_setting('hr.c1')), 'HR_CONTRACT_LOCKED');
select pg_temp.eq('contracts: notes may still be written',
  pg_temp.q('staff.admin@arak-sa.com', format($s$update public.hr_contracts set notes = 'Signed copy filed' where id = %L returning notes$s$, current_setting('hr.c1'))), 'Signed copy filed');
select pg_temp.eq('contracts: a finished one cannot be cancelled',
  (select pg_temp.err('staff.admin@arak-sa.com', $s$update public.hr_contracts set status = 'cancelled' where status = 'expired' and employee_id = (select id from public.hr_employees where employee_no = 'T-004')$s$) like '%HR_CONTRACT_TRANSITION%'), true);
select pg_temp.eq('contracts: nobody deletes one (it is cancelled)',
  pg_temp.q('staff.admin@arak-sa.com', format($s$with d as (delete from public.hr_contracts where id = %L returning 1) select count(*) from d$s$, current_setting('hr.c1'))), '0');
select pg_temp.eq('contracts: View learns who has a running contract without reading one',
  pg_temp.q('staff.marketing@arak-sa.com', format('select count(*) from public.hr_running_contracts(%L)', :arak)), '8');
select pg_temp.eq('contracts: Manage cancels a running one',
  pg_temp.q('staff.admin@arak-sa.com', format($s$update public.hr_contracts set status = 'cancelled' where id = %L returning status$s$, current_setting('hr.c1'))), 'cancelled');

-- ══ Leave: asking ══
select pg_temp.refused('leave: View cannot ask for someone else', 'staff.marketing@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, created_by) values (%L, %L, %L, '2026-12-01', '2026-12-01', 1, %L) returning id$s$,
    :arak, pg_temp.emp('T-004'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.marketing@arak-sa.com')),
  'row-level security');
select pg_temp.eq('leave: a linked View person asks for their own',
  pg_temp.q('staff.marketing@arak-sa.com', format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason, created_by) values (%L, %L, %L, '2026-12-06', '2026-12-08', 3, 'Test', %L) returning status$s$,
    :arak, pg_temp.emp('T-002'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.marketing@arak-sa.com'))),
  'pending');
select pg_temp.refused('leave: Work (attendance) cannot ask for someone else', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, created_by) values (%L, %L, %L, '2026-12-01', '2026-12-01', 1, %L) returning id$s$,
    :arak, pg_temp.emp('T-004'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.dev@arak-sa.com')),
  'row-level security');
select pg_temp.refused('leave: a request starts pending', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, status, created_by) values (%L, %L, %L, '2026-12-01', '2026-12-01', 1, 'approved', %L) returning id$s$,
    :arak, pg_temp.emp('T-004'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.admin@arak-sa.com')),
  'HR_LEAVE_TRANSITION');
select pg_temp.refused('leave: no more days than the calendar span', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, created_by) values (%L, %L, %L, '2026-12-01', '2026-12-02', 3, %L) returning id$s$,
    :arak, pg_temp.emp('T-004'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.admin@arak-sa.com')),
  'hr_leave_requests_days');
select pg_temp.refused('leave: overlapping requests are refused', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, created_by) values (%L, %L, %L, '2026-11-18', '2026-11-22', 2, %L) returning id$s$,
    :arak, pg_temp.emp('T-006'), pg_temp.typ('Sick leave'), pg_temp.uid('staff.admin@arak-sa.com')),
  'HR_LEAVE_OVERLAP');
select pg_temp.refused('leave: someone who has left gets no new request', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, created_by) values (%L, %L, %L, '2026-12-01', '2026-12-01', 1, %L) returning id$s$,
    :arak, pg_temp.emp('T-009'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.admin@arak-sa.com')),
  'HR_EMPLOYEE_NOT_ACTIVE');
select pg_temp.refused('leave: a type of another company is refused', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, created_by) values (%L, %L, (select id from public.hr_leave_types where workspace_id = %L limit 1), '2026-12-01', '2026-12-01', 1, %L) returning id$s$,
    :arak, pg_temp.emp('T-004'), current_setting('hr.ghusn'), pg_temp.uid('staff.admin@arak-sa.com')),
  'hr_leave_requests_type_fk');
select pg_temp.eq('leave: a direct update changes nothing (decisions go through hr_leave_decide)',
  pg_temp.q('staff.admin@arak-sa.com', $s$with u as (update public.hr_leave_requests set status = 'approved' where status = 'pending' returning 1) select count(*) from u$s$), '0');

-- Requests for the decision tests: Omar (T-003, tariq's own) asks 3 days; a
-- 30-day one that the balance cannot cover; the GM (nasser's own) asks 1.
select pg_temp.q('staff.dev@arak-sa.com', format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason, created_by) values (%L, %L, %L, '2026-11-08', '2026-11-10', 3, 'decide-me', %L) returning id$s$,
  :arak, pg_temp.emp('T-003'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.dev@arak-sa.com')));
select pg_temp.q('staff.dev@arak-sa.com', format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason, created_by) values (%L, %L, %L, '2027-01-03', '2027-02-05', 30, 'too-long', %L) returning id$s$,
  :arak, pg_temp.emp('T-003'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.dev@arak-sa.com')));
select pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason, created_by) values (%L, %L, %L, '2026-11-24', '2026-11-24', 1, 'gm-own', %L) returning id$s$,
  :arak, pg_temp.emp('T-001'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.admin@arak-sa.com')));
-- A pending request of the site technician (T-006), whose manager is not linked to anyone here.
select pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason, created_by) values (%L, %L, %L, '2026-12-13', '2026-12-13', 1, 'not-mine', %L) returning id$s$,
  :arak, pg_temp.emp('T-006'), pg_temp.typ('Sick leave'), pg_temp.uid('staff.admin@arak-sa.com')));
create function pg_temp.req(p_reason text) returns uuid as $$ select id from public.hr_leave_requests where reason = p_reason $$ language sql;


-- ══ Leave: deciding (his hr.leave_approve is Manage; a direct manager decides nothing) ══
select pg_temp.refused('decide: Work who is not the manager cannot approve', 'staff.dev@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('not-mine')), 'HR_LEAVE_NOT_APPROVER');
select pg_temp.refused('decide: nobody decides their own (even the access admin)', 'staff.ceo@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('gm-own')), 'HR_LEAVE_SELF_DECISION');
select pg_temp.refused('decide: nobody decides their own (Work)', 'staff.dev@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('decide-me')), 'HR_LEAVE_SELF_DECISION');
select pg_temp.refused('decide: a rejection says why', 'staff.admin@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''reject'', ''  '')', :arak, pg_temp.req('decide-me')), 'HR_LEAVE_REJECT_WHY');
select pg_temp.refused('decide: the balance must cover it', 'staff.admin@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('too-long')), 'HR_LEAVE_BALANCE');
select pg_temp.refused('decide: the request must be in the company named', 'staff.admin@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', current_setting('hr.ghusn'), pg_temp.req('decide-me')), 'HR_NOT_FOUND');
select pg_temp.refused('decide: a View person who is not the manager cannot', 'staff.marketing@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('not-mine')), 'HR_LEAVE_NOT_APPROVER');
select pg_temp.refused('decide: nor can the direct manager (his app has no manager path)', 'staff.marketing@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('decide-me')), 'HR_LEAVE_NOT_APPROVER');
select pg_temp.eq('decide: Manage approves',
  pg_temp.q('staff.admin@arak-sa.com', format('select status from public.hr_leave_decide(%L, %L, ''approve'', ''Enjoy'')', :arak, pg_temp.req('decide-me'))), 'approved');
select pg_temp.eq('decide: the approver is recorded',
  (select decided_by from public.hr_leave_requests where reason = 'decide-me'), pg_temp.uid('staff.admin@arak-sa.com'));
select pg_temp.refused('decide: a decided request is not decided again', 'staff.admin@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''reject'', ''no'')', :arak, pg_temp.req('decide-me')), 'HR_LEAVE_TRANSITION');
-- ── The ledger of allocations ──
select pg_temp.eq('ledger: the first port''s balances became allocations (21 for the year)',
  (select sum(days)::text from public.hr_leave_allocations where employee_id = pg_temp.emp('T-003') and leave_type_id = pg_temp.typ('Annual leave')), '21.00');
select pg_temp.eq('balance: 21 granted − 5 − 3 approved = 13 (the person themselves reads it)',
  pg_temp.q('staff.dev@arak-sa.com', format('select public.hr_leave_balance_on(%L, %L, ''2026-12-01'')', pg_temp.emp('T-003'), pg_temp.typ('Annual leave'))), '13.00');
select pg_temp.eq('balance: Manage reads anyone''s',
  pg_temp.q('staff.admin@arak-sa.com', format('select public.hr_leave_balance_on(%L, %L, ''2026-12-01'')', pg_temp.emp('T-003'), pg_temp.typ('Annual leave'))), '13.00');
select pg_temp.eq('balance: a colleague (View) cannot read someone else''s',
  pg_temp.q('staff.marketing@arak-sa.com', format('select public.hr_leave_balance_on(%L, %L, ''2026-12-01'')', pg_temp.emp('T-003'), pg_temp.typ('Annual leave'))), null::text);
select pg_temp.eq('balance: outside every window nothing is left',
  pg_temp.q('staff.admin@arak-sa.com', format('select public.hr_leave_balance_on(%L, %L, ''2027-01-03'')', pg_temp.emp('T-003'), pg_temp.typ('Annual leave'))), '0');
select pg_temp.eq('ledger: the person reads their own allocations, a colleague none',
  pg_temp.q('staff.dev@arak-sa.com', 'select count(*) from public.hr_leave_allocations where employee_id = (select id from public.hr_employees where employee_no = ''T-003'')') || '/' ||
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from public.hr_leave_allocations where employee_id = (select id from public.hr_employees where employee_no = ''T-003'')'), '2/0');
select pg_temp.refused('ledger: Work cannot grant', 'staff.dev@arak-sa.com',
  format($s$select public.hr_leave_allocate(%L, %L, %L, 5, '2026-01-01', '2026-12-31', 'x')$s$, :arak, pg_temp.emp('T-003'), pg_temp.typ('Annual leave')), 'HR_NOT_ALLOWED');
select pg_temp.refused('ledger: nobody inserts an allocation directly', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_leave_allocations (workspace_id, employee_id, leave_type_id, days, valid_from, valid_to, reason) values (%L, %L, %L, 5, '2026-01-01', '2026-12-31', 'x')$s$, :arak, pg_temp.emp('T-003'), pg_temp.typ('Annual leave')), 'permission denied');
select pg_temp.refused('ledger: a reason must be written', 'staff.admin@arak-sa.com',
  format($s$select public.hr_leave_allocate(%L, %L, %L, 5, '2026-01-01', '2026-12-31', '  ')$s$, :arak, pg_temp.emp('T-003'), pg_temp.typ('Annual leave')), 'hr_leave_allocations_reason_check');
select pg_temp.refused('ledger: zero days is not an allocation', 'staff.admin@arak-sa.com',
  format($s$select public.hr_leave_allocate(%L, %L, %L, 0, '2026-01-01', '2026-12-31', 'x')$s$, :arak, pg_temp.emp('T-003'), pg_temp.typ('Annual leave')), 'hr_leave_allocations_days_check');
select pg_temp.refused('ledger: the window runs forward', 'staff.admin@arak-sa.com',
  format($s$select public.hr_leave_allocate(%L, %L, %L, 5, '2026-12-31', '2026-01-01', 'x')$s$, :arak, pg_temp.emp('T-003'), pg_temp.typ('Annual leave')), 'hr_leave_allocations_dates');
select pg_temp.refused('ledger: a type of another company is refused', 'staff.admin@arak-sa.com',
  format($s$select public.hr_leave_allocate(%L, %L, (select id from public.hr_leave_types where workspace_id = %L limit 1), 5, '2026-01-01', '2026-12-31', 'x')$s$, :arak, pg_temp.emp('T-003'), current_setting('hr.ghusn')), 'HR_NOT_FOUND');
select pg_temp.eq('ledger: Manage corrects with a negative entry and its reason',
  pg_temp.q('staff.admin@arak-sa.com', format($s$select public.hr_leave_allocate(%L, %L, %L, -2, '2026-01-01', '2026-12-31', 'Correction (test)')$s$, :arak, pg_temp.emp('T-003'), pg_temp.typ('Annual leave'))), '1');
select pg_temp.eq('ledger: ...and the balance follows (13 − 2)',
  pg_temp.q('staff.admin@arak-sa.com', format('select public.hr_leave_balance_on(%L, %L, ''2026-12-01'')', pg_temp.emp('T-003'), pg_temp.typ('Annual leave'))), '11.00');
select pg_temp.eq('ledger: who granted it is recorded',
  (select approved_by from public.hr_leave_allocations where reason = 'Correction (test)'), pg_temp.uid('staff.admin@arak-sa.com'));
do $$ begin
  update public.hr_leave_allocations set days = 99 where reason = 'Correction (test)';
  insert into t (name, ok, detail) values ('ledger: an allocation is never edited (even below the app)', false, 'update went through');
exception when others then
  insert into t (name, ok, detail) values ('ledger: an allocation is never edited (even below the app)', sqlerrm like 'HR_ALLOCATION_IMMUTABLE%', sqlerrm);
end $$;
do $$ begin
  delete from public.hr_leave_allocations where reason = 'Correction (test)';
  insert into t (name, ok, detail) values ('ledger: ...nor deleted', false, 'delete went through');
exception when others then
  insert into t (name, ok, detail) values ('ledger: ...nor deleted', sqlerrm like 'HR_ALLOCATION_IMMUTABLE%', sqlerrm);
end $$;
select pg_temp.eq('ledger: "all active employees" grants each one separately',
  pg_temp.q('staff.admin@arak-sa.com', format($s$select public.hr_leave_allocate(%L, null, %L, 1, '2030-01-01', '2030-12-31', 'Bulk (test)')$s$, :arak, pg_temp.typ('Annual leave'))),
  (select count(*)::text from public.hr_employees where workspace_id = :arak and status = 'active'));
select pg_temp.eq('ledger: ...as separate entries, one per person',
  (select count(distinct employee_id)::text || '/' || count(*)::text from public.hr_leave_allocations where reason = 'Bulk (test)'),
  (select count(*)::text || '/' || count(*)::text from public.hr_employees where workspace_id = :arak and status = 'active'));
select pg_temp.eq('ledger: the first port''s balance table is closed to the app',
  pg_temp.err('staff.admin@arak-sa.com', 'select count(*) from public.hr_leave_balances') like '%permission denied%', true);
select pg_temp.refused('leave types: paid / keeps-a-balance are fixed once made', 'staff.admin@arak-sa.com',
  format($s$update public.hr_leave_types set paid = false where id = %L returning id$s$, pg_temp.typ('Annual leave')), 'HR_LEAVE_TYPE_LOCKED');
select pg_temp.eq('leave types: a name can still be fixed',
  pg_temp.q('staff.admin@arak-sa.com', format($s$update public.hr_leave_types set name_ar = 'إجازة سنوية' where id = %L returning name_ar$s$, pg_temp.typ('Annual leave'))), 'إجازة سنوية');
-- ── Cancelling ──
select pg_temp.refused('cancel: Work cannot cancel approved leave', 'staff.dev@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''cancel'')', :arak, pg_temp.req('decide-me')), 'HR_LEAVE_NOT_APPROVER');
select pg_temp.eq('cancel: Manage cancels approved leave',
  pg_temp.q('staff.admin@arak-sa.com', format('select status from public.hr_leave_decide(%L, %L, ''cancel'', ''Plans changed'')', :arak, pg_temp.req('decide-me'))), 'cancelled');
select pg_temp.eq('cancel: the employee withdraws their own pending request',
  pg_temp.q('staff.dev@arak-sa.com', format('select status from public.hr_leave_decide(%L, %L, ''cancel'')', :arak, pg_temp.req('too-long'))), 'cancelled');
select pg_temp.refused('cancel: a View person cannot cancel someone else''s', 'staff.marketing@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''cancel'')', :arak, pg_temp.req('Personal errand (test)')), 'HR_LEAVE_NOT_YOURS');
select pg_temp.refused('cancel: nor can Work (attendance)', 'staff.dev@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''cancel'')', :arak, pg_temp.req('Personal errand (test)')), 'HR_LEAVE_NOT_YOURS');
select pg_temp.eq('decide: Manage rejects with a reason',
  pg_temp.q('staff.admin@arak-sa.com', format('select status || '':'' || decision_note from public.hr_leave_decide(%L, %L, ''reject'', ''Busy week'')', :arak, pg_temp.req('Personal errand (test)'))), 'rejected:Busy week');
select pg_temp.refused('decide: signed out cannot call it', null,
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('not-mine')), 'permission denied');

-- ══ Attendance: sessions (20261128_attendance_1) ══
-- A clean day for the manual checks: last Friday (no seed attendance), and
-- a Riyadh moment on it.
create function pg_temp.fri() returns date as $$ select hr_today() - (((extract(dow from hr_today())::int - 5 + 7) % 7) + case when extract(dow from hr_today()) = 5 then 7 else 0 end) $$ language sql;
create function pg_temp.at(p_day date, p_time text) returns text as $$ select ((p_day + p_time::time) at time zone 'Asia/Riyadh')::text $$ language sql;
create function pg_temp.ins(p_no text, p_in text, p_out text) returns text as $$
  select format($s$insert into public.hr_attendance (workspace_id, employee_id, check_in, check_out, created_by) values ('00000000-0000-0000-0000-000000000001', %L, %L, %L, auth.uid()) returning id$s$,
                pg_temp.emp(p_no), p_in, p_out)
$$ language sql;

select pg_temp.refused('attendance: View cannot record', 'staff.marketing@arak-sa.com',
  pg_temp.ins('T-005', pg_temp.at(pg_temp.fri(), '08:00'), pg_temp.at(pg_temp.fri(), '12:00')), 'row-level security');
select pg_temp.refused('attendance: not in the future', 'staff.dev@arak-sa.com',
  pg_temp.ins('T-005', pg_temp.at(hr_today() + 1, '08:00'), null), 'HR_ATTENDANCE_FUTURE');
select pg_temp.refused('attendance: only for someone employed', 'staff.dev@arak-sa.com',
  pg_temp.ins('T-009', pg_temp.at('2026-06-01', '08:00'), pg_temp.at('2026-06-01', '12:00')), 'HR_ATTENDANCE_NOT_EMPLOYED');
select pg_temp.refused('attendance: not on approved leave', 'staff.dev@arak-sa.com',
  pg_temp.ins('T-005', pg_temp.at('2026-10-12', '08:00'), pg_temp.at('2026-10-12', '12:00')), 'HR_ATTENDANCE_ON_LEAVE');
select pg_temp.refused('attendance: leaving is after arriving', 'staff.dev@arak-sa.com',
  pg_temp.ins('T-005', pg_temp.at(pg_temp.fri(), '08:00'), pg_temp.at(pg_temp.fri(), '07:00')), 'hr_attendance_span');
select pg_temp.refused('attendance: at most 24 hours', 'staff.dev@arak-sa.com',
  pg_temp.ins('T-005', pg_temp.at(pg_temp.fri() - 7, '08:00'), pg_temp.at(pg_temp.fri() - 6, '09:00')), 'hr_attendance_span');
select pg_temp.eq('attendance: Work records a session',
  (pg_temp.q('staff.dev@arak-sa.com', pg_temp.ins('T-005', pg_temp.at(pg_temp.fri(), '08:00'), pg_temp.at(pg_temp.fri(), '12:30'))) is not null), true);
select pg_temp.eq('attendance: ...its day is Riyadh''s date of the check-in, its hours worked out',
  (select day::text || ':' || worked_hours::text from public.hr_attendance where employee_id = pg_temp.emp('T-005') and check_in = pg_temp.at(pg_temp.fri(), '08:00')::timestamptz),
  pg_temp.fri()::text || ':4.50');
select pg_temp.eq('attendance: several sessions a day',
  (pg_temp.q('staff.dev@arak-sa.com', pg_temp.ins('T-005', pg_temp.at(pg_temp.fri(), '13:30'), pg_temp.at(pg_temp.fri(), '16:00'))) is not null), true);
select pg_temp.refused('attendance: no overlap with another session', 'staff.dev@arak-sa.com',
  pg_temp.ins('T-005', pg_temp.at(pg_temp.fri(), '12:00'), pg_temp.at(pg_temp.fri(), '14:00')), 'HR_ATTENDANCE_OVERLAP');
select pg_temp.refused('attendance: nobody records a device record by hand', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_attendance (workspace_id, employee_id, check_in, check_out, source, device_day, created_by) values (%L, %L, %L, %L, 'device', %L, auth.uid())$s$,
    :arak, pg_temp.emp('T-005'), pg_temp.at(pg_temp.fri() - 7, '08:00'), pg_temp.at(pg_temp.fri() - 7, '09:00'), pg_temp.fri() - 7), 'row-level security');
create function pg_temp.att(p_no text, p_day date) returns uuid as $$ select id from public.hr_attendance where employee_id = pg_temp.emp(p_no) and day = p_day order by check_in limit 1 $$ language sql;
select pg_temp.eq('attendance: a direct update changes nothing (corrections go through hr_attendance_update)',
  pg_temp.q('staff.dev@arak-sa.com', format($s$with u as (update public.hr_attendance set notes = 'x' where id = %L returning 1) select count(*) from u$s$, pg_temp.att('T-005', pg_temp.fri()))), '0');
select pg_temp.refused('attendance: a correction needs a reason', 'staff.dev@arak-sa.com',
  format($s$select id from public.hr_attendance_update(%L, %L, %L, %L, '  ')$s$, :arak, pg_temp.att('T-005', pg_temp.fri()), pg_temp.at(pg_temp.fri(), '08:10'), pg_temp.at(pg_temp.fri(), '12:30')), 'HR_ATTENDANCE_REASON');
select pg_temp.refused('attendance: View cannot correct', 'staff.marketing@arak-sa.com',
  format($s$select id from public.hr_attendance_update(%L, %L, %L, %L, 'x')$s$, :arak, pg_temp.att('T-005', pg_temp.fri()), pg_temp.at(pg_temp.fri(), '08:10'), pg_temp.at(pg_temp.fri(), '12:30')), 'HR_NO_ACCESS');
select pg_temp.refused('attendance: a correction names the right company', 'staff.dev@arak-sa.com',
  format($s$select id from public.hr_attendance_update(%L, %L, %L, %L, 'x')$s$, current_setting('hr.ghusn'), pg_temp.att('T-005', pg_temp.fri()), pg_temp.at(pg_temp.fri(), '08:10'), pg_temp.at(pg_temp.fri(), '12:30')), 'HR_NO_ACCESS');
select pg_temp.eq('attendance: Work corrects with a reason',
  pg_temp.q('staff.dev@arak-sa.com', format($s$select worked_hours::text || ':' || notes from public.hr_attendance_update(%L, %L, %L, %L, 'Gate log shows 08:10')$s$,
    :arak, pg_temp.att('T-005', pg_temp.fri()), pg_temp.at(pg_temp.fri(), '08:10'), pg_temp.at(pg_temp.fri(), '12:30'))), '4.33:Gate log shows 08:10');
select pg_temp.eq('attendance: who corrected is on the record, before and after in the history',
  (select (a.corrected_by = pg_temp.uid('staff.dev@arak-sa.com'))::text || ':' || (c.before->>'check_in' < c.after->>'check_in')::text
     from public.hr_attendance a join public.hr_attendance_changes c on c.attendance_id = a.id where a.id = pg_temp.att('T-005', pg_temp.fri())), 'true:true');
select pg_temp.eq('attendance: nobody deletes a record (it is corrected)',
  pg_temp.q('staff.admin@arak-sa.com', format($s$with d as (delete from public.hr_attendance where id = %L returning 1) select count(*) from d$s$, pg_temp.att('T-005', pg_temp.fri()))), '0');
-- The board button: someone not on a device, with no open record (rolled back).
update public.hr_attendance set check_out = check_in + interval '1 minute' where employee_id = pg_temp.emp('T-001') and check_out is null;
select pg_temp.eq('attendance: the board button checks in now',
  pg_temp.q('staff.dev@arak-sa.com', format('select public.hr_attendance_toggle(%L, %L)', :arak, pg_temp.emp('T-001'))), 'in');
select pg_temp.refused('attendance: one open record at a time', 'staff.dev@arak-sa.com',
  pg_temp.ins('T-001', (now() - interval '1 minute')::text, null), 'HR_ATTENDANCE_OVERLAP');
select pg_temp.eq('attendance: ...and the second press checks out',
  pg_temp.q('staff.dev@arak-sa.com', format('select public.hr_attendance_toggle(%L, %L)', :arak, pg_temp.emp('T-001'))), 'out');
select pg_temp.refused('attendance: View cannot press it', 'staff.marketing@arak-sa.com',
  format('select public.hr_attendance_toggle(%L, %L)', :arak, pg_temp.emp('T-001')), 'HR_NO_ACCESS');

-- ══ Attendance devices (20261128_attendance_2) ══
-- Settings for the pairing and lateness: 08:00–17:00, 15 minutes' grace, from 1 September.
update public.hr_settings set daily_hours = 9, schedule_from = '2026-09-01', repeat_punch_minutes = 3 where workspace_id = :arak;
-- Clean days for the device: the last Wednesday and Thursday before today, without seed sessions for T-007.
-- A day of that weekday at least a week back: always past, and past the three days an early-leave email waits.
create function pg_temp.dow(p int) returns date as $$ select hr_today() - 7 - ((extract(dow from hr_today())::int - p + 7) % 7) $$ language sql;
delete from public.hr_attendance where employee_id in (pg_temp.emp('T-007'), pg_temp.emp('T-004')) and day in (pg_temp.dow(3), pg_temp.dow(4));

select pg_temp.refused('devices: Work cannot register one', 'staff.dev@arak-sa.com',
  format($s$select public.hr_device_add(%L, 'Door (test)', 'Asia/Riyadh')$s$, :arak), 'HR_NO_ACCESS');
select pg_temp.refused('devices: an unknown time zone is refused', 'staff.admin@arak-sa.com',
  format($s$select public.hr_device_add(%L, 'Door (test)', 'Mars/Olympus')$s$, :arak), 'HR_DEVICE_TIMEZONE');
select set_config('hr.key', pg_temp.q('staff.admin@arak-sa.com', format($s$select public.hr_device_add(%L, 'Door (test)', 'Asia/Riyadh') ->> 'key'$s$, :arak)), true);
select set_config('hr.device', split_part(substr(current_setting('hr.key'), 6), '-', 1) || '-' || split_part(substr(current_setting('hr.key'), 6), '-', 2) || '-' ||
  split_part(substr(current_setting('hr.key'), 6), '-', 3) || '-' || split_part(substr(current_setting('hr.key'), 6), '-', 4) || '-' || split_part(substr(current_setting('hr.key'), 6), '-', 5), true);
select pg_temp.eq('devices: the key is shown once and only its hash is kept',
  (select key_hash = encode(sha256(convert_to(right(current_setting('hr.key'), 40), 'UTF8')), 'hex') and key_hint = right(current_setting('hr.key'), 4)
     from public.hr_devices where id = current_setting('hr.device')::uuid), true);
select pg_temp.refused('devices: nobody reads the key''s hash', 'staff.admin@arak-sa.com',
  'select key_hash from public.hr_devices limit 1', 'permission denied');
select pg_temp.eq('devices: View sees the device list',
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from public.hr_devices where name = ''Door (test)'''), '1');
select pg_temp.refused('devices: a wrong key is refused', null,
  $s$select public.hr_device_sync('ARK1-00000000-0000-0000-0000-000000000000-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{"punches": []}')$s$, 'HR_DEVICE_KEY');
select pg_temp.refused('devices: an unreadable punch refuses the batch', null,
  format($s$select public.hr_device_sync(%L, '{"punches": [{"user_no": "7", "time": "yesterday"}]}')$s$, current_setting('hr.key')), 'HR_DEVICE_PUNCH_UNREADABLE');
select pg_temp.eq('devices: the bridge sends a batch with the key, no login',
  pg_temp.q(null, format($s$select r ->> 'inserted' || '/' || (r ->> 'duplicates') || '/' || (r ->> 'rejected') from public.hr_device_sync(%L, %L::jsonb) r$s$, current_setting('hr.key'),
    json_build_object(
      'device', json_build_object('serial', 'TEST123', 'model', 'K40', 'firmware', 'Ver 6.60', 'time', to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI:SS')),
      'users', json_build_array(json_build_object('no', '7', 'name', 'HUDA', 'enabled', true), json_build_object('no', '4', 'name', 'KHALID', 'enabled', true),
                                json_build_object('no', '99', 'name', 'VISITOR', 'enabled', true)),
      'punches', json_build_array(
        -- T-007 (number 7), Wednesday: 08:20 in (late 20), 16:30 out (early 30).
        json_build_object('user_no', '7', 'time', to_char(pg_temp.dow(3), 'YYYY-MM-DD') || ' 8:20:0', 'verify', 1, 'inout', 0),
        json_build_object('user_no', '7', 'time', to_char(pg_temp.dow(3), 'YYYY-MM-DD') || ' 16:30:00', 'verify', 1, 'inout', 1),
        -- T-007, Thursday: 07:58 and again a minute later (one punch pressed twice) only.
        json_build_object('user_no', '7', 'time', to_char(pg_temp.dow(4), 'YYYY-MM-DD') || ' 07:58:00'),
        json_build_object('user_no', '7', 'time', to_char(pg_temp.dow(4), 'YYYY-MM-DD') || ' 07:59:00'),
        -- T-004 (number 4), Thursday: a normal day.
        json_build_object('user_no', '4', 'time', to_char(pg_temp.dow(4), 'YYYY-MM-DD') || ' 07:50:00'),
        json_build_object('user_no', '4', 'time', to_char(pg_temp.dow(4), 'YYYY-MM-DD') || ' 17:05:00'),
        -- An unlinked number, and a punch in the future (the device clock ahead).
        json_build_object('user_no', '99', 'time', to_char(pg_temp.dow(4), 'YYYY-MM-DD') || ' 09:00:00'),
        json_build_object('user_no', '7', 'time', to_char(now() at time zone 'Asia/Riyadh' + interval '1 day', 'YYYY-MM-DD HH24:MI:SS'))
      ))::text)), '7/0/1');
select pg_temp.eq('devices: the same batch again adds nothing',
  pg_temp.q(null, format($s$select r ->> 'inserted' || '/' || (r ->> 'duplicates') from public.hr_device_sync(%L, %L::jsonb) r$s$, current_setting('hr.key'),
    json_build_object('punches', json_build_array(json_build_object('user_no', '4', 'time', to_char(pg_temp.dow(4), 'YYYY-MM-DD') || ' 07:50:00')))::text)), '0/1');
select pg_temp.eq('devices: the sync kept what the device reported',
  (select device_serial || '/' || device_model || '/' || users_reported from public.hr_device_syncs where device_id = current_setting('hr.device')::uuid order by created_at limit 1), 'TEST123/K40/3');
select pg_temp.refused('devices: a punch is never changed', 'staff.admin@arak-sa.com',
  'update public.hr_punches set device_user_no = ''8''', 'permission denied');
do $$ begin
  update public.hr_punches set device_user_no = '8' where device_user_no = '99';
  insert into t (name, ok, detail) values ('devices: punches are final even below the app', false, 'update went through');
exception when others then
  insert into t (name, ok, detail) values ('devices: punches are final even below the app', sqlerrm like 'HR_PUNCH_FINAL%', sqlerrm);
end $$;
select pg_temp.eq('pairing: nothing is paired before the numbers are linked',
  pg_temp.q('staff.marketing@arak-sa.com', format($s$select string_agg(device_user_no || '=' || state, ',' order by device_user_no, state) from public.hr_punch_days where workspace_id = %L and device_name = 'Door (test)'$s$, :arak)),
  '4=unlinked,7=unlinked,7=unlinked,99=unlinked');
select pg_temp.refused('pairing: Work cannot link numbers', 'staff.dev@arak-sa.com',
  format($s$select public.hr_device_link(%L, %L)$s$, :arak, json_build_object('7', pg_temp.emp('T-007'))::text), 'HR_NO_ACCESS');
select pg_temp.refused('pairing: one employee, one number', 'staff.admin@arak-sa.com',
  format($s$select public.hr_device_link(%L, %L)$s$, :arak, json_build_object('7', pg_temp.emp('T-007'), '4', pg_temp.emp('T-007'))::text), 'HR_DEVICE_LINK_TWICE');
select pg_temp.refused('pairing: the number is not set on the employee form', 'staff.admin@arak-sa.com',
  format($s$update public.hr_employees set device_user_no = '7' where id = %L$s$, pg_temp.emp('T-007')), 'HR_DEVICE_LINK_ONLY');
select pg_temp.eq('pairing: linking pairs the days already received',
  pg_temp.q('staff.admin@arak-sa.com', format($s$select r ->> 'changed' || '/' || (r ->> 'paired') from public.hr_device_link(%L, %L) r$s$, :arak,
    json_build_object('7', pg_temp.emp('T-007'), '4', pg_temp.emp('T-004'))::text)), '2/2');
select pg_temp.eq('pairing: first punch in, last punch out, a device record',
  (select to_char(check_in at time zone 'Asia/Riyadh', 'HH24:MI') || '-' || to_char(check_out at time zone 'Asia/Riyadh', 'HH24:MI') || ':' || source
     from public.hr_attendance where employee_id = pg_temp.emp('T-004') and device_day = pg_temp.dow(4)), '07:50-17:05:device');
select pg_temp.eq('pairing: the review shows each day''s state',
  pg_temp.q('staff.marketing@arak-sa.com', format($s$select string_agg(device_user_no || '=' || state, ',' order by device_user_no, state) from public.hr_punch_days where workspace_id = %L and device_name = 'Door (test)'$s$, :arak)),
  '4=applied,7=applied,7=single,99=unlinked');
do $$ begin
  update public.hr_attendance set check_in = check_in - interval '1 hour' where id = pg_temp.att('T-004', pg_temp.dow(4));
  insert into t (name, ok, detail) values ('pairing: a device record''s times are not changed directly', false, 'update went through');
exception when others then
  insert into t (name, ok, detail) values ('pairing: a device record''s times are not changed directly', sqlerrm like 'HR_ATTENDANCE_DEVICE_ONLY%', sqlerrm);
end $$;
select pg_temp.eq('pairing: corrected by a person, it is marked corrected',
  pg_temp.q('staff.dev@arak-sa.com', format($s$select source from public.hr_attendance_update(%L, %L, %L, %L, 'Forgot to punch out; left 17:30')$s$,
    :arak, pg_temp.att('T-004', pg_temp.dow(4)), pg_temp.at(pg_temp.dow(4), '07:50'), pg_temp.at(pg_temp.dow(4), '17:30'))), 'corrected');
select pg_temp.eq('pairing: ...and the pairing never touches it again',
  pg_temp.q('staff.admin@arak-sa.com', format('select public.hr_attendance_retry(%L, %L)', :arak, pg_temp.emp('T-004'))) || ':' ||
  (select to_char(check_out at time zone 'Asia/Riyadh', 'HH24:MI') from public.hr_attendance where id = pg_temp.att('T-004', pg_temp.dow(4))), '0:17:30');
select pg_temp.eq('pairing: the device number is locked once it made records',
  (select pg_temp.err('staff.admin@arak-sa.com', format($s$select public.hr_device_link(%L, %L)$s$, :arak, json_build_object('4', null)::text)) like '%HR_DEVICE_USER_LOCKED%'), true);
select pg_temp.eq('pairing: a stopped device sends nothing',
  pg_temp.q('staff.admin@arak-sa.com', format('update public.hr_devices set active = false where id = %L returning active', current_setting('hr.device'))) || ':' ||
  (select pg_temp.err(null, format($s$select public.hr_device_sync(%L, '{"punches": []}')$s$, current_setting('hr.key'))) like '%HR_DEVICE_INACTIVE%'), 'false:true');
update public.hr_devices set active = true where id = current_setting('hr.device')::uuid;
select pg_temp.eq('pairing: with a device running, the board button refuses a linked person',
  (select pg_temp.err('staff.dev@arak-sa.com', format('select public.hr_attendance_toggle(%L, %L)', :arak, pg_temp.emp('T-007'))) like '%HR_ATTENDANCE_DEVICE_MODE%'), true);
select pg_temp.eq('pairing: a new key stops the old one',
  (select pg_temp.q('staff.admin@arak-sa.com', format('select public.hr_device_rotate_key(%L, %L)', :arak, current_setting('hr.device'))) <> current_setting('hr.key')) and
  (select pg_temp.err(null, format($s$select public.hr_device_sync(%L, '{"punches": []}')$s$, current_setting('hr.key'))) like '%HR_DEVICE_KEY%'), true);
select pg_temp.refused('devices: a device is never deleted', 'staff.admin@arak-sa.com',
  format('delete from public.hr_devices where id = %L', current_setting('hr.device')), 'permission denied');
select pg_temp.eq('devices: other companies see none of it',
  pg_temp.q('outside.two@example.com', 'select (select count(*) from public.hr_devices) + (select count(*) from public.hr_punches) + (select count(*) from public.hr_punch_days)'), '0');

-- ══ Late arrivals and early leaves (20261128_attendance_3) ══
select pg_temp.eq('flags: late counted from the start, early leave from the end; a past day is never emailed',
  pg_temp.q('staff.marketing@arak-sa.com', format($s$select string_agg(kind || ':' || minutes || ':' || email_status, ',' order by kind desc) from public.hr_attendance_flags where employee_id = %L and work_day = %L$s$,
    pg_temp.emp('T-007'), pg_temp.dow(3))), 'late:20:past,early:30:past');
select pg_temp.eq('flags: on time and a full day are not flagged',
  (select count(*) from public.hr_attendance_flags where employee_id = pg_temp.emp('T-004')), 0::bigint);
select pg_temp.eq('flags: one punch is never an early leave',
  (select count(*) from public.hr_attendance_flags where employee_id = pg_temp.emp('T-007') and work_day = pg_temp.dow(4)), 0::bigint);
select pg_temp.refused('flags: Work cannot excuse', 'staff.dev@arak-sa.com',
  format($s$select id from public.hr_attendance_excuse(%L, (select id from public.hr_attendance_flags where employee_id = %L and kind = 'late' limit 1), 'Traffic')$s$, :arak, pg_temp.emp('T-007')), 'HR_NO_ACCESS');
select pg_temp.refused('flags: an excuse needs its reason', 'staff.admin@arak-sa.com',
  format($s$select id from public.hr_attendance_excuse(%L, (select id from public.hr_attendance_flags where employee_id = %L and kind = 'late' limit 1), ' ')$s$, :arak, pg_temp.emp('T-007')), 'HR_FLAG_EXCUSE_REASON');
select pg_temp.eq('flags: Manage excuses with a reason',
  pg_temp.q('staff.admin@arak-sa.com', format($s$select excuse_reason from public.hr_attendance_excuse(%L, (select id from public.hr_attendance_flags where employee_id = %L and kind = 'late' limit 1), 'Hospital appointment')$s$, :arak, pg_temp.emp('T-007'))), 'Hospital appointment');
select pg_temp.eq('flags: an excuse stays as recorded',
  (select pg_temp.err('staff.admin@arak-sa.com', format($s$select id from public.hr_attendance_excuse(%L, (select id from public.hr_attendance_flags where employee_id = %L and kind = 'late' limit 1), 'Other')$s$, :arak, pg_temp.emp('T-007'))) like '%HR_FLAG_FINAL%'), true);
select pg_temp.eq('flags: the email switch cannot be turned on without the HR mailbox',
  (select pg_temp.err('staff.admin@arak-sa.com', format('update public.hr_settings set employee_emails = true where workspace_id = %L returning 1', :arak)) like '%HR_MAILBOX_NOT_CONNECTED%'), true);

-- ══ Parity pass: job positions, parent departments, the personal file, history, files, deleting ══
select pg_temp.eq('positions: every title on file became a position the person points at',
  (select count(*) from public.hr_employees where workspace_id = :arak and job_id is null and trim(job_title) <> '')::text, '0');
select pg_temp.refused('positions: Work cannot add one', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_job_positions (workspace_id, name_en, created_by) values (%L, 'Driver 2 (test)', %L) returning id$s$, :arak, pg_temp.uid('staff.dev@arak-sa.com')),
  'row-level security');
select pg_temp.eq('positions: View reads the list',
  pg_temp.q('staff.marketing@arak-sa.com', format('select count(*) > 5 from public.hr_job_positions where workspace_id = %L', :arak)), 'true');
select pg_temp.eq('positions: Manage adds one under a department',
  pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.hr_job_positions (workspace_id, name_en, name_ar, department_id, description, created_by) values (%L, 'Draughtsman (test)', 'رسام (تجربة)', (select id from public.hr_departments where name_en = 'Projects (test)' and workspace_id = %L), 'Drawings', %L) returning name_en$s$, :arak, :arak, pg_temp.uid('staff.admin@arak-sa.com'))),
  'Draughtsman (test)');
select pg_temp.refused('positions: names are unique in a company', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_job_positions (workspace_id, name_en, created_by) values (%L, 'draughtsman (TEST)', %L) returning id$s$, :arak, pg_temp.uid('staff.admin@arak-sa.com')),
  'hr_job_positions_name_en_uq');
select pg_temp.refused('positions: a department of another company is refused', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_job_positions (workspace_id, name_en, department_id, created_by) values (%L, 'Z (test)', (select id from public.hr_departments where workspace_id = %L limit 1), %L) returning id$s$, :arak, current_setting('hr.ghusn'), pg_temp.uid('staff.admin@arak-sa.com')),
  'hr_job_positions_department_fk');
select pg_temp.eq('positions: the employee''s title follows the position',
  pg_temp.q('staff.admin@arak-sa.com', format($s$with p as (update public.hr_employees set job_id = (select id from public.hr_job_positions where name_en = 'Draughtsman (test)') where employee_no = 'T-100' returning job_title) select job_title from p$s$)),
  'Draughtsman (test)');
select pg_temp.q('staff.admin@arak-sa.com', $s$update public.hr_job_positions set name_en = 'Senior Draughtsman (test)' where name_en = 'Draughtsman (test)' returning 1$s$);
select pg_temp.eq('positions: ...and a rename follows through to the people',
  (select job_title from public.hr_employees where employee_no = 'T-100'), 'Senior Draughtsman (test)');
select pg_temp.refused('positions: a position of another company is refused', 'staff.admin@arak-sa.com',
  format($s$update public.hr_employees set job_id = (select id from public.hr_job_positions where workspace_id = %L limit 1) where employee_no = 'T-100' returning id$s$, current_setting('hr.ghusn')),
  'hr_employees_job_fk');
select pg_temp.refused('employees: employment type is one of three', 'staff.admin@arak-sa.com',
  $s$update public.hr_employees set employment_type = 'slave' where employee_no = 'T-100' returning id$s$, 'hr_employees_employment_type');
select pg_temp.eq('employees: trade, employment type and labour kind are kept',
  pg_temp.q('staff.admin@arak-sa.com', $s$update public.hr_employees set trade = 'Electrician', employment_type = 'part_time', is_direct_labor = false where employee_no = 'T-100' returning trade || ':' || employment_type || ':' || is_direct_labor$s$), 'Electrician:part_time:false');
select pg_temp.eq('departments: Manage gives one a parent',
  pg_temp.q('staff.admin@arak-sa.com', format($s$update public.hr_departments set parent_id = (select id from public.hr_departments where name_en = 'Administration (test)' and workspace_id = %L) where name_en = 'Warehouse (test)' and workspace_id = %L returning 1$s$, :arak, :arak)), '1');
select pg_temp.refused('departments: a loop of parents is refused', 'staff.admin@arak-sa.com',
  format($s$update public.hr_departments set parent_id = (select id from public.hr_departments where name_en = 'Warehouse (test)' and workspace_id = %L) where name_en = 'Administration (test)' and workspace_id = %L returning 1$s$, :arak, :arak),
  'HR_DEPARTMENT_LOOP');
select pg_temp.refused('departments: a parent of another company is refused', 'staff.admin@arak-sa.com',
  format($s$update public.hr_departments set parent_id = (select id from public.hr_departments where workspace_id = %L limit 1) where name_en = 'Warehouse (test)' and workspace_id = %L returning 1$s$, current_setting('hr.ghusn'), :arak),
  'hr_departments_parent_fk');

-- The personal file: Manage only.
select pg_temp.eq('personal: View and Work read none',
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from public.hr_employee_private') || '/' || pg_temp.q('staff.dev@arak-sa.com', 'select count(*) from public.hr_employee_private'), '0/0');
select pg_temp.refused('personal: Work cannot write it', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_employee_private (workspace_id, employee_id, nationality) values (%L, %L, 'X')$s$, :arak, pg_temp.emp('T-004')), 'row-level security');
select pg_temp.eq('personal: Manage writes it',
  pg_temp.q('staff.admin@arak-sa.com', format($s$insert into public.hr_employee_private (workspace_id, employee_id, nationality, id_type, id_number, birth_date, gender, mobile, emergency_contact, emergency_phone, address, notes) values (%L, %L, 'Saudi', 'national_id', '1999999999', '1990-05-01', 'm', '0500000000', 'Brother (test)', '0511111111', 'Riyadh (test)', 'private note') returning nationality$s$, :arak, pg_temp.emp('T-004'))),
  'Saudi');
select pg_temp.refused('personal: an identity number needs its type', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_employee_private (workspace_id, employee_id, id_number) values (%L, %L, '123')$s$, :arak, pg_temp.emp('T-005')), 'hr_employee_private_id_typed');
select pg_temp.refused('personal: one person per identity', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_employee_private (workspace_id, employee_id, id_type, id_number) values (%L, %L, 'national_id', '1999999999')$s$, :arak, pg_temp.emp('T-005')), 'hr_employee_private_identity_uq');
select pg_temp.refused('personal: a birth date is in the past', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_employee_private (workspace_id, employee_id, birth_date) values (%L, %L, hr_today() + 1)$s$, :arak, pg_temp.emp('T-005')), 'HR_BIRTH_DATE');
select pg_temp.refused('personal: an employee of another company is refused', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_employee_private (workspace_id, employee_id) values (%L, %L)$s$, :arak, pg_temp.emp('G-001')), 'hr_employee_private_employee_fk');

-- History.
select pg_temp.eq('history: Manage reads the changes of a person (employee, personal file, contract)',
  pg_temp.q('staff.admin@arak-sa.com', format($s$select string_agg(distinct table_name, ',' order by table_name) from public.hr_audit where employee_id = %L$s$, pg_temp.emp('T-004'))),
  'hr_contracts,hr_documents,hr_employee_private,hr_employees');
select pg_temp.eq('history: ...who and what',
  pg_temp.q('staff.admin@arak-sa.com', format($s$select (changed_by = %L)::text || ':' || action from public.hr_audit where table_name = 'hr_employees' and employee_id = %L and action = 'update' order by id desc limit 1$s$, pg_temp.uid('staff.admin@arak-sa.com'), pg_temp.emp('T-100'))),
  'true:update');
select pg_temp.eq('history: View and Work read none',
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from public.hr_audit') || '/' || pg_temp.q('staff.dev@arak-sa.com', 'select count(*) from public.hr_audit'), '0/0');
select pg_temp.refused('history: nobody writes it by hand', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_audit (workspace_id, table_name, row_id, action) values (%L, 'x', gen_random_uuid(), 'insert')$s$, :arak), 'permission denied');

-- Files of papers (the bucket and its folder rule).
select pg_temp.eq('files: the bucket is private and limited to scans and photos',
  (select (not public)::text || ':' || file_size_limit::text from storage.buckets where id = 'hr-papers'), 'true:10485760');
select pg_temp.eq('files: Manage may use a person''s folder, Work and outsiders may not',
  pg_temp.q('staff.admin@arak-sa.com', format($s$select public.hr_papers_folder_ok(%L, true)$s$, :arak || '/' || pg_temp.emp('T-004')::text || '/a.pdf')) || '/' ||
  pg_temp.q('staff.dev@arak-sa.com', format($s$select public.hr_papers_folder_ok(%L, false)$s$, :arak || '/' || pg_temp.emp('T-004')::text || '/a.pdf')) || '/' ||
  pg_temp.q('outside.two@example.com', format($s$select public.hr_papers_folder_ok(%L, false)$s$, :arak || '/' || pg_temp.emp('T-004')::text || '/a.pdf')),
  'true/false/false');
select pg_temp.eq('files: a person may read their own folder but not write it',
  pg_temp.q('staff.dev@arak-sa.com', format($s$select public.hr_papers_folder_ok(%L, false)::text || public.hr_papers_folder_ok(%L, true)::text$s$, :arak || '/' || pg_temp.emp('T-003')::text || '/a.pdf', :arak || '/' || pg_temp.emp('T-003')::text || '/a.pdf')),
  'truefalse');
select pg_temp.eq('files: a path that is not two ids reaches nobody',
  pg_temp.q('staff.admin@arak-sa.com', $s$select public.hr_papers_folder_ok('nonsense/a.pdf', true)::text || public.hr_papers_folder_ok('x', true)::text$s$), 'falsefalse');

-- Deleting a person never used anywhere.
select pg_temp.refused('delete: Work cannot', 'staff.dev@arak-sa.com',
  format($s$select public.hr_employee_delete(%L, %L)$s$, :arak, pg_temp.emp('T-100')), 'HR_NOT_ALLOWED');
select pg_temp.refused('delete: someone with contracts, leave or a team is refused and nothing changes', 'staff.admin@arak-sa.com',
  format($s$select public.hr_employee_delete(%L, %L)$s$, :arak, pg_temp.emp('T-003')), 'HR_EMPLOYEE_IN_USE');
select pg_temp.eq('delete: ...the person is still there',
  (select count(*) from public.hr_employees where employee_no = 'T-003')::text, '1');
select pg_temp.eq('delete: Manage deletes a person never used, and gets their papers'' files back to remove',
  pg_temp.q('staff.admin@arak-sa.com', format($s$with n as (insert into public.hr_employees (workspace_id, name_en, hire_date, created_by) values (%L, 'Scratch (test)', '2026-10-01', %L) returning id),
      d as (insert into public.hr_documents (workspace_id, employee_id, doc_type, file_path, file_name, file_size, file_type) select %L, id, 'passport', %L || '/' || id::text || '/s.pdf', 's.pdf', 5, 'application/pdf' from n returning 1)
    select count(*) from d$s$, :arak, pg_temp.uid('staff.admin@arak-sa.com'), :arak, :arak)), '1');
select pg_temp.eq('delete: ...the call returns the file paths',
  pg_temp.q('staff.admin@arak-sa.com', format($s$select cardinality(public.hr_employee_delete(%L, (select id from public.hr_employees where name_en = 'Scratch (test)')))::text$s$, :arak)), '1');
select pg_temp.eq('delete: ...and the row and its papers are gone',
  (select count(*) from public.hr_employees where name_en = 'Scratch (test)')::text, '0');

-- ══ Settings ══
select pg_temp.eq('settings: Work cannot change the work week',
  pg_temp.q('staff.dev@arak-sa.com', format($s$with u as (update public.hr_settings set grace_minutes = 60 where workspace_id = %L returning 1) select count(*) from u$s$, :arak)), '0');
select pg_temp.eq('settings: Manage changes it',
  pg_temp.q('staff.admin@arak-sa.com', format($s$update public.hr_settings set grace_minutes = 10 where workspace_id = %L returning grace_minutes$s$, :arak)), '10');

-- ══ Deleting a company still works with HR rows in it ══
do $$
declare ws uuid; e uuid; ty uuid; r uuid;
begin
  insert into public.workspaces (name) values ('HR delete test (test)') returning id into ws;
  insert into public.hr_departments (workspace_id, name_en) values (ws, 'D (test)');
  insert into public.hr_employees (workspace_id, name_en, hire_date, department_id) values (ws, 'E (test)', '2026-01-01', (select id from public.hr_departments where workspace_id = ws)) returning id into e;
  update public.hr_departments set head_id = e where workspace_id = ws;
  insert into public.hr_leave_types (workspace_id, name_en) values (ws, 'L (test)') returning id into ty;
  insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days) values (ws, e, ty, '2026-12-01', '2026-12-01', 1);
  insert into public.hr_attendance (workspace_id, employee_id, check_in, check_out, day) values (ws, e, '2026-10-01 05:00+00', '2026-10-01 13:00+00', '2026-10-01');
  insert into public.hr_devices (workspace_id, name, timezone, key_hash, key_hint) values (ws, 'D (test)', 'Asia/Riyadh', repeat('a', 64), 'aaaa');
  insert into public.hr_job_positions (workspace_id, name_en) values (ws, 'P (test)');
  insert into public.hr_employee_private (workspace_id, employee_id, nationality) values (ws, e, 'X');
  insert into public.hr_contracts (workspace_id, employee_id, contract_type, start_date) values (ws, e, 'open', '2026-01-01');
  insert into public.hr_leave_allocations (workspace_id, employee_id, leave_type_id, days, valid_from, valid_to, reason) values (ws, e, ty, 5, '2026-01-01', '2026-12-31', 'x');
  delete from public.workspaces where id = ws;
  insert into t (name, ok, detail) values ('company delete: cascades through every HR table, the ledger, contracts and history included', not exists (select 1 from public.hr_employees where workspace_id = ws) and not exists (select 1 from public.hr_leave_allocations where workspace_id = ws) and not exists (select 1 from public.hr_audit where workspace_id = ws) and not exists (select 1 from public.hr_contracts where workspace_id = ws), '');
exception when others then
  insert into t (name, ok, detail) values ('company delete: cascades through every HR table, the ledger, contracts and history included', false, sqlerrm);
end $$;

-- ══ Every hr_ table has RLS on ══
select pg_temp.eq('rls: on for every hr_ table',
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'hr\_%' and not relrowsecurity), 0::bigint);
select pg_temp.eq('rls: twenty hr_ tables, plus the two kept from the first attendance',
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'hr\_%'), 22::bigint);
select pg_temp.eq('rls: the kept first-attendance tables are closed to the app',
  pg_temp.err('staff.admin@arak-sa.com', 'select count(*) from public.hr_attendance_day_records') like '%permission denied%', true);

-- ── Report ──
\o
select case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else detail end as detail from t order by n;
select format('%s passed, %s failed', count(*) filter (where ok), count(*) filter (where not ok)) as summary from t;
do $$ begin
  if exists (select 1 from t where not ok) then raise exception 'HR tests failed'; end if;
end $$;
rollback;
