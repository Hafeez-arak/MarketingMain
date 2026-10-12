-- ─── Battle cards for approved leads (2026-10-12) ──────────────────────────
-- The owner: every approved lead gets a battle card, worked on in this app
-- until the deal moves to the CRM, and every part of it can be edited here
-- the way it would be in the CRM.
--
-- One row per approved lead. `card` is the whole card as the team sees it:
-- built once from what we hold (src/lib/sales/leadCard.js, no model call),
-- then edited. The four things recorded after the first call are columns,
-- so the CRM and any report read them without opening the card.
--
-- Written only through /api/leads (card, card_save) with the service key,
-- after the caller is checked there. Read policies mirror the leads'.

create table if not exists public.lead_cards (
  lead_id       uuid primary key references public.leads(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  card          jsonb not null default '{}'::jsonb,
  decision      text not null default '' check (decision in ('', 'quote_today', 'project_quote', 'park', 'decline')),
  quote_due     date,
  target_price  text not null default '',
  decides       text not null default '',
  built_at      timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

create index if not exists lead_cards_ws_idx on public.lead_cards (workspace_id);

alter table public.lead_cards enable row level security;

drop policy if exists lead_cards_admin_read on public.lead_cards;
create policy lead_cards_admin_read on public.lead_cards
  for select to authenticated
  using (public.is_access_admin() and public.is_workspace_member(workspace_id));

drop policy if exists lead_cards_sales_read on public.lead_cards;
create policy lead_cards_sales_read on public.lead_cards
  for select to authenticated using (public.is_sales_member(workspace_id));
