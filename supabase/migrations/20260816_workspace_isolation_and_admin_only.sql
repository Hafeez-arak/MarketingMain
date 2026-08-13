-- ─── Workspaces are real tenants now ──────────────────────────────────────
--
-- Two things this fixes.
--
-- 1. Isolation. Every per-workspace table already had an RLS policy built on
--    is_workspace_member(), which is correct as far as it goes — but "member"
--    is per-user, not per-workspace, and the two operators here belong to all
--    three workspaces. So RLS let every row from every workspace through and
--    the app, trusting RLS, sent queries with no workspace_id filter. The
--    Media Library was one merged pile: switching workspace changed nothing.
--    The client now filters by the active workspace (see lib/mediaLibrary.js);
--    this migration is the half that stops one workspace's data being
--    reachable from another at all.
--
-- 2. Arak Lighting is admin-only. It is the house workspace, not a client's,
--    and only an app admin (user_access.role = 'admin') should see it —
--    including its Media Library, its Creative Studio threads, and its plans.
--
-- Nothing is deleted and no row moves workspace: each asset stays with the
-- workspace it was created in. Membership rows stay too — access is decided
-- at read time, so making someone an admin restores Arak for them with no
-- further migration.

-- ── 1. Which workspaces are admin-only ────────────────────────────────────
-- A flag rather than a hardcoded uuid, so the rule is a property of the
-- workspace and the next house workspace needs no code change.
alter table public.workspaces
  add column if not exists admin_only boolean not null default false;

comment on column public.workspaces.admin_only is
  'When true, only an app admin (user_access.role = ''admin'') can see this workspace or any of its data, regardless of workspace_members.';

update public.workspaces
   set admin_only = true
 where id = '00000000-0000-0000-0000-000000000001';  -- Arak Lighting

-- ── 2. Who counts as an app admin ─────────────────────────────────────────
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access ua
    where ua.user_id = auth.uid()
      and ua.status  = 'approved'
      and ua.role    = 'admin'
  );
$$;

-- ── 3. One choke point for the whole app ──────────────────────────────────
-- 29 policies across every per-workspace table already call this, so gating
-- it here gates all of them at once — media_library, creative_sessions,
-- creative_versions, content_plans, plan_ideas, schedules, analytics. Adding
-- the check to each policy by hand would be 29 chances to miss one.
--
-- Reading public.workspaces from inside a policy helper does not recurse:
-- SECURITY DEFINER runs as the table owner (postgres), and an owner without
-- FORCE ROW LEVEL SECURITY is exempt from RLS — the same reason the previous
-- version could read workspace_members, whose own policy calls this function.
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.workspace_members wm
      join public.workspaces w on w.id = wm.workspace_id
     where wm.workspace_id = ws_id
       and wm.user_id      = auth.uid()
       and (not w.admin_only or public.is_app_admin())
  );
$$;

-- ── 4. New accounts do not get handed the house workspace ─────────────────
-- A pre-cleared signup is auto-joined to every workspace. That is deliberate
-- for client workspaces and wrong for an admin-only one, which would hand
-- Arak back to the next member who signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pre_cleared boolean;
begin
  select exists (
    select 1 from public.access_invites i where i.email = lower(new.email)
  ) into pre_cleared;

  insert into public.user_access (user_id, email, full_name, status, role, decided_at)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    case when pre_cleared then 'approved' else 'pending' end,
    'member',
    case when pre_cleared then now() else null end
  )
  on conflict (user_id) do nothing;

  if pre_cleared then
    insert into public.workspace_members (workspace_id, user_id, role)
    select w.id, new.id, 'owner'
      from public.workspaces w
     where not w.admin_only
    on conflict (workspace_id, user_id) do nothing;

    delete from public.access_invites where email = lower(new.email);
  end if;

  return new;
end;
$$;

-- ── 5. Close the anon back door into Arak's library ───────────────────────
-- This policy let the plain anon key read and write every media_library row
-- belonging to the legacy workspace — which is Arak, the one workspace that
-- is now supposed to be admin-only. Nothing calls it: the app's library reads
-- need a workspace id that only a session provides, and no n8n flow touches
-- this table. The nine sibling *_anon_legacy_only policies on the Instagram /
-- LinkedIn / brand tables are left alone — same legacy pattern, but they are
-- outside what this change is about and n8n may still use them.
drop policy if exists media_library_anon_legacy_only on public.media_library;
