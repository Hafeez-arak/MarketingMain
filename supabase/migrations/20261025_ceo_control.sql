-- ─── The CEO's control panel ───────────────────────────────────────────────
-- 2026-10-18. The CEO's requirements (Campai_Requirements.xlsx): six numbers
-- coloured against targets he sets, at most three decisions with one button
-- each, every qualified lead given an owner by rules, a 4-hour first reply
-- and a 72-hour quote with the manager told when either is missed, one row
-- per salesperson, the top ten customers, and a five-line summary by email
-- every Sunday at 08:00 Riyadh.
--
-- His rule 7: Odoo is the single source of truth. Until Odoo is connected,
-- the few facts below that Odoo will own (first reply, quote sent, deal
-- value, last contact) are marked in Campai by hand, and the Odoo sync will
-- write the same columns. Nothing here is a second CRM.
--
-- NOT APPLIED. The owner asked for this to stay on its branch until the CEO
-- agrees the plan. Applied by hand when it is. Safe to re-run.

-- The staff addresses below are the public repo's stand-ins (staff.ceo@,
-- staff.salesadmin@): the repo is public. Before applying this to production
-- by hand, swap in the real ones from dev/v2db/people.local.json (git-ignored).

-- ── Targets and who is told (one row per company) ──
create table if not exists public.company_targets (
  workspace_id          uuid primary key references public.workspaces(id) on delete cascade,
  -- Money and volume. Null = no target set: the tile shows grey, not green.
  revenue_month_sar     numeric check (revenue_month_sar is null or revenue_month_sar >= 0),
  pipeline_sar          numeric check (pipeline_sar is null or pipeline_sar >= 0),
  quotes_week           integer check (quotes_week is null or quotes_week >= 0),
  win_rate_pct          numeric check (win_rate_pct is null or (win_rate_pct >= 0 and win_rate_pct <= 100)),
  -- Speed. The CEO's own numbers are the defaults.
  first_reply_hours     numeric not null default 4  check (first_reply_hours > 0),
  quote_hours           numeric not null default 72 check (quote_hours > 0),
  key_account_quiet_days integer not null default 30 check (key_account_quiet_days > 0),
  -- How far from a target is still amber, in percent.
  amber_pct             numeric not null default 10 check (amber_pct >= 0 and amber_pct <= 100),
  -- Who gets the Sunday summary and the daily alerts.
  brief_emails          text[] not null default '{}',
  alert_emails          text[] not null default '{}',
  -- Routing: off until someone fills in the rules and switches it on.
  routing_enabled       boolean not null default false,
  routing_since         timestamptz,
  routing_fallback      uuid references auth.users(id) on delete set null,
  last_alerts_at        timestamptz,
  last_summary_at       timestamptz,
  updated_by            uuid references auth.users(id) on delete set null,
  updated_at            timestamptz not null default now()
);

alter table public.company_targets enable row level security;

drop policy if exists company_targets_admin_read on public.company_targets;
create policy company_targets_admin_read on public.company_targets
  for select to authenticated
  using (public.is_access_admin() and public.is_workspace_member(workspace_id));
-- Writes go through /api/leads/targets_save (service key, admin checked).

-- Arak: the CEO and the sales admin get both emails.
insert into public.company_targets (workspace_id, brief_emails, alert_emails)
values ('00000000-0000-0000-0000-000000000001',
        array['staff.ceo@arak-sa.com', 'staff.salesadmin@arak-sa.com'],
        array['staff.ceo@arak-sa.com', 'staff.salesadmin@arak-sa.com'])
on conflict (workspace_id) do nothing;

-- ── Routing rules: which salesperson gets which qualified lead ──
-- First matching rule wins (lowest position). A blank criterion matches
-- anything. No rule matches → the fallback person → else nobody (and it
-- shows on the CEO's "Needs my decision").
create table if not exists public.lead_routing_rules (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  position      integer not null default 0,
  sender_type   text not null default '',   -- leads.sender_type, '' = any
  region        text not null default '',   -- src/lib/control/region.js, '' = any
  project_type  text not null default '',   -- leads.project_final, '' = any
  assign_to     uuid not null references auth.users(id) on delete cascade,
  note          text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists lead_routing_rules_ws_idx on public.lead_routing_rules (workspace_id, position);

alter table public.lead_routing_rules enable row level security;

drop policy if exists lead_routing_rules_admin_read on public.lead_routing_rules;
create policy lead_routing_rules_admin_read on public.lead_routing_rules
  for select to authenticated
  using (public.is_access_admin() and public.is_workspace_member(workspace_id));

-- ── The deadlines, on the lead ──
alter table public.leads
  add column if not exists routed_by_rule  uuid references public.lead_routing_rules(id) on delete set null,
  add column if not exists first_reply_at  timestamptz,
  add column if not exists quote_sent_at   timestamptz,
  add column if not exists deal_value_sar  numeric check (deal_value_sar is null or deal_value_sar >= 0),
  -- So the same lateness is not alerted every day for ever: once per kind.
  add column if not exists late_alerted    jsonb not null default '{}'::jsonb;

-- ── Key accounts: when someone last spoke to them ──
alter table public.sales_accounts
  add column if not exists last_contact_at timestamptz;

-- ── Research opportunities sent to a salesperson ──
alter table public.research_opportunities
  add column if not exists sent_to      uuid references auth.users(id) on delete set null,
  add column if not exists sent_at      timestamptz,
  add column if not exists sent_by      uuid references auth.users(id) on delete set null;

-- ── The CEO lands on his own page ──
alter table public.user_access
  add column if not exists landing text not null default ''
  check (landing in ('', 'ceo'));

update public.user_access set landing = 'ceo' where email = 'staff.ceo@arak-sa.com';
