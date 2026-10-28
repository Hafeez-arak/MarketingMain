-- ─── v2 HR, part 3: attendance ─────────────────────────────────────────────
-- 2026-10-28. One record per employee per day: in and out times (Riyadh
-- wall-clock) and a status. Entered by hand for now; a fingerprint device is
-- out of scope (dev/erp-pilot/HR.md says what connecting one would take, and
-- `source` is ready for it).
--
-- Rules rewritten from Musa's ERP:
--   · not in the future, and only while the person is employed (from the hire
--     date, up to the end date)
--   · nobody is present on a day of their approved leave
--   · present and late need the arrival time; absent and leave have no times;
--     leaving is after arriving, the same day (no night shifts yet)
--   · a change to a saved record is a CORRECTION: it needs a reason, and who
--     corrected it, when, and the record before and after are kept in
--     hr_attendance_changes. Filling in a missing departure is not a
--     correction (the day simply went on).
--
-- Who: View reads; Work records and corrects; Manage also deletes a record
-- made by mistake. Corrections go through hr_attendance_update() (no update
-- policy), so the reason and the history cannot be skipped.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create table if not exists public.hr_attendance (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  employee_id       uuid not null,
  day               date not null,
  status            text not null check (status in ('present', 'late', 'absent', 'leave')),
  check_in          time,
  check_out         time,
  notes             text not null default '',
  -- 'device' is for a fingerprint device later; everything today is 'manual'.
  source            text not null default 'manual' check (source in ('manual', 'device')),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  corrected_by      uuid references auth.users(id) on delete set null,
  corrected_at      timestamptz,
  correction_reason text,
  updated_at        timestamptz not null default now(),
  constraint hr_attendance_employee_fk foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id),
  constraint hr_attendance_one_a_day unique (employee_id, day),
  constraint hr_attendance_times check (
    case when status in ('present', 'late') then check_in is not null
         else check_in is null and check_out is null end
    and (check_out is null or check_in is null or check_out > check_in)
  ),
  constraint hr_attendance_corrected check ((corrected_by is null) = (corrected_at is null))
);
create index if not exists hr_attendance_ws_day_idx on public.hr_attendance (workspace_id, day);

-- Every change to a saved record: who, when, why, before and after.
create table if not exists public.hr_attendance_changes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  attendance_id uuid not null references public.hr_attendance(id) on delete cascade,
  kind          text not null check (kind in ('correction', 'departure')),
  reason        text not null default '',
  before        jsonb not null,
  after         jsonb not null,
  changed_by    uuid references auth.users(id) on delete set null,
  changed_at    timestamptz not null default now()
);
create index if not exists hr_attendance_changes_idx on public.hr_attendance_changes (attendance_id, changed_at);

create or replace function public.hr_attendance_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  emp public.hr_employees;
begin
  if new.day > public.hr_today() then
    raise exception 'HR_ATTENDANCE_FUTURE: that day has not come yet' using errcode = 'P0001';
  end if;
  select * into emp from public.hr_employees where id = new.employee_id;
  if new.day < emp.hire_date or (emp.end_date is not null and new.day > emp.end_date) then
    raise exception 'HR_ATTENDANCE_NOT_EMPLOYED: not employed on that day' using errcode = 'P0001';
  end if;
  if new.status in ('present', 'late') and exists (
    select 1 from public.hr_leave_requests r
     where r.employee_id = new.employee_id and r.status = 'approved'
       and new.day between r.date_from and r.date_to
  ) then
    raise exception 'HR_ATTENDANCE_ON_LEAVE: approved leave that day' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.workspace_id, new.employee_id, new.day, new.created_by, new.created_at)
     is distinct from (old.workspace_id, old.employee_id, old.day, old.created_by, old.created_at) then
    raise exception 'HR_ATTENDANCE_LOCKED: whose day it is does not change' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists hr_attendance_guard on public.hr_attendance;
create trigger hr_attendance_guard before insert or update on public.hr_attendance
  for each row execute function public.hr_attendance_guard();

/*
 * Change a saved record. Filling in a missing departure (nothing else
 * changed) needs no reason; anything else is a correction and does.
 * Returns the saved row.
 */
create or replace function public.hr_attendance_update(
  ws uuid, attendance_id uuid, new_status text, new_in time, new_out time, new_notes text, reason text default ''
)
returns public.hr_attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.hr_attendance;
  b public.hr_attendance;
  kind text;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'HR_SIGNED_OUT' using errcode = 'P0001';
  end if;
  if not public.has_section(ws, 'hr', 'work') then
    raise exception 'HR_NO_ACCESS: recording attendance needs Work' using errcode = 'P0001';
  end if;
  select * into a from public.hr_attendance where id = attendance_id and workspace_id = ws for update;
  if not found then
    raise exception 'HR_NOT_FOUND: no such record here' using errcode = 'P0001';
  end if;
  if (a.status, a.check_in, a.check_out, a.notes) is not distinct from (new_status, new_in, new_out, coalesce(new_notes, '')) then
    return a;
  end if;
  kind := case when a.check_out is null and new_out is not null
                 and (a.status, a.check_in) is not distinct from (new_status, new_in) then 'departure'
               else 'correction' end;
  if kind = 'correction' and length(trim(coalesce(reason, ''))) = 0 then
    raise exception 'HR_ATTENDANCE_REASON: a correction needs its reason' using errcode = 'P0001';
  end if;
  update public.hr_attendance
     set status = new_status, check_in = new_in, check_out = new_out, notes = coalesce(new_notes, ''),
         corrected_by = case when kind = 'correction' then me else corrected_by end,
         corrected_at = case when kind = 'correction' then now() else corrected_at end,
         correction_reason = case when kind = 'correction' then trim(reason) else correction_reason end
   where id = a.id
   returning * into b;
  insert into public.hr_attendance_changes (workspace_id, attendance_id, kind, reason, before, after, changed_by)
  values (ws, a.id, kind, trim(coalesce(reason, '')),
          jsonb_build_object('status', a.status, 'check_in', a.check_in, 'check_out', a.check_out, 'notes', a.notes),
          jsonb_build_object('status', b.status, 'check_in', b.check_in, 'check_out', b.check_out, 'notes', b.notes),
          me);
  return b;
end $$;

-- ── Row level security ──
alter table public.hr_attendance enable row level security;
alter table public.hr_attendance_changes enable row level security;

drop policy if exists hr_attendance_read on public.hr_attendance;
create policy hr_attendance_read on public.hr_attendance for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
drop policy if exists hr_attendance_insert on public.hr_attendance;
create policy hr_attendance_insert on public.hr_attendance for insert to authenticated
  with check (public.has_section(workspace_id, 'hr', 'work') and created_by = auth.uid()
              and source = 'manual' and corrected_by is null);
drop policy if exists hr_attendance_delete on public.hr_attendance;
create policy hr_attendance_delete on public.hr_attendance for delete to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'));

drop policy if exists hr_attendance_changes_read on public.hr_attendance_changes;
create policy hr_attendance_changes_read on public.hr_attendance_changes for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));

revoke all on function public.hr_attendance_update(uuid, uuid, text, time, time, text, text) from public, anon;
grant execute on function public.hr_attendance_update(uuid, uuid, text, time, time, text, text) to authenticated;
