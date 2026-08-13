-- ─── Fold admin_only into the access-control work it belongs to ───────────
--
-- The admin_only migration (20260816_workspace_isolation_and_admin_only) was
-- written against a checkout that predated the access gate, so it invented
-- `is_app_admin()` — which is `is_access_admin()` from 20260816_access_control
-- under a second name, same definition to the letter. Two functions answering
-- "is this the admin?" is how they drift: someone tightens one and the other
-- keeps letting people through. There is one admin concept, so there is one
-- function, and it is the one the rest of the app already calls.
--
-- Also closes the hole the same staleness left: approving someone hands them
-- every workspace, and nothing told that path about admin_only.

-- ── 1. One admin check ────────────────────────────────────────────────────
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
       and (not w.admin_only or public.is_access_admin())
  );
$$;

drop function if exists public.is_app_admin();

-- ── 2. Approval no longer hands out the house workspace ───────────────────
-- grant_access_to_user() joins the approved user to every workspace. The read
-- gate above means such a row never actually granted sight of Arak — but it
-- did put a non-admin on Arak's roster as an owner, which reads as access to
-- anyone looking at the members table and is one refactor away from being it.
-- handle_new_user() already filters this way; this is the same rule on the
-- other route in.
create or replace function public.grant_access_to_user(target_user uuid, actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_access (user_id, email, status, role, decided_at, decided_by)
  select target_user, u.email, 'approved', 'member', now(), actor
  from auth.users u where u.id = target_user
  on conflict (user_id) do update
    set status = 'approved', decided_at = now(), decided_by = excluded.decided_by;

  insert into public.workspace_members (workspace_id, user_id, role)
  select w.id, target_user, 'owner'
  from public.workspaces w
  where not w.admin_only
  on conflict (workspace_id, user_id) do nothing;
end;
$$;

-- ── 3. Same rule for a newly created workspace ────────────────────────────
-- sync_workspace_roster() fires when a workspace is created and adds every
-- approved user to it. Correct for a client workspace; if an admin-only one
-- is ever created it would seed a roster the gate then has to keep denying.
create or replace function public.sync_workspace_roster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.admin_only then
    return new;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  select new.id, ua.user_id, 'owner'
  from public.user_access ua
  where ua.status = 'approved'
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$$;

-- Deliberately NOT deleting the Arak membership rows non-admins already hold.
-- They grant nothing — the gate above denies the read either way — and
-- keeping them is what makes promoting someone to admin restore Arak on its
-- own, with no migration. Deleting them would trade a harmless roster row for
-- a silent trap the next time someone is promoted and sees nothing.
