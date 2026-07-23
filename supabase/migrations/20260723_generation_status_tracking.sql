-- ════════════════════════════════════════════════════════════════════════
-- Generation status tracking — durable "processing / failed / completed"
-- state per plan idea, so Post Approvals can show in-flight generation,
-- real failures (not silent disappearance), and group everything by plan.
-- ════════════════════════════════════════════════════════════════════════
-- Three separate status dimensions now exist, on purpose, don't conflate them:
--   plan_ideas.status            — proposed / approved / rejected  (planning decision)
--   plan_ideas.generation_status — not_started / processing / completed / failed (THIS migration)
--   *_generated_posts.status     — pending_review / pending_publish / rejected (content decision)
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.plan_ideas
  add column if not exists generation_status text default 'not_started',
  add column if not exists generation_error  text default '';

alter table public.plan_ideas
  drop constraint if exists plan_ideas_generation_status_check;
alter table public.plan_ideas
  add constraint plan_ideas_generation_status_check
  check (generation_status in ('not_started','processing','completed','failed'));

-- Backfill: any idea that already has a real generated post (from before this
-- migration existed) should read as 'completed', not the new default
-- 'not_started' — otherwise old, already-finished posts would look wrong in
-- the new grouped/status-aware Approvals view.
update public.plan_ideas pi
set generation_status = 'completed'
where pi.generation_status = 'not_started'
  and (
    exists (select 1 from public.instagram_generated_posts gp where gp.plan_idea_id = pi.id)
    or exists (select 1 from public.linkedin_generated_posts gp where gp.plan_idea_id = pi.id)
  );

create index if not exists plan_ideas_generation_status_idx
  on public.plan_ideas(generation_status);
