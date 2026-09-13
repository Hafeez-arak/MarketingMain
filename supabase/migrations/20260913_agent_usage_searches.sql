-- ─── agent_usage.searches — what the run actually looked up ────────────────
-- `research_runs.searches` has existed since that table did and nothing ever
-- wrote it, so every completed run reports 0 searches beside a real bill. The
-- number is available: the provider returns it on every response as
-- `usage.server_tool_use.web_search_requests`. There was simply nowhere to
-- keep it.
--
-- WHY HERE AND NOT ON research_runs DIRECTLY:
--
-- A run is five or six separate HTTP invocations — one per lens, then
-- synthesis — and they share nothing but a run id. A counter on the run row
-- would need six concurrent read-modify-writes against one integer, which is
-- the same lost-update problem that put lens RESULTS in their own table rather
-- than in a jsonb column. agent_usage already has one row per model call with
-- the run id on it, so the count lands beside the tokens it was spent with and
-- the roll-up is a sum.
--
-- Searches are the second real cost of a run and the only one not yet visible.
-- Each lens declares a budget (openings 8, demand 6, category 6, rivals 5,
-- craft 3) and nothing has ever confirmed what was actually used against it —
-- so a lens quietly burning its whole allowance to answer nothing, which is
-- exactly what `openings` did on 2026-09-12, looked identical on the ledger to
-- one that found its answer in two.
--
-- Additive, defaulted, and read by nothing that does not know about it. Rows
-- written before this migration keep 0, which is honest for them: nobody was
-- counting.

alter table public.agent_usage
  add column if not exists searches integer not null default 0;

comment on column public.agent_usage.searches is
  'Server-side web searches this call made, from usage.server_tool_use.web_search_requests. Summed onto research_runs.searches.';

-- Verify:
--   select stage, model, searches, tokens_out
--     from public.agent_usage
--    where run_id = '...' order by created_at;
