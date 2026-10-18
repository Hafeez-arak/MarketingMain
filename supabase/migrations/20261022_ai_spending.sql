-- ─── AI spending: an admin-only limit, and warnings before it bites ───────
-- 2026-10-18, PR 3 of docs/CEO-ASSISTANT-PLAN.md. Applied by hand. Safe to
-- re-run.
--
-- The monthly limit (workspaces.agent_monthly_cap_usd) could only be changed
-- in the database. Checking who COULD change it found two holes, closed here:
--
--   • workspaces_update_member lets ANY member update their company's row,
--     every column. The Settings page only renames, but PostgREST accepts
--     any column, so any member could raise the AI limit, flip admin_only or
--     repoint zernio_profile_id.
--   • agent_usage_rw is ALL for members, so a member could delete the
--     month's usage rows and reset the meter. Only the server (service key)
--     ever writes usage; the browser only reads it.

-- ── 1. Members may rename; only admins touch the guarded columns ────────
create or replace function public.workspaces_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null for the service key (the server), which may change
  -- anything. A signed-in non-admin may not change these three.
  if auth.uid() is not null and not public.is_access_admin() and (
       new.agent_monthly_cap_usd is distinct from old.agent_monthly_cap_usd
    or new.admin_only            is distinct from old.admin_only
    or new.zernio_profile_id     is distinct from old.zernio_profile_id
  ) then
    raise exception 'Only an administrator can change the AI limit or the company''s access settings.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_guard on public.workspaces;
create trigger workspaces_guard
  before update on public.workspaces
  for each row execute function public.workspaces_guard();

-- ── 2. Usage is read-only from the browser ──────────────────────────────
-- Created before the old policy is dropped, so there is no moment without a
-- read policy.
drop policy if exists agent_usage_read on public.agent_usage;
create policy agent_usage_read on public.agent_usage
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
drop policy if exists agent_usage_rw on public.agent_usage;

-- ── 3. Changing the limit, with a record ────────────────────────────────
create table if not exists public.agent_cap_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  changed_by   uuid references auth.users(id) on delete set null,
  old_cap      numeric,
  new_cap      numeric,
  created_at   timestamptz not null default now()
);

alter table public.agent_cap_log enable row level security;
drop policy if exists agent_cap_log_read on public.agent_cap_log;
create policy agent_cap_log_read on public.agent_cap_log
  for select to authenticated
  using (public.is_access_admin() and public.is_workspace_member(workspace_id));

create or replace function public.set_agent_cap(ws uuid, cap numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  before numeric;
  who text;
begin
  if not (public.is_access_admin() and public.is_workspace_member(ws)) then
    raise exception 'Only an administrator of this company can change its AI limit.' using errcode = '42501';
  end if;
  -- No "uncapped" from the UI: a missing limit is how a runaway loop spends
  -- a month's budget in an afternoon. Set it high instead.
  if cap is null or cap < 1 or cap > 5000 then
    raise exception 'The monthly limit must be between $1 and $5,000.' using errcode = '22023';
  end if;
  select agent_monthly_cap_usd into before from public.workspaces where id = ws;
  update public.workspaces set agent_monthly_cap_usd = round(cap, 2) where id = ws;
  insert into public.agent_cap_log (workspace_id, changed_by, old_cap, new_cap) values (ws, auth.uid(), before, round(cap, 2));

  -- The other admins hear about it: a limit change is spending.
  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) into who from public.user_access where user_id = auth.uid();
  insert into public.notifications (user_id, workspace_id, kind, title, body, link)
    select ua.user_id, ws, 'ai_limit',
           coalesce(who, 'Someone') || ' changed the monthly AI limit to $' || round(cap, 2),
           'It was ' || coalesce('$' || before::text, 'not set') || '.', '/settings'
      from public.user_access ua
      join public.workspace_members m on m.user_id = ua.user_id and m.workspace_id = ws
     where ua.role = 'admin' and ua.status = 'approved' and ua.user_id <> auth.uid();
  return round(cap, 2);
end;
$$;

grant execute on function public.set_agent_cap(uuid, numeric) to authenticated;

-- ── 4. Warn at 80% and at 100%, once each per month ─────────────────────
-- On every usage row the server writes. One SUM over this month's rows for
-- one company: a few hundred rows at most.
create or replace function public.agent_usage_warn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap numeric;
  month_start timestamptz := date_trunc('month', now());
  after_sum numeric;
  before_sum numeric;
  name text;
  level int;
begin
  select agent_monthly_cap_usd, w.name into cap, name from public.workspaces w where w.id = new.workspace_id;
  if cap is null or cap <= 0 or coalesce(new.cost_usd, 0) <= 0 then return new; end if;
  select coalesce(sum(cost_usd), 0) into after_sum
    from public.agent_usage where workspace_id = new.workspace_id and created_at >= month_start;
  before_sum := after_sum - new.cost_usd;
  level := case
    when before_sum < cap and after_sum >= cap then 100
    when before_sum < cap * 0.8 and after_sum >= cap * 0.8 then 80
    else 0 end;
  if level = 0 then return new; end if;
  insert into public.notifications (user_id, workspace_id, kind, title, body, link)
    select ua.user_id, new.workspace_id, 'ai_limit_' || level,
           case level when 100 then name || ' has reached its monthly AI limit'
                      else name || ' has used 80% of its monthly AI limit' end,
           '$' || round(after_sum, 2) || ' of $' || cap || ' used this month.' ||
             case level when 100 then ' The assistant and research runs stop until the 1st, or until the limit is raised in Settings.'
                        else ' Raise the limit in Settings if this month needs more.' end,
           '/settings'
      from public.user_access ua
      join public.workspace_members m on m.user_id = ua.user_id and m.workspace_id = new.workspace_id
     where ua.role = 'admin' and ua.status = 'approved';
  return new;
end;
$$;

drop trigger if exists agent_usage_warn on public.agent_usage;
create trigger agent_usage_warn
  after insert on public.agent_usage
  for each row execute function public.agent_usage_warn();
