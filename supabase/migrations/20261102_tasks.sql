-- ─── v2: tasks, follow-ups and meetings ────────────────────────────────────
-- 2026-10-19. The owner: "we had a meeting with the sales team, we assign
-- the tasks, then the follow-ups, reminders, deadlines, all reminded through
-- the application". docs/TASKS-PLAN.md has the flow.
--
--   meetings     a meeting: who was there, notes; its action items are tasks
--   tasks        one thing one person must do, with a deadline and a reminder
--   task_events  each task's history and comments, written by the trigger
--
-- Who can be given a task: anyone in the company, a member or a sales seat.
-- Who sees one: the person doing it, the person who set it, whoever manages
-- its section (a v2 grant, 20261101_section_access), whoever manages the CEO
-- section (oversight of everything) and the access admin.
-- The bell (public.notifications) is written here, by triggers, so a change
-- made from any screen, the assistant or SQL notifies the same way. The
-- timed reminders (due soon, overdue, the morning digest) are written by the
-- server's reminder round (api/leads/_tasks.js) and recorded in
-- tasks.reminded so each is sent once per deadline.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── Who is in the company ──
-- A member, or a sales seat (the sales team are not members; 20261013).
create or replace function public.in_company(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_workspace_member(ws) or public.is_sales_member(ws);
$$;
grant execute on function public.in_company(uuid) to authenticated;

/** Everyone a task can be given to in this company, for the pickers. */
create or replace function public.task_people(ws uuid)
returns table (user_id uuid, name text, kind text)
language sql
stable
security definer
set search_path = public
as $$
  select ua.user_id,
         coalesce(nullif(trim(ua.full_name), ''), split_part(ua.email, '@', 1)),
         case when ua.role = 'sales' then 'sales' else 'member' end
    from public.user_access ua
   where public.in_company(ws)
     and ua.status = 'approved'
     and (
       exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = ua.user_id)
       or exists (select 1 from public.sales_seats s where s.workspace_id = ws and s.user_id = ua.user_id)
     )
   order by 2;
$$;
grant execute on function public.task_people(uuid) to authenticated;

-- ── Meetings ──
create table if not exists public.meetings (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  held_at      timestamptz not null default now(),
  section      text check (section in ('ceo', 'sales', 'marketing', 'insights')),
  attendees    uuid[] not null default '{}',
  notes        text not null default '',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists meetings_ws_idx on public.meetings (workspace_id, held_at desc);

-- ── Tasks ──
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  title         text not null check (length(trim(title)) > 0),
  details       text not null default '',
  assigned_to   uuid references auth.users(id) on delete set null,
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  due_at        timestamptz,
  -- An explicit reminder time; null = only the standard due-soon / overdue.
  remind_at     timestamptz,
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status        text not null default 'todo' check (status in ('todo', 'in_progress', 'waiting', 'done', 'cancelled')),
  section       text check (section in ('ceo', 'sales', 'marketing', 'insights')),
  meeting_id    uuid references public.meetings(id) on delete set null,
  lead_id       uuid references public.leads(id) on delete set null,
  account_id    uuid references public.sales_accounts(id) on delete set null,
  follow_up_of  uuid references public.tasks(id) on delete set null,
  -- Which timed reminders went out for the CURRENT deadline:
  -- { "remind": ts, "due_soon": ts, "overdue": ts }. Cleared when it moves.
  reminded      jsonb not null default '{}'::jsonb,
  completed_at  timestamptz,
  completed_by  uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists tasks_assignee_idx on public.tasks (assigned_to, status, due_at);
create index if not exists tasks_creator_idx on public.tasks (created_by, status, due_at);
create index if not exists tasks_ws_open_idx on public.tasks (workspace_id, status, due_at);
create index if not exists tasks_meeting_idx on public.tasks (meeting_id);
create index if not exists tasks_lead_idx on public.tasks (lead_id);

-- ── History and comments ──
create table if not exists public.task_events (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor        uuid references auth.users(id) on delete set null,
  kind         text not null check (kind in ('created', 'assigned', 'status', 'due', 'comment', 'edited')),
  body         text not null default '',
  from_status  text,
  to_status    text,
  created_at   timestamptz not null default now()
);
create index if not exists task_events_task_idx on public.task_events (task_id, created_at);

-- ── Who sees, who changes ──
create or replace function public.can_see_task(ws uuid, sec text, assignee uuid, creator uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.in_company(ws) and (
       assignee = auth.uid()
    or creator = auth.uid()
    or public.is_access_admin()
    or (sec is not null and public.has_section(ws, sec, 'manage'))
    -- Management oversight: whoever manages the CEO section sees every task.
    or public.has_section(ws, 'ceo', 'manage')
  );
$$;
grant execute on function public.can_see_task(uuid, text, uuid, uuid) to authenticated;

alter table public.tasks enable row level security;
alter table public.meetings enable row level security;
alter table public.task_events enable row level security;

drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (public.can_see_task(workspace_id, section, assigned_to, created_by));

-- Anyone in the company sets a task, as themselves, for someone there.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    public.in_company(workspace_id)
    and created_by = auth.uid()
    and (assigned_to is null or exists (select 1 from public.task_people(workspace_id) p where p.user_id = assigned_to))
  );

-- The person doing it, the setter, a section manager or the admin.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_see_task(workspace_id, section, assigned_to, created_by))
  with check (
    public.in_company(workspace_id)
    and (assigned_to is null or exists (select 1 from public.task_people(workspace_id) p where p.user_id = assigned_to))
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.in_company(workspace_id) and (created_by = auth.uid() or public.is_access_admin()));

-- Meetings: anyone in the company reads them (who was there, what was agreed);
-- the person who held one, or the admin, changes or removes it.
drop policy if exists meetings_read on public.meetings;
create policy meetings_read on public.meetings for select to authenticated
  using (public.in_company(workspace_id));
drop policy if exists meetings_insert on public.meetings;
create policy meetings_insert on public.meetings for insert to authenticated
  with check (public.in_company(workspace_id) and created_by = auth.uid());
drop policy if exists meetings_update on public.meetings;
create policy meetings_update on public.meetings for update to authenticated
  using (public.in_company(workspace_id) and (created_by = auth.uid() or public.is_access_admin()));
drop policy if exists meetings_delete on public.meetings;
create policy meetings_delete on public.meetings for delete to authenticated
  using (public.in_company(workspace_id) and (created_by = auth.uid() or public.is_access_admin()));

-- History: read with the task; comments written by the person themselves.
drop policy if exists task_events_read on public.task_events;
create policy task_events_read on public.task_events for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_events.task_id));
drop policy if exists task_events_comment on public.task_events;
create policy task_events_comment on public.task_events for insert to authenticated
  with check (
    kind = 'comment' and actor = auth.uid()
    and exists (select 1 from public.tasks t where t.id = task_events.task_id)
  );

-- ── The trigger: history and the bell ──
create or replace function public.task_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) from public.user_access where user_id = uid), 'Someone');
$$;

create or replace function public.tasks_track()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := coalesce(auth.uid(), new.updated_by, new.created_by);
  who   text := public.task_name(actor);
  link  text := '/tasks?id=' || new.id;
  -- A deadline with no time is stored as 23:59 and said as the day alone.
  due   text := case when new.due_at is null then ''
                     when to_char(new.due_at at time zone 'Asia/Riyadh', 'HH24:MI') = '23:59'
                       then ', due ' || to_char(new.due_at at time zone 'Asia/Riyadh', 'Dy DD Mon')
                     else ', due ' || to_char(new.due_at at time zone 'Asia/Riyadh', 'Dy DD Mon HH24:MI') end;
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, workspace_id, actor, kind, body, to_status)
      values (new.id, new.workspace_id, actor, 'created', new.details, new.status);
    if new.assigned_to is not null and new.assigned_to is distinct from actor then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link)
        values (new.assigned_to, new.workspace_id, 'task_assigned',
                who || ' gave you a task: ' || new.title || due, left(new.details, 400), link);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_events (task_id, workspace_id, actor, kind, from_status, to_status)
      values (new.id, new.workspace_id, actor, 'status', old.status, new.status);
    -- The setter hears when their task is finished, dropped or reopened.
    if new.created_by is not null and new.created_by is distinct from actor
       and (new.status in ('done', 'cancelled') or old.status in ('done', 'cancelled')) then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link)
        values (new.created_by, new.workspace_id, 'task_' || new.status,
                case new.status
                  when 'done' then who || ' finished: ' || new.title
                  when 'cancelled' then who || ' dropped: ' || new.title
                  else who || ' reopened: ' || new.title end,
                '', link);
    end if;
  end if;

  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    insert into public.task_events (task_id, workspace_id, actor, kind, body)
      values (new.id, new.workspace_id, actor, 'assigned', public.task_name(new.assigned_to));
    if new.assigned_to is distinct from actor then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link)
        values (new.assigned_to, new.workspace_id, 'task_assigned',
                who || ' gave you a task: ' || new.title || due, left(new.details, 400), link);
    end if;
  end if;

  if new.due_at is distinct from old.due_at then
    insert into public.task_events (task_id, workspace_id, actor, kind, body)
      values (new.id, new.workspace_id, actor, 'due', coalesce(to_char(new.due_at at time zone 'Asia/Riyadh', 'Dy DD Mon HH24:MI'), 'no deadline'));
    if new.assigned_to is not null and new.assigned_to is distinct from actor then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link)
        values (new.assigned_to, new.workspace_id, 'task_due_moved',
                who || ' moved the deadline: ' || new.title || due, '', link);
    end if;
  end if;

  if new.title is distinct from old.title or new.details is distinct from old.details then
    insert into public.task_events (task_id, workspace_id, actor, kind) values (new.id, new.workspace_id, actor, 'edited');
  end if;
  return new;
end;
$$;

-- BEFORE UPDATE: the row's own bookkeeping (timestamps, re-arming reminders).
create or replace function public.tasks_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status in ('done', 'cancelled') and old.status not in ('done', 'cancelled') then
    new.completed_at := now();
    new.completed_by := coalesce(auth.uid(), new.updated_by);
  elsif new.status not in ('done', 'cancelled') then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  -- A new deadline or reminder time re-arms the timed reminders.
  if new.due_at is distinct from old.due_at or new.remind_at is distinct from old.remind_at then
    new.reminded := '{}'::jsonb;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_stamp on public.tasks;
create trigger tasks_stamp before update on public.tasks for each row execute function public.tasks_stamp();
drop trigger if exists tasks_track_ins on public.tasks;
create trigger tasks_track_ins after insert on public.tasks for each row execute function public.tasks_track();
drop trigger if exists tasks_track_upd on public.tasks;
create trigger tasks_track_upd after update on public.tasks for each row execute function public.tasks_track();

-- A comment tells the other side: the setter or the person doing it.
create or replace function public.task_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tasks;
  who text := public.task_name(new.actor);
begin
  if new.kind <> 'comment' then return new; end if;
  select * into t from public.tasks where id = new.task_id;
  insert into public.notifications (user_id, workspace_id, kind, title, body, link)
    select u, t.workspace_id, 'task_comment', who || ' commented on: ' || t.title, left(new.body, 400), '/tasks?id=' || t.id
      from unnest(array[t.assigned_to, t.created_by]) as u
     where u is not null and u is distinct from new.actor
     group by u;
  return new;
end;
$$;
drop trigger if exists task_comment_notify on public.task_events;
create trigger task_comment_notify after insert on public.task_events for each row execute function public.task_comment_notify();

-- Meetings keep their own updated_at.
create or replace function public.meetings_stamp()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
drop trigger if exists meetings_stamp on public.meetings;
create trigger meetings_stamp before update on public.meetings for each row execute function public.meetings_stamp();

grant select, insert, update, delete on public.tasks, public.meetings to authenticated;
grant select, insert on public.task_events to authenticated;
grant all on public.tasks, public.meetings, public.task_events to service_role;

-- ── When each person's morning digest last went out ──
-- Written by the server's reminder round only (service key); nobody reads it
-- from the browser.
create table if not exists public.task_digests (
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sent_at      timestamptz not null,
  primary key (user_id, workspace_id)
);
alter table public.task_digests enable row level security;
grant all on public.task_digests to service_role;
