-- ════════════════════════════════════════════════════════════════════════
-- Per-post reference images (image-to-image generation)
-- ════════════════════════════════════════════════════════════════════════
-- Lets a specific post carry a list of reference image URLs that GUIDE the
-- AI image generation (true image-to-image), as opposed to `uploaded_image_urls`
-- which is a FINISHED image used AS the post (upload_type = 'upload', no
-- generation). References can come from a fresh upload or be picked from the
-- Brand Brain asset library — either way they are stored here as public URLs.
--
-- These references flow: plan_ideas → (on finalize) → instagram_schedule /
-- linkedin_schedule → n8n generation webhook, which will condition the
-- image model on them (n8n side handled separately).
--
-- Run ONCE in the Supabase SQL editor (project: "Arak Marketing").
-- Safe to re-run — idempotent.
-- ════════════════════════════════════════════════════════════════════════

alter table public.plan_ideas
  add column if not exists reference_image_urls text[] default '{}';

alter table public.instagram_schedule
  add column if not exists reference_image_urls text[] default '{}';

alter table public.linkedin_schedule
  add column if not exists reference_image_urls text[] default '{}';
