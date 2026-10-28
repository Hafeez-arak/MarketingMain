-- ─── v2 HR parity, part 1: people ──────────────────────────────────────────
-- 2026-10-29. The second pass over Musa's HR (dev/erp-pilot/HR.md): the
-- employee file, departments and job positions made to match his, money
-- excepted. What changes here:
--
--   · numbers: an employee's number is made by the system (E-YYYY-NNNNNN,
--     one counter per company) and never changes; the same counter makes
--     contract numbers (HC-…) in part 3. People who had no number get one;
--     numbers already given are kept.
--   · job positions: a list per company (name, department, description,
--     archived) instead of a free-text title. Each distinct title already on
--     file became a position; hr_employees.job_title stays as the display
--     text and is kept in step with the position by a trigger, so the
--     attendance screens that show it are unchanged.
--   · departments get a parent department (no loops).
--   · the employee file's other fields: trade, employment type, direct or
--     indirect labour; and the personal file (nationality, identity, birth
--     date, gender, personal mobile, emergency contact, address, notes) in
--     its own table that only Manage reads, as his hr.manage does. Notes
--     moved there from the employee row (copied, then cleared).
--   · who: his hr.manage (employee files, papers, departments, jobs) is
--     Manage here; Work is his hr.attendance. So creating, editing and
--     ending employees, and deleting one that was never used, are Manage's.
--   · a general history (hr_audit) of every change to these rows, read by
--     Manage, like his audit log shown on the employee page.
--
-- No pay, IBAN or payroll fields: out of scope by the owner's decision.
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── Numbers ──
create table if not exists public.hr_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,
  last_value   bigint not null default 0,
  primary key (workspace_id, key)
);
alter table public.hr_counters enable row level security;
revoke all on public.hr_counters from anon, authenticated;

-- 'E-2026-000007': the next number of a kind for a company, Riyadh's year.
create or replace function public.hr_next_number(ws uuid, prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  insert into public.hr_counters as c (workspace_id, key, last_value) values (ws, prefix, 1)
  on conflict (workspace_id, key) do update set last_value = c.last_value + 1
  returning last_value into n;
  return prefix || '-' || extract(year from public.hr_today())::int || '-' || lpad(n::text, 6, '0');
end $$;
revoke all on function public.hr_next_number(uuid, text) from public, anon, authenticated;

-- ── Job positions ──
create table if not exists public.hr_job_positions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name_en       text not null default '',
  name_ar       text not null default '',
  department_id uuid,
  description   text not null default '',
  active        boolean not null default true,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint hr_job_positions_named check (length(trim(name_en)) > 0 or length(trim(name_ar)) > 0),
  constraint hr_job_positions_ws_id unique (workspace_id, id),
  constraint hr_job_positions_department_fk foreign key (workspace_id, department_id) references public.hr_departments (workspace_id, id)
);
create unique index if not exists hr_job_positions_name_en_uq on public.hr_job_positions (workspace_id, lower(trim(name_en))) where trim(name_en) <> '';
create unique index if not exists hr_job_positions_name_ar_uq on public.hr_job_positions (workspace_id, trim(name_ar)) where trim(name_ar) <> '';
drop trigger if exists hr_job_positions_touch on public.hr_job_positions;
create trigger hr_job_positions_touch before update on public.hr_job_positions
  for each row execute function public.hr_touch();

-- ── Departments: a parent ──
alter table public.hr_departments add column if not exists parent_id uuid;
do $$ begin
  alter table public.hr_departments add constraint hr_departments_parent_fk
    foreign key (workspace_id, parent_id) references public.hr_departments (workspace_id, id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.hr_departments add constraint hr_departments_not_own_parent check (parent_id is null or parent_id <> id);
exception when duplicate_object then null; end $$;

-- A department's parent chain never loops (his rule forbids only itself; a
-- loop would make a department its own ancestor).
create or replace function public.hr_department_guard()
returns trigger
language plpgsql
as $$
declare cursor_id uuid := new.parent_id; steps int := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id or steps > 50 then
      raise exception 'HR_DEPARTMENT_LOOP: a department cannot sit under itself' using errcode = 'P0001';
    end if;
    select parent_id into cursor_id from public.hr_departments where id = cursor_id;
    steps := steps + 1;
  end loop;
  return new;
end $$;
drop trigger if exists hr_department_guard on public.hr_departments;
create trigger hr_department_guard before insert or update on public.hr_departments
  for each row execute function public.hr_department_guard();

-- ── Employees: the other fields ──
alter table public.hr_employees add column if not exists trade text not null default '';
alter table public.hr_employees add column if not exists employment_type text;
alter table public.hr_employees add column if not exists is_direct_labor boolean not null default true;
alter table public.hr_employees add column if not exists job_id uuid;
do $$ begin
  alter table public.hr_employees add constraint hr_employees_employment_type
    check (employment_type is null or employment_type in ('full_time', 'part_time', 'contractor'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.hr_employees add constraint hr_employees_job_fk
    foreign key (workspace_id, job_id) references public.hr_job_positions (workspace_id, id);
exception when duplicate_object then null; end $$;
create index if not exists hr_employees_job_idx on public.hr_employees (workspace_id, job_id);

-- The titles already on file become positions (Arabic text → the Arabic name).
insert into public.hr_job_positions (workspace_id, name_en, name_ar)
select distinct e.workspace_id,
       case when trim(e.job_title) ~ '[؀-ۿ]' then '' else trim(e.job_title) end,
       case when trim(e.job_title) ~ '[؀-ۿ]' then trim(e.job_title) else '' end
  from public.hr_employees e
 where trim(e.job_title) <> '' and e.job_id is null
   and not exists (select 1 from public.hr_job_positions p where p.workspace_id = e.workspace_id
                      and (lower(trim(p.name_en)) = lower(trim(e.job_title)) or trim(p.name_ar) = trim(e.job_title)));
update public.hr_employees e set job_id = p.id
  from public.hr_job_positions p
 where e.job_id is null and trim(e.job_title) <> '' and p.workspace_id = e.workspace_id
   and (lower(trim(p.name_en)) = lower(trim(e.job_title)) or trim(p.name_ar) = trim(e.job_title));

-- ── The personal file: Manage only ──
create table if not exists public.hr_employee_private (
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  employee_id       uuid not null,
  nationality       text not null default '',
  id_type           text check (id_type is null or id_type in ('national_id', 'iqama', 'passport')),
  id_number         text,
  birth_date        date,
  gender            text check (gender is null or gender in ('m', 'f')),
  mobile            text not null default '',
  emergency_contact text not null default '',
  emergency_phone   text not null default '',
  address           text not null default '',
  notes             text not null default '',
  updated_by        uuid references auth.users(id) on delete set null,
  updated_at        timestamptz not null default now(),
  primary key (employee_id),
  constraint hr_employee_private_employee_fk foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id) on delete cascade,
  -- An identity number says what kind of identity it is (his rule).
  constraint hr_employee_private_id_typed check (id_number is null or id_type is not null)
);
-- One person per identity (his unique on type + number), per company.
create unique index if not exists hr_employee_private_identity_uq on public.hr_employee_private (workspace_id, id_type, lower(trim(id_number)))
  where coalesce(trim(id_number), '') <> '';

create or replace function public.hr_employee_private_guard()
returns trigger
language plpgsql
as $$
begin
  if new.birth_date is not null and new.birth_date >= public.hr_today() then
    raise exception 'HR_BIRTH_DATE: the birth date is in the past' using errcode = 'P0001';
  end if;
  if coalesce(trim(new.id_number), '') = '' then new.id_number := null; end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists hr_employee_private_guard on public.hr_employee_private;
create trigger hr_employee_private_guard before insert or update on public.hr_employee_private
  for each row execute function public.hr_employee_private_guard();

-- Notes were on the employee row (readable by View); they are personal in
-- his app. Copy them over, then clear the old column (kept, now unused).
insert into public.hr_employee_private (workspace_id, employee_id, notes)
select e.workspace_id, e.id, e.notes from public.hr_employees e where trim(e.notes) <> ''
on conflict (employee_id) do nothing;
update public.hr_employees set notes = '' where trim(notes) <> ''
   and exists (select 1 from public.hr_employee_private p where p.employee_id = hr_employees.id and trim(p.notes) <> '');

-- ── The employee guard: numbers, positions, the rest as before ──
-- People without a number get one now (oldest first); numbers given stay.
do $$
declare r record;
begin
  for r in select id, workspace_id from public.hr_employees where coalesce(trim(employee_no), '') = '' order by created_at, id loop
    update public.hr_employees set employee_no = public.hr_next_number(r.workspace_id, 'E') where id = r.id;
  end loop;
end $$;

create or replace function public.hr_employee_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cursor_id uuid := new.manager_id;
  steps int := 0;
  pos public.hr_job_positions;
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

  -- The number is the system's: made on entry (a maintenance script may bring
  -- its own), and never changed once given (his rule).
  if tg_op = 'INSERT' then
    if auth.uid() is not null or coalesce(trim(new.employee_no), '') = '' then
      new.employee_no := public.hr_next_number(new.workspace_id, 'E');
    end if;
  elsif coalesce(trim(old.employee_no), '') <> '' and new.employee_no is distinct from old.employee_no then
    raise exception 'HR_NUMBER_LOCKED: an employee''s number never changes' using errcode = 'P0001';
  end if;

  -- The display title follows the position.
  if new.job_id is not null then
    select * into pos from public.hr_job_positions where id = new.job_id;
    new.job_title := coalesce(nullif(trim(pos.name_en), ''), pos.name_ar);
  elsif tg_op = 'INSERT' or new.job_id is distinct from old.job_id then
    new.job_title := '';
  end if;

  if tg_op = 'UPDATE' then new.updated_by := coalesce(auth.uid(), new.updated_by); end if;
  return new;
end $$;

-- A renamed position renames the title shown on its people.
create or replace function public.hr_job_position_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name_en is distinct from old.name_en or new.name_ar is distinct from old.name_ar then
    update public.hr_employees set job_title = coalesce(nullif(trim(new.name_en), ''), new.name_ar) where job_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists hr_job_position_sync on public.hr_job_positions;
create trigger hr_job_position_sync after update on public.hr_job_positions
  for each row execute function public.hr_job_position_sync();

-- Titles that now have a position take its text (a re-run changes nothing).
update public.hr_employees e set job_title = coalesce(nullif(trim(p.name_en), ''), p.name_ar)
  from public.hr_job_positions p where p.id = e.job_id and e.job_title is distinct from coalesce(nullif(trim(p.name_en), ''), p.name_ar);

-- ── Row level security ──
alter table public.hr_job_positions enable row level security;
alter table public.hr_employee_private enable row level security;

drop policy if exists hr_job_positions_read on public.hr_job_positions;
create policy hr_job_positions_read on public.hr_job_positions for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
drop policy if exists hr_job_positions_insert on public.hr_job_positions;
create policy hr_job_positions_insert on public.hr_job_positions for insert to authenticated
  with check (public.has_section(workspace_id, 'hr', 'manage') and created_by = auth.uid());
drop policy if exists hr_job_positions_update on public.hr_job_positions;
create policy hr_job_positions_update on public.hr_job_positions for update to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'))
  with check (public.has_section(workspace_id, 'hr', 'manage'));

drop policy if exists hr_employee_private_all on public.hr_employee_private;
create policy hr_employee_private_all on public.hr_employee_private for all to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'))
  with check (public.has_section(workspace_id, 'hr', 'manage'));

-- Employees: Manage adds, edits and deletes (his hr.manage); a person who
-- was used anywhere is not deletable (the foreign keys refuse), so ending
-- employment stays the way out for everyone who ever worked.
drop policy if exists hr_employees_insert on public.hr_employees;
create policy hr_employees_insert on public.hr_employees for insert to authenticated
  with check (public.has_section(workspace_id, 'hr', 'manage') and created_by = auth.uid());
drop policy if exists hr_employees_update on public.hr_employees;
create policy hr_employees_update on public.hr_employees for update to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'))
  with check (public.has_section(workspace_id, 'hr', 'manage'));
drop policy if exists hr_employees_delete on public.hr_employees;
create policy hr_employees_delete on public.hr_employees for delete to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'));

-- ── Deleting a person never used anywhere (Manage) ──
-- Returns the files of their papers, for the browser to remove from Storage
-- (SQL cannot remove the stored file itself). The foreign keys decide
-- whether the person was ever used; a refusal changes nothing.
-- (hr_documents.file_path is added in part 2; the function reads it
-- dynamically so this file can run first.)
create or replace function public.hr_employee_delete(ws uuid, emp uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare files text[] := '{}';
begin
  if not public.has_section(ws, 'hr', 'manage') then
    raise exception 'HR_NOT_ALLOWED: only Manage deletes an employee' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.hr_employees where id = emp and workspace_id = ws) then
    raise exception 'HR_NOT_FOUND: no such employee here' using errcode = 'P0001';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hr_documents' and column_name = 'file_path') then
    execute 'select coalesce(array_agg(file_path), ''{}'') from public.hr_documents where employee_id = $1 and workspace_id = $2 and file_path is not null'
      into files using emp, ws;
  end if;
  begin
    delete from public.hr_employees where id = emp and workspace_id = ws;
  exception when foreign_key_violation then
    raise exception 'HR_EMPLOYEE_IN_USE: this person is used elsewhere (contracts, leave, attendance, a team); end their employment instead' using errcode = 'P0001';
  end;
  return files;
end $$;
revoke all on function public.hr_employee_delete(uuid, uuid) from public, anon;
grant execute on function public.hr_employee_delete(uuid, uuid) to authenticated;

-- ── History: every change to these rows, kept (Manage reads) ──
create table if not exists public.hr_audit (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null,
  table_name   text not null,
  row_id       uuid not null,
  -- The employee the row belongs to (the row itself for an employee), so a
  -- person's page can ask for their history.
  employee_id  uuid,
  action       text not null check (action in ('insert', 'update', 'delete')),
  changed_by   uuid,
  changed_at   timestamptz not null default now(),
  old_data     jsonb,
  new_data     jsonb
);
create index if not exists hr_audit_employee_idx on public.hr_audit (workspace_id, employee_id, id desc);
create index if not exists hr_audit_row_idx on public.hr_audit (workspace_id, table_name, row_id, id desc);
-- A company's history goes with the company.
do $$ begin
  alter table public.hr_audit add constraint hr_audit_workspace_fk foreign key (workspace_id) references public.workspaces(id) on delete cascade;
exception when duplicate_object then null; end $$;
alter table public.hr_audit enable row level security;
drop policy if exists hr_audit_read on public.hr_audit;
create policy hr_audit_read on public.hr_audit for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'));
revoke insert, update, delete on public.hr_audit from anon, authenticated;

create or replace function public.hr_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb; emp uuid; rid uuid;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  -- Deleting a whole company deletes its history with it, not into it.
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces where id = (r->>'workspace_id')::uuid) then
    return old;
  end if;
  rid := coalesce((r->>'id')::uuid, (r->>'employee_id')::uuid);
  emp := case when tg_table_name = 'hr_employees' then (r->>'id')::uuid else (r->>'employee_id')::uuid end;
  insert into public.hr_audit (workspace_id, table_name, row_id, employee_id, action, changed_by, old_data, new_data)
  values ((r->>'workspace_id')::uuid, tg_table_name, rid, emp, lower(tg_op), auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['hr_employees', 'hr_employee_private', 'hr_departments', 'hr_job_positions', 'hr_documents', 'hr_leave_types'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.hr_audit_row()', t || '_audit', t);
  end loop;
end $$;
