-- ─── v2 HR attendance, part 3: late arrivals and early leaves ──────────────
-- 2026-10-28, dev/erp-pilot/ATTENDANCE.md. Musa's changes 0045 and 0046,
-- rewritten in our stack.
--
--   · the schedule is a company setting (start, end, grace minutes and the
--     date it applies from, in hr_settings); without it nothing is flagged
--     (unknown, not "on time");
--   · late = the day's first device punch after start + grace, counted from
--     the start (8:20 with 08:00 and 15 minutes' grace = 20 minutes late);
--   · left early = the day's last device punch before the end, judged only
--     once the day is over; a day with one punch is never an early leave;
--   · only working days, from the schedule's date, inside the employment, not
--     on approved leave;
--   · hr_attendance_flags keeps what was compared and never changes; only its
--     email status moves forward and an excuse (with its reason) is added,
--     once. Never deleted;
--   · the email goes to the employee only (work email, else their login's):
--     late on the day itself, early leave within three days; older days are
--     recorded without one (past). While the company's email switch is off a
--     record is marked off and never emailed later; nobody who has left is
--     emailed. In v2 the HR mailbox is not connected (hr_mailbox_ready), so
--     the switch stays off and nothing is sent: the sender comes with it.
--
-- Who: View reads; Manage records an excuse (hr_attendance_excuse).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create table if not exists public.hr_attendance_flags (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  employee_id    uuid not null,
  work_day       date not null,
  kind           text not null check (kind in ('late', 'early')),
  -- What was compared: the scheduled moment (start or end), the punch, and the grace then in force.
  scheduled_at   timestamptz not null,
  actual_at      timestamptz not null,
  grace_minutes  integer not null check (grace_minutes >= 0),
  minutes        integer not null check (minutes > 0),
  email_to       text,
  email_status   text not null check (email_status in ('pending', 'sent', 'failed', 'no_email', 'past', 'off')),
  email_attempts integer not null default 0 check (email_attempts >= 0),
  emailed_at     timestamptz,
  email_error    text,
  excused_at     timestamptz,
  excused_by     uuid references auth.users(id) on delete set null,
  excuse_reason  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint hr_attendance_flags_employee_fk foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id),
  constraint hr_attendance_flags_once unique (employee_id, work_day, kind),
  constraint hr_attendance_flags_email check ((email_status in ('no_email', 'past', 'off')) = (email_to is null)),
  constraint hr_attendance_flags_sent check ((email_status = 'sent') = (emailed_at is not null)),
  constraint hr_attendance_flags_excuse check ((excused_at is null) = (excused_by is null)
    and (excused_at is null or btrim(coalesce(excuse_reason, '')) <> ''))
);
create index if not exists hr_attendance_flags_day on public.hr_attendance_flags (workspace_id, work_day);
create index if not exists hr_attendance_flags_email_idx on public.hr_attendance_flags (workspace_id, email_status) where email_status in ('pending', 'failed');

create or replace function public.hr_attendance_flag_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- Only the company's own deletion takes it (the cascade of #268).
    if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
      raise exception 'HR_FLAG_FINAL: a lateness or early-leave record is never deleted; it is excused with a reason' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if (new.workspace_id, new.employee_id, new.work_day, new.kind, new.scheduled_at, new.actual_at, new.grace_minutes, new.minutes, new.email_to, new.created_at)
       is distinct from (old.workspace_id, old.employee_id, old.work_day, old.kind, old.scheduled_at, old.actual_at, old.grace_minutes, old.minutes, old.email_to, old.created_at) then
      raise exception 'HR_FLAG_FINAL: what was recorded does not change' using errcode = 'P0001';
    end if;
    -- The email moves forward only: pending/failed → sent/failed; the rest is final.
    if new.email_status is distinct from old.email_status
       and not (old.email_status in ('pending', 'failed') and new.email_status in ('sent', 'failed')) then
      raise exception 'HR_FLAG_FINAL: the email status % cannot become %', old.email_status, new.email_status using errcode = 'P0001';
    end if;
    if old.email_status = 'sent' and (new.emailed_at, new.email_attempts) is distinct from (old.emailed_at, old.email_attempts) then
      raise exception 'HR_FLAG_FINAL: a sent email stays as sent' using errcode = 'P0001';
    end if;
    -- An excuse is added once, with its reason, and stays.
    if old.excused_at is not null and (new.excused_at, new.excused_by, new.excuse_reason)
       is distinct from (old.excused_at, old.excused_by, old.excuse_reason) then
      raise exception 'HR_FLAG_FINAL: an excuse stays as recorded' using errcode = 'P0001';
    end if;
    new.updated_at := now();
  end if;
  if new.excused_at is not null and btrim(coalesce(new.excuse_reason, '')) = '' then
    raise exception 'HR_FLAG_EXCUSE_REASON: an excuse needs a written reason' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists hr_attendance_flag_guard on public.hr_attendance_flags;
create trigger hr_attendance_flag_guard before insert or update or delete on public.hr_attendance_flags
  for each row execute function public.hr_attendance_flag_guard();

/** Flag one employee day from its device punches; returns the number of records added. */
create or replace function public.hr_attendance_flag_day(p_employee uuid, p_day date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s       public.hr_settings;
  w       public.hr_employees;
  v_first timestamptz;
  v_last  timestamptz;
  v_tz    text;
  v_today date;
  v_start timestamptz;
  v_end   timestamptz;
  v_email text;
  v_pair  boolean;
  v_send  boolean;
  n       integer := 0;
  k       integer;
begin
  select * into w from public.hr_employees where id = p_employee;
  if not found then
    return 0;
  end if;
  select * into s from public.hr_settings where workspace_id = w.workspace_id;
  if s.workspace_id is null or s.work_start is null or p_day < s.schedule_from
     or not (extract(dow from p_day)::smallint = any (s.work_days)) then
    return 0;
  end if;
  if w.device_user_no is null or p_day < w.hire_date or (w.end_date is not null and p_day > w.end_date) then
    return 0;
  end if;
  if exists (select 1 from public.hr_leave_requests l where l.employee_id = p_employee and l.status = 'approved'
                and p_day between l.date_from and l.date_to) then
    return 0;
  end if;
  select min(p.punched_at), max(p.punched_at) into v_first, v_last
    from public.hr_punches p where p.workspace_id = w.workspace_id and p.device_user_no = w.device_user_no and p.work_day = p_day;
  if v_first is null then
    return 0;
  end if;
  select d.timezone into v_tz
    from public.hr_punches p join public.hr_devices d on d.id = p.device_id
   where p.workspace_id = w.workspace_id and p.device_user_no = w.device_user_no and p.work_day = p_day
   order by p.punched_at limit 1;
  v_today := (now() at time zone v_tz)::date;
  v_start := (p_day + s.work_start) at time zone v_tz;
  v_end := (p_day + s.work_end) at time zone v_tz;
  -- Emails only once the company switched them on, and only to someone still employed.
  v_send := s.employee_emails and w.status = 'active';
  v_email := nullif(btrim(w.work_email), '');
  if v_email is null and w.user_id is not null then
    select u.email into v_email from auth.users u
      join public.user_access ua on ua.user_id = u.id and ua.status = 'approved'
     where u.id = w.user_id;
  end if;

  if v_first > v_start + make_interval(mins => s.grace_minutes) and floor(extract(epoch from v_first - v_start) / 60) >= 1 then
    insert into public.hr_attendance_flags (workspace_id, employee_id, work_day, kind, scheduled_at, actual_at, grace_minutes, minutes, email_to, email_status)
    values (w.workspace_id, p_employee, p_day, 'late', v_start, v_first, s.grace_minutes,
            floor(extract(epoch from v_first - v_start) / 60)::integer,
            case when p_day = v_today and v_send then v_email end,
            case when p_day <> v_today then 'past' when not v_send then 'off' when v_email is null then 'no_email' else 'pending' end)
    on conflict do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end if;

  -- Early leave: the day is over, it has a check-out (a pair, as the pairing sees it), and it was before the end.
  v_pair := v_last > v_first and (s.repeat_punch_minutes is null or v_last - v_first >= make_interval(mins => s.repeat_punch_minutes));
  if p_day < v_today and v_pair and v_last < v_end and floor(extract(epoch from v_end - v_last) / 60) >= 1 then
    insert into public.hr_attendance_flags (workspace_id, employee_id, work_day, kind, scheduled_at, actual_at, grace_minutes, minutes, email_to, email_status)
    values (w.workspace_id, p_employee, p_day, 'early', v_end, v_last, 0,
            floor(extract(epoch from v_end - v_last) / 60)::integer,
            case when p_day >= v_today - 3 and v_send then v_email end,
            case when p_day < v_today - 3 then 'past' when not v_send then 'off' when v_email is null then 'no_email' else 'pending' end)
    on conflict do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end if;
  return n;
end $$;

-- Days a sync touched, plus the last seven days of every linked employee of
-- its company (so a day that ended is judged for early leave at the first
-- sync after it, even with no new punch). Returns records added.
create or replace function public.hr_attendance_flag_sync(p_sync uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  n integer := 0;
  ws uuid;
begin
  select workspace_id into ws from public.hr_device_syncs where id = p_sync;
  for d in select distinct w.id as employee_id, p.work_day
             from public.hr_punches p
             join public.hr_employees w on w.workspace_id = p.workspace_id and w.device_user_no = p.device_user_no
            where p.workspace_id = ws and (p.sync_id = p_sync or p.work_day >= public.hr_today() - 7)
            order by 1, 2 loop
    n := n + public.hr_attendance_flag_day(d.employee_id, d.work_day);
  end loop;
  return n;
end $$;

-- Every day of one employee (after linking the number; older days are recorded without email).
create or replace function public.hr_attendance_flag_employee(p_employee uuid)
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
    n := n + public.hr_attendance_flag_day(p_employee, v_day);
  end loop;
  return n;
end $$;

/** An excuse with its reason (Manage); the record and its email stay as they were. */
create or replace function public.hr_attendance_excuse(ws uuid, flag uuid, reason text)
returns public.hr_attendance_flags
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.hr_attendance_flags;
begin
  if auth.uid() is null or not public.has_section(ws, 'hr', 'manage') then
    raise exception 'HR_NO_ACCESS: excuses are recorded by HR managers' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(reason, ''))) = 0 then
    raise exception 'HR_FLAG_EXCUSE_REASON: an excuse needs a written reason' using errcode = 'P0001';
  end if;
  update public.hr_attendance_flags
     set excused_at = now(), excused_by = auth.uid(), excuse_reason = left(btrim(reason), 500)
   where id = flag and workspace_id = ws
   returning * into f;
  if not found then
    raise exception 'HR_NOT_FOUND: no such record here' using errcode = 'P0001';
  end if;
  return f;
end $$;

-- ── Row level security ──
alter table public.hr_attendance_flags enable row level security;
drop policy if exists hr_attendance_flags_read on public.hr_attendance_flags;
create policy hr_attendance_flags_read on public.hr_attendance_flags for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));
revoke all on public.hr_attendance_flags from anon, authenticated;
grant select on public.hr_attendance_flags to authenticated;

do $$
declare f text;
begin
  foreach f in array array['public.hr_attendance_flag_day(uuid, date)', 'public.hr_attendance_flag_sync(uuid)', 'public.hr_attendance_flag_employee(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
revoke all on function public.hr_attendance_excuse(uuid, uuid, text) from public, anon;
grant execute on function public.hr_attendance_excuse(uuid, uuid, text) to authenticated;
