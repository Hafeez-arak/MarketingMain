-- ════════════════════════════════════════════════════════════════════════
-- Brand Brain as the source of truth — task tags + the learning loop
-- ════════════════════════════════════════════════════════════════════════
-- Three changes, all additive:
--
--   1. `tasks` on brand_fields / brand_sections. A field can now say WHICH
--      kinds of generation it belongs in. Empty array = every task, so this
--      is backward compatible: nothing changes until someone tags something.
--      This is the "only the required information" control — a 30-row price
--      list is useful to a planner and pure token burn to an image prompt.
--
--   2. `brand_memory` — one table holding every kind of learning the system
--      accumulates: what got rejected and why, what the analytics showed,
--      what research turned up, and rules a human simply wrote down. It
--      lives inside the Brand Brain rather than in a silo, because a rule
--      that steers generation IS brand knowledge.
--
--   3. `idea_events` — an append-only decision log. Today edits and
--      re-drafts overwrite plan_ideas in place, so *what changed and why* is
--      genuinely unrecoverable. This is the raw material every later
--      insight is computed from, which is why it starts logging now rather
--      than when the reporting gets built.
--
-- Run ONCE. Every statement is idempotent — safe to re-run, drops nothing.
-- ════════════════════════════════════════════════════════════════════════

-- 1) ── Task tags ─────────────────────────────────────────────────────────
-- Tasks: plan | caption | image | video | research | chat
-- Deliberately NOT a check constraint or enum: the task list will grow, and
-- a new task name should not require a migration before a field can use it.
-- An unknown tag simply never matches, which is the safe failure.
alter table public.brand_fields
  add column if not exists tasks text[] not null default '{}';
alter table public.brand_sections
  add column if not exists tasks text[] not null default '{}';

comment on column public.brand_fields.tasks is
  'Which generation tasks this field is sent to. Empty = all tasks.';
comment on column public.brand_sections.tasks is
  'Which generation tasks this section is sent to. Empty = all tasks.';

-- 2) ── brand_memory ──────────────────────────────────────────────────────
-- `rule` is the only column that ever reaches a model, and it is injected
-- verbatim — one imperative sentence, ~20 tokens. `detail` and `evidence`
-- exist so a human can audit WHY a rule is there without paying for that
-- context on every generation.
create table if not exists public.brand_memory (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope        text not null default 'global'
               check (scope in ('plan','caption','image','timing','competitor','trend','global')),
  rule         text not null,
  detail       text default '',
  evidence     jsonb not null default '{}'::jsonb,   -- {idea_ids, post_ids, metrics, sample_size}
  source       text not null default 'human'
               check (source in ('rejections','edits','analytics','research','human')),
  -- proposed → a machine suggested it and a human has not agreed yet.
  -- Only 'active' rows are ever injected into a prompt: an unreviewed
  -- inference must not silently start steering the brand's output.
  status       text not null default 'proposed'
               check (status in ('proposed','active','retired')),
  tasks        text[] not null default '{}',         -- same semantics as above: empty = all
  confidence   numeric default null,                 -- 0-1 where a machine could estimate it
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz default null,
  reviewed_by  uuid default null
);
create index if not exists brand_memory_ws_idx     on public.brand_memory(workspace_id);
-- The read path is always "active rules for this workspace", so index that
-- pair directly rather than making every generation filter a full scan.
create index if not exists brand_memory_active_idx on public.brand_memory(workspace_id, status);

-- 3) ── idea_events ───────────────────────────────────────────────────────
-- Append-only. No updates, no deletes: the value here is precisely that it
-- records what was true at the time, including decisions later reversed.
-- idea_id is NOT a foreign key on purpose — a deleted idea's history is the
-- most interesting history there is, and a cascade would erase it.
create table if not exists public.idea_events (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id      uuid default null,
  idea_id      uuid default null,
  event        text not null
               check (event in ('created','approved','rejected','edited','redrafted','deleted')),
  reason       text default '',                      -- reject reason, or free text
  before       jsonb not null default '{}'::jsonb,
  after        jsonb not null default '{}'::jsonb,
  actor        uuid default null,
  created_at   timestamptz not null default now()
);
create index if not exists idea_events_ws_idx   on public.idea_events(workspace_id, created_at desc);
create index if not exists idea_events_idea_idx on public.idea_events(idea_id);

-- 4) ── Row-level security — same workspace scoping as every brand_* table ─
-- NOTE: RLS here is per-USER, not per-workspace isolation. The operators
-- belong to all three workspaces, so these policies let every workspace's
-- rows through at once. Every application query must still carry its own
-- workspace_id filter — see the workspace isolation migration.
alter table public.brand_memory enable row level security;
alter table public.idea_events  enable row level security;

drop policy if exists brand_memory_rw on public.brand_memory;
create policy brand_memory_rw on public.brand_memory
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Insert/select only: an append-only log that callers can rewrite is just a
-- table. Omitting update/delete from the policy is what makes it append-only
-- for the app; a service-role backfill can still correct it out of band.
drop policy if exists idea_events_read on public.idea_events;
create policy idea_events_read on public.idea_events
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists idea_events_insert on public.idea_events;
create policy idea_events_insert on public.idea_events
  for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

-- ════════════════════════════════════════════════════════════════════════
-- Done. New: brand_memory, idea_events; tasks[] on brand_fields and
-- brand_sections. Identity fields (brand_name / brand_descriptor) are seeded
-- per workspace by the companion seed migration.
-- ════════════════════════════════════════════════════════════════════════
