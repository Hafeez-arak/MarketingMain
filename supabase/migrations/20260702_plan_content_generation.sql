-- ════════════════════════════════════════════════════════════════════════
-- Plan → Content Generation (upfront generation + human review)
-- ════════════════════════════════════════════════════════════════════════
-- When a monthly plan is approved, every approved idea is generated NOW
-- (caption + image) into the *_generated_posts tables with
-- status = 'pending_review' and source = 'plan', so the user reviews the
-- REAL caption/image before it's cleared to schedule — instead of the old
-- 8am-cron flow that generated on the morning of publish (no review window).
--
-- These columns let a generated post trace back to the plan/idea it came from
-- (so a re-run can skip ideas already generated) and carry the intended
-- publish date/time + any image-to-image reference URLs forward.
--
-- Run ONCE in the Supabase SQL editor (project: "Arak Marketing").
-- Safe to re-run — idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- Instagram ---------------------------------------------------------------
alter table public.instagram_generated_posts
  add column if not exists plan_id              uuid,
  add column if not exists plan_idea_id         uuid,
  add column if not exists publish_time         text,
  add column if not exists reference_image_urls text[] default '{}';

create index if not exists instagram_generated_plan_idea_idx
  on public.instagram_generated_posts(plan_idea_id);

-- LinkedIn ----------------------------------------------------------------
alter table public.linkedin_generated_posts
  add column if not exists plan_id              uuid,
  add column if not exists plan_idea_id         uuid,
  add column if not exists publish_time         text,
  add column if not exists reference_image_urls text[] default '{}';

create index if not exists linkedin_generated_plan_idea_idx
  on public.linkedin_generated_posts(plan_idea_id);
