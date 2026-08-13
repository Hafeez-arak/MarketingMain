-- ════════════════════════════════════════════════════════════════════════
-- scheduled_posts — one read surface over the three post tables
--
-- Posts live in three tables and always will: instagram_generated_posts and
-- linkedin_generated_posts have real data and workflows depending on them,
-- and generated_posts is the shared superset for everything else (TikTok and
-- Snapchat today, WhatsApp and email later). Merging them is a separate,
-- higher-risk decision — see the header of 20260808_generated_posts_table.sql.
--
-- The problem that needs solving is narrower: every screen that wants "all
-- posts" has to know all three names and hand-union them. Approvals does
-- exactly that for two of the three, which is precisely why TikTok and
-- Snapchat posts have been invisible in the app since the day that table was
-- added — the pattern demonstrably does not get extended when a table is.
-- A client-side union also cannot do the one thing a calendar needs:
-- `order by scheduled_publish_at limit 50` ACROSS tables.
--
-- So: a view. Additive, no migration risk to existing data, exposed by
-- PostgREST for free at /rest/v1/scheduled_posts, and read-only —
-- writes keep going to the base tables, keyed by the post_table column below.
--
-- ⚠️  security_invoker = true is the single most important line in this file.
-- Without it a view executes as its OWNER and bypasses the base tables' RLS
-- entirely, so every workspace would read every other workspace's posts with
-- no error anywhere. It requires PG15+, which Supabase is on. Verify with TWO
-- accounts — a single-account test cannot catch this.
--
-- Run ONCE in the Supabase SQL editor. Idempotent (create or replace).
-- ════════════════════════════════════════════════════════════════════════

drop view if exists public.scheduled_posts;

create view public.scheduled_posts
with (security_invoker = true) as

  -- ── Instagram ─────────────────────────────────────────────────────────
  select
    'instagram_generated_posts'::text as post_table,
    'instagram'::text                 as platform,
    p.id, p.workspace_id,
    p.caption, p.caption_ar, p.caption_en, p.hashtags, p.first_comment,
    null::text  as hook,
    null::text  as body,
    p.topic, p.post_kind, p.style, p.tone, p.aspect_ratio,
    null::text  as format,
    -- media_type is a real column only on generated_posts; derived here so a
    -- caller can filter video vs image the same way across all three.
    case when coalesce(p.video_url, '') <> '' then 'video' else 'image' end as media_type,
    p.image_url, p.image_urls, p.image_prompt, p.video_url, p.cover_image_url,
    p.motion_prompt,
    p.post_strategy,
    null::text    as post_type,
    null::boolean as include_image,
    null::text    as content_route,
    p.scheduled_date, p.publish_time,
    p.status, p.source,
    p.plan_id, p.plan_idea_id,
    -- campaign_id is text here and on LinkedIn but uuid on generated_posts,
    -- so the union is aligned on text (see the cast in the third branch).
    p.campaign_id,
    p.creative_session_id, p.creative_version_id,
    p.zernio_post_id, p.zernio_account_id,
    p.publish_status, p.published_at, p.scheduled_publish_at,
    p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
  from public.instagram_generated_posts p

  union all

  -- ── LinkedIn ──────────────────────────────────────────────────────────
  -- hook/body are carried through rather than flattened away. Approvals and
  -- LinkedInPage are both built around the split (the hook is what shows
  -- before "see more"), so losing it here would mean every LinkedIn consumer
  -- had to fall back to the base table anyway. `caption` is synthesised for
  -- callers that just want one string, without destroying the parts.
  select
    'linkedin_generated_posts'::text,
    'linkedin'::text,
    p.id, p.workspace_id,
    nullif(trim(coalesce(p.hook, '') || E'\n\n' || coalesce(p.body, '')), '') as caption,
    p.caption_ar, p.caption_en, p.hashtags, p.first_comment,
    p.hook, p.body,
    p.topic, p.post_kind, p.style, p.tone, p.aspect_ratio,
    null::text as format,
    case when coalesce(p.video_url, '') <> '' then 'video' else 'image' end,
    p.image_url, p.image_urls, p.image_prompt, p.video_url, p.cover_image_url,
    p.motion_prompt,
    p.post_strategy, p.post_type, p.include_image, p.content_route,
    p.scheduled_date, p.publish_time,
    p.status, p.source,
    p.plan_id, p.plan_idea_id, p.campaign_id,
    p.creative_session_id, p.creative_version_id,
    p.zernio_post_id, p.zernio_account_id,
    p.publish_status, p.published_at, p.scheduled_publish_at,
    p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
  from public.linkedin_generated_posts p

  union all

  -- ── Everything else (TikTok, Snapchat — and later WhatsApp / email) ────
  -- `platform` is a real column here, since one table serves several.
  select
    'generated_posts'::text,
    p.platform,
    p.id, p.workspace_id,
    p.caption, p.caption_ar, p.caption_en, p.hashtags, p.first_comment,
    null::text as hook,
    null::text as body,
    p.topic, p.post_kind, p.style,
    null::text as tone,
    p.aspect_ratio, p.format, p.media_type,
    p.image_url, p.image_urls, p.image_prompt, p.video_url, p.cover_image_url,
    p.motion_prompt,
    null::text    as post_strategy,
    null::text    as post_type,
    null::boolean as include_image,
    null::text    as content_route,
    p.scheduled_date, p.publish_time,
    p.status, p.source,
    p.plan_id, p.plan_idea_id,
    -- The one genuine type difference between the three tables: campaign_id is
    -- uuid here and text on the other two, and a UNION will not match them.
    -- Cast to text rather than the reverse — uuid::text always succeeds, while
    -- text::uuid would fail the moment an Instagram or LinkedIn row held a
    -- campaign id that wasn't a well-formed uuid, and those columns have never
    -- been constrained to be.
    p.campaign_id::text,
    p.creative_session_id, p.creative_version_id,
    p.zernio_post_id, p.zernio_account_id,
    p.publish_status, p.published_at, p.scheduled_publish_at,
    p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
  from public.generated_posts p;

grant select on public.scheduled_posts to authenticated;


-- Lets the planner push a date-range filter down into each branch instead of
-- scanning all three tables and sorting the union. Free at today's volumes and
-- correct at ten times them — the calendar's whole query shape is
-- "this workspace, this month, ordered by when it goes out".
create index if not exists instagram_generated_posts_sched_idx
  on public.instagram_generated_posts(workspace_id, scheduled_publish_at)
  where scheduled_publish_at is not null;

create index if not exists linkedin_generated_posts_sched_idx
  on public.linkedin_generated_posts(workspace_id, scheduled_publish_at)
  where scheduled_publish_at is not null;

create index if not exists generated_posts_sched_idx
  on public.generated_posts(workspace_id, scheduled_publish_at)
  where scheduled_publish_at is not null;
