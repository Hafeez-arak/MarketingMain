-- ════════════════════════════════════════════════════════════════════════
-- Campaign planner: generation survives the request that started it
-- ════════════════════════════════════════════════════════════════════════
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
--
-- THE BUG THIS CLOSES
--
-- The planner was synchronous: the browser POSTed to /api/n8n/campaignPlanner
-- and waited, n8n called Opus 5 (max_tokens 32000, adaptive thinking) for a
-- whole month of posts, answered with the ideas, and THE BROWSER wrote them
-- into plan_ideas. A month plan routinely takes longer than the serverless
-- function's ceiling, so the request 504'd — and because the write happened
-- on the browser side, the finished plan had nowhere to land. n8n completed,
-- answered a socket nobody was holding, and the whole month evaporated after
-- Opus had already been paid for it.
--
-- The app's error text made this worse by being wrong: it said the workflow
-- "will save its result" and told the user to wait and refresh. That is true
-- of arak-draft-copy (which writes to Supabase itself) and was never true
-- here. Refreshing recovered nothing, so the only way forward was to run it
-- again and pay twice — the exact thing the message warned against.
--
-- THE FIX
--
-- The plan row is created FIRST, in status 'generating', and its id is handed
-- to n8n. n8n answers 202 immediately (the Draft Copy pattern) and, when Opus
-- returns minutes later, writes the result onto the row below. The browser
-- polls the row instead of holding a request open.
--
-- WHY THE RAW MODEL OUTPUT, AND NOT plan_ideas ROWS
--
-- n8n deliberately does NOT write plan_ideas here. Turning model output into
-- idea rows means normalizeAiIdea() and distributeDates() — date spreading
-- around pinned posts, past-date replacement, format/aspect-ratio defaulting
-- per platform — which live in src/pages/campaigns and are unit tested there.
-- Porting them into a Code node would fork that logic into a second copy that
-- no test covers and that drifts the first time either side changes. So n8n
-- parks the parsed posts here verbatim and the browser runs the transforms it
-- already runs today, unchanged.
--
-- The result is durable either way: close the tab mid-run and the posts are
-- still sitting on the row when the plan is reopened.
-- ════════════════════════════════════════════════════════════════════════

alter table public.content_plans
  -- The parsed {campaignName, posts} Claude produced, waiting for the browser
  -- to turn it into plan_ideas. Cleared once consumed, so a non-null value
  -- always means "there is work here nobody has picked up yet".
  add column if not exists generation_result     jsonb,
  -- Why a run failed, in words a person can act on. Empty on success.
  add column if not exists generation_error      text default '',
  -- When the run was kicked off. The poller calls a 'generating' plan stale
  -- after 15 minutes and stops waiting — without this there is no way to tell
  -- "still thinking" from "n8n died and will never answer".
  add column if not exists generation_started_at timestamptz,
  -- 'new'  → this run builds the plan's first slate of ideas.
  -- 'more' → this run is a top-up; its posts append to what is already there.
  -- Stored rather than kept in browser state so a refresh mid-run still knows
  -- which of the two it is about to consume.
  add column if not exists generation_mode       text default 'new';

-- status already allows 'generating' (20260703_plan_brief_and_vision.sql
-- widened the CHECK). Nothing in the app had ever written it — the finalize
-- step that comment anticipated was built differently — so the value was
-- free to take, and no existing row can be sitting in it.

-- A plan left 'generating' by a crash before this shipped would be invisible
-- and unrecoverable in the new UI, which only ever polls rows it can date.
-- There are none today, but make that true by construction rather than by
-- inspection: anything already stuck goes back to being an ordinary draft.
update public.content_plans
   set status = 'draft'
 where status = 'generating'
   and generation_started_at is null;

-- Finding the plans a poller cares about without scanning every plan a
-- workspace has ever had. Partial: 'generating' is a transient state holding
-- a handful of rows at most, so the index stays tiny.
create index if not exists content_plans_generating_idx
  on public.content_plans(workspace_id, generation_started_at)
  where status = 'generating';

-- ════════════════════════════════════════════════════════════════════════
-- Done. content_plans += generation_result, generation_error,
--       generation_started_at, generation_mode (+ one partial index).
-- No table was created and no existing column was altered.
-- ════════════════════════════════════════════════════════════════════════
