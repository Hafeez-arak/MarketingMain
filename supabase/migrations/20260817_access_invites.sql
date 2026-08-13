-- Let the admin add someone by email, before that person has an account.
--
-- The gate as shipped only reacts: someone signs up, the admin approves. But
-- the normal way a team grows is the other direction — a person is hired, and
-- access is arranged before they ever open the app. Without this the admin
-- has to tell them "sign up, then wait while I notice", which is two steps of
-- confusion for something that should be settled in advance.
--
-- An invite is genuinely a different thing from an access row: it is keyed by
-- an email that may not correspond to any auth.users row yet, so it cannot
-- live in user_access (keyed by user_id). Hence a second, deliberately tiny
-- table rather than making user_access.user_id nullable and weakening the
-- key that everything else joins on.
--
-- There is no email being sent here — the app has no mail infrastructure.
-- Adding someone pre-clears them; telling them to go sign up is still a
-- human conversation. The UI says so plainly.

create table if not exists public.access_invites (
  email      text primary key,
  invited_at timestamptz not null default now(),
  invited_by uuid references auth.users(id) on delete set null
);

alter table public.access_invites enable row level security;

-- Only the admin can see the invite list. No write policies: the two
-- functions below are the only way in or out.
drop policy if exists access_invites_admin_read on public.access_invites;
create policy access_invites_admin_read on public.access_invites
  for select using (public.is_access_admin());

-- ── Shared grant path ───────────────────────────────────────────────────────
-- Factored out so approve_access() and the invite path can't drift into
-- granting subtly different things.
--
-- This helper performs NO authorization check of its own — every caller must
-- do it first. That makes it dangerous to expose, and PostgREST turns every
-- function in the public schema into a callable endpoint, with EXECUTE
-- granted to PUBLIC by default. So the grants are revoked immediately below;
-- without that, any signed-in user could approve themselves by calling it.
create or replace function public.grant_access_to_user(target_user uuid, actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Upsert rather than update: covers the case where an auth.users row exists
  -- with no access row yet, which would otherwise leave someone holding
  -- workspace memberships while the app still reads them as pending.
  -- `role` is deliberately not in the update list — approving must never
  -- change who the admin is.
  insert into public.user_access (user_id, email, status, role, decided_at, decided_by)
  select target_user, u.email, 'approved', 'member', now(), actor
  from auth.users u where u.id = target_user
  on conflict (user_id) do update
    set status = 'approved', decided_at = now(), decided_by = excluded.decided_by;

  insert into public.workspace_members (workspace_id, user_id, role)
  select w.id, target_user, 'owner'
  from public.workspaces w
  on conflict (workspace_id, user_id) do nothing;
end;
$$;

revoke all on function public.grant_access_to_user(uuid, uuid) from public;
revoke all on function public.grant_access_to_user(uuid, uuid) from anon, authenticated;

-- ── Add someone by email ────────────────────────────────────────────────────
-- Returns what actually happened so the UI can say something true rather
-- than a generic "done": the same click means three different things
-- depending on whether that person has an account yet.
create or replace function public.invite_access(target_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  norm    text := lower(trim(coalesce(target_email, '')));
  found   uuid;
  current_status text;
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can add people';
  end if;

  if norm !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address';
  end if;

  select u.id into found from auth.users u where lower(u.email) = norm;

  -- No account yet: pre-clear the address. handle_new_user() picks it up the
  -- moment they sign up, and they land straight in with no second step.
  if found is null then
    insert into public.access_invites (email, invited_by)
    values (norm, auth.uid())
    on conflict (email) do nothing;
    return 'invited';
  end if;

  select ua.status into current_status from public.user_access ua where ua.user_id = found;

  if current_status = 'approved' then
    return 'already';
  end if;

  -- Covers both a pending request and a previously revoked person: the admin
  -- typing their address is an explicit decision to let them in.
  perform public.grant_access_to_user(found, auth.uid());
  return 'approved';
end;
$$;

create or replace function public.cancel_invite(target_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_access_admin() then
    raise exception 'Only the access admin can remove invites';
  end if;
  delete from public.access_invites where email = lower(trim(coalesce(target_email, '')));
end;
$$;

grant execute on function public.invite_access(text) to authenticated;
grant execute on function public.cancel_invite(text) to authenticated;

-- ── approve_access now shares the grant path ────────────────────────────────
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

  if not exists (select 1 from public.user_access where user_id = target_user) then
    raise exception 'No access request found for that user';
  end if;

  perform public.grant_access_to_user(target_user, auth.uid());
end;
$$;

-- ── Signup honours a pending invite ─────────────────────────────────────────
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
    on conflict (workspace_id, user_id) do nothing;

    -- Consumed. Leaving it would silently re-approve them after a revoke.
    delete from public.access_invites where email = lower(new.email);
  end if;

  return new;
end;
$$;
