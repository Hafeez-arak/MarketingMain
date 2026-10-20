-- ─── Prospects: companies we could contract with, found on request ─────────
-- 2026-10-20. Ghusn asked for "a tool for finding associations or corporates
-- that will benefit from our services, people we can contract with". The
-- weekly research finds projects in the news; most of Ghusn's B2B buyers are
-- not in the news at all. A mall, a hotel or a restaurant chain needs its
-- grounds looked after every year whether it is building anything or not.
-- Those are found by building a list per segment, so this is a search a
-- person starts ("hotels in Riyadh"), not a weekly lens.
--
-- Two tables:
--
--   research_prospect_searches   one row per search: what was asked, how it
--                                ended, what it cost. A row left 'running'
--                                means the function died; the page says so.
--   research_prospects           one row per company. (workspace_id, name_key)
--                                is unique, so a company found twice is one
--                                row, and a rejected one is never proposed
--                                again: the search checks every status.
--
-- Written by the agent (service role). Members read both, and may change a
-- prospect's status (added to outreach, contacted, rejected). Nobody deletes:
-- a rejected row is what stops the company coming back next time.
--
-- Contacts are PUBLIC ones only (website, general or procurement email, main
-- phone, company page) and every one carries the page it was read from.

create table if not exists public.research_prospect_searches (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  segment       text not null check (length(btrim(segment)) > 0),
  area          text not null default '',
  status        text not null default 'running' check (status in ('running', 'complete', 'failed')),
  found         int not null default 0,
  added         int not null default 0,
  cost_usd      numeric not null default 0,
  error         text not null default '',
  created_by    uuid references auth.users(id) on delete set null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists research_prospect_searches_ws_idx
  on public.research_prospect_searches (workspace_id, started_at desc);

create table if not exists public.research_prospects (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  search_id       uuid references public.research_prospect_searches(id) on delete set null,
  name            text not null check (length(btrim(name)) > 0),
  -- Lower-cased, punctuation and company suffixes removed
  -- (src/lib/agent/prospects.js nameKey). What "the same company" means.
  name_key        text not null,
  segment         text not null default '',
  website         text not null default '',
  domain          text not null default '',
  city            text not null default '',
  -- What they run that needs us: "14 drive-through branches in Riyadh".
  sites           text not null default '',
  fit             text not null default '',
  -- One of the ICP's offers (sales_icp.config.offers[].key), or ''.
  offer           text not null default '',
  pitch           text not null default '',
  proof           text not null default '',
  ask_for         text not null default '',
  email           text not null default '',
  phone           text not null default '',
  linkedin        text not null default '',
  contact_source  text not null default '',
  source_url      text not null default '',
  confidence      numeric,
  status          text not null default 'new' check (status in ('new', 'added', 'contacted', 'rejected')),
  contact_id      uuid references public.email_contacts(id) on delete set null,
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, name_key)
);

create index if not exists research_prospects_ws_idx
  on public.research_prospects (workspace_id, created_at desc);

alter table public.research_prospect_searches enable row level security;
alter table public.research_prospects enable row level security;

drop policy if exists research_prospect_searches_member_read on public.research_prospect_searches;
create policy research_prospect_searches_member_read on public.research_prospect_searches
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists research_prospects_member_read on public.research_prospects;
create policy research_prospects_member_read on public.research_prospects
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists research_prospects_member_update on public.research_prospects;
create policy research_prospects_member_update on public.research_prospects
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
