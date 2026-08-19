-- ════════════════════════════════════════════════════════════════════════
-- scheduled_posts: carry publish_provider
--
-- 20260823_meta_graph_publishing.sql added `publish_provider` to both post
-- tables, but this view enumerates its columns rather than using `*`, so a
-- new column is invisible to every screen until the view is rebuilt. The
-- calendar and Approvals read exclusively through the view, so without this
-- they cannot tell a post Zernio published from one Meta published — which
-- is the single question worth asking during a provider changeover.
--
-- ⚠️  DROP + CREATE, never CREATE OR REPLACE. `create or replace view`
-- RESETS reloptions, and that is precisely how `security_invoker = true`
-- was silently lost once already, making every workspace's posts readable
-- by every other. See 20260821_restore_scheduled_posts_rls.sql. The clause
-- is load-bearing; it stays on every rebuild, including this one.
--
-- Body below is 20260822's verbatim, plus `p.publish_provider` in each
-- branch's id block. Run ONCE in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════════

drop view if exists public.scheduled_posts;

create view public.scheduled_posts
with (security_invoker = true) as

  -- ── Instagram history (frozen, 21 rows — nothing writes here any more) ──
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
    p.image_url, p.image_urls, p.image_prompt, p.video_url, p.cover_image_url,
    p.motion_prompt,
    p.post_strategy,
    null::text    as post_type,
    null::boolean as include_image,
    null::text    as content_route,
    p.scheduled_date, p.publish_time,
    p.status, p.source,
    p.plan_id, p.plan_idea_id,
    p.campaign_id,
    p.creative_session_id, p.creative_version_id,
    p.zernio_post_id, p.zernio_account_id, p.publish_provider,
    p.publish_status, p.published_at, p.scheduled_publish_at,
    p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
  from public.instagram_generated_posts p

  union all

  -- ── Everything from here on: Instagram, TikTok, Snapchat ──────────────
  -- tone and post_strategy are now real columns here, not null padding.
  select
    'generated_posts'::text as post_table,
    p.platform,
    p.id, p.workspace_id,
    p.caption, p.caption_ar, p.caption_en, p.hashtags, p.first_comment,
    null::text as hook,
    null::text as body,
    p.topic, p.post_kind, p.style, p.tone,
    p.aspect_ratio, p.format, p.media_type,
    p.image_url, p.image_urls, p.image_prompt, p.video_url, p.cover_image_url,
    p.motion_prompt,
    p.post_strategy,
    null::text    as post_type,
    null::boolean as include_image,
    null::text    as content_route,
    p.scheduled_date, p.publish_time,
    p.status, p.source,
    p.plan_id, p.plan_idea_id,
    p.campaign_id::text as campaign_id,
    p.creative_session_id, p.creative_version_id,
    p.zernio_post_id, p.zernio_account_id, p.publish_provider,
    p.publish_status, p.published_at, p.scheduled_publish_at,
    p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
  from public.generated_posts p;

grant select on public.scheduled_posts to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- Verify:
--   select relname, reloptions from pg_class where relname='scheduled_posts';
--     -> {security_invoker=true}   (NOT null — if null, the leak is back)
--   select post_table, publish_provider, count(*)
--     from public.scheduled_posts group by 1,2;
-- ════════════════════════════════════════════════════════════════════════
