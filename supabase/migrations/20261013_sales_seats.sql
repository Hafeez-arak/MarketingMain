-- ─── Sales people are not company members (2026-10-11) ────────────────────
-- 20261013_sales_role made a sales person an ordinary workspace member and
-- hid the marketing app from them in the browser. That was not enough:
-- membership is the permission everywhere else. Nine tables (agent notes,
-- competitors, deal outcomes, research…) join workspace_members directly,
-- every other one calls is_workspace_member(), and the email, agent and
-- Zernio functions treat "can read the workspaces row" as membership. A
-- sales login could have read all of it, or spent money, with its own token.
--
-- So a sales person holds no workspace_members row at all. Their companies
-- live in sales_seats, which only the leads policies and the leads function
-- read. Every existing check refuses them without being touched, and so
-- will every one written later. No sales person existed when this ran.
--
-- They also cannot create a company: has_app_access() no longer counts them,
-- so create_company() and the workspaces insert policy refuse them (the
-- roster trigger would otherwise have made them a member of their own).

create table if not exists public.sales_seats (
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, workspace_id)
);
alter table public.sales_seats enable row level security;
-- Read only: your own seats, or the admin's view of everyone's. Written by
-- the functions below and nothing else.
drop policy if exists sales_seats_read on public.sales_seats;
create policy sales_seats_read on public.sales_seats
  for select to authenticated
  using (user_id = auth.uid() or public.is_access_admin());

create or replace function public.is_sales_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_sales_access() and exists (
    select 1 from public.sales_seats s where s.user_id = auth.uid() and s.workspace_id = ws_id
  );
$$;
grant execute on function public.is_sales_member(uuid) to authenticated;

-- The companies a sales person may open, by name, for the app's switcher.
-- A function rather than a workspaces policy: a policy would make the
-- workspaces row readable, and that is exactly what the other functions
-- take as proof of membership.
create or replace function public.my_sales_companies()
returns table (id uuid, name text, slug text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, w.name, w.slug, w.created_at
    from public.sales_seats s join public.workspaces w on w.id = s.workspace_id
   where s.user_id = auth.uid() and public.is_sales_access()
   order by w.created_at;
$$;
grant execute on function public.my_sales_companies() to authenticated;

-- The leads, by seat instead of membership.
drop policy if exists leads_sales_read on public.leads;
create policy leads_sales_read on public.leads
  for select to authenticated using (public.is_sales_member(workspace_id));
drop policy if exists lead_mailboxes_sales_read on public.lead_mailboxes;
create policy lead_mailboxes_sales_read on public.lead_mailboxes
  for select to authenticated using (public.is_sales_member(workspace_id));

-- "Approved to use the app" means the marketing app; sales is not it.
create or replace function public.has_app_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access ua
    where ua.user_id = auth.uid() and ua.status = 'approved' and ua.role <> 'sales'
  );
$$;

-- Write one person's companies to the right table for their role, and
-- clear the other. Shared by every function that hands out companies.
create or replace function public.place_user_companies(target_user uuid, ws_ids uuid[], replace_all boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  is_sales boolean := exists (select 1 from public.user_access where user_id = target_user and role = 'sales');
  wanted   uuid[] := coalesce(ws_ids, '{}'::uuid[]);
begin
  if is_sales then
    delete from public.workspace_members where user_id = target_user;
    if replace_all then
      delete from public.sales_seats where user_id = target_user and not (workspace_id = any (wanted));
    end if;
    insert into public.sales_seats (user_id, workspace_id)
    select target_user, w.id from public.workspaces w where w.id = any (wanted)
    on conflict do nothing;
  else
    delete from public.sales_seats where user_id = target_user;
    if replace_all then
      delete from public.workspace_members where user_id = target_user and not (workspace_id = any (wanted));
    end if;
    insert into public.workspace_members (workspace_id, user_id, role)
    select w.id, target_user, 'owner' from public.workspaces w where w.id = any (wanted)
    on conflict (workspace_id, user_id) do nothing;
  end if;
end;
$$;
-- Internal: only the security-definer functions below call it.
revoke execute on function public.place_user_companies(uuid, uuid[], boolean) from public, anon, authenticated;

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
  if target_status <> 'approved' then
    raise exception 'Approve this person before assigning companies';
  end if;
  perform public.place_user_companies(target_user, ws_ids, true);
end;
$$;

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
  perform public.place_user_companies(found, wanted, false);

  return 'approved';
end;
$$;
grant execute on function public.invite_access(text, uuid[], text) to authenticated;

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
    perform public.place_user_companies(new.id, invited_to, false);
    delete from public.access_invites where email = lower(new.email);
  end if;

  return new;
end;
$$;

-- Switching role carries the person's companies across: a member made sales
-- keeps the same companies as seats, and the other way round.
create or replace function public.set_user_role(target_user uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  held uuid[];
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can change roles';
  end if;
  if new_role not in ('member', 'sales') then
    raise exception 'A person can be member or sales';
  end if;
  if exists (select 1 from public.user_access where user_id = target_user and role = 'admin') then
    raise exception 'The access admin''s role does not change';
  end if;
  select coalesce(array_agg(ws), '{}'::uuid[]) into held from (
    select workspace_id as ws from public.workspace_members where user_id = target_user
    union select workspace_id from public.sales_seats where user_id = target_user
  ) h;
  update public.user_access set role = new_role where user_id = target_user;
  perform public.place_user_companies(target_user, held, true);
end;
$$;
grant execute on function public.set_user_role(uuid, text) to authenticated;

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
  if target_role = 'admin' then
    raise exception 'The access admin cannot be revoked';
  end if;
  update public.user_access
     set status = 'revoked', decided_at = now(), decided_by = auth.uid()
   where user_id = target_user;
  delete from public.workspace_members where user_id = target_user;
  delete from public.sales_seats where user_id = target_user;
end;
$$;
