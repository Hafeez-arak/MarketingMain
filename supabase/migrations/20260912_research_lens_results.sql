-- ════════════════════════════════════════════════════════════════════════
-- Lens results — because the run no longer fits in one HTTP request
-- ════════════════════════════════════════════════════════════════════════
-- api/agent/run.js used to await the whole run in a single invocation:
-- gather, six lenses, synthesis, persist, memory. Vercel kills the function at
-- its ceiling, mid-run, writing no status and no error and leaving a spinner
-- that only the server can close.
--
-- The ceiling on this project is 300 SECONDS AND THERE IS NO SETTING TO RAISE
-- IT — Pro allows 800s, Hobby does not. A single calendar lens was measured at
-- 380s twice. So the run is now three routes (/run, /lens, /synthesise) driven
-- by n8n, and the lenses are six PARALLEL HTTP requests.
--
-- Six parallel requests cannot share a variable, which is what this table
-- replaces. One row per (run_id, lens) rather than a jsonb column on
-- research_runs: six concurrent read-modify-write updates to a single jsonb
-- value is a lost-update race, and separate rows cannot race at all.
--
-- Applied 2026-09-12.

create table if not exists public.research_lens_results (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  run_id        uuid not null references public.research_runs(id) on delete cascade,
  lens          text not null,

  -- 'ok' means it answered, even if it answered with nothing. 'failed' means
  -- it could not. A lens that found nothing and a lens that never ran must
  -- never look the same in the brief.
  status        text not null default 'ok' check (status in ('ok', 'failed')),

  findings      jsonb not null default '[]'::jsonb,
  sources       jsonb not null default '[]'::jsonb,
  note          text not null default '',
  error         text not null default '',
  cost_usd      numeric(12, 6) not null default 0,

  -- How long it actually took, so PHASE_BUDGET_MS can be tuned against
  -- measurements rather than the three data points that motivated it.
  duration_ms   int,
  timed_out     boolean not null default false,

  created_at    timestamptz not null default now()
);

-- Makes a lens retryable and idempotent. NOTE: application code must name this
-- explicitly as `?on_conflict=run_id,lens` — PostgREST resolves
-- `resolution=merge-duplicates` against the PRIMARY KEY by default, which here
-- is a generated uuid that never collides, so without it every retry appends a
-- second result for the same lens instead of replacing the first.
create unique index if not exists research_lens_results_run_lens_idx
  on public.research_lens_results (run_id, lens);

create index if not exists research_lens_results_ws_idx
  on public.research_lens_results (workspace_id, created_at desc);

alter table public.research_lens_results enable row level security;

-- Scopes by MEMBERSHIP, not by workspace: the operators belong to all three
-- workspaces, so this passes every workspace's rows at once. Application code
-- must still carry its own workspace_id filter on every query. RLS is not
-- isolation in this database.
drop policy if exists research_lens_results_member on public.research_lens_results;
create policy research_lens_results_member on public.research_lens_results
  for all to authenticated
  using (exists (select 1 from public.workspace_members m
                 where m.workspace_id = research_lens_results.workspace_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.workspace_members m
                      where m.workspace_id = research_lens_results.workspace_id and m.user_id = auth.uid()));
