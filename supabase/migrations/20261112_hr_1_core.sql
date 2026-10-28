-- ─── v2 HR, part 1: departments, employees, documents, contracts ───────────
-- 2026-10-28. The owner's direction: the finished, non-accounting parts of
-- Musa's ERP are rewritten into v2 in our own stack, as clean tables of ours
-- (not his schema). This is the HR section ('hr', allowed by
-- 20261110_erp_sections). His business rules were read from his app and
-- rewritten here; dev/erp-pilot/HR.md lists what was kept and what was not.
--
--   hr_departments  a company's departments; archived, never deleted
--   hr_employees    the employee file: names EN/AR, job, department, manager,
--                   hire date, status, work email/phone, an optional login
--   hr_documents    identity and work papers with their expiry dates
--   hr_contracts    employment contracts: type and dates (NO pay: payroll and
--                   money are out of scope by the owner's decision)
--   hr_settings     the company's work week, for the attendance sheets
--
-- Who may do what (section access, 20261101_section_access):
--   view    read the section: the directory, departments, leave, attendance
--   work    day-to-day HR entry: employees, papers, contracts, attendance;
--           also reads documents and contracts (personal papers)
--   manage  settings and approvals: departments, leave types and balances,
--           the work week, approving leave, linking a login to an employee
-- An employee linked to a login also reads their own papers and contracts.
--
-- Company separation: every row carries workspace_id; RLS on every table;
-- and every reference between HR rows is a composite (workspace_id, id) key,
-- so a row can never point at another company's employee or department.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── Helpers ──

-- updated_at on every change.
create or replace function public.hr_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Today in Riyadh: the company's day, whatever the server's clock zone.
create or replace function public.hr_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Riyadh')::date;
$$;

-- An approved login of this company (a member or a sales seat): the only
-- logins an employee can be linked to.
create or replace function public.hr_login_in_company(ws uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_access ua where ua.user_id = uid and ua.status = 'approved')
     and (exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = uid)
          or exists (select 1 from public.sales_seats s where s.workspace_id = ws and s.user_id = uid));
$$;

-- ── Departments ──
create table if not exists public.hr_departments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name_en      text not null default '',
  name_ar      text not null default '',
  -- The department's head, an employee of the same company (FK added below).
  head_id      uuid,
  active       boolean not null default true,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint hr_departments_named check (length(trim(name_en)) > 0 or length(trim(name_ar)) > 0),
  constraint hr_departments_ws_id unique (workspace_id, id)
);
create unique index if not exists hr_departments_name_en_uq on public.hr_departments (workspace_id, lower(trim(name_en))) where trim(name_en) <> '';
create unique index if not exists hr_departments_name_ar_uq on public.hr_departments (workspace_id, trim(name_ar)) where trim(name_ar) <> '';

-- ── Employees ──
create table if not exists public.hr_employees (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  -- The company's own number for the person, when it has one.
  employee_no   text,
  name_en       text not null default '',
  name_ar       text not null default '',
  job_title     text not null default '',
  department_id uuid,
  manager_id    uuid,
  -- Required at entry (his rule): the start of everything else.
  hire_date     date not null,
  status        text not null default 'active' check (status in ('active', 'ended')),
  -- Ending employment needs its date and reason (his rule); re-hiring clears them.
  end_date      date,
  end_reason    text,
  work_email    text,
  work_phone    text,
  -- One of our logins, so the person can ask for their own leave and a
  -- manager can approve their team's. Linking needs Manage.
  user_id       uuid references auth.users(id) on delete set null,
  notes         text not null default '',
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint hr_employees_named check (length(trim(name_en)) > 0 or length(trim(name_ar)) > 0),
  constraint hr_employees_ws_id unique (workspace_id, id),
  constraint hr_employees_department_fk foreign key (workspace_id, department_id) references public.hr_departments (workspace_id, id),
  constraint hr_employees_manager_fk foreign key (workspace_id, manager_id) references public.hr_employees (workspace_id, id),
  constraint hr_employees_not_own_manager check (manager_id is null or manager_id <> id),
  constraint hr_employees_ended check (
    (status = 'ended') = (end_date is not null)
    and (status <> 'ended' or length(trim(coalesce(end_reason, ''))) > 0)
    and (end_date is null or end_date >= hire_date)
  ),
  constraint hr_employees_email check (work_email is null or work_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
create unique index if not exists hr_employees_no_uq on public.hr_employees (workspace_id, lower(trim(employee_no))) where coalesce(trim(employee_no), '') <> '';
create unique index if not exists hr_employees_user_uq on public.hr_employees (workspace_id, user_id) where user_id is not null;
create index if not exists hr_employees_department_idx on public.hr_employees (workspace_id, department_id);
create index if not exists hr_employees_manager_idx on public.hr_employees (manager_id);

do $$ begin
  alter table public.hr_departments add constraint hr_departments_head_fk
    foreign key (workspace_id, head_id) references public.hr_employees (workspace_id, id);
exception when duplicate_object then null; end $$;

-- The reporting line has no loops; a linked login belongs to the company and
-- only Manage links one (a link gives approval rights over a team).
create or replace function public.hr_employee_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cursor_id uuid := new.manager_id;
  steps int := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id or steps > 50 then
      raise exception 'HR_MANAGER_LOOP: the reporting line would loop' using errcode = 'P0001';
    end if;
    select manager_id into cursor_id from public.hr_employees where id = cursor_id;
    steps := steps + 1;
  end loop;
  if new.user_id is not null and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    if not public.hr_login_in_company(new.workspace_id, new.user_id) then
      raise exception 'HR_LOGIN_NOT_IN_COMPANY: that login is not in this company' using errcode = 'P0001';
    end if;
  end if;
  -- Linking or unlinking a login is Manage's (auth.uid() is null for
  -- maintenance scripts run as the database owner).
  if auth.uid() is not null
     and new.user_id is distinct from (case when tg_op = 'UPDATE' then old.user_id end)
     and not public.has_section(new.workspace_id, 'hr', 'manage') then
    raise exception 'HR_LINK_NEEDS_MANAGE: only Manage links a login to an employee' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then
    raise exception 'HR_LOCKED: an employee stays in their company' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then new.updated_by := coalesce(auth.uid(), new.updated_by); end if;
  return new;
end $$;

drop trigger if exists hr_employee_guard on public.hr_employees;
create trigger hr_employee_guard before insert or update on public.hr_employees
  for each row execute function public.hr_employee_guard();
drop trigger if exists hr_employees_touch on public.hr_employees;
create trigger hr_employees_touch before update on public.hr_employees
  for each row execute function public.hr_touch();
drop trigger if exists hr_departments_touch on public.hr_departments;
create trigger hr_departments_touch before update on public.hr_departments
  for each row execute function public.hr_touch();

-- The employee linked to the caller in this company, if any.
create or replace function public.hr_my_employee(ws uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.hr_employees where workspace_id = ws and user_id = auth.uid() and auth.uid() is not null;
$$;

-- Is the caller the direct manager of this employee (through their linked login)?
create or replace function public.hr_is_manager_of(emp uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hr_employees e
      join public.hr_employees m on m.id = e.manager_id and m.workspace_id = e.workspace_id
     where e.id = emp and m.user_id = auth.uid() and auth.uid() is not null
  );
$$;

-- ── Documents: identity and work papers ──
create table if not exists public.hr_documents (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id  uuid not null,
  doc_type     text not null check (doc_type in ('national_id', 'iqama', 'passport', 'work_permit', 'health_cert', 'driving_license', 'other')),
  doc_number   text not null default '',
  issue_date   date,
  expiry_date  date,
  notes        text not null default '',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint hr_documents_employee_fk foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id) on delete cascade,
  constraint hr_documents_dates check (expiry_date is null or issue_date is null or expiry_date >= issue_date),
  -- "Other" says what it is (his rule).
  constraint hr_documents_other_named check (doc_type <> 'other' or length(trim(notes)) > 0)
);
create index if not exists hr_documents_employee_idx on public.hr_documents (employee_id);
create index if not exists hr_documents_expiry_idx on public.hr_documents (workspace_id, expiry_date) where expiry_date is not null;
drop trigger if exists hr_documents_touch on public.hr_documents;
create trigger hr_documents_touch before update on public.hr_documents
  for each row execute function public.hr_touch();

-- ── Contracts: type and dates only ──
create table if not exists public.hr_contracts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  employee_id   uuid not null,
  contract_type text not null check (contract_type in ('fixed', 'open')),
  start_date    date not null,
  end_date      date,
  notes         text not null default '',
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint hr_contracts_employee_fk foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id) on delete cascade,
  constraint hr_contracts_dates check (end_date is null or end_date >= start_date),
  -- A fixed-term contract has its end date (his rule).
  constraint hr_contracts_fixed_ends check (contract_type <> 'fixed' or end_date is not null)
);
create index if not exists hr_contracts_employee_idx on public.hr_contracts (employee_id, start_date);

-- One contract at a time: two contracts of one person never cover the same day.
create or replace function public.hr_contract_guard()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.hr_contracts c
     where c.employee_id = new.employee_id and c.id <> new.id
       and c.start_date <= coalesce(new.end_date, 'infinity'::date)
       and coalesce(c.end_date, 'infinity'::date) >= new.start_date
  ) then
    raise exception 'HR_CONTRACT_OVERLAP: another contract covers these dates' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists hr_contract_guard on public.hr_contracts;
create trigger hr_contract_guard before insert or update on public.hr_contracts
  for each row execute function public.hr_contract_guard();
drop trigger if exists hr_contracts_touch on public.hr_contracts;
create trigger hr_contracts_touch before update on public.hr_contracts
  for each row execute function public.hr_touch();

-- ── The work week (for the attendance sheets) ──
-- Entered by the company; nothing is assumed (his rule): without it the
-- monthly sheet does not count days with no record, and nobody is "late".
create table if not exists public.hr_settings (
  workspace_id  uuid primary key references public.workspaces(id) on delete cascade,
  -- 0 = Sunday … 6 = Saturday.
  work_days     smallint[] not null default '{}' check (work_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  work_start    time,
  work_end      time,
  grace_minutes integer check (grace_minutes between 0 and 240),
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  constraint hr_settings_hours check (work_start is null or work_end is null or work_end > work_start)
);
drop trigger if exists hr_settings_touch on public.hr_settings;
create trigger hr_settings_touch before update on public.hr_settings
  for each row execute function public.hr_touch();

-- ── Row level security ──
alter table public.hr_departments enable row level security;
alter table public.hr_employees enable row level security;
alter table public.hr_documents enable row level security;
alter table public.hr_contracts enable row level security;
alter table public.hr_settings enable row level security;

-- Departments: everyone in HR reads; Manage changes. Never deleted (archived).
drop policy if exists hr_departments_read on public.hr_departments;
create policy hr_departments_read on public.hr_departments for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
drop policy if exists hr_departments_insert on public.hr_departments;
create policy hr_departments_insert on public.hr_departments for insert to authenticated
  with check (public.has_section(workspace_id, 'hr', 'manage') and created_by = auth.uid());
drop policy if exists hr_departments_update on public.hr_departments;
create policy hr_departments_update on public.hr_departments for update to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'))
  with check (public.has_section(workspace_id, 'hr', 'manage'));

-- Employees: everyone in HR reads the directory; Work adds and edits; a
-- record is never deleted (employment is ended instead).
drop policy if exists hr_employees_read on public.hr_employees;
create policy hr_employees_read on public.hr_employees for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
drop policy if exists hr_employees_insert on public.hr_employees;
create policy hr_employees_insert on public.hr_employees for insert to authenticated
  with check (public.has_section(workspace_id, 'hr', 'work') and created_by = auth.uid());
drop policy if exists hr_employees_update on public.hr_employees;
create policy hr_employees_update on public.hr_employees for update to authenticated
  using (public.has_section(workspace_id, 'hr', 'work'))
  with check (public.has_section(workspace_id, 'hr', 'work'));

-- Papers and contracts are personal: Work and up, or the employee themselves.
drop policy if exists hr_documents_read on public.hr_documents;
create policy hr_documents_read on public.hr_documents for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'work')
         or (public.has_section(workspace_id, 'hr', 'view') and employee_id = public.hr_my_employee(workspace_id)));
drop policy if exists hr_documents_write on public.hr_documents;
create policy hr_documents_write on public.hr_documents for all to authenticated
  using (public.has_section(workspace_id, 'hr', 'work'))
  with check (public.has_section(workspace_id, 'hr', 'work'));

drop policy if exists hr_contracts_read on public.hr_contracts;
create policy hr_contracts_read on public.hr_contracts for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'work')
         or (public.has_section(workspace_id, 'hr', 'view') and employee_id = public.hr_my_employee(workspace_id)));
drop policy if exists hr_contracts_write on public.hr_contracts;
create policy hr_contracts_write on public.hr_contracts for all to authenticated
  using (public.has_section(workspace_id, 'hr', 'work'))
  with check (public.has_section(workspace_id, 'hr', 'work'));

drop policy if exists hr_settings_read on public.hr_settings;
create policy hr_settings_read on public.hr_settings for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
drop policy if exists hr_settings_write on public.hr_settings;
create policy hr_settings_write on public.hr_settings for all to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'))
  with check (public.has_section(workspace_id, 'hr', 'manage'));

-- The functions the browser may call; helpers for policies stay callable.
revoke all on function public.hr_login_in_company(uuid, uuid) from public, anon;
grant execute on function public.hr_login_in_company(uuid, uuid) to authenticated;
revoke all on function public.hr_my_employee(uuid) from public, anon;
grant execute on function public.hr_my_employee(uuid) to authenticated;
revoke all on function public.hr_is_manager_of(uuid) from public, anon;
grant execute on function public.hr_is_manager_of(uuid) to authenticated;
grant execute on function public.hr_today() to authenticated;

-- The company's logins, with their emails, for linking one to an employee
-- (matched by work email on screen). Manage only: it lists emails.
create or replace function public.hr_logins(ws uuid)
returns table (user_id uuid, name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select ua.user_id, coalesce(nullif(trim(ua.full_name), ''), split_part(ua.email, '@', 1)), ua.email
    from public.user_access ua
   where public.has_section(ws, 'hr', 'manage')
     and public.hr_login_in_company(ws, ua.user_id)
   order by 2;
$$;
revoke all on function public.hr_logins(uuid) from public, anon;
grant execute on function public.hr_logins(uuid) to authenticated;
