-- ════════════════════════════════════════════════════════════════════════
-- brand_edit_feedback — RECOVERED migration
--
-- This table already exists in the live database and `logEditFeedback`
-- (src/lib/brandBrain.js) has been writing to it, but it had NO migration
-- in the repo — so a rebuild from migrations alone would silently drop it,
-- and every write would start failing with a 404 that the caller swallows
-- by design ("best-effort — never block the user's save on this"). Written
-- here to match the columns the existing writer sends.
--
-- Why it matters more now: this is the single highest-value learning
-- signal in the system — what a human changed the AI's text TO. Outcome
-- metrics (post_analytics) tell you what performed; this tells you what a
-- human considered correct. Any future self-improvement loop leans on it,
-- so it must not be the one table that isn't reproducible.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive — safe on the
-- existing table (create-if-not-exists + add-column-if-not-exists), so it
-- reconciles the repo with reality rather than recreating anything.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.brand_edit_feedback (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,

  platform      text default '',
  post_id       uuid,
  field         text default '',        -- caption | hook | body | hashtags | image_prompt
  original_text text default '',        -- what the AI produced
  edited_text   text default '',        -- what the human changed it to

  created_at    timestamptz not null default now()
);

-- Additive guards, in case the live table predates any of these columns.
alter table public.brand_edit_feedback
  add column if not exists platform      text default '',
  add column if not exists post_id       uuid,
  add column if not exists field         text default '',
  add column if not exists original_text text default '',
  add column if not exists edited_text   text default '',
  add column if not exists created_at    timestamptz not null default now();

create index if not exists brand_edit_feedback_ws_idx
  on public.brand_edit_feedback(workspace_id, created_at desc);

alter table public.brand_edit_feedback enable row level security;

drop policy if exists brand_edit_feedback_rw on public.brand_edit_feedback;
create policy brand_edit_feedback_rw on public.brand_edit_feedback
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
