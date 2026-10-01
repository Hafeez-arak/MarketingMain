-- ─── A company goes to nobody until someone is chosen ─────────────────────
--
-- Creating a company handed it to every approved person: the roster trigger
-- from 20260816_access_control back-filled the whole team into each new
-- workspace, on the reasoning that "all workspaces have the same people". That
-- stopped being the model on 2026-09-15 (20260916_assign_workspaces_per_user:
-- the admin picks companies per person), but the three automatic routes in
-- were left running, so a client company created on 2026-10-01 appeared in
-- four switchers before anyone had decided who should see it.
--
-- From here on membership is only ever written by a decision:
--
--   new company        → the administrators, the person who created it, and
--                        whoever the admin ticked on the create form
--   approving a person → lets them sign in; they hold no company until one is
--                        ticked for them
--   adding by email    → the companies ticked on that form, and no others
--
-- Existing memberships are NOT touched. Everyone keeps exactly the companies
-- they hold today; this only changes what happens next.

-- ── 1. A new company: admins and its creator ──────────────────────────────
-- The creator is included because the app switches straight into the company
-- it just made — without a row, a member who creates one would be dropped
-- into a workspace RLS then hides from them. auth.uid() is null when a
-- workspace is inserted from the SQL editor or by the service role, and then
-- only the administrators are added.
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
    and (ua.role = 'admin' or ua.user_id = auth.uid())
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$$;

-- ── 2. Create a company, optionally naming who gets it ────────────────────
-- member_ids defaults to null so a caller sending only company_name (every
-- browser still on the previous build) keeps working. The one-argument
-- function has to go first: left in place, a call with just company_name
-- would match both signatures and PostgREST would refuse to choose.
drop function if exists public.create_company(text);

create or replace function public.create_company(company_name text, member_ids uuid[] default null)
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

  -- Deciding who sees a company is the admin's privilege everywhere else
  -- (set_user_workspaces), so it is here too. A member can still create a
  -- company; it reaches them and the administrators and nobody else.
  if coalesce(cardinality(member_ids), 0) > 0 and not public.is_access_admin() then
    raise exception 'Only the access admin can choose who gets a company';
  end if;

  insert into public.workspaces (name)
    values (coalesce(nullif(trim(company_name), ''), 'My Company'))
    returning id into new_id;

  -- Approved people only: membership IS the permission, so a row for someone
  -- pending or revoked would be a way in that skipped the approval.
  insert into public.workspace_members (workspace_id, user_id, role)
  select new_id, ua.user_id, 'owner'
  from public.user_access ua
  where ua.user_id = any (coalesce(member_ids, '{}'::uuid[]))
    and ua.status = 'approved'
  on conflict (workspace_id, user_id) do nothing;

  return new_id;
end;
$$;

grant execute on function public.create_company(text, uuid[]) to authenticated;

-- ── 3. Approval lets someone in, and nothing more ─────────────────────────
-- Used to join the person to every company not marked admin_only. Still no
-- authorization check of its own — every caller does that first, and the
-- grants stay revoked (see 20260817_access_invites).
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
end;
$$;

revoke all on function public.grant_access_to_user(uuid, uuid) from public;
revoke all on function public.grant_access_to_user(uuid, uuid) from anon, authenticated;

-- ── 4. Adding someone by email carries the companies chosen for them ──────
-- An invite is for a person with no account yet, so there is no user to
-- write membership rows for. The choice is kept on the invite and applied by
-- the signup trigger. Without this an invited person would arrive approved
-- and empty, and the admin would have to notice they had signed up.
alter table public.access_invites
  add column if not exists workspace_ids uuid[] not null default '{}';

drop function if exists public.invite_access(text);

create or replace function public.invite_access(target_email text, ws_ids uuid[] default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  norm    text := lower(trim(coalesce(target_email, '')));
  found   uuid;
  current_status text;
  wanted  uuid[];
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can add people';
  end if;

  if norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address';
  end if;

  -- Only companies that exist. An id for one deleted since the form loaded
  -- is dropped here rather than stored on an invite to fail at signup.
  select coalesce(array_agg(w.id), '{}'::uuid[]) into wanted
    from public.workspaces w
   where w.id = any (coalesce(ws_ids, '{}'::uuid[]));

  select u.id into found from auth.users u where lower(u.email) = norm;

  -- No account yet: pre-clear the address. Adding the same address again
  -- replaces the companies, so the last choice made is the one that applies.
  if found is null then
    insert into public.access_invites (email, invited_by, workspace_ids)
    values (norm, auth.uid(), wanted)
    on conflict (email) do update set workspace_ids = excluded.workspace_ids;
    return 'invited';
  end if;

  select ua.status into current_status from public.user_access ua where ua.user_id = found;

  -- Already in: their companies are edited on their own row, not from here,
  -- so a stray re-add can never quietly widen what someone sees.
  if current_status = 'approved' then
    return 'already';
  end if;

  perform public.grant_access_to_user(found, auth.uid());

  insert into public.workspace_members (workspace_id, user_id, role)
  select w, found, 'owner' from unnest(wanted) as w
  on conflict (workspace_id, user_id) do nothing;

  return 'approved';
end;
$$;

grant execute on function public.invite_access(text, uuid[]) to authenticated;

-- ── 5. Signup honours the invite's companies ──────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_to  uuid[];
  pre_cleared boolean;
begin
  select i.workspace_ids into invited_to
    from public.access_invites i where i.email = lower(new.email);
  -- Copied out at once: FOUND is overwritten by the insert just below.
  pre_cleared := found;

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
    -- Joined to workspaces so a company deleted since the invite was made is
    -- skipped instead of failing the signup on its foreign key.
    insert into public.workspace_members (workspace_id, user_id, role)
    select w.id, new.id, 'owner'
      from public.workspaces w
     where w.id = any (coalesce(invited_to, '{}'::uuid[]))
    on conflict (workspace_id, user_id) do nothing;

    -- Consumed. Leaving it would silently re-approve them after a revoke.
    delete from public.access_invites where email = lower(new.email);
  end if;

  return new;
end;
$$;

-- ── 6. admin_only has nothing left to mean ────────────────────────────────
-- It marked the one company that was never handed out automatically. No
-- company is handed out automatically now, so no function reads it. The
-- column stays (Arak's row still carries true) so nothing selecting it
-- breaks; it is simply no longer a rule.
comment on column public.workspaces.admin_only is
  'Retired 2026-10-01. Used to mark a company that was never handed out automatically; since 20261004_companies_by_assignment no company is, so nothing reads this.';
