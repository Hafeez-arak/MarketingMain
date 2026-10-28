-- ─── v2 HR attendance, part 2: the fingerprint devices ─────────────────────
-- 2026-10-28, dev/erp-pilot/ATTENDANCE.md. Musa's change 0044, rewritten in
-- our stack: the company's ZKTeco terminals feed attendance.
--
--   hr_devices       a terminal: name, the time zone of its clock, its key
--                    (only the key's SHA-256 is kept; shown once), running or
--                    stopped. Never deleted.
--   hr_device_users  the users as the device lists them (for linking)
--   hr_device_syncs  one row per batch received (the office bridge) or
--                    uploaded by hand (a CSV file)
--   hr_punches       every punch exactly as the device reported it; never
--                    changed or deleted; the same punch again is ignored
--   hr_employees.device_user_no  the employee's number on the device
--
-- Pairing (his fn_attendance_apply_day): per employee and device day, the
-- first punch is the check-in and the last the check-out. A day with one
-- punch (or punches closer than the repeat-punch minutes) stays for review;
-- a day already recorded by hand is left to that record; a corrected record
-- is never touched again; a day the attendance rules refuse waits in the
-- review with the reason. hr_punch_days shows every device day and its state.
--
-- The bridge has no login: it calls hr_device_sync(key, payload), open to
-- anonymous callers, which finds the device by its key and refuses anything
-- else (and more than 60 batches a minute from one device). A CSV upload is
-- hr_device_upload() by Manage.
--
-- Who: View reads the punches, the review and the device list (never a key);
-- Manage registers devices, issues keys, stops them, links numbers, uploads
-- and retries.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── Devices ──
create table if not exists public.hr_devices (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (btrim(name) <> ''),
  -- IANA time zone of the device clock (it reports wall-clock time without a zone).
  timezone     text not null,
  key_hash     text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  key_hint     text not null check (key_hint ~ '^[0-9a-zA-Z]{4}$'),
  active       boolean not null default true,
  notes        text not null default '',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint hr_devices_ws_id unique (workspace_id, id)
);
create unique index if not exists hr_devices_key on public.hr_devices (key_hash);

create table if not exists public.hr_device_users (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  device_id      uuid not null,
  device_user_no text not null check (device_user_no ~ '^[0-9]{1,24}$'),
  name           text,
  enabled        boolean,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint hr_device_users_device_fk foreign key (workspace_id, device_id) references public.hr_devices (workspace_id, id),
  constraint hr_device_users_one unique (device_id, device_user_no)
);

create table if not exists public.hr_device_syncs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  device_id       uuid not null,
  source          text not null check (source in ('bridge', 'upload')),
  received        integer not null default 0 check (received >= 0),
  inserted        integer not null default 0 check (inserted >= 0),
  rejected        integer not null default 0 check (rejected >= 0),
  users_reported  integer check (users_reported >= 0),
  -- As the device reported them (SDK: serial, product code, firmware, clock).
  device_serial   text,
  device_model    text,
  device_firmware text,
  device_time     timestamp,
  remote_ip       text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint hr_device_syncs_device_fk foreign key (workspace_id, device_id) references public.hr_devices (workspace_id, id),
  constraint hr_device_syncs_ws_id unique (workspace_id, id),
  constraint hr_device_syncs_upload_by check (source <> 'upload' or created_by is not null)
);
create index if not exists hr_device_syncs_device_idx on public.hr_device_syncs (device_id, created_at);

create table if not exists public.hr_punches (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  device_id       uuid not null,
  sync_id         uuid not null,
  device_user_no  text not null check (device_user_no ~ '^[0-9]{1,24}$'),
  -- The device's wall-clock time as reported; punched_at and work_day come from it.
  local_time      timestamp not null,
  punched_at      timestamptz not null,
  work_day        date not null,
  -- The SDK's codes, kept as reported (verify mode, in/out button, work code).
  verify_mode     integer,
  in_out_mode     integer,
  work_code       integer,
  created_at      timestamptz not null default now(),
  constraint hr_punches_device_fk foreign key (workspace_id, device_id) references public.hr_devices (workspace_id, id),
  constraint hr_punches_sync_fk foreign key (workspace_id, sync_id) references public.hr_device_syncs (workspace_id, id),
  constraint hr_punches_once unique (device_id, device_user_no, local_time)
);
create index if not exists hr_punches_user_day on public.hr_punches (workspace_id, device_user_no, work_day);
create index if not exists hr_punches_sync on public.hr_punches (sync_id);
create index if not exists hr_punches_day on public.hr_punches (workspace_id, work_day);

-- ── Their rules ──
create or replace function public.hr_device_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- Only the company's own deletion takes it (the cascade of #268).
    if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      raise exception 'HR_DEVICE_DELETE: a device is never deleted; it is stopped' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'HR_DEVICE_TIMEZONE: % is not a known time zone', new.timezone using errcode = 'P0001';
  end if;
  -- The clock's zone gives every stored punch its moment: it stays once there are punches.
  if tg_op = 'UPDATE' and new.timezone is distinct from old.timezone
     and exists (select 1 from public.hr_punches p where p.device_id = old.id) then
    raise exception 'HR_DEVICE_TIMEZONE_LOCKED: the device already has punches in its time zone' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'HR_DEVICE_LOCKED' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists hr_device_guard on public.hr_devices;
create trigger hr_device_guard before insert or update or delete on public.hr_devices
  for each row execute function public.hr_device_guard();

create or replace function public.hr_device_sync_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      raise exception 'HR_SYNC_FINAL: a sync record is never deleted' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if not exists (select 1 from public.hr_devices d where d.id = new.device_id and d.active) then
    raise exception 'HR_DEVICE_INACTIVE: the device is stopped' using errcode = 'P0001';
  end if;
  -- Only its counts are filled in, inside the transaction that received it.
  if tg_op = 'UPDATE' and (old.created_at <> now()
     or (new.device_id, new.source, new.created_by, new.created_at, new.remote_ip, new.workspace_id)
        is distinct from (old.device_id, old.source, old.created_by, old.created_at, old.remote_ip, old.workspace_id)) then
    raise exception 'HR_SYNC_FINAL: a sync record is not changed after it is received' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists hr_device_sync_guard on public.hr_device_syncs;
create trigger hr_device_sync_guard before insert or update or delete on public.hr_device_syncs
  for each row execute function public.hr_device_sync_guard();

create or replace function public.hr_punch_guard()
returns trigger
language plpgsql
as $$
declare
  d public.hr_devices;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'HR_PUNCH_FINAL: a punch is kept as the device reported it' using errcode = 'P0001';
  end if;
  select * into d from public.hr_devices where id = new.device_id;
  if not d.active then
    raise exception 'HR_DEVICE_INACTIVE: the device is stopped' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.hr_device_syncs s where s.id = new.sync_id and s.device_id = new.device_id) then
    raise exception 'HR_PUNCH_SYNC: a punch arrives with a sync of its own device' using errcode = 'P0001';
  end if;
  new.punched_at := new.local_time at time zone d.timezone;
  new.work_day := new.local_time::date;
  if new.punched_at > now() + interval '5 minutes' then
    raise exception 'HR_PUNCH_FUTURE: % is in the future (check the device clock)', new.local_time using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists hr_punch_guard on public.hr_punches;
create trigger hr_punch_guard before insert or update or delete on public.hr_punches
  for each row execute function public.hr_punch_guard();

drop trigger if exists hr_device_users_touch on public.hr_device_users;
create trigger hr_device_users_touch before update on public.hr_device_users
  for each row execute function public.hr_touch();

-- ── The employee's number on the device ──
alter table public.hr_employees add column if not exists device_user_no text check (device_user_no ~ '^[0-9]{1,24}$');
create unique index if not exists hr_employees_device_user_no on public.hr_employees (workspace_id, device_user_no) where device_user_no is not null;

-- Linked on the devices screen (Manage, hr_device_link); once the device made
-- records under a number, it stays (his fn_worker_device_user_guard).
create or replace function public.hr_employee_device_guard()
returns trigger
language plpgsql
as $$
begin
  if new.device_user_no is distinct from old.device_user_no then
    if current_setting('hr.device_link', true) is distinct from 'on' then
      raise exception 'HR_DEVICE_LINK_ONLY: the device number is set on the devices screen' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.hr_attendance a where a.employee_id = old.id and a.device_day is not null) then
      raise exception 'HR_DEVICE_USER_LOCKED: the employee already has attendance from the device under number %', old.device_user_no using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists hr_employee_device_guard on public.hr_employees;
create trigger hr_employee_device_guard before update of device_user_no on public.hr_employees
  for each row execute function public.hr_employee_device_guard();

-- ── Pairing ──
/*
 * One employee, one device day: makes or refreshes the device record and
 * returns the day's state: applied, corrected, manual, single, unlinked,
 * none, inactive, before_hire, on_leave, conflict.
 */
create or replace function public.hr_attendance_apply_day(p_employee uuid, p_day date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  w       public.hr_employees;
  v_first timestamptz;
  v_last  timestamptz;
  v_tz    text;
  v_merge integer;
  v_pair  boolean;
  r       public.hr_attendance;
  v_state text;
begin
  select * into w from public.hr_employees where id = p_employee;
  if not found or w.device_user_no is null then
    return 'unlinked';
  end if;
  select min(p.punched_at), max(p.punched_at) into v_first, v_last
    from public.hr_punches p where p.workspace_id = w.workspace_id and p.device_user_no = w.device_user_no and p.work_day = p_day;
  if v_first is null then
    return 'none';
  end if;
  select d.timezone into v_tz
    from public.hr_punches p join public.hr_devices d on d.id = p.device_id
   where p.workspace_id = w.workspace_id and p.device_user_no = w.device_user_no and p.work_day = p_day
   order by p.punched_at limit 1;
  select s.repeat_punch_minutes into v_merge from public.hr_settings s where s.workspace_id = w.workspace_id;
  v_pair := v_last > v_first and (v_merge is null or v_last - v_first >= make_interval(mins => v_merge));

  select * into r from public.hr_attendance a where a.employee_id = p_employee and a.device_day = p_day;
  if found then
    if r.source <> 'device' then
      return 'corrected';
    end if;
    if not v_pair or (r.check_in, r.check_out) is not distinct from (v_first, v_last) then
      return 'applied';
    end if;
  else
    if not v_pair then
      return 'single';
    end if;
    if exists (select 1 from public.hr_attendance a where a.employee_id = p_employee and a.device_day is null
                  and (a.check_in at time zone v_tz)::date = p_day) then
      return 'manual';
    end if;
  end if;
  if w.status <> 'active' or (w.end_date is not null and p_day > w.end_date) then
    return 'inactive';
  end if;
  if p_day < w.hire_date then
    return 'before_hire';
  end if;
  if exists (select 1 from public.hr_leave_requests l where l.employee_id = p_employee and l.status = 'approved'
                and p_day between l.date_from and l.date_to) then
    return 'on_leave';
  end if;

  perform set_config('hr.attendance_device', 'on', true);
  begin
    if r.id is not null then
      update public.hr_attendance set check_in = v_first, check_out = v_last where id = r.id;
    else
      insert into public.hr_attendance (workspace_id, employee_id, check_in, check_out, day, source, device_day)
      values (w.workspace_id, p_employee, v_first, v_last, p_day, 'device', p_day);
    end if;
    v_state := 'applied';
  exception when raise_exception or check_violation or unique_violation then
    -- Refused by the attendance rules (an overlap, …): the day waits in the review.
    v_state := 'conflict';
  end;
  perform set_config('hr.attendance_device', '', true);
  return v_state;
end $$;

-- Every employee day a sync touched; returns the records made or refreshed.
create or replace function public.hr_attendance_apply_sync(p_sync uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  n integer := 0;
begin
  for d in select distinct w.id as employee_id, p.work_day
             from public.hr_punches p
             join public.hr_employees w on w.workspace_id = p.workspace_id and w.device_user_no = p.device_user_no
            where p.sync_id = p_sync order by 1, 2 loop
    if public.hr_attendance_apply_day(d.employee_id, d.work_day) = 'applied' then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Every day of one employee (after linking the number, or to retry the review).
create or replace function public.hr_attendance_apply_employee(p_employee uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  n integer := 0;
begin
  for v_day in select distinct p.work_day
                 from public.hr_punches p
                 join public.hr_employees w on w.workspace_id = p.workspace_id and w.device_user_no = p.device_user_no
                where w.id = p_employee order by 1 loop
    if public.hr_attendance_apply_day(p_employee, v_day) = 'applied' then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ── Review: every device user's day and its state (read only; mirrors hr_attendance_apply_day) ──
drop view if exists public.hr_punch_days;
create view public.hr_punch_days with (security_invoker = true) as
with days as (
  select p.workspace_id, p.device_user_no, p.work_day, count(*)::integer as punches,
         min(p.punched_at) as first_at, max(p.punched_at) as last_at,
         (array_agg(d.timezone order by p.punched_at))[1] as timezone,
         (array_agg(d.name order by p.punched_at))[1] as device_name
    from public.hr_punches p join public.hr_devices d on d.id = p.device_id
   group by p.workspace_id, p.device_user_no, p.work_day
)
select x.workspace_id, x.device_user_no, x.work_day, x.punches, x.first_at, x.last_at, x.device_name,
       w.id as employee_id, a.id as attendance_id,
       case
         when w.id is null then 'unlinked'
         when a.id is not null and a.source = 'device' then 'applied'
         when a.id is not null then 'corrected'
         when not (x.last_at > x.first_at and (s.repeat_punch_minutes is null
                   or x.last_at - x.first_at >= make_interval(mins => s.repeat_punch_minutes)))
           then case when x.work_day >= (now() at time zone x.timezone)::date then 'open' else 'single' end
         when exists (select 1 from public.hr_attendance m where m.employee_id = w.id and m.device_day is null
                         and (m.check_in at time zone x.timezone)::date = x.work_day) then 'manual'
         when w.status <> 'active' or (w.end_date is not null and x.work_day > w.end_date) then 'inactive'
         when x.work_day < w.hire_date then 'before_hire'
         when exists (select 1 from public.hr_leave_requests l where l.employee_id = w.id and l.status = 'approved'
                         and x.work_day between l.date_from and l.date_to) then 'on_leave'
         else 'conflict'
       end as state
  from days x
  left join public.hr_employees w on w.workspace_id = x.workspace_id and w.device_user_no = x.device_user_no
  left join public.hr_attendance a on a.employee_id = w.id and a.device_day = x.work_day
  left join public.hr_settings s on s.workspace_id = x.workspace_id;

-- ── Receiving a batch (his AttendanceIngest::receive) ──

/** "2026-10-26 8:0:16" (the SDK's parts without padding) → a timestamp; null if not a real time. */
create or replace function public.hr_device_local_time(v text)
returns timestamp
language plpgsql
immutable
as $$
declare
  m text[];
begin
  m := regexp_match(btrim(coalesce(v, '')), '^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})$');
  if m is null then
    return null;
  end if;
  return make_timestamp(m[1]::int, m[2]::int, m[3]::int, m[4]::int, m[5]::int, m[6]::double precision);
exception when others then
  return null;
end $$;

/** A device's code as reported (an integer under a million), or null. */
create or replace function public.hr_device_code(v jsonb)
returns integer
language sql
immutable
as $$
  select case when v is not null and jsonb_typeof(v) in ('number', 'string') and (v #>> '{}') ~ '^-?[0-9]{1,6}$'
              then (v #>> '{}')::integer end;
$$;

/**
 * One batch from a device, inside the caller's transaction: records the
 * sync, keeps every new punch as reported (the same punch again is ignored),
 * refreshes the device's user list, pairs the days the batch touched and
 * flags late arrivals and early leaves (when part 3 is there). Returns the
 * counts. Both the bridge and the upload come through here.
 */
create or replace function public.hr_device_receive(
  p_device uuid, p_source text, p_meta jsonb, p_users jsonb, p_punches jsonb, p_by uuid, p_ip text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d          public.hr_devices;
  v_sync     uuid;
  v_received integer := coalesce(jsonb_array_length(p_punches), 0);
  v_inserted integer := 0;
  v_rejected text[] := '{}';
  v_rows     integer := 0;
  v_paired   integer := 0;
  v_flags    integer := 0;
  i          integer := 0;
  p          jsonb;
  u          jsonb;
  v_no       text;
  v_time     timestamp;
  n          integer;
begin
  if jsonb_typeof(p_punches) is distinct from 'array' then
    raise exception 'HR_DEVICE_BATCH: punches must be a list' using errcode = 'P0001';
  end if;
  if v_received > 2000 or (p_users is not null and jsonb_typeof(p_users) = 'array' and jsonb_array_length(p_users) > 5000) then
    raise exception 'HR_DEVICE_BATCH_SIZE: the batch is larger than allowed; send it in parts' using errcode = 'P0001';
  end if;
  select * into d from public.hr_devices where id = p_device;
  -- Every punch readable, or the whole batch is refused (his rule).
  for p in select * from jsonb_array_elements(p_punches) loop
    i := i + 1;
    v_no := btrim(coalesce(p ->> 'user_no', ''));
    v_time := public.hr_device_local_time(p ->> 'time');
    if v_no !~ '^[0-9]{1,24}$' or v_time is null then
      raise exception 'HR_DEVICE_PUNCH_UNREADABLE: punch % is not readable (user number or time)', i using errcode = 'P0001';
    end if;
  end loop;

  insert into public.hr_device_syncs (workspace_id, device_id, source, received, users_reported,
                                      device_serial, device_model, device_firmware, device_time, remote_ip, created_by)
  values (d.workspace_id, d.id, p_source, v_received,
          case when jsonb_typeof(p_users) = 'array' then jsonb_array_length(p_users) end,
          left(nullif(btrim(p_meta ->> 'serial'), ''), 200), left(nullif(btrim(p_meta ->> 'model'), ''), 200),
          left(nullif(btrim(p_meta ->> 'firmware'), ''), 200), public.hr_device_local_time(p_meta ->> 'time'),
          left(p_ip, 100), p_by)
  returning id into v_sync;

  for p in select * from jsonb_array_elements(p_punches) loop
    v_no := btrim(p ->> 'user_no');
    v_time := public.hr_device_local_time(p ->> 'time');
    -- A punch after now (the device clock ahead) is not stored; it is counted and reported back.
    if (v_time at time zone d.timezone) > now() + interval '5 minutes' then
      v_rejected := v_rejected || (v_no || ' @ ' || v_time::text);
      continue;
    end if;
    v_rows := v_rows + 1;
    insert into public.hr_punches (workspace_id, device_id, sync_id, device_user_no, local_time, punched_at, work_day,
                                   verify_mode, in_out_mode, work_code)
    values (d.workspace_id, d.id, v_sync, v_no, v_time, v_time at time zone d.timezone, v_time::date,
            public.hr_device_code(p -> 'verify'), public.hr_device_code(p -> 'inout'), public.hr_device_code(p -> 'workcode'))
    on conflict (device_id, device_user_no, local_time) do nothing;
    get diagnostics n = row_count;
    v_inserted := v_inserted + n;
  end loop;

  if jsonb_typeof(p_users) = 'array' then
    for u in select * from jsonb_array_elements(p_users) loop
      v_no := btrim(coalesce(u ->> 'no', ''));
      continue when v_no !~ '^[0-9]{1,24}$';
      insert into public.hr_device_users as t (workspace_id, device_id, device_user_no, name, enabled)
      values (d.workspace_id, d.id, v_no, left(nullif(btrim(u ->> 'name'), ''), 200),
              case when u ? 'enabled' and u ->> 'enabled' is not null then lower(u ->> 'enabled') in ('true', '1', 'yes', 'on') end)
      on conflict (device_id, device_user_no) do update set name = excluded.name, enabled = excluded.enabled
       where (t.name, t.enabled) is distinct from (excluded.name, excluded.enabled);
    end loop;
  end if;

  update public.hr_device_syncs set inserted = v_inserted, rejected = coalesce(array_length(v_rejected, 1), 0) where id = v_sync;
  v_paired := public.hr_attendance_apply_sync(v_sync);
  if to_regprocedure('public.hr_attendance_flag_sync(uuid)') is not null then
    execute 'select public.hr_attendance_flag_sync($1)' into v_flags using v_sync;
  end if;
  return jsonb_build_object('sync_id', v_sync, 'received', v_received, 'inserted', v_inserted,
    'duplicates', v_rows - v_inserted, 'rejected', coalesce(array_length(v_rejected, 1), 0),
    'rejected_examples', to_jsonb(v_rejected[1:10]), 'paired', v_paired, 'flags', v_flags);
end $$;

/**
 * The office bridge: POST /rest/v1/rpc/hr_device_sync with the device's own
 * key, ARK1-<device id>-<secret>, never a person's login. Read only for the
 * device: nothing is sent back to it. At most 60 batches a minute per device.
 */
create or replace function public.hr_device_sync(device_key text, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m  text[];
  d  public.hr_devices;
  ip text;
begin
  m := regexp_match(coalesce(device_key, ''), '^ARK1-([0-9a-f-]{36})-([0-9A-Za-z]{40})$');
  if m is null then
    raise exception 'HR_DEVICE_KEY: unknown or revoked device key' using errcode = 'P0001';
  end if;
  select * into d from public.hr_devices
   where id = m[1]::uuid and key_hash = encode(sha256(convert_to(m[2], 'UTF8')), 'hex');
  if not found then
    raise exception 'HR_DEVICE_KEY: unknown or revoked device key' using errcode = 'P0001';
  end if;
  if not d.active then
    raise exception 'HR_DEVICE_INACTIVE: the device is stopped' using errcode = 'P0001';
  end if;
  if (select count(*) from public.hr_device_syncs s where s.device_id = d.id and s.created_at > now() - interval '1 minute') >= 60 then
    raise exception 'HR_DEVICE_TOO_MANY: more than 60 batches a minute; wait a minute' using errcode = 'P0001';
  end if;
  begin
    ip := btrim(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1));
  exception when others then
    ip := null;
  end;
  return public.hr_device_receive(d.id, 'bridge', coalesce(payload -> 'device', '{}'), payload -> 'users',
                                  coalesce(payload -> 'punches', '[]'), null, nullif(ip, ''));
end $$;

/** A file of punches uploaded by hand (Manage), already read in the browser: [{user_no, time, verify, inout, workcode}]. */
create or replace function public.hr_device_upload(ws uuid, device uuid, punches jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_section(ws, 'hr', 'manage') then
    raise exception 'HR_NO_ACCESS: devices are for HR managers' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.hr_devices d where d.id = device and d.workspace_id = ws) then
    raise exception 'HR_NOT_FOUND: no such device here' using errcode = 'P0001';
  end if;
  return public.hr_device_receive(device, 'upload', '{}', null, punches, auth.uid(), null);
end $$;

-- ── Keys ──
/** A new secret for a device: stores its hash and returns the full key (shown once). */
create or replace function public.hr_device_issue_key(p_device uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  secret text := left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 40);
begin
  update public.hr_devices set key_hash = encode(sha256(convert_to(secret, 'UTF8')), 'hex'), key_hint = right(secret, 4)
   where id = p_device;
  return 'ARK1-' || p_device::text || '-' || secret;
end $$;

/** Register a device (Manage): returns { id, key }; the key is not shown again. */
create or replace function public.hr_device_add(ws uuid, name text, timezone text, notes text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.has_section(ws, 'hr', 'manage') then
    raise exception 'HR_NO_ACCESS: devices are for HR managers' using errcode = 'P0001';
  end if;
  -- A placeholder hash until the real key is issued in the same transaction.
  insert into public.hr_devices (workspace_id, name, timezone, notes, key_hash, key_hint, created_by)
  values (ws, btrim(name), btrim(timezone), coalesce(btrim(notes), ''), repeat('0', 64), '0000', auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', public.hr_device_issue_key(v_id));
end $$;

/** A new key (Manage); the old one stops working at once. */
create or replace function public.hr_device_rotate_key(ws uuid, device uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_section(ws, 'hr', 'manage') then
    raise exception 'HR_NO_ACCESS: devices are for HR managers' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.hr_devices d where d.id = device and d.workspace_id = ws) then
    raise exception 'HR_NOT_FOUND: no such device here' using errcode = 'P0001';
  end if;
  return public.hr_device_issue_key(device);
end $$;

-- ── Linking numbers to employees (his link()) ──
/**
 * links: { "<device number>": "<employee id>" | null }. One number per
 * employee and one employee per number; numbers whose holder changes are
 * freed first. Then the days already received are paired and flagged.
 * Returns { changed, paired }.
 */
create or replace function public.hr_device_link(ws uuid, links jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k       text;
  v       text;
  e       public.hr_employees;
  changed uuid[] := '{}';
  paired  integer := 0;
  x       uuid;
begin
  if auth.uid() is null or not public.has_section(ws, 'hr', 'manage') then
    raise exception 'HR_NO_ACCESS: devices are for HR managers' using errcode = 'P0001';
  end if;
  if jsonb_typeof(links) is distinct from 'object' then
    raise exception 'HR_DEVICE_LINKS: links must be an object' using errcode = 'P0001';
  end if;
  if (select count(*) from jsonb_each_text(links) j where nullif(j.value, '') is not null)
     <> (select count(distinct j.value) from jsonb_each_text(links) j where nullif(j.value, '') is not null) then
    raise exception 'HR_DEVICE_LINK_TWICE: one employee is linked to one number on the device' using errcode = 'P0001';
  end if;
  perform set_config('hr.device_link', 'on', true);
  -- First free the numbers whose holder changes.
  for e in select * from public.hr_employees w
            where w.workspace_id = ws and w.device_user_no in (select j.key from jsonb_each_text(links) j where j.key ~ '^[0-9]{1,24}$') loop
    if nullif(links ->> e.device_user_no, '') is distinct from e.id::text then
      update public.hr_employees set device_user_no = null where id = e.id;
    end if;
  end loop;
  for k, v in select j.key, j.value from jsonb_each_text(links) j where j.key ~ '^[0-9]{1,24}$' and nullif(j.value, '') is not null loop
    select * into e from public.hr_employees w where w.id = v::uuid and w.workspace_id = ws;
    if not found then
      raise exception 'HR_NOT_FOUND: no such employee here' using errcode = 'P0001';
    end if;
    if e.device_user_no is distinct from k then
      update public.hr_employees set device_user_no = k where id = e.id;
      changed := changed || e.id;
    end if;
  end loop;
  perform set_config('hr.device_link', '', true);
  foreach x in array changed loop
    paired := paired + public.hr_attendance_apply_employee(x);
    if to_regprocedure('public.hr_attendance_flag_employee(uuid)') is not null then
      execute 'select public.hr_attendance_flag_employee($1)' using x;
    end if;
  end loop;
  return jsonb_build_object('changed', coalesce(array_length(changed, 1), 0), 'paired', paired);
end $$;

/** Try an employee's device days again (Manage), after a hire date, a leave or a manual record changed. */
create or replace function public.hr_attendance_retry(ws uuid, employee uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.uid() is null or not public.has_section(ws, 'hr', 'manage') then
    raise exception 'HR_NO_ACCESS: devices are for HR managers' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.hr_employees e where e.id = employee and e.workspace_id = ws) then
    raise exception 'HR_NOT_FOUND: no such employee here' using errcode = 'P0001';
  end if;
  n := public.hr_attendance_apply_employee(employee);
  if to_regprocedure('public.hr_attendance_flag_employee(uuid)') is not null then
    execute 'select public.hr_attendance_flag_employee($1)' using employee;
  end if;
  return n;
end $$;

-- ── Row level security ──
alter table public.hr_devices enable row level security;
alter table public.hr_device_users enable row level security;
alter table public.hr_device_syncs enable row level security;
alter table public.hr_punches enable row level security;

drop policy if exists hr_devices_read on public.hr_devices;
create policy hr_devices_read on public.hr_devices for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
drop policy if exists hr_devices_change on public.hr_devices;
create policy hr_devices_change on public.hr_devices for update to authenticated
  using (public.has_section(workspace_id, 'hr', 'manage'))
  with check (public.has_section(workspace_id, 'hr', 'manage'));
-- Never the key's hash; only these columns change by hand (the key through its functions).
revoke all on public.hr_devices from anon, authenticated;
grant select (id, workspace_id, name, timezone, key_hint, active, notes, created_by, created_at, updated_at) on public.hr_devices to authenticated;
grant update (name, timezone, active, notes) on public.hr_devices to authenticated;

drop policy if exists hr_device_users_read on public.hr_device_users;
create policy hr_device_users_read on public.hr_device_users for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
drop policy if exists hr_device_syncs_read on public.hr_device_syncs;
create policy hr_device_syncs_read on public.hr_device_syncs for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
drop policy if exists hr_punches_read on public.hr_punches;
create policy hr_punches_read on public.hr_punches for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
revoke all on public.hr_device_users, public.hr_device_syncs, public.hr_punches from anon, authenticated;
grant select on public.hr_device_users, public.hr_device_syncs, public.hr_punches to authenticated;
revoke all on public.hr_punch_days from anon, authenticated;
grant select on public.hr_punch_days to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.hr_attendance_apply_day(uuid, date)', 'public.hr_attendance_apply_sync(uuid)', 'public.hr_attendance_apply_employee(uuid)',
    'public.hr_device_receive(uuid, text, jsonb, jsonb, jsonb, uuid, text)', 'public.hr_device_issue_key(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.hr_device_upload(uuid, uuid, jsonb)', 'public.hr_device_add(uuid, text, text, text)', 'public.hr_device_rotate_key(uuid, uuid)',
    'public.hr_device_link(uuid, jsonb)', 'public.hr_attendance_retry(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
-- The bridge has no login.
revoke all on function public.hr_device_sync(text, jsonb) from public;
grant execute on function public.hr_device_sync(text, jsonb) to anon, authenticated;
