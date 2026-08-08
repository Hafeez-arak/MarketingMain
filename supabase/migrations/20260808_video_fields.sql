-- ════════════════════════════════════════════════════════════════════════
-- Video fields on the generated-post tables — schema readiness for a
-- plan-approved video idea (reel/video format) to land somewhere once
-- actual clip rendering is built. NOT wired to any generation logic yet:
-- the engine change in this same pass only commits an already-chosen
-- CAPTION and IMAGE (see hasSelectedCaption/hasSelectedImage in
-- gen_workflows.py's Generate Post). Batch video rendering at Finalize is
-- deliberately deferred — it needs a provider decision (fal.ai/Higgsfield/
-- Replicate) that hasn't been locked in, and duplicating the existing
-- Instagram Reels pipeline without reusing it would be the wrong shape.
-- Adding the columns now means that decision doesn't also require a
-- migration later.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.instagram_generated_posts
  add column if not exists video_url        text default '',
  add column if not exists cover_image_url  text default '',
  add column if not exists motion_prompt    text default '';

alter table public.linkedin_generated_posts
  add column if not exists video_url        text default '',
  add column if not exists cover_image_url  text default '',
  add column if not exists motion_prompt    text default '';
