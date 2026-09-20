-- ════════════════════════════════════════════════════════════════════════
-- plan_ideas.slides — one ordered list, each slide knowing where it came from
-- ════════════════════════════════════════════════════════════════════════
-- Until now an idea's pictures lived in three fields that could only say
-- "all of this is from the Studio" or "all of this is yours":
--
--   image_mode            one mode for the whole post
--   preview_image_url     the single Studio render
--   reference_image_urls  your uploads
--
-- and every reader resolved them the same way:
--
--   const images = idea.previewImageUrl ? [idea.previewImageUrl] : refs
--
-- The Studio render wins and the uploads are discarded. So a four-slide
-- carousel could be four AI images or four of your own, never two and two —
-- and the moment a render landed on an idea that already had uploads, those
-- uploads stopped being reachable with nothing on screen to say so.
--
-- `slides` is that list, in order:
--
--   [{ "url": "...", "type": "image" | "video",
--      "source": "studio" | "upload" | "library", "versionId": "..." }]
--
-- The three old columns are NOT dropped and are NOT dead. They are still read
-- by the caption workflow, by screens this change does not touch, and by
-- every row written before today. They are now DERIVED from `slides` —
-- src/lib/planSlides.js legacyFieldsFor() is the one place that derives them,
-- and it runs on every write. Dropping them would have meant changing the
-- n8n workflows in the same breath, on a box that is mid-redeploy.
--
-- Backfill is deliberately absent. An idea with no slides is not an idea with
-- no pictures — slidesFor() derives the list from the old columns, faithfully
-- reproducing the Studio-render-wins rule for rows that predate this. That
-- rule is wrong going forward and correct going backward, which is the only
-- combination that does not silently rearrange a plan already in flight.
-- Rows adopt the new model the first time someone edits their slides.
-- ════════════════════════════════════════════════════════════════════════

alter table public.plan_ideas
  add column if not exists slides jsonb not null default '[]'::jsonb;

comment on column public.plan_ideas.slides is
  'Ordered media for this idea: [{url, type, source, versionId?}]. source is studio|upload|library. '
  'Empty means the row predates the column — read it through planSlides.slidesFor(), which falls back '
  'to preview_image_url / reference_image_urls. preview_image_url, reference_image_urls, image_mode, '
  'preview_video_url, media_type and slide_count are derived from this by planSlides.legacyFieldsFor().';
