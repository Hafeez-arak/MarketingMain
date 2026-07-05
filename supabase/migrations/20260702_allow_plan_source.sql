-- ════════════════════════════════════════════════════════════════════════
-- Allow source = 'plan' on generated_posts tables
-- ════════════════════════════════════════════════════════════════════════
-- The Plan → Content Generation flow (see 20260702_plan_content_generation.sql)
-- inserts generated posts with source = 'plan' so the app can badge them as
-- "📋 From plan". The original *_generated_posts tables were created with a
-- CHECK constraint on `source` that predates the plan flow and rejects 'plan',
-- causing n8n inserts to fail with:
--   new row for relation "instagram_generated_posts" violates check
--   constraint "instagram_generated_posts_source_check"
--
-- This drops the stale constraint and recreates it with the full allowed set.
--
-- Run ONCE in the Supabase SQL editor (project: "Arak Marketing").
-- Safe to re-run — idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- Instagram ---------------------------------------------------------------
alter table public.instagram_generated_posts
  drop constraint if exists instagram_generated_posts_source_check;

alter table public.instagram_generated_posts
  add constraint instagram_generated_posts_source_check
  check (source in ('scheduled', 'manual', 'plan', 'generated'));

-- LinkedIn ----------------------------------------------------------------
alter table public.linkedin_generated_posts
  drop constraint if exists linkedin_generated_posts_source_check;

alter table public.linkedin_generated_posts
  add constraint linkedin_generated_posts_source_check
  check (source in ('scheduled', 'manual', 'plan', 'generated'));

-- ════════════════════════════════════════════════════════════════════════
-- Allow status = 'pending_review' on generated_posts tables
-- ════════════════════════════════════════════════════════════════════════
-- The plan flow writes finished posts with status = 'pending_review' so the
-- user reviews the real caption/image before it moves to scheduling. The
-- original status CHECK constraint predates this review step and rejects it:
--   new row for relation "instagram_generated_posts" violates check
--   constraint "instagram_generated_posts_status_check"
-- Widen to the full status lifecycle used across the app.
-- ════════════════════════════════════════════════════════════════════════

-- Instagram ---------------------------------------------------------------
alter table public.instagram_generated_posts
  drop constraint if exists instagram_generated_posts_status_check;

alter table public.instagram_generated_posts
  add constraint instagram_generated_posts_status_check
  check (status in ('pending_review', 'pending_publish', 'approved', 'scheduled', 'published', 'rejected', 'draft'));

-- LinkedIn ----------------------------------------------------------------
alter table public.linkedin_generated_posts
  drop constraint if exists linkedin_generated_posts_status_check;

alter table public.linkedin_generated_posts
  add constraint linkedin_generated_posts_status_check
  check (status in ('pending_review', 'pending_publish', 'approved', 'scheduled', 'published', 'rejected', 'draft'));
