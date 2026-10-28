-- ─── v2 HR parity, part 3: contracts ───────────────────────────────────────
-- 2026-10-29. Contracts get his workflow (money excepted):
--
--   · a number, HC-YYYY-NNNNNN, made by the system and never changed
--   · weekly hours (more than 0, at most 168), optional
--   · a status: draft → running | cancelled; running → expired | cancelled
--   · terms are fixed once a contract leaves draft: only the status, the end
--     date (when it is closed) and the notes may change; a change of terms is
--     a new contract
--   · one running contract per employee (a partial unique index)
--   · a contract is made for an employee still employed
--   · a fixed-term contract has its end date; closing a running contract
--     sets its end date (not before the start)
--   · no deleting: a mistaken contract is cancelled (his app has no delete)
--   · "ending soon": running, with an end date within 60 days
--
-- The first port derived the state from the dates and refused overlapping
-- contracts; his rule is "one running", so the overlap trigger goes. The
-- rows already there are kept in place: ended → expired, running today →
-- running, starting later → draft.
--
-- Who: his hr.contracts is Manage here (reads and writes). The employee
-- themselves reads their own. View badges "no running contract" through
-- hr_running_contracts() without reading any contract.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

alter table public.hr_contracts add column if not exists contract_no text;
alter table public.hr_contracts add column if not exists weekly_hours numeric(5,2);
alter table public.hr_contracts add column if not exists status text;
do $$ begin
  alter table public.hr_contracts add constraint hr_contracts_weekly_hours check (weekly_hours is null or (weekly_hours > 0 and weekly_hours <= 168));
exception when duplicate_object then null; end $$;

-- Old rows: state from the dates, once.
update public.hr_contracts set status = case
    when end_date is not null and end_date < public.hr_today() then 'expired'
    when start_date > public.hr_today() then 'draft'
    else 'running' end
 where status is null;
do $$
declare r record;
begin
  for r in select id, workspace_id from public.hr_contracts where contract_no is null order by created_at, id loop
    update public.hr_contracts set contract_no = public.hr_next_number(r.workspace_id, 'HC') where id = r.id;
  end loop;
end $$;
alter table public.hr_contracts alter column status set default 'draft';
alter table public.hr_contracts alter column status set not null;
alter table public.hr_contracts alter column contract_no set not null;
do $$ begin
  alter table public.hr_contracts add constraint hr_contracts_status check (status in ('draft', 'running', 'expired', 'cancelled'));
exception when duplicate_object then null; end $$;
create unique index if not exists hr_contracts_no_uq on public.hr_contracts (workspace_id, lower(contract_no));
create unique index if not exists hr_contracts_one_running on public.hr_contracts (employee_id) where status = 'running';
create index if not exists hr_contracts_ws_status_idx on public.hr_contracts (workspace_id, status);

-- Contracts are never deleted: the employee's row may not vanish under them
-- either (his foreign key has no cascade). A whole company still goes at once.
alter table public.hr_contracts drop constraint if exists hr_contracts_employee_fk;
alter table public.hr_contracts add constraint hr_contracts_employee_fk
  foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id);

-- The guard replaces the first port's overlap rule.
create or replace function public.hr_contract_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare emp_status text;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'running') then
      raise exception 'HR_CONTRACT_TRANSITION: a contract starts as draft or running' using errcode = 'P0001';
    end if;
    select status into emp_status from public.hr_employees where id = new.employee_id;
    if emp_status is distinct from 'active' then
      raise exception 'HR_EMPLOYEE_NOT_ACTIVE: this employee has left' using errcode = 'P0001';
    end if;
    -- The number is the system's (a maintenance script may bring its own).
    if auth.uid() is not null or coalesce(trim(new.contract_no), '') = '' then
      new.contract_no := public.hr_next_number(new.workspace_id, 'HC');
    end if;
    return new;
  end if;

  if new.employee_id <> old.employee_id or new.workspace_id <> old.workspace_id or new.contract_no is distinct from old.contract_no then
    raise exception 'HR_CONTRACT_LOCKED: the owner and the number of a contract are fixed' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not (
       (old.status = 'draft'   and new.status in ('running', 'cancelled'))
    or (old.status = 'running' and new.status in ('expired', 'cancelled'))
  ) then
    raise exception 'HR_CONTRACT_TRANSITION: % to % is not allowed', old.status, new.status using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and (
       (to_jsonb(new) - 'status' - 'end_date' - 'notes' - 'updated_at') <> (to_jsonb(old) - 'status' - 'end_date' - 'notes' - 'updated_at')
       or (new.end_date is distinct from old.end_date and new.status = old.status)
  ) then
    raise exception 'HR_CONTRACT_LOCKED: the terms of a % contract cannot change; make a new contract', old.status using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists hr_contract_guard on public.hr_contracts;
create trigger hr_contract_guard before insert or update on public.hr_contracts
  for each row execute function public.hr_contract_guard();

-- ── Who ──
drop policy if exists hr_contracts_read on public.hr_contracts;
create policy hr_contracts_read on public.hr_contracts for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage')
         or (public.has_section(workspace_id, 'hr', 'view') and employee_id = public.hr_my_employee(workspace_id)));
drop policy if exists hr_contracts_write on public.hr_contracts;
drop policy if exists hr_contracts_insert on public.hr_contracts;
create policy hr_contracts_insert on public.hr_contracts for insert to authenticated
  with check (public.has_section(workspace_id, 'hr', 'manage') and created_by = auth.uid());
drop policy if exists hr_contracts_update on public.hr_contracts;
create policy hr_contracts_update on public.hr_contracts for update to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'))
  with check (public.has_section(workspace_id, 'hr', 'manage'));
-- (no delete policy: a contract is cancelled, never removed)

-- Which employees have a running contract, for the directory's badge (View
-- may know that, not read the contract).
create or replace function public.hr_running_contracts(ws uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.employee_id from public.hr_contracts c
   where c.workspace_id = ws and c.status = 'running' and public.has_section(ws, 'hr', 'view');
$$;
revoke all on function public.hr_running_contracts(uuid) from public, anon;
grant execute on function public.hr_running_contracts(uuid) to authenticated;

-- Contracts join the history.
drop trigger if exists hr_contracts_audit on public.hr_contracts;
create trigger hr_contracts_audit after insert or update or delete on public.hr_contracts
  for each row execute function public.hr_audit_row();
