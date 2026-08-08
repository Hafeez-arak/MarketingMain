-- ════════════════════════════════════════════════════════════════════════
-- Draft copy — caption + media-prompt OPTIONS at plan time, before any
-- image/video renders. Fired once per idea (see n8n/gen_workflows.py
-- build_draft_copy) the moment a plan is created; the reviewer picks or
-- edits from these on the plan board (Step 3) before Finalize commits
-- anything.
--
-- caption_options / media_prompt_options hold what the model proposed (3
-- of each) so a page reload during review doesn't lose them. caption_ar /
-- caption_en / media_prompt / motion_prompt hold the SELECTED (or
-- hand-edited) values — these are what finalize actually reads.
--
-- IMPORTANT — these are PRE-GENERATION DRAFT fields only. Once an idea is
-- generated, *_generated_posts owns the caption; do not read plan_ideas'
-- caption_ar/caption_en after generation_status = 'completed' (see the
-- Approvals retry-path fix landing alongside the generation-v3 migration).
--
-- No caption_language column here — brand_profile.caption_language is
-- already the single source of truth and is already threaded through
-- requestPlanContentGeneration.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.plan_ideas
  add column if not exists caption_options      jsonb default '[]'::jsonb,
  add column if not exists media_prompt_options  jsonb default '[]'::jsonb,
  add column if not exists caption_ar            text default '',
  add column if not exists caption_en            text default '',
  add column if not exists media_prompt          text default '',
  add column if not exists motion_prompt         text default '',
  add column if not exists draft_status          text default 'not_started',
  add column if not exists draft_error           text default '',
  add column if not exists drafted_at            timestamptz;

alter table public.plan_ideas
  drop constraint if exists plan_ideas_draft_status_check;
alter table public.plan_ideas
  add constraint plan_ideas_draft_status_check
  check (draft_status in ('not_started','drafting','ready','failed'));

create index if not exists plan_ideas_draft_status_idx
  on public.plan_ideas(draft_status) where draft_status = 'drafting';
