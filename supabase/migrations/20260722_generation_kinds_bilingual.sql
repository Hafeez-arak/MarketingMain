-- ════════════════════════════════════════════════════════════════════════
-- Content generation v2 — post kinds, bilingual captions, carousels
-- ════════════════════════════════════════════════════════════════════════
-- Turns the single "caption + one image" generator into a real social-content
-- engine that handles every post kind, in Saudi Arabic + English.
--
--   post_kind (decided at plan time, per idea):
--     caption_only   — caption(s), no image
--     image_only     — one image, no caption
--     caption_image  — caption(s) + one image  (the common default)
--     carousel       — caption(s) + N images
--     text_image     — an image built around words/typography (image_text)
--
--   caption language is a PER-COMPANY setting (brand_profile.caption_language):
--     ar | en | both   (default 'both' = Saudi-Arabic + English, stacked)
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

-- 1) ── plan_ideas: the post kind + carousel/text controls ─────────────────
alter table public.plan_ideas
  add column if not exists post_kind   text default 'caption_image',
  add column if not exists slide_count int  default 1,     -- carousel: how many slides
  add column if not exists image_text  text default '';    -- text_image: the words to feature

alter table public.plan_ideas
  drop constraint if exists plan_ideas_post_kind_check;
alter table public.plan_ideas
  add constraint plan_ideas_post_kind_check
  check (post_kind in ('caption_only','image_only','caption_image','carousel','text_image'));

-- 2) ── brand_profile: per-company caption language + dialect ───────────────
alter table public.brand_profile
  add column if not exists caption_language text default 'both',
  add column if not exists arabic_dialect   text default 'saudi';

alter table public.brand_profile
  drop constraint if exists brand_profile_caption_language_check;
alter table public.brand_profile
  add constraint brand_profile_caption_language_check
  check (caption_language in ('ar','en','both'));

-- 3) ── generated-post tables: bilingual + carousel + kind + scoping ────────
-- caption_ar / caption_en hold the two language variants; the legacy `caption`
-- (Instagram) and `hook`/`body` (LinkedIn) columns are kept for back-compat and
-- populated with the display text. image_urls holds every image (carousels);
-- image_url keeps the first/single image for anything that reads one image.
alter table public.instagram_generated_posts
  add column if not exists caption_ar   text   default '',
  add column if not exists caption_en   text   default '',
  add column if not exists image_urls   text[] default '{}',
  add column if not exists post_kind    text   default 'caption_image',
  add column if not exists workspace_id uuid;

alter table public.linkedin_generated_posts
  add column if not exists caption_ar   text   default '',
  add column if not exists caption_en   text   default '',
  add column if not exists image_urls   text[] default '{}',
  add column if not exists post_kind    text   default 'caption_image',
  add column if not exists workspace_id uuid;

create index if not exists instagram_generated_ws_idx
  on public.instagram_generated_posts(workspace_id);
create index if not exists linkedin_generated_ws_idx
  on public.linkedin_generated_posts(workspace_id);
