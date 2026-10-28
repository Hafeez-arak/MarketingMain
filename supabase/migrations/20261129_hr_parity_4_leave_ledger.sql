-- ─── v2 HR parity, part 4: the leave ledger and who decides ────────────────
-- 2026-10-29. Leave balances become his ledger of allocations:
--
--   · an allocation is days (never 0; a negative one is a correction),
--     valid from–to, with a reason that must be written and who granted it
--   · allocations are never edited or deleted: a correction is a new entry
--   · a balance on a day = the allocations valid that day − the approved
--     days of requests starting inside one of those windows (counted once)
--   · "all active employees" grants the same days to each, as separate
--     entries, in one go
--   · approving a request of a type that keeps a balance needs the balance
--     on the request's first day to cover it; approvals of one person are
--     serialised
--
-- The first port's one-number-per-year table (hr_leave_balances) is kept, in
-- place and unchanged, closed to the app; each row became an allocation
-- covering that calendar year.
--
-- Who decides (his hr.leave_approve = Manage here): Manage approves, rejects
-- and cancels approved leave; nobody decides their own. The first port also
-- let an employee's direct manager decide; his app does not, so that path is
-- gone. The employee (or Manage) cancels a pending request. Asking: the
-- employee for themselves (View, login linked), Manage for anyone.
--
-- Leave types: whether a type is paid and whether it keeps a balance are
-- fixed once it exists (his screen lets only the English name and "in use"
-- change).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create table if not exists public.hr_leave_allocations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  employee_id   uuid not null,
  leave_type_id uuid not null,
  days          numeric(6,2) not null check (days <> 0 and days between -365 and 365),
  valid_from    date not null,
  valid_to      date not null,
  reason        text not null check (length(trim(reason)) > 0),
  approved_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint hr_leave_allocations_dates check (valid_to >= valid_from),
  constraint hr_leave_allocations_employee_fk foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id),
  constraint hr_leave_allocations_type_fk foreign key (workspace_id, leave_type_id) references public.hr_leave_types (workspace_id, id)
);
create index if not exists hr_leave_allocations_emp_idx on public.hr_leave_allocations (employee_id, leave_type_id, valid_from);

-- A ledger: no edits, no deletes (a whole company going is the one exception).
create or replace function public.hr_leave_allocation_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces where id = old.workspace_id) then
    return old;
  end if;
  raise exception 'HR_ALLOCATION_IMMUTABLE: add a new allocation instead (a negative one corrects)' using errcode = 'P0001';
end $$;
drop trigger if exists hr_leave_allocation_immutable on public.hr_leave_allocations;
create trigger hr_leave_allocation_immutable before update or delete on public.hr_leave_allocations
  for each row execute function public.hr_leave_allocation_immutable();

-- The first port's balances, once, as allocations of their calendar year.
do $$
begin
  if to_regclass('public.hr_leave_balances') is not null then
    insert into public.hr_leave_allocations (workspace_id, employee_id, leave_type_id, days, valid_from, valid_to, reason, approved_by)
    select b.workspace_id, b.employee_id, b.leave_type_id, b.days, make_date(b.year, 1, 1), make_date(b.year, 12, 31),
           coalesce(nullif(trim(b.note), ''), 'Yearly balance carried over'), b.updated_by
      from public.hr_leave_balances b
     where b.days > 0
       and not exists (select 1 from public.hr_leave_allocations a
                        where a.employee_id = b.employee_id and a.leave_type_id = b.leave_type_id
                          and a.valid_from = make_date(b.year, 1, 1) and a.valid_to = make_date(b.year, 12, 31) and a.days = b.days);
    alter table public.hr_leave_balances enable row level security;
    drop policy if exists hr_leave_balances_read on public.hr_leave_balances;
    drop policy if exists hr_leave_balances_write on public.hr_leave_balances;
    revoke all on public.hr_leave_balances from anon, authenticated;
  end if;
end $$;
drop function if exists public.hr_leave_balance(uuid, uuid, integer);

-- ── The balance on a day ──
create or replace function public.hr_leave_balance_raw(emp uuid, typ uuid, on_day date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(a.days) from public.hr_leave_allocations a
                    where a.employee_id = emp and a.leave_type_id = typ and on_day between a.valid_from and a.valid_to), 0)
       - coalesce((select sum(r.days) from public.hr_leave_requests r
                    where r.employee_id = emp and r.leave_type_id = typ and r.status = 'approved'
                      and exists (select 1 from public.hr_leave_allocations a
                                   where a.employee_id = emp and a.leave_type_id = typ
                                     and on_day between a.valid_from and a.valid_to
                                     and r.date_from between a.valid_from and a.valid_to)), 0);
$$;
revoke all on function public.hr_leave_balance_raw(uuid, uuid, date) from public, anon, authenticated;

-- What the browser may ask: Manage any employee's, a person their own.
create or replace function public.hr_leave_balance_on(emp uuid, typ uuid, on_day date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select public.hr_leave_balance_raw(emp, typ, on_day)
   where exists (select 1 from public.hr_employees e
                  where e.id = emp and (public.has_section(e.workspace_id, 'hr', 'manage')
                        or (public.has_section(e.workspace_id, 'hr', 'view') and e.user_id = auth.uid())));
$$;
revoke all on function public.hr_leave_balance_on(uuid, uuid, date) from public, anon;
grant execute on function public.hr_leave_balance_on(uuid, uuid, date) to authenticated;

-- ── Granting (Manage): one employee, or all active ones ──
create or replace function public.hr_leave_allocate(ws uuid, emp uuid, typ uuid, p_days numeric, p_from date, p_to date, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer := 0; e record;
begin
  if not public.has_section(ws, 'hr', 'manage') then
    raise exception 'HR_NOT_ALLOWED: only Manage grants leave balances' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.hr_leave_types where id = typ and workspace_id = ws) then
    raise exception 'HR_NOT_FOUND: no such leave type here' using errcode = 'P0001';
  end if;
  for e in select id from public.hr_employees
            where workspace_id = ws and status = 'active' and (emp is null or id = emp) loop
    insert into public.hr_leave_allocations (workspace_id, employee_id, leave_type_id, days, valid_from, valid_to, reason, approved_by)
    values (ws, e.id, typ, p_days, p_from, p_to, p_reason, auth.uid());
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'HR_NOT_FOUND: no active employee to grant to' using errcode = 'P0001';
  end if;
  return n;
end $$;
revoke all on function public.hr_leave_allocate(uuid, uuid, uuid, numeric, date, date, text) from public, anon;
grant execute on function public.hr_leave_allocate(uuid, uuid, uuid, numeric, date, date, text) to authenticated;

-- ── Deciding ──
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
    if not public.has_section(ws, 'hr', 'manage') then
      raise exception 'HR_LEAVE_NOT_APPROVER: only HR managers decide leave' using errcode = 'P0001';
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
      left_days := public.hr_leave_balance_raw(r.employee_id, r.leave_type_id, r.date_from);
      if r.days > left_days then
        raise exception 'HR_LEAVE_BALANCE: % days left, % asked', left_days, r.days using errcode = 'P0001';
      end if;
    end if;
    update public.hr_leave_requests
       set status = 'approved', decided_by = me, decided_at = now(), decision_note = trim(coalesce(note, ''))
     where id = r.id returning * into r;
    return r;
  elsif action = 'cancel' then
    if r.status = 'pending' then
      -- (emp_user is null when no login is linked: compare null-safely.)
      if not (emp_user is not distinct from me or public.has_section(ws, 'hr', 'manage')) then
        raise exception 'HR_LEAVE_NOT_YOURS: only the employee or an HR manager cancels a pending request' using errcode = 'P0001';
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
alter table public.hr_leave_allocations enable row level security;
drop policy if exists hr_leave_allocations_read on public.hr_leave_allocations;
create policy hr_leave_allocations_read on public.hr_leave_allocations for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage')
         or (public.has_section(workspace_id, 'hr', 'view') and employee_id = public.hr_my_employee(workspace_id)));
-- (no insert policy: grants go through hr_leave_allocate())
revoke insert, update, delete on public.hr_leave_allocations from anon, authenticated;

-- Asking: the employee for themselves; Manage for anyone.
drop policy if exists hr_leave_requests_insert on public.hr_leave_requests;
create policy hr_leave_requests_insert on public.hr_leave_requests for insert to authenticated
  with check (
    created_by = auth.uid() and status = 'pending' and decided_by is null and cancelled_by is null
    and (public.has_section(workspace_id, 'hr', 'manage')
         or (public.has_section(workspace_id, 'hr', 'view') and employee_id = public.hr_my_employee(workspace_id)))
  );

-- ── Leave types: paid / keeps-a-balance are fixed once made ──
create or replace function public.hr_leave_type_guard()
returns trigger
language plpgsql
as $$
begin
  if new.paid is distinct from old.paid or new.needs_balance is distinct from old.needs_balance then
    raise exception 'HR_LEAVE_TYPE_LOCKED: whether a type is paid and keeps a balance cannot change; make a new type' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists hr_leave_type_guard on public.hr_leave_types;
create trigger hr_leave_type_guard before update on public.hr_leave_types
  for each row execute function public.hr_leave_type_guard();
