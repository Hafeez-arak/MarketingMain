-- Account access control: one approval gate, one uniform permission set.
--
-- The model, in three sentences:
--   1. Signing up grants NOTHING. It files a pending request, nothing more.
--   2. The access admin (hafeez@arak-sa.com) approves. Approval joins that
--      person to EVERY company — present and future — with identical rights.
--   3. Approved people can do everything in the app, including creating and
--      deleting companies. The one thing they cannot do is grant or revoke
--      someone else's access.
--
-- Why "identical rights" needs no new plumbing: every workspace-scoped table
-- in this database already gates on is_workspace_member(workspace_id) with no
-- role test anywhere. So membership IS the permission. Keeping the roster the
-- same across all workspaces is therefore the whole job — hence the trigger
-- below that back-fills every new company with every approved member. There
-- is deliberately no per-workspace role: nothing reads one, and a column
-- nothing reads is a lie waiting to be believed.
--
-- The gate is enforced in the database, not the UI. A revoked user loses
-- every workspace_members row, so RLS returns them zero rows everywhere —
-- there is no screen to bypass.

-- ── Who has access ──────────────────────────────────────────────────────────
-- One row per human who has ever signed up. This is the single source of
-- truth for both "are you in" (status) and "can you let others in" (role).
-- Keeping them in one table means the client learns both from one query on
-- its own row, and there is no second table to drift out of sync.
create table if not exists public.user_access (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'revoked')),
  role        text not null default 'member'
              check (role in ('admin', 'member')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users(id) on delete set null
);

create index if not exists user_access_status_idx on public.user_access (status);

alter table public.user_access enable row level security;

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so they can read user_access from inside a policy on
-- user_access itself without infinite recursion.
create or replace function public.is_access_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access ua
    where ua.user_id = auth.uid()
      and ua.role = 'admin'
      and ua.status = 'approved'
  );
$$;

create or replace function public.has_app_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access ua
    where ua.user_id = auth.uid()
      and ua.status = 'approved'
  );
$$;

grant execute on function public.is_access_admin() to authenticated;
grant execute on function public.has_app_access() to authenticated;

-- ── Reading the roster ──────────────────────────────────────────────────────
-- You can always see your own row (the app needs it to decide between the
-- dashboard and the "pending approval" screen). Only the admin sees everyone.
drop policy if exists user_access_select_self on public.user_access;
create policy user_access_select_self on public.user_access
  for select using (user_id = auth.uid() or public.is_access_admin());

-- No INSERT/UPDATE/DELETE policies, on purpose. Rows are written only by the
-- signup trigger and the two approve/revoke functions below, both of which
-- are SECURITY DEFINER and check the caller. A member cannot promote
-- themselves by any route the client can reach.

-- ── Signup files a request, and nothing else ────────────────────────────────
-- Replaces the previous trigger, which auto-admitted anyone with an
-- @arak-sa.com address into Arak Lighting and handed everyone else a
-- private workspace. Both paths are gone: no email domain grants access,
-- and nobody self-provisions a tenant.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_access (user_id, email, full_name, status, role)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    'pending',
    'member'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- ── Every company gets every approved member ────────────────────────────────
-- The guarantee "all workspaces have the same people, no extra, no less"
-- has to hold for companies created tomorrow, not just the ones that exist
-- today. This trigger is what makes it automatic instead of a chore someone
-- has to remember.
create or replace function public.sync_workspace_roster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  select new.id, ua.user_id, 'owner'
  from public.user_access ua
  where ua.status = 'approved'
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists workspaces_sync_roster on public.workspaces;
create trigger workspaces_sync_roster
  after insert on public.workspaces
  for each row execute function public.sync_workspace_roster();

-- ── Grant access ────────────────────────────────────────────────────────────
create or replace function public.approve_access(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can approve access';
  end if;

  update public.user_access
     set status = 'approved', decided_at = now(), decided_by = auth.uid()
   where user_id = target_user;

  if not found then
    raise exception 'No access request found for that user';
  end if;

  -- Join them to every company that exists right now; the trigger above
  -- covers every company created from here on.
  insert into public.workspace_members (workspace_id, user_id, role)
  select w.id, target_user, 'owner'
  from public.workspaces w
  on conflict (workspace_id, user_id) do nothing;
end;
$$;

-- ── Revoke access (also used to deny a pending request) ─────────────────────
create or replace function public.revoke_access(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can revoke access';
  end if;

  select role into target_role from public.user_access where user_id = target_user;

  if target_role is null then
    raise exception 'No access record found for that user';
  end if;

  -- Guard against the one irreversible mistake here: revoking the admin
  -- would leave nobody able to approve anyone, including themselves.
  if target_role = 'admin' then
    raise exception 'The access admin cannot be revoked';
  end if;

  update public.user_access
     set status = 'revoked', decided_at = now(), decided_by = auth.uid()
   where user_id = target_user;

  -- Membership is the permission, so pulling every row is what actually
  -- locks them out — RLS then returns them nothing, everywhere.
  delete from public.workspace_members where user_id = target_user;
end;
$$;

grant execute on function public.approve_access(uuid) to authenticated;
grant execute on function public.revoke_access(uuid) to authenticated;

-- ── Creating a company ──────────────────────────────────────────────────────
-- No longer inserts the caller's membership by hand: the roster trigger
-- already added every approved member, the caller included. Doing both
-- would collide on the primary key.
create or replace function public.create_company(company_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not public.has_app_access() then
    raise exception 'Your access has not been approved yet';
  end if;

  insert into public.workspaces (name)
    values (coalesce(nullif(trim(company_name), ''), 'My Company'))
    returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_company(text) to authenticated;

-- ── Workspace policies: approved members, all equal ─────────────────────────
-- Previously any authenticated user could insert a workspace — including one
-- sitting in the pending queue, which would have handed them a tenant the
-- admin never approved.
drop policy if exists "authenticated can create a workspace" on public.workspaces;
create policy workspaces_insert_approved on public.workspaces
  for insert to authenticated
  with check (public.has_app_access());

-- Delete was owner-only. Approved members are all equals by decision, and
-- they all carry 'owner' anyway, so the role test was noise — replaced with
-- a plain membership test that says what it means.
drop policy if exists workspaces_delete_owner on public.workspaces;
drop policy if exists workspaces_delete_member on public.workspaces;
create policy workspaces_delete_member on public.workspaces
  for delete using (public.is_workspace_member(id));

-- ── Backfill: bring the people who already exist into the new model ─────────
-- Matched by email rather than a pasted uuid so this migration is honest
-- about who it is naming and safe to re-run.
insert into public.user_access (user_id, email, status, role, decided_at)
select u.id, u.email, 'approved', 'admin', now()
from auth.users u
where u.email = 'hafeez@arak-sa.com'
on conflict (user_id) do update
  set status = 'approved', role = 'admin';

insert into public.user_access (user_id, email, status, role, decided_at)
select u.id, u.email, 'approved', 'member', now()
from auth.users u
where u.email = 'mkader@arak-sa.com'
on conflict (user_id) do update
  set status = 'approved';

-- Everyone else who signed up before the gate existed goes into the queue
-- rather than being silently grandfathered in.
insert into public.user_access (user_id, email, status, role)
select u.id, u.email, 'pending', 'member'
from auth.users u
on conflict (user_id) do nothing;

-- Level the roster: every approved person, in every company.
insert into public.workspace_members (workspace_id, user_id, role)
select w.id, ua.user_id, 'owner'
from public.workspaces w
cross join public.user_access ua
where ua.status = 'approved'
on conflict (workspace_id, user_id) do nothing;

-- ...and nobody who isn't approved.
delete from public.workspace_members wm
where not exists (
  select 1 from public.user_access ua
  where ua.user_id = wm.user_id and ua.status = 'approved'
);
