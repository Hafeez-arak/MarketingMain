-- ════════════════════════════════════════════════════════════════════════
-- Media options — real, on-demand image generation during REVIEW (not just
-- prompts). "Generate image options" on the plan board calls arak-media-
-- options, which returns 2-3 actual candidate images from fal.ai; the
-- reviewer picks one and it becomes preview_image_url. Same flow covers a
-- video idea's COVER image — the video clip itself still only renders at
-- Finalize (Step 4), so review stays fast even for a month with several
-- reels.
--
-- preview_image_url holds whichever fal.ai URL was picked — fal's own URLs
-- are not guaranteed permanent, so Finalize re-fetches and uploads this one
-- to Supabase Storage as part of committing the post (the same "make it
-- permanent" step the generation engine already does for AI-generated
-- images). Nothing here is a final, generation-ready value on its own.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.plan_ideas
  add column if not exists preview_image_url text default '';
