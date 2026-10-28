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
select pg_temp.eq('read: Work reads every paper of the company',
  pg_temp.q('staff.dev@arak-sa.com', 'select count(*) from public.hr_documents where workspace_id = ''00000000-0000-0000-0000-000000000001'''), '9');
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
select pg_temp.refused('employees: View cannot add one', 'staff.marketing@arak-sa.com',
  format($s$insert into public.hr_employees (workspace_id, name_en, hire_date, created_by) values (%L, 'X (test)', '2026-01-01', %L) returning id$s$, :arak, pg_temp.uid('staff.marketing@arak-sa.com')),
  'row-level security');
select pg_temp.eq('employees: Work adds one',
  pg_temp.q('staff.dev@arak-sa.com', format($s$insert into public.hr_employees (workspace_id, employee_no, name_ar, hire_date, created_by) values (%L, 'T-100', 'جديد (تجربة)', '2026-10-01', %L) returning name_ar$s$, :arak, pg_temp.uid('staff.dev@arak-sa.com'))),
  'جديد (تجربة)');
select pg_temp.refused('employees: a hire date is required', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_employees (workspace_id, name_en, created_by) values (%L, 'Y (test)', %L) returning id$s$, :arak, pg_temp.uid('staff.dev@arak-sa.com')),
  'hire_date');
select pg_temp.refused('employees: employee numbers are unique in a company', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_employees (workspace_id, employee_no, name_en, hire_date, created_by) values (%L, 't-100', 'Z (test)', '2026-01-01', %L) returning id$s$, :arak, pg_temp.uid('staff.dev@arak-sa.com')),
  'hr_employees_no_uq');
select pg_temp.refused('employees: Work cannot add one to another company', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_employees (workspace_id, name_en, hire_date, created_by) values (%L, 'G (test)', '2026-01-01', %L) returning id$s$, current_setting('hr.ghusn'), pg_temp.uid('staff.dev@arak-sa.com')),
  'row-level security');
select pg_temp.refused('employees: a department of another company is refused', 'staff.admin@arak-sa.com',
  format($s$update public.hr_employees set department_id = (select id from public.hr_departments where workspace_id = %L limit 1) where employee_no = 'T-100' returning id$s$, current_setting('hr.ghusn')),
  'hr_employees_department_fk');
select pg_temp.refused('employees: a manager of another company is refused', 'staff.admin@arak-sa.com',
  $s$update public.hr_employees set manager_id = (select id from public.hr_employees where employee_no = 'G-001') where employee_no = 'T-100' returning id$s$,
  'hr_employees_manager_fk');
select pg_temp.refused('employees: the reporting line cannot loop', 'staff.dev@arak-sa.com',
  $s$update public.hr_employees set manager_id = (select id from public.hr_employees where employee_no = 'T-003') where employee_no = 'T-002' returning id$s$,
  'HR_MANAGER_LOOP');
select pg_temp.refused('employees: ending employment needs a reason', 'staff.dev@arak-sa.com',
  $s$update public.hr_employees set status = 'ended', end_date = '2026-10-20' where employee_no = 'T-100' returning id$s$,
  'hr_employees_ended');
select pg_temp.eq('employees: Work ends employment with date and reason',
  pg_temp.q('staff.dev@arak-sa.com', $s$update public.hr_employees set status = 'ended', end_date = '2026-10-20', end_reason = 'Test ended' where employee_no = 'T-100' returning status$s$),
  'ended');
select pg_temp.refused('employees: Work cannot link a login', 'staff.dev@arak-sa.com',
  format($s$update public.hr_employees set user_id = %L where employee_no = 'T-008' returning id$s$, pg_temp.uid('staff.dev@arak-sa.com')),
  'HR_LINK_NEEDS_MANAGE');
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
select pg_temp.eq('employees: a delete removes nothing (no policy: end employment instead)',
  pg_temp.q('staff.admin@arak-sa.com', $s$with d as (delete from public.hr_employees where employee_no = 'T-100' returning 1) select count(*) from d$s$), '0');

-- ══ Papers and contracts ══
select pg_temp.eq('papers: a linked View person reads their own only',
  pg_temp.q('staff.marketing@arak-sa.com', 'select count(*) from public.hr_documents'), '1');
select pg_temp.refused('papers: "other" says what it is', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_documents (workspace_id, employee_id, doc_type) values (%L, %L, 'other') returning id$s$, :arak, pg_temp.emp('T-004')),
  'hr_documents_other_named');
select pg_temp.refused('papers: expiry is not before issue', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_documents (workspace_id, employee_id, doc_type, issue_date, expiry_date) values (%L, %L, 'passport', '2026-01-01', '2025-01-01') returning id$s$, :arak, pg_temp.emp('T-004')),
  'hr_documents_dates');
select pg_temp.refused('papers: View cannot add one', 'staff.marketing@arak-sa.com',
  format($s$insert into public.hr_documents (workspace_id, employee_id, doc_type) values (%L, %L, 'passport') returning id$s$, :arak, pg_temp.emp('T-002')),
  'row-level security');
select pg_temp.refused('papers: an employee of another company is refused', 'staff.admin@arak-sa.com',
  format($s$insert into public.hr_documents (workspace_id, employee_id, doc_type) values (%L, %L, 'passport') returning id$s$, :arak, pg_temp.emp('G-001')),
  'hr_documents_employee_fk');
select pg_temp.refused('contracts: fixed term has an end date', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_contracts (workspace_id, employee_id, contract_type, start_date) values (%L, %L, 'fixed', '2027-01-01') returning id$s$, :arak, pg_temp.emp('T-100')),
  'hr_contracts_fixed_ends');
select pg_temp.refused('contracts: two never cover the same day', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_contracts (workspace_id, employee_id, contract_type, start_date, end_date) values (%L, %L, 'fixed', '2026-12-01', '2027-12-01') returning id$s$, :arak, pg_temp.emp('T-003')),
  'HR_CONTRACT_OVERLAP');
select pg_temp.eq('contracts: a renewal after the last one is fine',
  pg_temp.q('staff.dev@arak-sa.com', format($s$insert into public.hr_contracts (workspace_id, employee_id, contract_type, start_date, end_date) values (%L, %L, 'fixed', '2027-01-09', '2029-01-08') returning contract_type$s$, :arak, pg_temp.emp('T-003'))),
  'fixed');

-- ══ Leave: asking ══
select pg_temp.refused('leave: View cannot ask for someone else', 'staff.marketing@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, created_by) values (%L, %L, %L, '2026-12-01', '2026-12-01', 1, %L) returning id$s$,
    :arak, pg_temp.emp('T-004'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.marketing@arak-sa.com')),
  'row-level security');
select pg_temp.eq('leave: a linked View person asks for their own',
  pg_temp.q('staff.marketing@arak-sa.com', format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason, created_by) values (%L, %L, %L, '2026-12-06', '2026-12-08', 3, 'Test', %L) returning status$s$,
    :arak, pg_temp.emp('T-002'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.marketing@arak-sa.com'))),
  'pending');
select pg_temp.refused('leave: a request starts pending', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, status, created_by) values (%L, %L, %L, '2026-12-01', '2026-12-01', 1, 'approved', %L) returning id$s$,
    :arak, pg_temp.emp('T-004'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.dev@arak-sa.com')),
  'HR_LEAVE_TRANSITION');
select pg_temp.refused('leave: no more days than the calendar span', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, created_by) values (%L, %L, %L, '2026-12-01', '2026-12-02', 3, %L) returning id$s$,
    :arak, pg_temp.emp('T-004'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.dev@arak-sa.com')),
  'hr_leave_requests_days');
select pg_temp.refused('leave: overlapping requests are refused', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, created_by) values (%L, %L, %L, '2026-11-18', '2026-11-22', 2, %L) returning id$s$,
    :arak, pg_temp.emp('T-006'), pg_temp.typ('Sick leave'), pg_temp.uid('staff.dev@arak-sa.com')),
  'HR_LEAVE_OVERLAP');
select pg_temp.refused('leave: someone who has left gets no new request', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, created_by) values (%L, %L, %L, '2026-12-01', '2026-12-01', 1, %L) returning id$s$,
    :arak, pg_temp.emp('T-009'), pg_temp.typ('Annual leave'), pg_temp.uid('staff.dev@arak-sa.com')),
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

-- ══ Leave: deciding ══
select pg_temp.refused('decide: Work who is not the manager cannot approve', 'staff.dev@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('not-mine')), 'HR_LEAVE_NOT_APPROVER');
select pg_temp.refused('decide: nobody decides their own (even the access admin)', 'staff.ceo@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('gm-own')), 'HR_LEAVE_SELF_DECISION');
select pg_temp.refused('decide: nobody decides their own (Work)', 'staff.dev@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('decide-me')), 'HR_LEAVE_SELF_DECISION');
select pg_temp.refused('decide: a rejection says why', 'staff.marketing@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''reject'', ''  '')', :arak, pg_temp.req('decide-me')), 'HR_LEAVE_REJECT_WHY');
select pg_temp.refused('decide: the balance must cover it', 'staff.marketing@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('too-long')), 'HR_LEAVE_BALANCE');
select pg_temp.refused('decide: the request must be in the company named', 'staff.admin@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', current_setting('hr.ghusn'), pg_temp.req('decide-me')), 'HR_NOT_FOUND');
select pg_temp.refused('decide: a View person who is not the manager cannot', 'staff.marketing@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('not-mine')), 'HR_LEAVE_NOT_APPROVER');
select pg_temp.eq('decide: the direct manager (View, linked) approves',
  pg_temp.q('staff.marketing@arak-sa.com', format('select status from public.hr_leave_decide(%L, %L, ''approve'', ''Enjoy'')', :arak, pg_temp.req('decide-me'))), 'approved');
select pg_temp.eq('decide: the approver is recorded',
  (select decided_by from public.hr_leave_requests where reason = 'decide-me'), pg_temp.uid('staff.marketing@arak-sa.com'));
select pg_temp.refused('decide: a decided request is not decided again', 'staff.admin@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''reject'', ''no'')', :arak, pg_temp.req('decide-me')), 'HR_LEAVE_TRANSITION');
select pg_temp.eq('balance: 21 granted, 5 + 3 used, 0 pending of the 30-day one counted separately',
  pg_temp.q('staff.marketing@arak-sa.com', format('select concat_ws(''/'', granted, used, pending, remaining) from public.hr_leave_balance(%L, %L, 2026)', pg_temp.emp('T-003'), pg_temp.typ('Annual leave'))),
  '21.0/8.0/0/13.0');
select pg_temp.eq('balance: the next year is counted on its own (no grant yet)',
  pg_temp.q('staff.marketing@arak-sa.com', format('select concat_ws(''/'', coalesce(granted::text, ''none''), used, pending, remaining) from public.hr_leave_balance(%L, %L, 2027)', pg_temp.emp('T-003'), pg_temp.typ('Annual leave'))),
  'none/0/30.0/0');
select pg_temp.refused('cancel: Work cannot cancel approved leave', 'staff.dev@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''cancel'')', :arak, pg_temp.req('decide-me')), 'HR_LEAVE_NOT_APPROVER');
select pg_temp.eq('cancel: Manage cancels approved leave',
  pg_temp.q('staff.admin@arak-sa.com', format('select status from public.hr_leave_decide(%L, %L, ''cancel'', ''Plans changed'')', :arak, pg_temp.req('decide-me'))), 'cancelled');
select pg_temp.eq('cancel: the employee withdraws their own pending request',
  pg_temp.q('staff.dev@arak-sa.com', format('select status from public.hr_leave_decide(%L, %L, ''cancel'')', :arak, pg_temp.req('too-long'))), 'cancelled');
select pg_temp.refused('cancel: a View person cannot cancel someone else''s', 'staff.marketing@arak-sa.com',
  format('select status from public.hr_leave_decide(%L, %L, ''cancel'')', :arak, pg_temp.req('Personal errand (test)')), 'HR_LEAVE_NOT_YOURS');
select pg_temp.eq('decide: Manage rejects with a reason',
  pg_temp.q('staff.admin@arak-sa.com', format('select status || '':'' || decision_note from public.hr_leave_decide(%L, %L, ''reject'', ''Busy week'')', :arak, pg_temp.req('Personal errand (test)'))), 'rejected:Busy week');
select pg_temp.refused('decide: signed out cannot call it', null,
  format('select status from public.hr_leave_decide(%L, %L, ''approve'')', :arak, pg_temp.req('not-mine')), 'permission denied');
select pg_temp.eq('balances: Work cannot change a balance',
  pg_temp.q('staff.dev@arak-sa.com', format($s$with u as (update public.hr_leave_balances set days = 99, updated_by = %L where employee_id = %L returning 1) select count(*) from u$s$, pg_temp.uid('staff.dev@arak-sa.com'), pg_temp.emp('T-003'))), '0');
select pg_temp.eq('balances: ...and the balance is unchanged',
  (select days from public.hr_leave_balances where employee_id = pg_temp.emp('T-003') and leave_type_id = pg_temp.typ('Annual leave') and year = 2026), 21.0::numeric);
select pg_temp.eq('balances: Manage sets one',
  pg_temp.q('staff.admin@arak-sa.com', format($s$update public.hr_leave_balances set days = 25, updated_by = %L where employee_id = %L and leave_type_id = %L and year = 2026 returning days$s$,
    pg_temp.uid('staff.admin@arak-sa.com'), pg_temp.emp('T-003'), pg_temp.typ('Annual leave'))), '25.0');

-- ══ Attendance ══
select pg_temp.refused('attendance: View cannot record', 'staff.marketing@arak-sa.com',
  format($s$insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in, created_by) values (%L, %L, hr_today(), 'present', '08:00', %L) returning id$s$, :arak, pg_temp.emp('T-005'), pg_temp.uid('staff.marketing@arak-sa.com')),
  'row-level security');
select pg_temp.refused('attendance: not in the future', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in, created_by) values (%L, %L, hr_today() + 1, 'present', '08:00', %L) returning id$s$, :arak, pg_temp.emp('T-005'), pg_temp.uid('staff.dev@arak-sa.com')),
  'HR_ATTENDANCE_FUTURE');
select pg_temp.refused('attendance: not before the hire date', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in, created_by) values (%L, %L, '2023-01-01', 'present', '08:00', %L) returning id$s$, :arak, pg_temp.emp('T-005'), pg_temp.uid('staff.dev@arak-sa.com')),
  'HR_ATTENDANCE_NOT_EMPLOYED');
select pg_temp.refused('attendance: not after the end date', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in, created_by) values (%L, %L, '2026-07-01', 'present', '08:00', %L) returning id$s$, :arak, pg_temp.emp('T-009'), pg_temp.uid('staff.dev@arak-sa.com')),
  'HR_ATTENDANCE_NOT_EMPLOYED');
select pg_temp.refused('attendance: not present on approved leave', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in, created_by) values (%L, %L, hr_today(), 'present', '08:00', %L) returning id$s$, :arak, pg_temp.emp('T-008'), pg_temp.uid('staff.dev@arak-sa.com')),
  'HR_ATTENDANCE_ON_LEAVE');
select pg_temp.refused('attendance: present needs an arrival time', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_attendance (workspace_id, employee_id, day, status, created_by) values (%L, %L, hr_today(), 'present', %L) returning id$s$, :arak, pg_temp.emp('T-005'), pg_temp.uid('staff.dev@arak-sa.com')),
  'hr_attendance_times');
select pg_temp.refused('attendance: absent has no times', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in, created_by) values (%L, %L, hr_today(), 'absent', '08:00', %L) returning id$s$, :arak, pg_temp.emp('T-005'), pg_temp.uid('staff.dev@arak-sa.com')),
  'hr_attendance_times');
select pg_temp.refused('attendance: leaving is after arriving', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in, check_out, created_by) values (%L, %L, hr_today(), 'present', '08:00', '07:00', %L) returning id$s$, :arak, pg_temp.emp('T-005'), pg_temp.uid('staff.dev@arak-sa.com')),
  'hr_attendance_times');
select pg_temp.eq('attendance: Work records an arrival',
  pg_temp.q('staff.dev@arak-sa.com', format($s$insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in, created_by) values (%L, %L, hr_today(), 'present', '08:03', %L) returning status$s$, :arak, pg_temp.emp('T-005'), pg_temp.uid('staff.dev@arak-sa.com'))),
  'present');
select pg_temp.refused('attendance: one record a day', 'staff.dev@arak-sa.com',
  format($s$insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in, created_by) values (%L, %L, hr_today(), 'present', '09:00', %L) returning id$s$, :arak, pg_temp.emp('T-005'), pg_temp.uid('staff.dev@arak-sa.com')),
  'hr_attendance_one_a_day');
create function pg_temp.att(p_no text) returns uuid as $$ select id from public.hr_attendance where employee_id = pg_temp.emp(p_no) and day = hr_today() $$ language sql;
select pg_temp.eq('attendance: a direct update changes nothing (corrections go through hr_attendance_update)',
  pg_temp.q('staff.dev@arak-sa.com', format($s$with u as (update public.hr_attendance set check_in = '07:00' where id = %L returning 1) select count(*) from u$s$, pg_temp.att('T-005'))), '0');
select pg_temp.eq('attendance: filling in the departure needs no reason',
  pg_temp.q('staff.dev@arak-sa.com', format($s$select check_out::text from public.hr_attendance_update(%L, %L, 'present', '08:03', '17:10', '')$s$, :arak, pg_temp.att('T-005'))), '17:10:00');
select pg_temp.eq('attendance: ...and is kept as a departure, not a correction',
  (select kind || ':' || coalesce((select corrected_by::text from public.hr_attendance where id = pg_temp.att('T-005')), 'none') from public.hr_attendance_changes where attendance_id = pg_temp.att('T-005')), 'departure:none');
select pg_temp.refused('attendance: a correction needs a reason', 'staff.dev@arak-sa.com',
  format($s$select id from public.hr_attendance_update(%L, %L, 'late', '08:40', '17:10', '', '')$s$, :arak, pg_temp.att('T-005')), 'HR_ATTENDANCE_REASON');
select pg_temp.refused('attendance: View cannot correct', 'staff.marketing@arak-sa.com',
  format($s$select id from public.hr_attendance_update(%L, %L, 'late', '08:40', '17:10', '', 'x')$s$, :arak, pg_temp.att('T-005')), 'HR_NO_ACCESS');
select pg_temp.refused('attendance: a correction names the right company', 'staff.dev@arak-sa.com',
  format($s$select id from public.hr_attendance_update(%L, %L, 'late', '08:40', '17:10', '', 'x')$s$, current_setting('hr.ghusn'), pg_temp.att('T-005')), 'HR_NO_ACCESS');
select pg_temp.eq('attendance: Work corrects with a reason',
  pg_temp.q('staff.dev@arak-sa.com', format($s$select status || '@' || check_in::text from public.hr_attendance_update(%L, %L, 'late', '08:40', '17:10', '', 'Gate log shows 08:40')$s$, :arak, pg_temp.att('T-005'))), 'late@08:40:00');
select pg_temp.eq('attendance: who corrected, and why, are on the record',
  (select (corrected_by = pg_temp.uid('staff.dev@arak-sa.com'))::text || ':' || correction_reason from public.hr_attendance where id = pg_temp.att('T-005')), 'true:Gate log shows 08:40');
select pg_temp.eq('attendance: the history keeps before and after',
  (select before->>'check_in' || '>' || (after->>'check_in') from public.hr_attendance_changes where attendance_id = pg_temp.att('T-005') and kind = 'correction'), '08:03:00>08:40:00');
select pg_temp.eq('attendance: Work cannot delete a record',
  pg_temp.q('staff.dev@arak-sa.com', format($s$with d as (delete from public.hr_attendance where id = %L returning 1) select count(*) from d$s$, pg_temp.att('T-005'))), '0');
select pg_temp.eq('attendance: Manage deletes one made by mistake',
  pg_temp.q('staff.admin@arak-sa.com', format($s$with d as (delete from public.hr_attendance where id = %L returning 1) select count(*) from d$s$, pg_temp.att('T-005'))), '1');

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
  insert into public.hr_attendance (workspace_id, employee_id, day, status) values (ws, e, '2026-10-01', 'absent');
  delete from public.workspaces where id = ws;
  insert into t (name, ok, detail) values ('company delete: cascades through every HR table', not exists (select 1 from public.hr_employees where workspace_id = ws), '');
exception when others then
  insert into t (name, ok, detail) values ('company delete: cascades through every HR table', false, sqlerrm);
end $$;

-- ══ Every hr_ table has RLS on ══
select pg_temp.eq('rls: on for every hr_ table',
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'hr\_%' and not relrowsecurity), 0::bigint);
select pg_temp.eq('rls: ten hr_ tables',
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'hr\_%'), 10::bigint);

-- ── Report ──
\o
select case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else detail end as detail from t order by n;
select format('%s passed, %s failed', count(*) filter (where ok), count(*) filter (where not ok)) as summary from t;
do $$ begin
  if exists (select 1 from t where not ok) then raise exception 'HR tests failed'; end if;
end $$;
rollback;
