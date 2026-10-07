-- ════════════════════════════════════════════════════════════════════════
-- Sales → Targets: the ideal customer, the accounts to work, and what makes
-- a found project worth a call
-- ════════════════════════════════════════════════════════════════════════
-- The research run finds projects and events for everyone. Sales asked for one
-- place that lists WHO TO GO AFTER, built on what our own history says wins:
-- the Oct 2026 CRM + email analysis showed existing clients win about three
-- times as often as new ones, and that segment, buyer, package size and
-- whether the contractor already holds the job decide most of the rest.
--
-- Three pieces, all per company:
--
--   sales_icp        the ideal customer profile as data: segments split into a
--                    core track (what we usually win) and a broader track (what
--                    we want to grow into), buyers, size bands, red flags,
--                    questions to ask first, and the client problems marketing
--                    should speak to. Scoring reads it in code, so editing it
--                    re-scores every target at once without a run.
--   sales_accounts   existing customers to reactivate, upsell or extend. Loaded
--                    from the analysis, worked by people. Client names and
--                    values live ONLY here, never in the repository (it is
--                    public).
--   research_opportunities gains the fields the targets lens fills, so a found
--                    project can be scored against the ICP.
--
-- Admin only, like the Lead Agent: these rows carry client names and order
-- values.

-- ── 1. sales_icp ───────────────────────────────────────────────────────────
create table if not exists public.sales_icp (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  config       jsonb not null default '{}'::jsonb,
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

alter table public.sales_icp enable row level security;
drop policy if exists sales_icp_admin on public.sales_icp;
create policy sales_icp_admin on public.sales_icp
  for all to authenticated
  using (public.is_access_admin() and public.is_workspace_member(workspace_id))
  with check (public.is_access_admin() and public.is_workspace_member(workspace_id));

-- ── 2. sales_accounts ──────────────────────────────────────────────────────
create table if not exists public.sales_accounts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  name           text not null,
  orders         int,
  value_sar      numeric,
  first_year     int,
  last_order     date,
  -- What they have bought from us so far.
  bought         text not null default '' check (bought in ('', 'lighting', 'controls', 'both')),
  -- What to offer next. Several can apply to one customer.
  plays          text[] not null default '{}',
  open_deals     int,
  open_value_sar numeric,
  -- Why this account is on the list, in one or two plain sentences.
  why            text not null default '',
  priority       int not null default 2 check (priority between 1 and 3),
  -- Owned by people.
  status         text not null default 'new'
                 check (status in ('new', 'contacted', 'meeting', 'quoted', 'won', 'parked')),
  owner          text not null default '',
  owner_note     text not null default '',
  next_step_on   date,
  source         text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, name)
);

create index if not exists sales_accounts_ws_idx on public.sales_accounts (workspace_id, priority, value_sar desc);

alter table public.sales_accounts enable row level security;
drop policy if exists sales_accounts_admin on public.sales_accounts;
create policy sales_accounts_admin on public.sales_accounts
  for all to authenticated
  using (public.is_access_admin() and public.is_workspace_member(workspace_id))
  with check (public.is_access_admin() and public.is_workspace_member(workspace_id));

-- ── 3. What the targets lens adds to a found project ───────────────────────
-- Raw facts only. The FIT is never stored: it is computed against the current
-- ICP every time the page is opened, so a changed ICP never leaves stale
-- scores behind.
alter table public.research_opportunities
  add column if not exists segment   text not null default '',
  add column if not exists buyer     text not null default '',
  add column if not exists value_sar numeric,
  add column if not exists track     text not null default '' check (track in ('', 'core', 'broader')),
  add column if not exists why_fit   text not null default '',
  add column if not exists red_flags text not null default '',
  add column if not exists contact   text not null default '';

comment on column public.research_opportunities.buyer is
  'Who would buy from us: contractor_awarded, contractor_bidding, owner_developer, fitout, operator, consultant, other, or ''''.';
comment on column public.research_opportunities.track is
  'Which half of the targets lens found it: core (what we usually win) or broader (growth). '''' for other lenses.';
