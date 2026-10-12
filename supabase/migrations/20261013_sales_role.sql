-- ─── A "sales" person: the leads page and nothing else (2026-10-11) ────────
-- The owner wants the sales team in the leads list without the agent's
-- settings or the marketing app. A third role next to admin and member:
--   admin   everything, including Team & Access and the agent settings
--   member  the marketing app (unchanged)
--   sales   only Leads, for the companies they are given
-- The app shows a sales person a leads-only screen; the database lets them
-- read leads and the list of mailboxes (for the "Came in" filter), and the
-- API lets them correct a verdict and download an email, nothing else.
-- Added the same way as anyone: Team & Access, add by email, pick the role.

alter table public.user_access drop constraint if exists user_access_role_check;
alter table public.user_access add constraint user_access_role_check check (role in ('admin', 'member', 'sales'));

-- The role an invited address gets when it signs up.
alter table public.access_invites add column if not exists role text not null default 'member';
alter table public.access_invites drop constraint if exists access_invites_role_check;
alter table public.access_invites add constraint access_invites_role_check check (role in ('member', 'sales'));

create or replace function public.is_sales_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access ua
    where ua.user_id = auth.uid() and ua.role = 'sales' and ua.status = 'approved'
  );
$$;
grant execute on function public.is_sales_access() to authenticated;

-- Read, for their own companies. Permissive policies add up, so the admin's
-- stay as they are.
create policy leads_sales_read on public.leads
  for select to authenticated
  using (public.is_sales_access() and public.is_workspace_member(workspace_id));
create policy lead_mailboxes_sales_read on public.lead_mailboxes
  for select to authenticated
  using (public.is_sales_access() and public.is_workspace_member(workspace_id));

-- Add by email, now with the role. The old two-argument form is replaced,
-- and the new one defaults to member, so the existing page keeps working.
drop function if exists public.invite_access(text, uuid[]);
create or replace function public.invite_access(target_email text, ws_ids uuid[] default null, as_role text default 'member')
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
  r       text := coalesce(nullif(as_role, ''), 'member');
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can add people';
  end if;
  if r not in ('member', 'sales') then
    raise exception 'A person can be added as member or sales';
  end if;
  if norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address';
  end if;

  select coalesce(array_agg(w.id), '{}'::uuid[]) into wanted
    from public.workspaces w
   where w.id = any (coalesce(ws_ids, '{}'::uuid[]));

  select u.id into found from auth.users u where lower(u.email) = norm;

  if found is null then
    insert into public.access_invites (email, invited_by, workspace_ids, role)
    values (norm, auth.uid(), wanted, r)
    on conflict (email) do update set workspace_ids = excluded.workspace_ids, role = excluded.role;
    return 'invited';
  end if;

  select ua.status into current_status from public.user_access ua where ua.user_id = found;
  if current_status = 'approved' then
    return 'already';
  end if;

  perform public.grant_access_to_user(found, auth.uid());
  update public.user_access set role = r where user_id = found and role <> 'admin';

  insert into public.workspace_members (workspace_id, user_id, role)
  select w, found, 'owner' from unnest(wanted) as w
  on conflict (workspace_id, user_id) do nothing;

  return 'approved';
end;
$$;
grant execute on function public.invite_access(text, uuid[], text) to authenticated;

-- Signing up with an invited address: the invite's role, not always member.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited_to  uuid[];
  invited_as  text;
  pre_cleared boolean;
begin
  select i.workspace_ids, i.role into invited_to, invited_as
    from public.access_invites i where i.email = lower(new.email);
  -- Copied out at once: FOUND is overwritten by the insert just below.
  pre_cleared := found;

  insert into public.user_access (user_id, email, full_name, status, role, decided_at)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    case when pre_cleared then 'approved' else 'pending' end,
    case when pre_cleared and invited_as = 'sales' then 'sales' else 'member' end,
    case when pre_cleared then now() else null end
  )
  on conflict (user_id) do nothing;

  if pre_cleared then
    insert into public.workspace_members (workspace_id, user_id, role)
    select w.id, new.id, 'owner'
      from public.workspaces w
     where w.id = any (coalesce(invited_to, '{}'::uuid[]))
    on conflict (workspace_id, user_id) do nothing;
    delete from public.access_invites where email = lower(new.email);
  end if;

  return new;
end;
$$;

-- Switch someone between marketing and sales from their row. Never touches
-- the admin, and never makes anyone admin.
create or replace function public.set_user_role(target_user uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can change roles';
  end if;
  if new_role not in ('member', 'sales') then
    raise exception 'A person can be member or sales';
  end if;
  update public.user_access set role = new_role where user_id = target_user and role <> 'admin';
end;
$$;
grant execute on function public.set_user_role(uuid, text) to authenticated;
