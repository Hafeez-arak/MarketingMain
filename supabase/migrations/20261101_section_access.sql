-- ─── v2: who may open which section ────────────────────────────────────────
-- 2026-10-19. v2 splits the app into sections (src/lib/modules.js): CEO,
-- Sales, Marketing, Insights, Admin. The CEO's requirement 18 and the
-- owner's plan (docs/COMPANY-HUB-PLAN.md, step 2): each person gets only the
-- sections they need, at a level:
--
--   view    read it
--   work    use it day to day (assign, mark, post…)
--   manage  change how it works (targets, routing, agent settings)
--
-- The access admin (user_access.role = 'admin') has every section at manage
-- without rows here. The Admin section itself (who may sign in, which
-- companies, these grants) is the access admin's alone and is never granted.
--
-- What the database enforces after this file:
--   · Sales data (leads, lead cards, target accounts, the ICP) and CEO data
--     (briefs, targets, routing rules) are readable by anyone granted that
--     section in that company, through NEW policies. Every existing policy
--     stays, so nobody loses access they had.
--   · Marketing and Insights data stay readable by every member of the
--     company, as in v1: restricting them means rewriting the policies on
--     ~40 tables, a later step. The app hides those sections from people
--     without them; the database does not yet refuse them.
--
-- v2 ONLY. Applied to the local v2 database (dev/v2db), never to production
-- until v2 ships. Safe to re-run.

create table if not exists public.section_access (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  section      text not null check (section in ('ceo', 'sales', 'marketing', 'insights')),
  level        text not null check (level in ('view', 'work', 'manage')),
  granted_by   uuid references auth.users(id) on delete set null,
  granted_at   timestamptz not null default now(),
  primary key (workspace_id, user_id, section)
);

create index if not exists section_access_user_idx on public.section_access (user_id, workspace_id);

alter table public.section_access enable row level security;

-- Each person reads their own grants (the app needs them to draw the rail);
-- the access admin reads and changes everyone's.
drop policy if exists section_access_read on public.section_access;
create policy section_access_read on public.section_access
  for select to authenticated
  using (user_id = auth.uid() or public.is_access_admin());

drop policy if exists section_access_admin_write on public.section_access;
create policy section_access_admin_write on public.section_access
  for all to authenticated
  using (public.is_access_admin())
  with check (public.is_access_admin());

-- view < work < manage
create or replace function public.section_rank(l text)
returns integer
language sql
immutable
as $$
  select case l when 'view' then 1 when 'work' then 2 when 'manage' then 3 else 0 end;
$$;

/*
 * May the caller use this section of this company at this level (or more)?
 * A member of the company, and either the access admin or granted it.
 */
create or replace function public.has_section(ws uuid, sec text, min_level text default 'view')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_workspace_member(ws) and (
    public.is_access_admin()
    or exists (
      select 1 from public.section_access a
       where a.workspace_id = ws
         and a.user_id = auth.uid()
         and a.section = sec
         and public.section_rank(a.level) >= public.section_rank(min_level)
    )
  );
$$;

grant execute on function public.section_rank(text) to authenticated;
grant execute on function public.has_section(uuid, text, text) to authenticated;

-- ── Day one: everyone keeps what v1 gave them ──
-- v1's marketing members used Marketing and Insights; admins need no rows.
-- (Sales staff are not company members; they keep their own Sales app.)
insert into public.section_access (workspace_id, user_id, section, level)
select m.workspace_id, m.user_id, s.section, 'work'
  from public.workspace_members m
  join public.user_access ua on ua.user_id = m.user_id
 cross join (values ('marketing'), ('insights')) as s(section)
 where ua.status = 'approved' and ua.role = 'member'
on conflict do nothing;

-- ── Sales and CEO data: readable by those granted the section ──
-- New, permissive policies beside the existing admin / sales-seat ones.
drop policy if exists leads_section_read on public.leads;
create policy leads_section_read on public.leads
  for select to authenticated
  using (public.has_section(workspace_id, 'sales', 'view'));

drop policy if exists lead_cards_section_read on public.lead_cards;
create policy lead_cards_section_read on public.lead_cards
  for select to authenticated
  using (public.has_section(workspace_id, 'sales', 'view'));

drop policy if exists sales_accounts_section_read on public.sales_accounts;
create policy sales_accounts_section_read on public.sales_accounts
  for select to authenticated
  using (public.has_section(workspace_id, 'sales', 'view'));

drop policy if exists sales_icp_section_read on public.sales_icp;
create policy sales_icp_section_read on public.sales_icp
  for select to authenticated
  using (public.has_section(workspace_id, 'sales', 'view'));

drop policy if exists ceo_briefs_section_read on public.ceo_briefs;
create policy ceo_briefs_section_read on public.ceo_briefs
  for select to authenticated
  using (public.has_section(workspace_id, 'ceo', 'view'));

drop policy if exists company_targets_section_read on public.company_targets;
create policy company_targets_section_read on public.company_targets
  for select to authenticated
  using (public.has_section(workspace_id, 'ceo', 'view'));

drop policy if exists lead_routing_rules_section_read on public.lead_routing_rules;
create policy lead_routing_rules_section_read on public.lead_routing_rules
  for select to authenticated
  using (public.has_section(workspace_id, 'ceo', 'view'));
