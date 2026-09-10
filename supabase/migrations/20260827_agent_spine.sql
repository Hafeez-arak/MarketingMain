-- ════════════════════════════════════════════════════════════════════════
-- Agent spine — the usage ledger and the spend cap
-- ════════════════════════════════════════════════════════════════════════
-- See AGENT.md §7. The agent stops being one page's feature here and becomes
-- something reachable from anywhere, which changes what has to be measured:
-- a weekly run is one bill you could eyeball, a chat box on every screen is
-- not.
--
-- What this migration deliberately does NOT do:
--
--  • It does not add chat tables. research_chats / research_messages already
--    exist (20260824) and are the right shape. They keep their names even
--    though the agent is no longer research-only — the same call this repo
--    made for zernio_post_id when Meta took over publishing. A rename is
--    churn with a migration attached, and the comment below carries the
--    meaning instead.
--
--  • It does not add a steering table. research_agenda is already the
--    steering wheel: it holds standing questions AND the competitor
--    watchlist, both editable by a human, with created_by telling you who
--    asked for a row. Nothing new is needed for AGENT.md §5b.
--
--  • It does not touch brand_profile / brand_fields / brand_sections /
--    brand_directory_*. It never will. RESEARCH-AGENT.md §5a.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. agent_usage — every model call, one row ──────────────────────────
-- research_runs already carries tokens_in/tokens_out/cost_estimate for a
-- run. This is not a duplicate of that: a run summarises itself, while this
-- is the per-call ledger that a cap can be enforced against, and it covers
-- chat turns and draft reviews that have no run row at all.
--
-- Why rows rather than a running counter on the workspace: a counter tells
-- you that you spent $40 and nothing about where it went. When the bill
-- looks wrong the only useful question is "which calls", and that has to be
-- answerable after the fact.
create table if not exists public.agent_usage (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,

  -- What invoked this call. Not a check constraint: the set of surfaces will
  -- grow (chat, run, review, discover…) and a new one should not need a
  -- migration to be recordable.
  surface        text not null default 'chat',
  -- Free-text stage label for a run: gather|plan|search|reflect|synthesise.
  stage          text default '',
  run_id         uuid default null references public.research_runs(id) on delete set null,
  chat_id        uuid default null references public.research_chats(id) on delete set null,

  model          text not null default '',
  -- Split out because they are priced differently — a cached read is ~a tenth
  -- of a fresh input token, so collapsing them into one number would make the
  -- ledger disagree with the invoice and hide whether caching is working at
  -- all. AGENT.md §7.
  tokens_in         integer not null default 0,
  tokens_cache_read integer not null default 0,
  tokens_cache_write integer not null default 0,
  tokens_out        integer not null default 0,

  -- Computed from the price table in src/lib/agent/models.js at write time
  -- and STORED, not derived on read. Prices change (Sonnet 5 had an intro
  -- rate that expired 2026-08-31); a historical row must keep the cost it
  -- actually incurred, not what the same tokens would cost today.
  cost_usd       numeric not null default 0,

  -- Set when the call failed, so a run that burned tokens and produced
  -- nothing is still visible in the ledger rather than silently free.
  error          text default '',
  created_at     timestamptz not null default now()
);

comment on table public.agent_usage is
  'One row per model call made by the agent, any surface. The authority for spend and for the monthly cap; research_runs keeps its own summary columns.';

-- The cap query is always "this workspace, this calendar month", and the
-- ledger only grows, so this index is the one that matters.
create index if not exists agent_usage_ws_created_idx
  on public.agent_usage(workspace_id, created_at desc);
create index if not exists agent_usage_run_idx
  on public.agent_usage(run_id) where run_id is not null;


-- ── 2. workspaces.agent_monthly_cap_usd ─────────────────────────────────
-- Null means no cap — which is the resting state for a workspace nobody has
-- thought about, and is deliberately NOT zero. A default of 0 would read as
-- "no budget" and refuse every call the moment this migration landed, which
-- is the kind of helpful safety rail that takes a product down.
alter table public.workspaces
  add column if not exists agent_monthly_cap_usd numeric default null;

comment on column public.workspaces.agent_monthly_cap_usd is
  'Monthly agent spend ceiling in USD for this workspace. Null = uncapped. Enforced in src/lib/agent/budget.js against agent_usage, not by the database.';


-- ── 3. RLS ──────────────────────────────────────────────────────────────
-- Same shape as every other workspace-scoped table here. Note what this is
-- and is not: RLS is the backstop, not the isolation mechanism — every agent
-- tool passes workspace_id explicitly, taken from the session and never from
-- anything the model produced. AGENT.md §2.
alter table public.agent_usage enable row level security;

drop policy if exists agent_usage_rw on public.agent_usage;
create policy agent_usage_rw on public.agent_usage
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));


-- ── 4. Renaming nothing, meaning something ──────────────────────────────
-- The chat tables serve the whole agent now, not only research. Recorded as
-- a comment so the next person reading the schema is not misled by a name
-- that is now narrower than the thing.
comment on table public.research_chats is
  'A conversation with the agent — any surface, any subject, not only research. Named research_* for history; see AGENT.md §1.';
comment on table public.research_messages is
  'Turns within an agent conversation. tool_calls and sources are kept so an answer can be audited after the fact.';
