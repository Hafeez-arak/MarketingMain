-- ════════════════════════════════════════════════════════════════════════
-- generated_posts.media — a post's media, in the order it was chosen
--
-- Instagram carousels may mix images and videos (up to 10 items, all sharing
-- the aspect ratio of the first), and Zernio takes exactly that: an ordered
-- array of { type, url }. What this app had nowhere to keep was the ORDER, or
-- indeed the fact that a post held both at once.
--
-- image_urls (an array) and video_url (a single column) cannot express
-- "picture, clip, picture". So five separate code paths each resolved the
-- ambiguity by dropping half the post — see the header of src/lib/mediaOrder.js
-- for the list. The visible symptom was a carousel that showed two pictures on
-- one screen and only the video on another, and images silently deleted from
-- the row on the next save.
--
-- ── WHY A COLUMN AND NOT A TABLE ──
-- Media is never queried independently of its post, never joined to, and
-- never more than ten rows. A child table would buy referential tidiness and
-- cost a join on every read plus an ordering column to maintain by hand.
--
-- ── THE LEGACY COLUMNS STAY, AS A PROJECTION ──
-- image_url / image_urls / video_url are NOT dropped and NOT deprecated in
-- place. PostPanel, the Post Queue, the planner cards, the dashboard,
-- post_analytics and several n8n nodes read them, and none of them needs to
-- learn about this column. src/lib/mediaOrder.js#projectionFor derives them
-- from `media` on every write, one way only: `media` is the truth, the columns
-- follow. A row with no `media` (everything written before today, plus the
-- frozen instagram_generated_posts) is read back through the legacy columns
-- instead — so this is additive, and nothing needs backfilling.
--
-- Run ONCE in the Supabase SQL editor. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. The column ────────────────────────────────────────────────────────
alter table public.generated_posts
  add column if not exists media jsonb;

comment on column public.generated_posts.media is
  'Ordered media: [{"type":"image|video","url":"…"}]. Authoritative when '
  'present; image_url/image_urls/video_url are a derived projection of it. '
  'NULL on rows written before 2026-09-20 — read those through the legacy '
  'columns. See src/lib/mediaOrder.js.';

-- Shape guard. A malformed value here becomes a publish that silently sends
-- nothing, which is the failure this whole change exists to stop.
alter table public.generated_posts
  drop constraint if exists generated_posts_media_is_array;

alter table public.generated_posts
  add constraint generated_posts_media_is_array
  check (media is null or jsonb_typeof(media) = 'array');

-- ── 2. The view ──────────────────────────────────────────────────────────
-- DROP then CREATE, never `create or replace`.
--
-- ⚠️  security_invoker = true is the single most important line in this file.
-- Without it the view executes as its OWNER and bypasses the base tables' RLS
-- entirely, so every workspace would read every other workspace's posts with
-- no error anywhere. `create or replace` is banned here precisely because it
-- silently keeps the old options: a replace that forgets this line leaves a
-- view that LOOKS right and leaks everything. Verify with TWO accounts — a
-- single-account test cannot catch it.
drop view if exists public.scheduled_posts;

create view public.scheduled_posts
with (security_invoker = true) as

  -- ── instagram_generated_posts (FROZEN: read, never written) ───────────
  -- No `media` column of its own and never will have one, so it reports NULL
  -- and mediaOfPost falls back to this row's legacy columns.
  select
    'instagram_generated_posts'::text as post_table,
    'instagram'::text                 as platform,
    p.id, p.workspace_id,
    p.caption, p.caption_ar, p.caption_en, p.hashtags, p.first_comment,
    null::text as hook,
    null::text as body,
    p.topic, p.post_kind, p.style, p.tone, p.aspect_ratio,
    null::text as format,
    case when coalesce(p.video_url, '') <> '' then 'video' else 'image' end as media_type,
    null::jsonb as media,
    p.image_url, p.image_urls, p.image_prompt, p.video_url, p.cover_image_url,
    p.motion_prompt,
    p.post_strategy,
    null::text    as post_type,
    null::boolean as include_image,
    null::text    as content_route,
    '{}'::jsonb   as platform_options,
    '{}'::text[]  as tags,
    p.scheduled_date, p.publish_time,
    p.status, p.source,
    p.plan_id, p.plan_idea_id,
    p.campaign_id,
    p.creative_session_id, p.creative_version_id,
    p.zernio_post_id, p.zernio_account_id,
    p.publish_provider,
    p.publish_status, p.published_at, p.scheduled_publish_at,
    p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
  from public.instagram_generated_posts p

  union all

  -- ── generated_posts (every platform written today) ────────────────────
  select
    'generated_posts'::text as post_table,
    p.platform,
    p.id, p.workspace_id,
    p.caption, p.caption_ar, p.caption_en, p.hashtags, p.first_comment,
    null::text as hook,
    null::text as body,
    p.topic, p.post_kind, p.style, p.tone, p.aspect_ratio,
    p.format,
    p.media_type,
    p.media,
    p.image_url, p.image_urls, p.image_prompt, p.video_url, p.cover_image_url,
    p.motion_prompt,
    p.post_strategy,
    null::text    as post_type,
    null::boolean as include_image,
    null::text    as content_route,
    p.platform_options,
    p.tags,
    p.scheduled_date, p.publish_time,
    p.status, p.source,
    p.plan_id, p.plan_idea_id,
    p.campaign_id::text as campaign_id,
    p.creative_session_id, p.creative_version_id,
    p.zernio_post_id, p.zernio_account_id,
    p.publish_provider,
    p.publish_status, p.published_at, p.scheduled_publish_at,
    p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
  from public.generated_posts p;

-- The view is reached with the caller's own token; security_invoker above is
-- what makes the base tables' RLS apply. These grants are what PostgREST needs
-- to expose it at all.
grant select on public.scheduled_posts to anon, authenticated;
