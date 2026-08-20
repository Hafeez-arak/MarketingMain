-- ════════════════════════════════════════════════════════════════════════
-- Research Agent — the agenda, the ledger, the snapshots, the chat
-- ════════════════════════════════════════════════════════════════════════
-- Six tables behind Insights → Research. See RESEARCH-AGENT.md for why the
-- memory is split three ways instead of being one blob.
--
-- THE BOUNDARY THIS MIGRATION EXISTS TO KEEP (RESEARCH-AGENT.md §5a):
-- the agent never edits Brand Brain CONTENT. Nothing here writes to
-- brand_profile, brand_fields, brand_sections or brand_directory_*. The
-- agent's only Brand Brain surface is brand_memory — the learned rule book —
-- which already exists and already requires a human to move a row from
-- 'proposed' to 'active'. Its own watchlist lives here instead, which is what
-- lets a verified Instagram handle (research metadata, discovered and
-- confidence-scored) stay out of a directory a human typed.
--
-- Run ONCE. Every statement is idempotent — safe to re-run, drops nothing.
--
-- APPLIED 2026-08-20 via Supabase MCP apply_migration (name: research_agent).
-- Verified after: six tables present with RLS on and one policy each, the
-- single-flight and once-per-run guarantees probed live (see below), no new
-- security advisor findings, PostgREST schema cache reloaded.
-- ════════════════════════════════════════════════════════════════════════

-- 1) ── research_runs — one run of the agent ──────────────────────────────
-- A run is minutes long, so the browser never waits on it: the webhook
-- inserts this row as 'running', responds with the id, and the page polls.
-- Which makes the terminal write non-optional — draft_status taught this
-- expensively. Every path out of the workflow, including the error branch,
-- must land on 'complete' or 'failed'. A run left 'running' is a spinner
-- nobody can close, so the page also sweeps stale rows (see stale_after).
create table if not exists public.research_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  trigger       text not null default 'manual'
                check (trigger in ('manual','scheduled','chat')),
  status        text not null default 'running'
                check (status in ('running','complete','failed')),
  stage         text default null,     -- gather|plan|search|reflect|synthesise — for the UI's progress line
  period_start  date default null,
  period_end    date default null,
  -- The whole brief, shaped by the output contract in RESEARCH-AGENT.md §8.
  -- Kept as one document rather than shredded into columns because it is
  -- read whole, rendered whole, and its shape will move for a few months.
  report        jsonb not null default '{}'::jsonb,
  error         text default '',
  model         text default '',
  tokens_in     integer default 0,
  tokens_out    integer default 0,
  searches      integer default 0,
  tool_calls    integer default 0,
  cost_estimate numeric default null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz default null
);
create index if not exists research_runs_ws_idx
  on public.research_runs(workspace_id, started_at desc);

-- Single-flight, enforced by the database rather than by a check-then-insert
-- in the app. Two tabs, a double-click, or the cron firing while someone
-- pressed the button would otherwise start two agents on the same period:
-- twice the bill, and two conflicting snapshot sets for one week. The caller
-- catches the unique violation and returns the RUNNING run's id, so a second
-- press attaches to the run already going rather than failing at the user.
create unique index if not exists research_runs_single_flight
  on public.research_runs(workspace_id) where status = 'running';

-- 2) ── research_agenda — the standing memory ─────────────────────────────
-- The "small memory fed to the agent every week". Continuity comes from
-- re-asking the SAME questions with stable ids, not from pasting last week's
-- answers into the prompt — that is what makes week N+1 comparable to week N
-- instead of merely adjacent to it.
--
-- Seeded FROM the Brand Brain and never written back to it. A competitor
-- entry here may exist that no directory row mentions, and may carry a
-- verified handle the directory has no column for. That divergence is the
-- point, not a sync bug.
create table if not exists public.research_agenda (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  kind          text not null default 'question'
                check (kind in ('question','competitor','metric')),
  subject       text not null,          -- the question, or the competitor's name
  why           text default '',        -- why we care — steers how an answer is judged
  status        text not null default 'proposed'
                check (status in ('proposed','active','retired')),
  cadence       text not null default 'weekly'
                check (cadence in ('weekly','monthly')),

  -- ── Instagram resolution (kind = 'competitor') ──────────────────────────
  -- Zero handles exist anywhere in the Brand Brain today (see §7), so these
  -- are filled by the agent's resolve step and corrected by hand on the page.
  -- ig_verified_at is the load-bearing one: a handle that was FOUND but not
  -- VERIFIED against the rival's own bio/website must never be snapshotted.
  -- "Ozee" and "Ozeyl" are two different companies in one workspace, and a
  -- confident week of numbers attached to the wrong one is exactly the kind
  -- of wrong that does not look wrong.
  ig_handle     text default '',
  ig_user_id    text default '',
  ig_confidence numeric default null,   -- 0-1, from the resolve step
  ig_verified_at timestamptz default null,
  ig_status     text not null default 'unresolved'
                check (ig_status in ('unresolved','resolved','not_found','private','human_set')),

  -- Where this came from, so a human-typed entry is never quietly overwritten
  -- by a later discovery pass. Read-only pointer into the Brand Brain: SET
  -- NULL rather than CASCADE, because a rival deleted from the directory is
  -- still one we may want to keep watching.
  source_row_id uuid default null references public.brand_directory_rows(id) on delete set null,
  created_by    text not null default 'human' check (created_by in ('human','agent')),

  last_seen_run_id uuid default null references public.research_runs(id) on delete set null,
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz default null
);
create index if not exists research_agenda_ws_idx
  on public.research_agenda(workspace_id, status);
-- One watchlist entry per competitor per workspace. Without this, every
-- discovery pass adds "Technolight" again and the board grows duplicates that
-- each carry their own half of the history.
create unique index if not exists research_agenda_competitor_uniq
  on public.research_agenda(workspace_id, lower(subject))
  where kind = 'competitor';

-- 3) ── competitor_snapshots — the numbers ────────────────────────────────
-- The table that makes deltas real. "Their posting went 3 → 7 a week" must be
-- a subtraction over two stored rows, never a model recalling something it
-- never saw. Every number here is computed in code from business_discovery
-- and handed to the model as a given fact.
--
-- Our own account gets a row too (is_self), so every comparison in the report
-- is against us rather than against an average — when we have an account
-- worth comparing to, which today we mostly do not.
create table if not exists public.competitor_snapshots (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.research_runs(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  agenda_id      uuid default null references public.research_agenda(id) on delete set null,
  competitor_name text not null,
  ig_handle      text default '',
  is_self        boolean not null default false,
  -- 'instagram' = hard numbers below are real. 'web_only' = the rival had no
  -- resolvable public account and appears in the report on web findings
  -- alone. The report must say which, on every card.
  data_source    text not null default 'web_only'
                 check (data_source in ('instagram','web_only')),

  followers      integer default null,
  follows        integer default null,
  media_count    integer default null,
  posts_in_period integer default null,
  posts_per_week numeric default null,
  format_mix     jsonb not null default '{}'::jsonb,  -- {IMAGE:.4, VIDEO:.5, CAROUSEL_ALBUM:.1}
  avg_engagement numeric default null,
  -- The only number comparable across accounts of different sizes, and
  -- therefore the only one the report should ever rank on.
  engagement_per_1k numeric default null,
  top_posts      jsonb not null default '[]'::jsonb,  -- [{permalink,likes,comments,hook,timestamp}]
  post_hours     jsonb not null default '{}'::jsonb,  -- weekday/hour histogram
  sample_size    integer default null,                -- posts the averages rest on
  captured_at    timestamptz not null default now()
);
create index if not exists competitor_snapshots_run_idx
  on public.competitor_snapshots(run_id);
-- The delta query: this competitor, this workspace, most recent first.
create index if not exists competitor_snapshots_series_idx
  on public.competitor_snapshots(workspace_id, lower(competitor_name), captured_at desc);
-- A run may not snapshot the same rival twice — a retried stage would
-- otherwise double a week and quietly halve every average.
create unique index if not exists competitor_snapshots_once_per_run
  on public.competitor_snapshots(run_id, lower(competitor_name));

-- 4) ── research_findings — what was found, with citations ────────────────
-- Atomic and cited. `sources` is URL + the quote that mattered, never the
-- page's full text: a memory that grows without bound is a context bill that
-- grows without bound, and by month three the agent is paying to re-read
-- February.
create table if not exists public.research_findings (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.research_runs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agenda_id    uuid default null references public.research_agenda(id) on delete set null,
  kind         text not null default 'trend'
               check (kind in ('competitor','trend','gap','our_performance')),
  headline     text not null,
  detail       text default '',
  sources      jsonb not null default '[]'::jsonb,   -- [{url,title,quote}]
  evidence     jsonb not null default '{}'::jsonb,   -- the numbers this rests on
  confidence   numeric default null,
  -- What turns a report into a REVIEW. 'continuing' collapses in the UI;
  -- 'changed' leads. Without this every week reads like the first week.
  novelty      text not null default 'new'
               check (novelty in ('new','continuing','changed','resolved')),
  -- Set when a finding was turned into a proposed idea, so the same gap is
  -- not offered as a fresh suggestion every week until someone acts on it.
  promoted_idea_id uuid default null,
  created_at   timestamptz not null default now()
);
create index if not exists research_findings_run_idx
  on public.research_findings(run_id);
create index if not exists research_findings_ws_idx
  on public.research_findings(workspace_id, created_at desc);

-- 5) ── research_chats / research_messages — the conversation ─────────────
-- Same agent, same tools, different entry. Persisted so a reload does not
-- lose the thread, and so "why did you say Lumina tripled Reels" can be
-- answered from the stored snapshot instead of by searching again.
create table if not exists public.research_chats (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title        text default '',
  -- The brief this conversation opened against, so a question about "this
  -- week" still resolves correctly when read back next month.
  run_id       uuid default null references public.research_runs(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists research_chats_ws_idx
  on public.research_chats(workspace_id, updated_at desc);

create table if not exists public.research_messages (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid not null references public.research_chats(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role         text not null check (role in ('user','assistant')),
  content      text not null default '',
  -- What the agent did to answer, kept for the same reason the report keeps
  -- sources: an answer you cannot audit is an answer you cannot trust.
  tool_calls   jsonb not null default '[]'::jsonb,
  sources      jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists research_messages_chat_idx
  on public.research_messages(chat_id, created_at);

-- 6) ── plan_ideas.source — traceability for promoted ideas ───────────────
-- plan_ideas has no source column today and plan_id is required, so a
-- research suggestion cannot be a floating idea: it rests in
-- research_findings until someone picks a target plan. This column is only
-- so that, once landed, the idea's later performance is traceable back to
-- the research that suggested it. Deliberately NOT a check constraint — the
-- set of sources will grow, and a new one should not need a migration.
alter table public.plan_ideas
  add column if not exists source text not null default 'planner';
comment on column public.plan_ideas.source is
  'Where this idea came from: planner | research | human.';

-- 7) ── Row-level security ────────────────────────────────────────────────
-- Same per-USER scoping as every other table here. NOTE, as everywhere in
-- this schema: RLS is NOT workspace isolation — the operators belong to all
-- three workspaces, so these policies let every workspace's rows through at
-- once. Every application query must still carry its own workspace_id
-- filter. See the workspace isolation migration.
alter table public.research_runs        enable row level security;
alter table public.research_agenda      enable row level security;
alter table public.competitor_snapshots enable row level security;
alter table public.research_findings    enable row level security;
alter table public.research_chats       enable row level security;
alter table public.research_messages    enable row level security;

drop policy if exists research_runs_rw on public.research_runs;
create policy research_runs_rw on public.research_runs
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists research_agenda_rw on public.research_agenda;
create policy research_agenda_rw on public.research_agenda
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists research_chats_rw on public.research_chats;
create policy research_chats_rw on public.research_chats
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists research_messages_rw on public.research_messages;
create policy research_messages_rw on public.research_messages
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Snapshots and findings are READ-ONLY to the browser. They are the evidence
-- the report rests on; only the workflow (service key, which bypasses RLS)
-- writes them. A page that could edit its own evidence is not evidence.
drop policy if exists competitor_snapshots_read on public.competitor_snapshots;
create policy competitor_snapshots_read on public.competitor_snapshots
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists research_findings_read on public.research_findings;
create policy research_findings_read on public.research_findings
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- ════════════════════════════════════════════════════════════════════════
-- Done. New: research_runs, research_agenda, competitor_snapshots,
-- research_findings, research_chats, research_messages; plan_ideas.source.
--
-- NOT touched, and never to be: brand_profile, brand_fields, brand_sections,
-- brand_directory_columns, brand_directory_rows. The agent reads those and
-- proposes into brand_memory. That is the whole boundary.
-- ════════════════════════════════════════════════════════════════════════
