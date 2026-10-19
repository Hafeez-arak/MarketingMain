-- ─── The source sweep: every source on "Where to look", checked every run ──
-- 2026-10-19. The tier on a source ("every run / most runs / when there is
-- room") was only a sentence in the lens prompt. The model chose what to
-- search, nothing recorded what it chose, and the 19 Oct run cited none of
-- the eight "every run" sources Etimad, Saudi Exchange, @addadruh and the
-- rest were set to. Nobody could tell whether they had been searched and
-- found empty, or skipped.
--
-- Now the code searches every active source itself before the two project
-- lenses start (api/agent/_sweep.js), hands them the results, and writes one
-- row here per source per run. The tier decides how DEEP a source is read,
-- no longer whether it is read at all.
--
--   status        claimed while a lens is checking it; done or failed after.
--                 Openings and targets run in parallel and split the work by
--                 claiming rows: (run_id, source_id) is unique, so only one
--                 of them checks each source.
--   results       what came back: [{title, url, snippet}], already cut to
--                 the source's own site where it has one.
--   findings      how many of this run's project findings cited the source.
--                 Null until synthesis has counted; 0 means counted, none.
--
-- Written by the agent (service role) only. Members and sales seats read it,
-- for the "checked 19 Oct · 6 results · led to a project 12 Oct" line.

create table if not exists public.research_source_checks (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  run_id        uuid not null references public.research_runs(id) on delete cascade,
  source_id     uuid not null references public.research_agenda(id) on delete cascade,
  status        text not null default 'claimed' check (status in ('claimed', 'done', 'failed')),
  queries       text[] not null default '{}',
  results       jsonb not null default '[]'::jsonb,
  result_count  int not null default 0,
  provider      text not null default '',
  error         text not null default '',
  findings      int,
  checked_at    timestamptz not null default now(),
  unique (run_id, source_id)
);

create index if not exists research_source_checks_ws_idx
  on public.research_source_checks (workspace_id, source_id, checked_at desc);

alter table public.research_source_checks enable row level security;

drop policy if exists research_source_checks_member_read on public.research_source_checks;
create policy research_source_checks_member_read on public.research_source_checks
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists research_source_checks_sales_read on public.research_source_checks;
create policy research_source_checks_sales_read on public.research_source_checks
  for select to authenticated using (public.is_sales_member(workspace_id));
