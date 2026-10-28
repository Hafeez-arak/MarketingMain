-- ─── v2 HR, part 2: leave ──────────────────────────────────────────────────
-- 2026-10-28. Leave types per company, balances per employee per year, and
-- requests that a manager or HR decides. Rules rewritten from Musa's ERP
-- (dev/erp-pilot/HR.md):
--
--   · a request starts pending; pending → approved | rejected | cancelled,
--     approved → cancelled; nothing else, and a decided request never changes
--   · a rejection says why
--   · nobody decides their own request
--   · two pending/approved requests of one person never cover the same day
--   · days > 0 and no more than the calendar days asked for (weekends and
--     holidays are left out by typing fewer days)
--   · approving a type that keeps a balance needs enough left in the year
--     the leave starts in; approvals of one person are serialised so two at
--     once cannot both pass
--   · only an active employee, and only an active type, gets a new request
--
-- Who:
--   ask     Work and up for anyone; a View person for themselves (their login
--           is linked to an employee)
--   decide  Manage, or the employee's direct manager (through their linked
--           login), never the employee
--   cancel  a pending one: the employee themselves or Work and up;
--           an approved one: Manage
--   types and balances: Manage
--
-- Decisions go through hr_leave_decide() (no update policy on requests), so
-- the rules above cannot be stepped around from the browser.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create table if not exists public.hr_leave_types (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name_en       text not null default '',
  name_ar       text not null default '',
  paid          boolean not null default true,
  -- Annual leave keeps a balance; unpaid or sick leave usually does not.
  needs_balance boolean not null default true,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint hr_leave_types_named check (length(trim(name_en)) > 0 or length(trim(name_ar)) > 0),
  constraint hr_leave_types_ws_id unique (workspace_id, id)
);
create unique index if not exists hr_leave_types_name_en_uq on public.hr_leave_types (workspace_id, lower(trim(name_en))) where trim(name_en) <> '';
create unique index if not exists hr_leave_types_name_ar_uq on public.hr_leave_types (workspace_id, trim(name_ar)) where trim(name_ar) <> '';
drop trigger if exists hr_leave_types_touch on public.hr_leave_types;
create trigger hr_leave_types_touch before update on public.hr_leave_types
  for each row execute function public.hr_touch();

-- Days granted per employee, type and year. One number, changed in place by
-- Manage, with who and when (his ledger of allocations is simplified away).
create table if not exists public.hr_leave_balances (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  employee_id   uuid not null,
  leave_type_id uuid not null,
  year          integer not null check (year between 2000 and 2100),
  days          numeric(6,1) not null check (days >= 0 and days <= 366),
  note          text not null default '',
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  constraint hr_leave_balances_employee_fk foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id) on delete cascade,
  constraint hr_leave_balances_type_fk foreign key (workspace_id, leave_type_id) references public.hr_leave_types (workspace_id, id),
  constraint hr_leave_balances_one unique (employee_id, leave_type_id, year)
);
drop trigger if exists hr_leave_balances_touch on public.hr_leave_balances;
create trigger hr_leave_balances_touch before update on public.hr_leave_balances
  for each row execute function public.hr_touch();

create table if not exists public.hr_leave_requests (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  employee_id    uuid not null,
  leave_type_id  uuid not null,
  date_from      date not null,
  date_to        date not null,
  days           numeric(5,1) not null check (days > 0),
  reason         text not null default '',
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by     uuid references auth.users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text not null default '',
  cancelled_by   uuid references auth.users(id) on delete set null,
  cancelled_at   timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint hr_leave_requests_employee_fk foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id),
  constraint hr_leave_requests_type_fk foreign key (workspace_id, leave_type_id) references public.hr_leave_types (workspace_id, id),
  constraint hr_leave_requests_dates check (date_to >= date_from),
  constraint hr_leave_requests_days check (days <= (date_to - date_from + 1)),
  constraint hr_leave_requests_decided check (status not in ('approved', 'rejected') or (decided_by is not null and decided_at is not null)),
  constraint hr_leave_requests_rejected_why check (status <> 'rejected' or length(trim(decision_note)) > 0)
);
create index if not exists hr_leave_requests_employee_idx on public.hr_leave_requests (employee_id, date_from);
create index if not exists hr_leave_requests_ws_idx on public.hr_leave_requests (workspace_id, status, date_from);

-- What is left of a balance in a year: granted − approved, and what is
-- pending beside it. A type without a balance has granted = null.
create or replace function public.hr_leave_balance(emp uuid, typ uuid, yr integer)
returns table (granted numeric, used numeric, pending numeric, remaining numeric)
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select (select days from public.hr_leave_balances where employee_id = emp and leave_type_id = typ and year = yr) as granted
  ), r as (
    select coalesce(sum(days) filter (where status = 'approved'), 0) as used,
           coalesce(sum(days) filter (where status = 'pending'), 0) as pending
      from public.hr_leave_requests
     where employee_id = emp and leave_type_id = typ and extract(year from date_from) = yr
  )
  select b.granted, r.used, r.pending, coalesce(b.granted, 0) - r.used from b, r
   where exists (select 1 from public.hr_employees e where e.id = emp and public.has_section(e.workspace_id, 'hr', 'view'));
$$;

-- The request's shape, transitions and locks, whoever writes it.
create or replace function public.hr_leave_request_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  emp public.hr_employees;
  typ public.hr_leave_types;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'HR_LEAVE_TRANSITION: a request starts as pending' using errcode = 'P0001';
    end if;
    select * into emp from public.hr_employees where id = new.employee_id;
    if emp.status <> 'active' then
      raise exception 'HR_EMPLOYEE_NOT_ACTIVE: this employee has left' using errcode = 'P0001';
    end if;
    select * into typ from public.hr_leave_types where id = new.leave_type_id;
    if not typ.active then
      raise exception 'HR_LEAVE_TYPE_ARCHIVED: that leave type is no longer used' using errcode = 'P0001';
    end if;
  else
    if new.status <> old.status and not (
         (old.status = 'pending' and new.status in ('approved', 'rejected', 'cancelled'))
      or (old.status = 'approved' and new.status = 'cancelled')
    ) then
      raise exception 'HR_LEAVE_TRANSITION: % to % is not allowed', old.status, new.status using errcode = 'P0001';
    end if;
    -- The request itself never changes after it is made: only its outcome.
    if (new.workspace_id, new.employee_id, new.leave_type_id, new.date_from, new.date_to, new.days, new.reason, new.created_by, new.created_at)
       is distinct from
       (old.workspace_id, old.employee_id, old.leave_type_id, old.date_from, old.date_to, old.days, old.reason, old.created_by, old.created_at) then
      raise exception 'HR_LEAVE_LOCKED: a request is not edited; cancel it and ask again' using errcode = 'P0001';
    end if;
  end if;

  if new.status in ('pending', 'approved') and exists (
    select 1 from public.hr_leave_requests o
     where o.employee_id = new.employee_id and o.id <> new.id and o.status in ('pending', 'approved')
       and o.date_from <= new.date_to and o.date_to >= new.date_from
  ) then
    raise exception 'HR_LEAVE_OVERLAP: another request covers these dates' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists hr_leave_request_guard on public.hr_leave_requests;
create trigger hr_leave_request_guard before insert or update on public.hr_leave_requests
  for each row execute function public.hr_leave_request_guard();

/*
 * Approve, reject or cancel a request. Returns the saved row. Every rule of
 * who may, and the balance, is checked here; the trigger above checks the
 * transition and the lock again.
 */
create or replace function public.hr_leave_decide(ws uuid, request_id uuid, action text, note text default '')
returns public.hr_leave_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.hr_leave_requests;
  typ public.hr_leave_types;
  emp_user uuid;
  left_days numeric;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'HR_SIGNED_OUT' using errcode = 'P0001';
  end if;
  select * into r from public.hr_leave_requests where id = request_id and workspace_id = ws;
  if not found or not public.has_section(ws, 'hr', 'view') then
    raise exception 'HR_NOT_FOUND: no such request here' using errcode = 'P0001';
  end if;
  -- One decision per person at a time: the balance check below cannot race.
  perform 1 from public.hr_employees where id = r.employee_id for update;
  select * into r from public.hr_leave_requests where id = request_id;
  select user_id into emp_user from public.hr_employees where id = r.employee_id;

  if action in ('approve', 'reject') then
    if r.status <> 'pending' then
      raise exception 'HR_LEAVE_TRANSITION: only a pending request is decided' using errcode = 'P0001';
    end if;
    if emp_user is not distinct from me then
      raise exception 'HR_LEAVE_SELF_DECISION: nobody decides their own leave' using errcode = 'P0001';
    end if;
    if not (public.has_section(ws, 'hr', 'manage') or public.hr_is_manager_of(r.employee_id)) then
      raise exception 'HR_LEAVE_NOT_APPROVER: only HR managers or the direct manager decide' using errcode = 'P0001';
    end if;
    if action = 'reject' then
      if length(trim(coalesce(note, ''))) = 0 then
        raise exception 'HR_LEAVE_REJECT_WHY: say why it is rejected' using errcode = 'P0001';
      end if;
      update public.hr_leave_requests
         set status = 'rejected', decided_by = me, decided_at = now(), decision_note = trim(note)
       where id = r.id returning * into r;
      return r;
    end if;
    select * into typ from public.hr_leave_types where id = r.leave_type_id;
    if typ.needs_balance then
      select b.remaining into left_days from public.hr_leave_balance(r.employee_id, r.leave_type_id, extract(year from r.date_from)::int) b;
      if r.days > coalesce(left_days, 0) then
        raise exception 'HR_LEAVE_BALANCE: % days left, % asked', coalesce(left_days, 0), r.days using errcode = 'P0001';
      end if;
    end if;
    update public.hr_leave_requests
       set status = 'approved', decided_by = me, decided_at = now(), decision_note = trim(coalesce(note, ''))
     where id = r.id returning * into r;
    return r;
  elsif action = 'cancel' then
    if r.status = 'pending' then
      -- (emp_user is null when no login is linked: compare null-safely.)
      if not (emp_user is not distinct from me or public.has_section(ws, 'hr', 'work')) then
        raise exception 'HR_LEAVE_NOT_YOURS: only the employee or HR cancels a pending request' using errcode = 'P0001';
      end if;
    elsif r.status = 'approved' then
      if not public.has_section(ws, 'hr', 'manage') then
        raise exception 'HR_LEAVE_NOT_APPROVER: only HR managers cancel approved leave' using errcode = 'P0001';
      end if;
    else
      raise exception 'HR_LEAVE_TRANSITION: % cannot be cancelled', r.status using errcode = 'P0001';
    end if;
    update public.hr_leave_requests
       set status = 'cancelled', cancelled_by = me, cancelled_at = now(),
           decision_note = case when length(trim(coalesce(note, ''))) > 0 then trim(note) else decision_note end
     where id = r.id returning * into r;
    return r;
  end if;
  raise exception 'HR_UNKNOWN_ACTION: %', action using errcode = 'P0001';
end $$;

-- ── Row level security ──
alter table public.hr_leave_types enable row level security;
alter table public.hr_leave_balances enable row level security;
alter table public.hr_leave_requests enable row level security;

drop policy if exists hr_leave_types_read on public.hr_leave_types;
create policy hr_leave_types_read on public.hr_leave_types for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
drop policy if exists hr_leave_types_write on public.hr_leave_types;
create policy hr_leave_types_write on public.hr_leave_types for all to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'))
  with check (public.has_section(workspace_id, 'hr', 'manage'));

drop policy if exists hr_leave_balances_read on public.hr_leave_balances;
create policy hr_leave_balances_read on public.hr_leave_balances for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
drop policy if exists hr_leave_balances_write on public.hr_leave_balances;
create policy hr_leave_balances_write on public.hr_leave_balances for all to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'))
  with check (public.has_section(workspace_id, 'hr', 'manage') and updated_by = auth.uid());

-- Requests: everyone in HR reads them (who is off is the team's business);
-- asking as above; no update or delete policy: decisions go through
-- hr_leave_decide().
drop policy if exists hr_leave_requests_read on public.hr_leave_requests;
create policy hr_leave_requests_read on public.hr_leave_requests for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
drop policy if exists hr_leave_requests_insert on public.hr_leave_requests;
create policy hr_leave_requests_insert on public.hr_leave_requests for insert to authenticated
  with check (
    created_by = auth.uid() and status = 'pending' and decided_by is null and cancelled_by is null
    and (public.has_section(workspace_id, 'hr', 'work')
         or (public.has_section(workspace_id, 'hr', 'view') and employee_id = public.hr_my_employee(workspace_id)))
  );

revoke all on function public.hr_leave_balance(uuid, uuid, integer) from public, anon;
grant execute on function public.hr_leave_balance(uuid, uuid, integer) to authenticated;
revoke all on function public.hr_leave_decide(uuid, uuid, text, text) from public, anon;
grant execute on function public.hr_leave_decide(uuid, uuid, text, text) to authenticated;
