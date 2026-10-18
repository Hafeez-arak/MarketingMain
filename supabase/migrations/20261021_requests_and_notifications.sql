-- ─── Requests, tagging, notifications, private conversations ──────────────
-- 2026-10-18. PR 2 of docs/CEO-ASSISTANT-PLAN.md.
--
-- The CEO talks to the assistant. When he asks for something it cannot do
-- itself, or tags a person, that becomes a REQUEST someone owns and he can
-- ask about later. People hear about it through NOTIFICATIONS that survive a
-- refresh (the old bell kept them in browser memory). And his conversations
-- stop being visible to everyone in the company.
--
-- Applied by hand, like every migration here. Safe to re-run.

-- ── 1. Conversations belong to the person who started them ───────────────
-- Before this, research_chats had no owner and RLS was membership only, so
-- anyone in Arak Lighting saw every conversation in Past conversations.
-- Rows from before this migration have no owner; they stay visible to
-- administrators only.

alter table public.research_chats
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists research_chats_owner_idx
  on public.research_chats (workspace_id, user_id, updated_at desc);

create or replace function public.chat_visible(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select owner = auth.uid() or (owner is null and public.is_access_admin());
$$;

-- ALTER, not DROP + CREATE: a dropped policy leaves the table wide open (or
-- shut) for the moment between the two statements, and a half-applied run
-- through the MCP has left exactly that behind before.
alter policy research_chats_rw on public.research_chats
  using (public.is_workspace_member(workspace_id) and public.chat_visible(user_id))
  with check (public.is_workspace_member(workspace_id) and public.chat_visible(user_id));

-- A message is visible when its conversation is. The subquery runs under the
-- caller's RLS on research_chats, so it inherits the rule above.
alter policy research_messages_rw on public.research_messages
  using (
    public.is_workspace_member(workspace_id)
    and exists (select 1 from public.research_chats c where c.id = research_messages.chat_id)
  )
  with check (
    public.is_workspace_member(workspace_id)
    and exists (select 1 from public.research_chats c where c.id = research_messages.chat_id)
  );

-- ── 2. Who can be tagged, and who hears about new requests ───────────────
-- Data, not code: the CEO asked for Shadia and Hafeez now, and more people
-- later should be a row, not a deploy.

create table if not exists public.request_people (
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  can_be_tagged   boolean not null default true,
  gets_new_requests boolean not null default false,
  label           text not null default '',
  created_at      timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.request_people enable row level security;

drop policy if exists request_people_read on public.request_people;
create policy request_people_read on public.request_people
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists request_people_admin on public.request_people;
create policy request_people_admin on public.request_people
  for all to authenticated
  using (public.is_access_admin() and public.is_workspace_member(workspace_id))
  with check (public.is_access_admin() and public.is_workspace_member(workspace_id));

-- Names for the @ picker. user_access is readable by admins only, so a member
-- could not otherwise see who they can tag.
create or replace function public.taggable_people(ws uuid)
returns table (user_id uuid, name text, label text)
language sql
stable
security definer
set search_path = public
as $$
  select rp.user_id,
         coalesce(nullif(trim(ua.full_name), ''), split_part(ua.email, '@', 1)) as name,
         rp.label
    from public.request_people rp
    join public.user_access ua on ua.user_id = rp.user_id and ua.status = 'approved'
   where rp.workspace_id = ws
     and rp.can_be_tagged
     and public.is_workspace_member(ws)
   order by 2;
$$;

grant execute on function public.taggable_people(uuid) to authenticated;

-- ── 3. Requests ──────────────────────────────────────────────────────────

create table if not exists public.requests (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind         text not null default 'improvement'
               check (kind in ('improvement', 'bug', 'content', 'question', 'task')),
  title        text not null,
  body         text not null default '',   -- the asker's own words
  brief        text not null default '',   -- what the assistant wrote for whoever picks it up
  page         text not null default '',   -- where they were when they asked
  context      jsonb not null default '{}'::jsonb,
  chat_id      uuid references public.research_chats(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  assigned_to  uuid references auth.users(id) on delete set null,
  status       text not null default 'new'
               check (status in ('new', 'in_progress', 'done', 'declined')),
  resolution   text not null default '',
  link         text not null default '',
  updated_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  closed_at    timestamptz
);

create index if not exists requests_board_idx on public.requests (workspace_id, status, updated_at desc);
create index if not exists requests_assignee_idx on public.requests (assigned_to, status);
create index if not exists requests_creator_idx on public.requests (created_by, status);

alter table public.requests enable row level security;

-- Admins see the whole board; everyone else sees what they asked for or
-- what is theirs to do.
drop policy if exists requests_read on public.requests;
create policy requests_read on public.requests
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (public.is_access_admin() or created_by = auth.uid() or assigned_to = auth.uid())
  );

drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());

drop policy if exists requests_update on public.requests;
create policy requests_update on public.requests
  for update to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (public.is_access_admin() or created_by = auth.uid() or assigned_to = auth.uid())
  )
  with check (public.is_workspace_member(workspace_id));

create table if not exists public.request_events (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.requests(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor        uuid references auth.users(id) on delete set null,
  kind         text not null check (kind in ('created', 'status', 'assigned', 'comment')),
  body         text not null default '',
  from_status  text,
  to_status    text,
  created_at   timestamptz not null default now()
);

create index if not exists request_events_idx on public.request_events (request_id, created_at);

alter table public.request_events enable row level security;

drop policy if exists request_events_read on public.request_events;
create policy request_events_read on public.request_events
  for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_events.request_id));

drop policy if exists request_events_insert on public.request_events;
create policy request_events_insert on public.request_events
  for insert to authenticated
  with check (
    actor = auth.uid()
    and exists (select 1 from public.requests r where r.id = request_events.request_id)
  );

-- ── 4. Notifications ─────────────────────────────────────────────────────

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  kind         text not null default 'info',
  title        text not null,
  body         text not null default '',
  link         text not null default '',
  request_id   uuid references public.requests(id) on delete cascade,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists notifications_inbox_idx on public.notifications (user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

-- Marking read is the only change a person makes to their own inbox.
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 5. One place decides who hears about what ────────────────────────────
-- A trigger rather than code in each writer: a request can be made or moved
-- by the assistant (service key), by the Requests page (the person's token)
-- or by hand in SQL, and all three must notify the same way. The writer sets
-- updated_by so the person who acted is not notified about their own act.

create or replace function public.requests_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The signed-in person when there is one (the Requests page); the server's
  -- updated_by when the assistant acted with the service key.
  actor uuid := coalesce(auth.uid(), new.updated_by, new.created_by);
  asker text;
  link  text := '/requests?id=' || new.id;
begin
  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) into asker
    from public.user_access where user_id = actor;
  asker := coalesce(asker, 'Someone');

  if tg_op = 'INSERT' then
    insert into public.request_events (request_id, workspace_id, actor, kind, body, to_status)
      values (new.id, new.workspace_id, new.created_by, 'created', new.body, new.status);

    if new.assigned_to is not null and new.assigned_to is distinct from actor then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link, request_id)
        values (new.assigned_to, new.workspace_id, 'tagged',
                asker || ' tagged you: ' || new.title, left(coalesce(nullif(new.brief, ''), new.body), 400), link, new.id);
    end if;

    -- Unassigned requests go to whoever handles new ones (the app's builders).
    if new.assigned_to is null then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link, request_id)
        select rp.user_id, new.workspace_id, 'new_request',
               'New request from ' || asker || ': ' || new.title, left(coalesce(nullif(new.brief, ''), new.body), 400), link, new.id
          from public.request_people rp
         where rp.workspace_id = new.workspace_id and rp.gets_new_requests and rp.user_id is distinct from actor;
    end if;
    return new;
  end if;

  -- UPDATE
  new.updated_at := now();
  if new.status in ('done', 'declined') and old.status not in ('done', 'declined') then
    new.closed_at := now();
  elsif new.status not in ('done', 'declined') then
    new.closed_at := null;
  end if;

  if new.status is distinct from old.status then
    insert into public.request_events (request_id, workspace_id, actor, kind, body, from_status, to_status)
      values (new.id, new.workspace_id, actor, 'status', new.resolution, old.status, new.status);
    -- The asker hears every move on their request.
    if new.created_by is not null and new.created_by is distinct from actor then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link, request_id)
        values (new.created_by, new.workspace_id, 'request_' || new.status,
                case new.status
                  when 'done' then 'Done: ' || new.title
                  when 'declined' then 'Declined: ' || new.title
                  when 'in_progress' then asker || ' started on: ' || new.title
                  else 'Reopened: ' || new.title end,
                left(new.resolution, 400), link, new.id);
    end if;
  end if;

  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    insert into public.request_events (request_id, workspace_id, actor, kind, body)
      values (new.id, new.workspace_id, actor, 'assigned', '');
    if new.assigned_to is distinct from actor then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link, request_id)
        values (new.assigned_to, new.workspace_id, 'tagged',
                asker || ' gave you: ' || new.title, left(coalesce(nullif(new.brief, ''), new.body), 400), link, new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists requests_notify_ins on public.requests;
create trigger requests_notify_ins
  after insert on public.requests
  for each row execute function public.requests_notify();

drop trigger if exists requests_notify_upd on public.requests;
create trigger requests_notify_upd
  before update on public.requests
  for each row execute function public.requests_notify();

-- A comment notifies the other side of the request.
create or replace function public.request_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.requests;
  who text;
begin
  if new.kind <> 'comment' then return new; end if;
  select * into r from public.requests where id = new.request_id;
  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) into who
    from public.user_access where user_id = new.actor;
  insert into public.notifications (user_id, workspace_id, kind, title, body, link, request_id)
    select distinct u, r.workspace_id, 'comment', coalesce(who, 'Someone') || ' commented on: ' || r.title,
           left(new.body, 400), '/requests?id=' || r.id, r.id
      from unnest(array[r.created_by, r.assigned_to]) as u
     where u is not null and u is distinct from new.actor;
  return new;
end;
$$;

drop trigger if exists request_comment_notify on public.request_events;
create trigger request_comment_notify
  after insert on public.request_events
  for each row execute function public.request_comment_notify();

-- ── 6. Arak Lighting's people ────────────────────────────────────────────
-- Shadia (marketing) and Hafeez can be tagged; Hafeez also hears about every
-- new request, since he builds the changes.
insert into public.request_people (workspace_id, user_id, can_be_tagged, gets_new_requests, label)
select '00000000-0000-0000-0000-000000000001', ua.user_id, true,
       ua.email = 'hafeez@arak-sa.com',
       case ua.email when 'shadia@arak-sa.com' then 'Marketing' else 'Builds the app' end
  from public.user_access ua
 where ua.email in ('shadia@arak-sa.com', 'hafeez@arak-sa.com')
on conflict (workspace_id, user_id) do nothing;

-- ── 7. Names for the Requests page ───────────────────────────────────────
-- user_access is admin-only, so a member opening a request assigned to them
-- could not otherwise see who asked. Names only, for people in this company.
create or replace function public.workspace_people(ws uuid)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select ua.user_id, coalesce(nullif(trim(ua.full_name), ''), split_part(ua.email, '@', 1))
    from public.user_access ua
   where public.is_workspace_member(ws)
     and (
       exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = ua.user_id)
       or exists (select 1 from public.request_people rp where rp.workspace_id = ws and rp.user_id = ua.user_id)
       or ua.role = 'admin'
     );
$$;

grant execute on function public.workspace_people(uuid) to authenticated;
