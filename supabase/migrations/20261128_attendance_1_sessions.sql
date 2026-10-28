-- ─── v2 HR attendance, part 1: check-in / check-out sessions ───────────────
-- 2026-10-28, dev/erp-pilot/ATTENDANCE.md. The parity pass on Musa's
-- attendance (the owner: "there was a lot to attendance in Musa's app").
-- The first port (20261112_hr_3_attendance) kept one row per person per day
-- with a status; his records are check-in / check-out sessions, and every
-- screen (the board, the device pairing, lateness) is built on them. So the
-- record is rebuilt as his:
--
--   hr_attendance   a session: check-in, check-out (empty while still in),
--                   worked hours, notes, where it came from (manual, device,
--                   corrected) and, for a device record, the device day.
--                   Several a day; one open at a time; no overlaps; at most
--                   24 hours; not in the future; only for an employed person;
--                   not on a day of approved leave.
--   hr_attendance_changes  every correction: who, when, why, before, after
--                   (his general audit log, for these records).
--   hr_settings     + daily hours, the schedule's start date, the repeat-punch
--                   minutes and the employee-email switch (his
--                   attendance_settings, changes 0036/0044/0045/0046).
--
-- Not here: the project worked at (his attendances.project_id) waits for the
-- Projects module. A record is never deleted (his): a mistake is corrected.
--
-- The first shape's rows are kept, unchanged, in hr_attendance_day_records
-- (and their history in hr_attendance_changes_day); its present and late days
-- with a departure are copied in as sessions. Nobody can read the kept tables from the app.
--
-- Who: View reads; Work records, checks people in and out, and corrects;
-- Manage sets the work week and hours.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── Keep the first shape apart ──
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'hr_attendance' and column_name = 'status') then
    create table public.hr_attendance_day_records as select * from public.hr_attendance;
    create table public.hr_attendance_changes_day as select * from public.hr_attendance_changes;
    drop function if exists public.hr_attendance_update(uuid, uuid, text, time, time, text, text);
    drop table public.hr_attendance_changes;
    drop table public.hr_attendance cascade;
  end if;
end $$;
do $$
begin
  if to_regclass('public.hr_attendance_day_records') is not null then
    alter table public.hr_attendance_day_records enable row level security;
    alter table public.hr_attendance_changes_day enable row level security;
    revoke all on public.hr_attendance_day_records, public.hr_attendance_changes_day from anon, authenticated;
  end if;
end $$;

-- ── The record ──
create table if not exists public.hr_attendance (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  employee_id   uuid not null,
  check_in      timestamptz not null,
  check_out     timestamptz,
  worked_hours  numeric(6,2) generated always as (round((extract(epoch from (check_out - check_in)) / 3600)::numeric, 2)) stored,
  -- Riyadh's date of the check-in (set by the guard): the lists' day.
  day           date not null,
  notes         text not null default '',
  source        text not null default 'manual' check (source in ('manual', 'device', 'corrected')),
  -- The device's local date this record pairs (device and corrected only).
  device_day    date,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  corrected_by  uuid references auth.users(id) on delete set null,
  corrected_at  timestamptz,
  updated_at    timestamptz not null default now(),
  constraint hr_attendance_employee_fk foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id),
  constraint hr_attendance_span check (check_out is null or (check_out > check_in and check_out - check_in <= interval '24 hours')),
  constraint hr_attendance_source_day check ((source = 'manual') = (device_day is null)),
  constraint hr_attendance_corrected check ((corrected_by is null) = (corrected_at is null))
);
create unique index if not exists hr_attendance_one_open on public.hr_attendance (employee_id) where check_out is null;
create unique index if not exists hr_attendance_device_day on public.hr_attendance (workspace_id, employee_id, device_day) where device_day is not null;
create index if not exists hr_attendance_employee_idx on public.hr_attendance (employee_id, check_in);
create index if not exists hr_attendance_ws_day_idx on public.hr_attendance (workspace_id, day);

create table if not exists public.hr_attendance_changes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  attendance_id uuid not null references public.hr_attendance(id) on delete cascade,
  kind          text not null check (kind in ('correction')),
  reason        text not null default '',
  before        jsonb not null,
  after         jsonb not null,
  changed_by    uuid references auth.users(id) on delete set null,
  changed_at    timestamptz not null default now()
);
create index if not exists hr_attendance_changes_idx on public.hr_attendance_changes (attendance_id, changed_at);

-- His rules (fn_attendance_guard): not in the future, employed, no overlap,
-- not on approved leave. Ours on top: whose record it is never changes.
create or replace function public.hr_attendance_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  emp public.hr_employees;
begin
  if new.check_in > now() + interval '5 minutes' or new.check_out > now() + interval '5 minutes' then
    raise exception 'HR_ATTENDANCE_FUTURE: that time has not come yet' using errcode = 'P0001';
  end if;
  select * into emp from public.hr_employees where id = new.employee_id and workspace_id = new.workspace_id;
  if emp.status is distinct from 'active' then
    raise exception 'HR_ATTENDANCE_NOT_EMPLOYED: the employee is not employed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.hr_attendance a
              where a.employee_id = new.employee_id and a.id <> new.id
                and a.check_in < coalesce(new.check_out, 'infinity') and coalesce(a.check_out, 'infinity') > new.check_in) then
    raise exception 'HR_ATTENDANCE_OVERLAP: it overlaps another record of the same person' using errcode = 'P0001';
  end if;
  new.day := (new.check_in at time zone 'Asia/Riyadh')::date;
  if exists (select 1 from public.hr_leave_requests r
              where r.employee_id = new.employee_id and r.status = 'approved'
                and new.day between r.date_from and r.date_to) then
    raise exception 'HR_ATTENDANCE_ON_LEAVE: approved leave that day' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.workspace_id, new.employee_id, new.created_by, new.created_at)
     is distinct from (old.workspace_id, old.employee_id, old.created_by, old.created_at) then
    raise exception 'HR_ATTENDANCE_LOCKED: whose record it is does not change' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists hr_attendance_guard on public.hr_attendance;
create trigger hr_attendance_guard before insert or update on public.hr_attendance
  for each row execute function public.hr_attendance_guard();

-- Where a record comes from (his fn_attendance_source_guard, change 0044): a
-- device record is written by the pairing only (the transaction flag
-- hr.attendance_device, set by hr_attendance_apply_day); a person's change
-- of its times marks it corrected; the origin never changes otherwise.
create or replace function public.hr_attendance_source_guard()
returns trigger
language plpgsql
as $$
declare
  pairing boolean := current_setting('hr.attendance_device', true) = 'on';
begin
  if tg_op = 'INSERT' then
    if new.source = 'corrected' or (new.source = 'device' and not pairing) then
      raise exception 'HR_ATTENDANCE_DEVICE_ONLY: a record from the device is made from its punches' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.device_day is distinct from old.device_day
     or not ((old.source = new.source) or (old.source = 'device' and new.source = 'corrected')) then
    raise exception 'HR_ATTENDANCE_SOURCE: the origin of a record does not change' using errcode = 'P0001';
  end if;
  if new.source = 'device' and not pairing and (new.check_in, new.check_out) is distinct from (old.check_in, old.check_out) then
    raise exception 'HR_ATTENDANCE_DEVICE_ONLY: correcting a record from the device marks it corrected' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists hr_attendance_source_guard on public.hr_attendance;
create trigger hr_attendance_source_guard before insert or update on public.hr_attendance
  for each row execute function public.hr_attendance_source_guard();

-- The first shape's present and late days, as sessions (once): those with a
-- departure, and today's.
do $$
begin
  if to_regclass('public.hr_attendance_day_records') is not null
     and not exists (select 1 from public.hr_attendance) then
    insert into public.hr_attendance (workspace_id, employee_id, check_in, check_out, day, notes, created_by, created_at)
    select r.workspace_id, r.employee_id,
           (r.day + r.check_in) at time zone 'Asia/Riyadh',
           case when r.check_out is not null then (r.day + r.check_out) at time zone 'Asia/Riyadh' end,
           r.day, r.notes, r.created_by, r.created_at
      from public.hr_attendance_day_records r
      join public.hr_employees e on e.id = r.employee_id and e.status = 'active'
     where r.status in ('present', 'late') and r.check_in is not null
       -- A past day with no departure would stay "in" for ever and overlap
       -- every later day: it stays in the kept table only.
       and (r.check_out is not null or r.day = public.hr_today())
       -- and nothing that has not happened yet (test rows were written ahead).
       and (r.day + r.check_in) at time zone 'Asia/Riyadh' <= now()
       and (r.check_out is null or (r.day + r.check_out) at time zone 'Asia/Riyadh' <= now())
       and not exists (select 1 from public.hr_leave_requests l where l.employee_id = r.employee_id and l.status = 'approved'
                          and r.day between l.date_from and l.date_to)
     order by r.employee_id, r.day;
  end if;
end $$;

/*
 * Correct a saved record (Work), his update(): the times and notes, with a
 * reason (his form asks for it). A time given at the minute it already had
 * keeps its seconds (a device record keeps its punch); a device record whose
 * times change becomes corrected. Every change is kept in
 * hr_attendance_changes. Returns the saved row.
 */
create or replace function public.hr_attendance_update(
  ws uuid, attendance_id uuid, new_in timestamptz, new_out timestamptz, new_notes text
)
returns public.hr_attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.hr_attendance;
  b public.hr_attendance;
  v_in timestamptz := new_in;
  v_out timestamptz := new_out;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'HR_SIGNED_OUT' using errcode = 'P0001';
  end if;
  if not public.has_section(ws, 'hr', 'work') then
    raise exception 'HR_NO_ACCESS: recording attendance needs Work' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(new_notes, ''))) = 0 then
    raise exception 'HR_ATTENDANCE_REASON: a correction needs its reason' using errcode = 'P0001';
  end if;
  select * into a from public.hr_attendance where id = attendance_id and workspace_id = ws for update;
  if not found then
    raise exception 'HR_NOT_FOUND: no such record here' using errcode = 'P0001';
  end if;
  if date_trunc('minute', a.check_in) = date_trunc('minute', v_in) then v_in := a.check_in; end if;
  if a.check_out is not null and v_out is not null and date_trunc('minute', a.check_out) = date_trunc('minute', v_out) then v_out := a.check_out; end if;
  if (a.check_in, a.check_out, a.notes) is not distinct from (v_in, v_out, trim(new_notes)) then
    return a;
  end if;
  update public.hr_attendance
     set check_in = v_in, check_out = v_out, notes = trim(new_notes),
         source = case when source = 'device' and (v_in, v_out) is distinct from (a.check_in, a.check_out) then 'corrected' else source end,
         corrected_by = me, corrected_at = now()
   where id = a.id
   returning * into b;
  insert into public.hr_attendance_changes (workspace_id, attendance_id, kind, reason, before, after, changed_by)
  values (ws, a.id, 'correction', trim(new_notes),
          jsonb_build_object('check_in', a.check_in, 'check_out', a.check_out, 'notes', a.notes, 'source', a.source),
          jsonb_build_object('check_in', b.check_in, 'check_out', b.check_out, 'notes', b.notes, 'source', b.source),
          me);
  return b;
end $$;

-- ── Settings (his attendance_settings) ──
alter table public.hr_settings add column if not exists daily_hours numeric(4,2) check (daily_hours > 0 and daily_hours <= 24);
alter table public.hr_settings add column if not exists schedule_from date;
alter table public.hr_settings add column if not exists repeat_punch_minutes integer check (repeat_punch_minutes between 1 and 720);
alter table public.hr_settings add column if not exists employee_emails boolean not null default false;
alter table public.hr_settings add column if not exists employee_emails_changed_at timestamptz;
alter table public.hr_settings add column if not exists employee_emails_changed_by uuid references auth.users(id) on delete set null;
-- The first port had hours without a start date: they apply from the day this ran.
update public.hr_settings set schedule_from = public.hr_today()
 where work_start is not null and schedule_from is null;
update public.hr_settings set grace_minutes = 0
 where work_start is not null and grace_minutes is null;
alter table public.hr_settings drop constraint if exists hr_settings_schedule;
alter table public.hr_settings add constraint hr_settings_schedule check (
  (work_start is null) = (work_end is null)
  and (work_start is null) = (grace_minutes is null)
  and (work_start is null) = (schedule_from is null)
  and (work_start is null or work_end > work_start));

/*
 * The HR mailbox the late / early-leave emails go from (his: Microsoft Graph
 * from the HR address only). Not connected in v2 yet, so the switch cannot be
 * turned on, as in his app until the mailbox is connected.
 */
create or replace function public.hr_mailbox_ready(ws uuid)
returns boolean
language sql
stable
as $$
  select false;
$$;

-- The email switch (his change 0046): off until the company turns it on,
-- only once the HR mailbox is connected; who changed it and when is kept.
create or replace function public.hr_settings_guard()
returns trigger
language plpgsql
as $$
begin
  if new.employee_emails is distinct from (case when tg_op = 'UPDATE' then old.employee_emails else false end) then
    if new.employee_emails and not public.hr_mailbox_ready(new.workspace_id) then
      raise exception 'HR_MAILBOX_NOT_CONNECTED: connect the HR mailbox and send a test first' using errcode = 'P0001';
    end if;
    new.employee_emails_changed_at := now();
    new.employee_emails_changed_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.employee_emails_changed_at := old.employee_emails_changed_at;
    new.employee_emails_changed_by := old.employee_emails_changed_by;
  end if;
  return new;
end $$;
drop trigger if exists hr_settings_guard on public.hr_settings;
create trigger hr_settings_guard before insert or update on public.hr_settings
  for each row execute function public.hr_settings_guard();

/*
 * Check in or out now (Work), his board's button: closes the open record, or
 * opens one. Refused for someone on the device while a device is running
 * (the device records them). Returns 'in' or 'out'.
 */
create or replace function public.hr_attendance_toggle(ws uuid, employee uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  open_id uuid;
begin
  if me is null then
    raise exception 'HR_SIGNED_OUT' using errcode = 'P0001';
  end if;
  if not public.has_section(ws, 'hr', 'work') then
    raise exception 'HR_NO_ACCESS: recording attendance needs Work' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.hr_employees e where e.id = employee and e.workspace_id = ws) then
    raise exception 'HR_NOT_FOUND: no such employee here' using errcode = 'P0001';
  end if;
  if to_regclass('public.hr_devices') is not null and exists (
       select 1 from public.hr_employees e where e.id = employee and e.workspace_id = ws and e.device_user_no is not null)
     and exists (select 1 from public.hr_devices d where d.workspace_id = ws and d.active) then
    raise exception 'HR_ATTENDANCE_DEVICE_MODE: this person is recorded by the attendance device' using errcode = 'P0001';
  end if;
  select id into open_id from public.hr_attendance where employee_id = employee and workspace_id = ws and check_out is null for update;
  if open_id is not null then
    update public.hr_attendance set check_out = clock_timestamp() where id = open_id;
    return 'out';
  end if;
  insert into public.hr_attendance (workspace_id, employee_id, check_in, day, created_by)
  values (ws, employee, clock_timestamp(), public.hr_today(), me);
  return 'in';
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

drop policy if exists hr_attendance_changes_read on public.hr_attendance_changes;
create policy hr_attendance_changes_read on public.hr_attendance_changes for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));

revoke all on function public.hr_attendance_update(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.hr_attendance_update(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
revoke all on function public.hr_attendance_toggle(uuid, uuid) from public, anon;
grant execute on function public.hr_attendance_toggle(uuid, uuid) to authenticated;
grant execute on function public.hr_mailbox_ready(uuid) to authenticated;
