-- ─── v2: the Technical and Finance sections ─────────────────────────────────
-- 2026-10-19. The owner's answer: Odoo manages the projects; Campai watches
-- submittals, delays, reminders and follow-ups. Finance is read only from
-- Odoo Accounting. Both read Odoo through the hourly mirror (odoo_records,
-- 20261103), which now also holds project stages, tasks and updates, Odoo
-- users, customer payments and analytic lines (src/lib/control/odoo.js).
--
-- Sections:
--   technical  view/work = the projects you manage in Odoo (you are the
--              project's "Project Manager" there, matched by email);
--              manage = every project, and the stage limits and reminders.
--   finance    view = invoices, collections and project margins.
--   ceo        view = every project and every number, as before.
--
-- Campai's own project data (all keyed by the Odoo project id):
--   project_stage_log    when each project entered each of the nine stages
--                        (the mirror writes it when the stage changes)
--   project_submittals   the client's submittal rounds and their codes A–D
--   project_updates      the project manager's weekly update
--   project_flags        each project's health; turning red is told once
--                        in the CEO's daily alert
--   technical_settings   days allowed per stage, how often the update is due
--
-- Reminders and follow-ups are tasks (public.tasks), section 'technical',
-- with the project's id and a key (auto_key) so each is made once:
--   made by the monitor round (api/leads/_technical.js): a late stage, a
--     missing weekly update, a submittal waiting on the client;
--   made here, the moment it happens: a C or D code (resubmit), and closed
--     here when the next round goes in or the update is written.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── The two new sections ──
alter table public.section_access drop constraint if exists section_access_section_check;
alter table public.section_access add constraint section_access_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance'));
alter table public.tasks drop constraint if exists tasks_section_check;
alter table public.tasks add constraint tasks_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance'));
alter table public.meetings drop constraint if exists meetings_section_check;
alter table public.meetings add constraint meetings_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance'));

-- ── Tasks that belong to a project, made once each ──
alter table public.tasks add column if not exists odoo_project_id integer;
alter table public.tasks add column if not exists auto_key text;
create unique index if not exists tasks_auto_key_idx on public.tasks (workspace_id, auto_key);
create index if not exists tasks_project_idx on public.tasks (workspace_id, odoo_project_id);

-- A task the app made itself says so in the bell ("Campai gave you a task").
create or replace function public.task_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when uid is null then 'Campai'
    else coalesce((select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) from public.user_access where user_id = uid), 'Someone') end;
$$;

-- ── Who is who in Odoo ──
/** The Odoo user a Campai login is in this company, by login or email. */
create or replace function public.odoo_user_of(ws uuid, who uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select r.odoo_id
    from public.odoo_records r
    join public.user_access ua on ua.user_id = who
   where r.workspace_id = ws and r.model = 'res.users'
     and coalesce((r.data->>'active')::boolean, true)
     and lower(ua.email) in (lower(coalesce(r.data->>'login', '')), lower(coalesce(r.data->>'email', '')))
   order by r.odoo_id
   limit 1;
$$;

create or replace function public.my_odoo_uid(ws uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$ select public.odoo_user_of(ws, auth.uid()); $$;

/** Each project's manager: the Odoo user, and the Campai login they are (or null). */
create or replace function public.project_managers(ws uuid)
returns table (odoo_project_id integer, odoo_user_id integer, user_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.odoo_id,
         (p.data->'user_id'->>0)::int,
         (select ua.user_id
            from public.odoo_records u
            join public.user_access ua
              on lower(ua.email) in (lower(coalesce(u.data->>'login', '')), lower(coalesce(u.data->>'email', '')))
             and ua.status = 'approved'
           where u.workspace_id = ws and u.model = 'res.users' and u.odoo_id = (p.data->'user_id'->>0)::int
             and exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = ua.user_id)
           limit 1),
         p.data->'user_id'->>1
    from public.odoo_records p
   where p.workspace_id = ws and p.model = 'project.project' and jsonb_typeof(p.data->'user_id') = 'array';
$$;
revoke execute on function public.project_managers(uuid) from public, anon, authenticated;
grant execute on function public.project_managers(uuid) to service_role;

create or replace function public.project_pm_user(ws uuid, pid integer)
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select m.user_id from public.project_managers(ws) m where m.odoo_project_id = pid; $$;
revoke execute on function public.project_pm_user(uuid, integer) from public, anon, authenticated;

/** Is this project the caller's own (they are its manager in Odoo)? */
create or replace function public.is_my_project(ws uuid, pid integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.odoo_records p
     where p.workspace_id = ws and p.model = 'project.project' and p.odoo_id = pid
       and (p.data->'user_id'->>0)::int = public.my_odoo_uid(ws)
  );
$$;

/**
 * May the caller see this project? The CEO section, Technical at manage
 * (every project), or Technical at view/work for a project they manage.
 */
create or replace function public.can_see_project(ws uuid, pid integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_section(ws, 'ceo', 'view')
      or public.has_section(ws, 'technical', 'manage')
      or (public.has_section(ws, 'technical', 'view') and public.is_my_project(ws, pid));
$$;

/** May the caller record things on this project (submittals, the update)? */
create or replace function public.can_work_project(ws uuid, pid integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_section(ws, 'technical', 'manage')
      or (public.has_section(ws, 'technical', 'work') and public.is_my_project(ws, pid));
$$;
grant execute on function public.my_odoo_uid(uuid), public.is_my_project(uuid, integer),
  public.can_see_project(uuid, integer), public.can_work_project(uuid, integer) to authenticated;

-- ── The mirror, by model ──
-- Before: anyone with CEO or Sales read every mirrored model. Now each model
-- is read by the sections that use it; money is Finance's and the CEO's.
create or replace function public.odoo_record_visible(ws uuid, mdl text, oid integer, d jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when mdl in ('crm.stage', 'crm.lead') then public.has_any_section(ws, '{ceo,sales}')
    when mdl = 'sale.order' then public.has_any_section(ws, '{ceo,sales,finance}')
    when mdl in ('account.move', 'account.payment', 'account.analytic.line') then public.has_any_section(ws, '{ceo,finance}')
    when mdl = 'project.project' then public.has_any_section(ws, '{ceo,finance}') or public.can_see_project(ws, oid)
    when mdl = 'project.project.stage' then public.has_any_section(ws, '{ceo,finance,technical}')
    when mdl in ('project.task', 'project.update') then
      jsonb_typeof(d->'project_id') = 'array' and public.can_see_project(ws, (d->'project_id'->>0)::int)
    when mdl = 'res.users' then public.has_any_section(ws, '{ceo,sales,technical,finance}')
    else public.has_section(ws, 'ceo', 'view')
  end;
$$;
grant execute on function public.odoo_record_visible(uuid, text, integer, jsonb) to authenticated;

drop policy if exists odoo_records_read on public.odoo_records;
create policy odoo_records_read on public.odoo_records for select to authenticated
  using (public.odoo_record_visible(workspace_id, model, odoo_id, data));

-- The Odoo address, for "Open in Odoo" links: the connection row
-- (lead_crm) holds the sealed key and is never read from the browser.
alter table public.odoo_sync add column if not exists odoo_url text not null default '';

drop policy if exists odoo_sync_read on public.odoo_sync;
create policy odoo_sync_read on public.odoo_sync for select to authenticated
  using (public.has_any_section(workspace_id, '{ceo,sales,technical,finance}'));

-- ── Settings: days per stage, reminders ──
create table if not exists public.technical_settings (
  workspace_id      uuid primary key references public.workspaces(id) on delete cascade,
  stage_days        jsonb not null default '{}'::jsonb,   -- { "client_review": 14, … }; missing = the default
  update_every_days integer not null default 7 check (update_every_days between 1 and 60),
  review_chase_days integer not null default 10 check (review_chase_days between 1 and 90),
  resubmit_days     integer not null default 7 check (resubmit_days between 1 and 90),
  updated_by        uuid references auth.users(id) on delete set null,
  updated_at        timestamptz not null default now()
);
alter table public.technical_settings enable row level security;
drop policy if exists technical_settings_read on public.technical_settings;
create policy technical_settings_read on public.technical_settings for select to authenticated
  using (public.has_any_section(workspace_id, '{technical,ceo}'));
drop policy if exists technical_settings_write on public.technical_settings;
create policy technical_settings_write on public.technical_settings for all to authenticated
  using (public.has_section(workspace_id, 'technical', 'manage'))
  with check (public.has_section(workspace_id, 'technical', 'manage'));

-- ── When each project entered each stage ──
create table if not exists public.project_stage_log (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  odoo_project_id integer not null,
  odoo_stage_id   integer not null,
  stage_key       text,              -- one of the nine, or null when the Odoo stage is none of them
  stage_name      text not null default '',
  entered_at      timestamptz not null,
  left_at         timestamptz,
  estimated       boolean not null default false   -- first seen with no stage date in Odoo: its last change
);
create unique index if not exists project_stage_log_open_idx on public.project_stage_log (workspace_id, odoo_project_id) where left_at is null;
create index if not exists project_stage_log_project_idx on public.project_stage_log (workspace_id, odoo_project_id, entered_at);
alter table public.project_stage_log enable row level security;
drop policy if exists project_stage_log_read on public.project_stage_log;
create policy project_stage_log_read on public.project_stage_log for select to authenticated
  using (public.can_see_project(workspace_id, odoo_project_id));

-- ── Submittal rounds ──
create table if not exists public.project_submittals (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  odoo_project_id integer not null,
  title           text not null check (length(trim(title)) > 0),   -- what is submitted: "Lighting fixtures", "Shop drawings"
  round           integer not null default 1 check (round >= 1),
  submitted_at    date,
  returned_at     date,
  code            text check (code in ('A', 'B', 'C', 'D')),
  notes           text not null default '',
  odoo_task_id    integer,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists project_submittals_round_idx on public.project_submittals (workspace_id, odoo_project_id, lower(title), round);
alter table public.project_submittals enable row level security;
drop policy if exists project_submittals_read on public.project_submittals;
create policy project_submittals_read on public.project_submittals for select to authenticated
  using (public.can_see_project(workspace_id, odoo_project_id));
drop policy if exists project_submittals_insert on public.project_submittals;
create policy project_submittals_insert on public.project_submittals for insert to authenticated
  with check (public.can_work_project(workspace_id, odoo_project_id) and created_by = auth.uid());
drop policy if exists project_submittals_update on public.project_submittals;
create policy project_submittals_update on public.project_submittals for update to authenticated
  using (public.can_work_project(workspace_id, odoo_project_id))
  with check (public.can_work_project(workspace_id, odoo_project_id));
drop policy if exists project_submittals_delete on public.project_submittals;
create policy project_submittals_delete on public.project_submittals for delete to authenticated
  using (public.has_section(workspace_id, 'technical', 'manage') or (created_by = auth.uid() and public.can_work_project(workspace_id, odoo_project_id)));

-- ── The project manager's weekly update ──
create table if not exists public.project_updates (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  odoo_project_id integer not null,
  status          text not null check (status in ('on_track', 'at_risk', 'off_track')),
  done            text not null default '',   -- what moved this week
  next            text not null default '',   -- what happens next week
  blockers        text not null default '',   -- what is holding it, and who must act
  written_by      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  written_at      timestamptz not null default now()
);
create index if not exists project_updates_project_idx on public.project_updates (workspace_id, odoo_project_id, written_at desc);
alter table public.project_updates enable row level security;
drop policy if exists project_updates_read on public.project_updates;
create policy project_updates_read on public.project_updates for select to authenticated
  using (public.can_see_project(workspace_id, odoo_project_id));
drop policy if exists project_updates_insert on public.project_updates;
create policy project_updates_insert on public.project_updates for insert to authenticated
  with check (public.can_work_project(workspace_id, odoo_project_id) and written_by = auth.uid());
drop policy if exists project_updates_update on public.project_updates;
create policy project_updates_update on public.project_updates for update to authenticated
  using (written_by = auth.uid() and public.can_work_project(workspace_id, odoo_project_id))
  with check (written_by = auth.uid() and public.can_work_project(workspace_id, odoo_project_id));
-- Removing an update (one written on the wrong project) is the Technical manager's.
drop policy if exists project_updates_delete on public.project_updates;
create policy project_updates_delete on public.project_updates for delete to authenticated
  using (public.has_section(workspace_id, 'technical', 'manage'));

-- ── Health, and the red the CEO is told about ──
create table if not exists public.project_flags (
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  odoo_project_id integer not null,
  name            text not null default '',
  level           text not null check (level in ('green', 'amber', 'red')),
  reasons         jsonb not null default '[]'::jsonb,
  red_since       timestamptz,     -- when it last turned red
  alerted_at      timestamptz,     -- when the daily alert told the CEO (once per turn red)
  updated_at      timestamptz not null default now(),
  primary key (workspace_id, odoo_project_id)
);
alter table public.project_flags enable row level security;
drop policy if exists project_flags_read on public.project_flags;
create policy project_flags_read on public.project_flags for select to authenticated
  using (public.can_see_project(workspace_id, odoo_project_id));

grant select on public.project_stage_log, public.project_flags to authenticated;
grant select, insert, update, delete on public.project_submittals, public.technical_settings to authenticated;
grant select, insert, update, delete on public.project_updates to authenticated;
grant all on public.project_stage_log, public.project_flags, public.project_submittals, public.project_updates, public.technical_settings to service_role;

-- ── Follow-ups the moment they happen ──
create or replace function public.project_name(ws uuid, pid integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select data->>'name' from public.odoo_records where workspace_id = ws and model = 'project.project' and odoo_id = pid), 'Project ' || pid);
$$;

/** Close a project's open reminders by key prefix ("update_due:401:"). */
create or replace function public.close_project_tasks(ws uuid, key_prefix text, actor uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.tasks set status = 'done', updated_by = actor
   where workspace_id = ws and auto_key like key_prefix || '%'
     and status in ('todo', 'in_progress', 'waiting');
$$;
revoke execute on function public.close_project_tasks(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.close_project_tasks(uuid, text, uuid) to service_role;

create or replace function public.project_submittals_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  -- A code means it came back: on the day it is recorded, unless said.
  if new.code is not null and new.returned_at is null then new.returned_at := current_date; end if;
  if new.code is null then new.returned_at := null; end if;
  return new;
end;
$$;
drop trigger if exists project_submittals_stamp on public.project_submittals;
create trigger project_submittals_stamp before insert or update on public.project_submittals
  for each row execute function public.project_submittals_stamp();

create or replace function public.project_submittals_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := coalesce(auth.uid(), new.updated_by, new.created_by);
  pname text := public.project_name(new.workspace_id, new.odoo_project_id);
  days  integer := coalesce((select resubmit_days from public.technical_settings where workspace_id = new.workspace_id), 7);
  prev  uuid;
  label text;
begin
  -- A code came back: the client is no longer being chased for this round.
  if new.code is not null and (tg_op = 'INSERT' or old.code is distinct from new.code) then
    perform public.close_project_tasks(new.workspace_id, 'review_chase:' || new.odoo_project_id || ':' || new.id, actor);
    -- C or D: the next round is due. One follow-up per round.
    if new.code in ('C', 'D') then
      label := case new.code when 'C' then 'revise and resubmit' else 'rejected' end;
      insert into public.tasks (workspace_id, title, details, assigned_to, created_by, updated_by, due_at, priority, section, odoo_project_id, auto_key)
      values (
        new.workspace_id,
        'Resubmit ' || new.title || ' (round ' || (new.round + 1) || ') on ' || pname,
        'The client returned round ' || new.round || ' with code ' || new.code || ' (' || label || ')'
          || case when new.notes <> '' then ': ' || left(new.notes, 300) else '.' end
          || ' Record the next round on the project in Technical when it goes in.',
        public.project_pm_user(new.workspace_id, new.odoo_project_id),
        null, actor,
        ((coalesce(new.returned_at, current_date) + days)::timestamp + time '23:59') at time zone 'Asia/Riyadh',
        'high', 'technical', new.odoo_project_id,
        'resubmit:' || new.odoo_project_id || ':' || new.id
      )
      on conflict (workspace_id, auto_key) do nothing;
    end if;
  end if;

  -- The next round went in: the resubmission is done.
  if tg_op = 'INSERT' and new.round > 1 then
    select s.id into prev from public.project_submittals s
     where s.workspace_id = new.workspace_id and s.odoo_project_id = new.odoo_project_id
       and lower(s.title) = lower(new.title) and s.round = new.round - 1;
    if prev is not null then
      perform public.close_project_tasks(new.workspace_id, 'resubmit:' || new.odoo_project_id || ':' || prev, actor);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists project_submittals_follow on public.project_submittals;
create trigger project_submittals_follow after insert or update on public.project_submittals
  for each row execute function public.project_submittals_follow();

-- The weekly update is written: its reminder is done.
create or replace function public.project_updates_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.close_project_tasks(new.workspace_id, 'update_due:' || new.odoo_project_id || ':', new.written_by);
  return new;
end;
$$;
drop trigger if exists project_updates_follow on public.project_updates;
create trigger project_updates_follow after insert on public.project_updates
  for each row execute function public.project_updates_follow();
