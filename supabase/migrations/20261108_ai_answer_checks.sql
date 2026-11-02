-- ─── Is the company named when a buyer asks an AI assistant? ───────────────
-- 2026-11-01. One row per question per check. A check is every row sharing a
-- run_id: the Website tab's "Named in AI answers" button asks the brand's
-- questions (Brand Brain `ai_questions`) through a model with web search and
-- writes what came back, so the next check has something to be compared with.
--
-- Written only by server/agentHandlers/aiAnswers.js with the service key;
-- members read. `named`/`cited`/`rank`/`competitors` are scored in code
-- (src/lib/agent/aiAnswers.js), never by a model. `answer` is kept so a
-- surprising score can be read rather than trusted.
--
-- Applied by hand. Safe to re-run.

create table if not exists public.ai_answer_checks (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  run_id        uuid not null,
  checked_at    timestamptz not null default now(),
  engine        text not null default 'claude',
  model         text not null default '',
  question      text not null,
  answer        text not null default '',
  named         boolean not null default false,
  -- Our place among the tracked company names, by first mention. Null when
  -- not named.
  rank          integer,
  cited         boolean not null default false,
  competitors   text[] not null default '{}',
  sources       jsonb not null default '[]'::jsonb,
  cost_usd      numeric(10, 4) not null default 0,
  -- Non-empty when the question was not answered (cap, overload, timeout).
  -- Such rows are kept out of every share.
  error         text not null default ''
);

create index if not exists ai_answer_checks_latest_idx
  on public.ai_answer_checks (workspace_id, checked_at desc);

alter table public.ai_answer_checks enable row level security;

drop policy if exists ai_answer_checks_member_read on public.ai_answer_checks;
create policy ai_answer_checks_member_read on public.ai_answer_checks
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
