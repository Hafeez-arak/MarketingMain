-- ════════════════════════════════════════════════════════════════════════
-- Restore RLS on scheduled_posts  —  fixes an ACTIVE cross-workspace leak
-- ════════════════════════════════════════════════════════════════════════
-- 20260813_scheduled_posts_view.sql created this view
-- `with (security_invoker = true)`, and its own header called that "the
-- single most important line in this file". It was right.
--
-- 20260819_remove_linkedin.sql then rebuilt the view with
-- `create or replace view ... as` and NO `with` clause. That is the bug:
-- CREATE OR REPLACE VIEW does not merge reloptions, it RESETS them. The
-- clause was not inherited from the previous definition — it was erased.
--
-- Confirmed in production before writing this:
--
--     relname          relkind   reloptions   owner
--     scheduled_posts  v         NULL         postgres
--
-- reloptions NULL means security_invoker is OFF, so the view executed as its
-- owner (postgres) and bypassed RLS on BOTH base tables — even though
-- instagram_generated_posts and generated_posts each have relrowsecurity =
-- true and a correct `is_workspace_member(workspace_id)` policy. The only
-- thing separating one client's posts from another's was the client-supplied
-- `workspace_id=eq.` query parameter, which any signed-in user can edit.
-- Both the calendar and Approvals read this view.
--
-- ⚠️  HOUSE RULE FOR THIS VIEW: always DROP + CREATE, never CREATE OR REPLACE.
--     `create or replace` silently drops the security_invoker setting and
--     reopens this exact leak with no error anywhere. If you change a column
--     below, change it by editing this drop+create pair.
--
-- Checked before dropping: nothing else depends on this view (no dependent
-- views or rules), so the drop is safe without cascade. DROP also discards
-- the view's grants, so the `grant select` at the bottom is re-issued — it
-- is not redundant.
--
-- Column list is copied verbatim from 20260819_remove_linkedin.sql; this
-- migration changes the view's SECURITY, not its shape.
-- ════════════════════════════════════════════════════════════════════════

drop view if exists public.scheduled_posts;

create view public.scheduled_posts
with (security_invoker = true) as

  -- ── Instagram (21 historical rows) ────────────────────────────────────
  select
    'instagram_generated_posts'::text as post_table,
    'instagram'::text                 as platform,
    p.id, p.workspace_id,
    p.caption, p.caption_ar, p.caption_en, p.hashtags, p.first_comment,
    null::text as hook,
    null::text as body,
    p.topic, p.post_kind, p.style, p.tone, p.aspect_ratio,
    null::text as format,
    -- media_type is a real column only on generated_posts; derived here so a
    -- caller can filter video vs image the same way across both branches.
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
    -- campaign_id is text here but uuid on generated_posts, so the union is
    -- aligned on text (see the cast in the second branch).
    p.campaign_id,
    p.creative_session_id, p.creative_version_id,
    p.zernio_post_id, p.zernio_account_id,
    p.publish_status, p.published_at, p.scheduled_publish_at,
    p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
  from public.instagram_generated_posts p

  union all

  -- ── Everything else (TikTok, Snapchat — and later WhatsApp / email) ────
  -- `platform` is a real column here, since one table serves several.
  select
    'generated_posts'::text as post_table,
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
    -- uuid::text always succeeds, while text::uuid would fail the moment an
    -- Instagram row held a campaign id that wasn't a well-formed uuid, and
    -- that column has never been constrained to be.
    p.campaign_id::text as campaign_id,
    p.creative_session_id, p.creative_version_id,
    p.zernio_post_id, p.zernio_account_id,
    p.publish_status, p.published_at, p.scheduled_publish_at,
    p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
  from public.generated_posts p;

-- DROP VIEW discarded the old grant; re-issue it.
grant select on public.scheduled_posts to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- Verify (must return {security_invoker=true}, not NULL):
--
--   select relname, reloptions from pg_class where relname = 'scheduled_posts';
--
-- Then the test the original migration insisted on and that a single-account
-- test CANNOT substitute for: sign in as two users in two different
-- workspaces and confirm neither sees the other's posts on /schedule and
-- /social/approvals.
-- ════════════════════════════════════════════════════════════════════════
