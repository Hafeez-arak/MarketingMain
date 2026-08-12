-- ════════════════════════════════════════════════════════════════════════
-- Carry a chosen VIDEO back to the plan
--
-- The media stage records what was accepted in the Studio on the plan idea,
-- so finalising the plan can attach it instead of generating something new.
-- That worked for images only: preview_image_url held the still, and the
-- generation workflow read it. A video idea had nowhere to put the clip, so an
-- accepted reel was marked ready on the board and then quietly not attached —
-- the post row got a caption and no video, which looks identical to a render
-- that failed.
--
-- preview_video_url is the missing half. preview_image_url keeps its meaning
-- (the picture standing in for this idea on the board) and doubles as the
-- video's cover, which is what a thumbnail grid needs anyway.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.plan_ideas
  add column if not exists preview_video_url text default '';
