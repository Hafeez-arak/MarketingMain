-- ─── Companies are assigned per person ────────────────────────────────────
--
-- Until now access was all-or-nothing: approving someone joined them to every
-- company that was not admin_only, and Arak Lighting (the one admin_only
-- workspace) was unreachable by anyone who was not the access admin, even if
-- they held a membership row. That made two things impossible:
--
--   1. Giving one person Arak without making them an app admin.
--   2. Giving a new person only *some* of the client companies.
--
-- Both are now the same operation: the admin picks which workspaces a person
-- is a member of. Membership was always the permission — every per-workspace
-- RLS policy gates on is_workspace_member() and nothing else — so the only
-- change needed to make it granular is to stop overriding it.
--
-- What admin_only means from here on: "do not hand this company out
-- automatically." It no longer hides the workspace from a member. So a new
-- signup still does not get Arak by default, but the admin can assign it to
-- anyone from Settings → Team & Access, and it appears in that person's
-- company switcher like any other.

-- ── 1. Membership alone decides what you can see ──────────────────────────
-- Dropping the admin_only clause here is the whole feature: every per-
-- workspace policy calls this one function, so an assigned member of Arak now
-- reads Arak's media, plans, sessions and analytics exactly as they read any
-- other company's.
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
     where wm.workspace_id = ws_id
       and wm.user_id      = auth.uid()
  );
$$;

comment on column public.workspaces.admin_only is
  'When true, this company is never handed out automatically (not on signup, not on approval, not by the new-workspace roster trigger). It is assigned by the access admin, one person at a time, and once assigned it behaves like any other company.';

-- ── 2. The admin can see the whole roster and every company ───────────────
-- Additive policies: permissive policies OR together, so whatever select
-- policy these tables already carry keeps working untouched. Without these
-- the assignment UI would be blind — the admin could only read memberships
-- for workspaces they happen to belong to themselves.
drop policy if exists workspace_members_select_access_admin on public.workspace_members;
create policy workspace_members_select_access_admin on public.workspace_members
  for select using (public.is_access_admin());

drop policy if exists workspaces_select_access_admin on public.workspaces;
create policy workspaces_select_access_admin on public.workspaces
  for select using (public.is_access_admin());

-- ── 3. Assign ─────────────────────────────────────────────────────────────
-- Takes the complete list the admin ticked and makes the roster match it:
-- inserts what is missing, deletes what is no longer there. A whole-set call
-- rather than add/remove verbs, because the UI is a set of checkboxes and a
-- Save button — sending the end state means a dropped request can't leave a
-- half-applied assignment.
create or replace function public.set_user_workspaces(target_user uuid, ws_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_status text;
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can assign companies';
  end if;

  select status into target_status from public.user_access where user_id = target_user;

  if target_status is null then
    raise exception 'No access record found for that user';
  end if;

  -- Membership IS the permission, so handing rows to someone who is pending
  -- or revoked would let them in through the side door without ever being
  -- approved. Approve first, then assign.
  if target_status <> 'approved' then
    raise exception 'Approve this person before assigning companies';
  end if;

  delete from public.workspace_members wm
   where wm.user_id = target_user
     and not (wm.workspace_id = any (coalesce(ws_ids, '{}'::uuid[])));

  insert into public.workspace_members (workspace_id, user_id, role)
  select w.id, target_user, 'owner'
    from public.workspaces w
   where w.id = any (coalesce(ws_ids, '{}'::uuid[]))
  on conflict (workspace_id, user_id) do nothing;
end;
$$;

grant execute on function public.set_user_workspaces(uuid, uuid[]) to authenticated;

-- ── 4. Clear the memberships that were dead and are now live ──────────────
-- 20260818 deliberately kept the Arak rows non-admins already held, on the
-- grounds that the read gate denied them anyway. Step 1 just removed that
-- gate, which would turn every one of those rows into real access the moment
-- this runs — access nobody granted, appearing in someone's switcher with no
-- click behind it. So they go. Admins keep theirs (they have Arak today and
-- would only have to re-tick it), and every admin_only grant from here on is
-- an explicit tick in Settings → Team & Access.
delete from public.workspace_members wm
using public.workspaces w
where w.id = wm.workspace_id
  and w.admin_only
  and not exists (
    select 1 from public.user_access ua
    where ua.user_id = wm.user_id
      and ua.role    = 'admin'
      and ua.status  = 'approved'
  );
