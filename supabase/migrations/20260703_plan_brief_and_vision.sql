-- ════════════════════════════════════════════════════════════════════════
-- Richer plan brief + per-idea creative vision (ARAK Content Studio)
-- ════════════════════════════════════════════════════════════════════════
-- Upgrades monthly planning from "a count + a general idea" into a real brief,
-- and lets each idea carry the human's own creative direction BEFORE content
-- generation (so references/vision inform the plan, not bolted on after).
--
-- Stage 1 (brief): a plan can now name which products to FEATURE this month and
--   carry a campaign-wide REFERENCE POOL of images the planner can draw from.
-- Stage 3 (editable board): each idea can carry a freeform IMAGE_IDEA ("what I'm
--   imagining") plus a persisted aspect ratio. reference_image_urls already
--   exists (see 20260702_post_reference_images.sql).
--
-- Run ONCE in the Supabase SQL editor (project: "Arak Marketing").
-- Idempotent + additive — nothing existing is dropped or rewritten.
-- ════════════════════════════════════════════════════════════════════════

-- 1) ── Plan-level brief inputs ────────────────────────────────────────────
alter table public.content_plans
  add column if not exists featured_products text[] default '{}',   -- product/collection names to emphasize
  add column if not exists reference_pool    text[] default '{}';   -- campaign-wide reference image URLs

-- The finalize step moves a plan to status 'generating' while content is being
-- produced; the original CHECK predates that and silently rejects the PATCH.
-- Widen it to the full lifecycle the app actually uses.
alter table public.content_plans
  drop constraint if exists content_plans_status_check;
alter table public.content_plans
  add constraint content_plans_status_check
  check (status in ('draft','approved','active','generating','archived'));

-- 2) ── Per-idea creative direction ────────────────────────────────────────
alter table public.plan_ideas
  add column if not exists image_idea            text default '',   -- freeform "what I'm imagining" for the visual
  add column if not exists suggested_aspect_ratio text default ''   -- persist the AR the planner chose
  ;

-- How the idea's image(s) are produced:
--   'generate'      → AI generates it (reference_image_urls, if any, GUIDE it — image-to-image)
--   'use_reference' → skip AI; reference_image_urls ARE the final image(s) used as the post
-- Count rule enforced in the UI: use_reference + a single 'post' allows exactly
-- one image; a 'carousel' (or any AI generation) allows many.
alter table public.plan_ideas
  add column if not exists image_mode text default 'generate'
  check (image_mode in ('generate','use_reference'));

-- ════════════════════════════════════════════════════════════════════════
-- Done. content_plans += featured_products, reference_pool (+ widened status).
--       plan_ideas    += image_idea, suggested_aspect_ratio.
-- ════════════════════════════════════════════════════════════════════════
