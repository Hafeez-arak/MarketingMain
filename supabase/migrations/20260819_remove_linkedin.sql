-- ════════════════════════════════════════════════════════════════════════
-- Remove LinkedIn
-- ════════════════════════════════════════════════════════════════════════
-- LinkedIn is not used anywhere in this system and is being removed rather
-- than hidden. Everything below lives in the Arak Lighting test workspace.
--
-- Checked before writing this: all 6 LinkedIn scheduled posts carry an EMPTY
-- STRING zernio_post_id, not a real one — so none of them is registered with
-- Zernio and none can publish. (Worth noting the trap: `zernio_post_id is not
-- null` reports all of them as registered, because '' is not null. Test for
-- a non-empty value, not for null.)
--
-- Order matters. scheduled_posts is a VIEW that UNIONs
-- linkedin_generated_posts, so the view has to be rebuilt without that branch
-- before the table can be dropped.
-- ════════════════════════════════════════════════════════════════════════

-- 1) ── Rebuild the union view without the LinkedIn branch ────────────────
-- Same shape as before, minus the middle SELECT. The instagram and generic
-- branches are unchanged; the columns that only existed to carry LinkedIn's
-- hook/body/post_type are kept as NULL so every consumer's column list still
-- resolves. Dropping them is a separate, wider change.
create or replace view public.scheduled_posts as
 SELECT 'instagram_generated_posts'::text AS post_table,
    'instagram'::text AS platform,
    p.id, p.workspace_id, p.caption, p.caption_ar, p.caption_en, p.hashtags,
    p.first_comment,
    NULL::text AS hook,
    NULL::text AS body,
    p.topic, p.post_kind, p.style, p.tone, p.aspect_ratio,
    NULL::text AS format,
    CASE WHEN COALESCE(p.video_url, ''::text) <> ''::text THEN 'video'::text
         ELSE 'image'::text END AS media_type,
    p.image_url, p.image_urls, p.image_prompt, p.video_url, p.cover_image_url,
    p.motion_prompt, p.post_strategy,
    NULL::text AS post_type,
    NULL::boolean AS include_image,
    NULL::text AS content_route,
    p.scheduled_date, p.publish_time, p.status, p.source, p.plan_id,
    p.plan_idea_id, p.campaign_id, p.creative_session_id, p.creative_version_id,
    p.zernio_post_id, p.zernio_account_id, p.publish_status, p.published_at,
    p.scheduled_publish_at, p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
   FROM public.instagram_generated_posts p
UNION ALL
 SELECT 'generated_posts'::text AS post_table,
    p.platform,
    p.id, p.workspace_id, p.caption, p.caption_ar, p.caption_en, p.hashtags,
    p.first_comment,
    NULL::text AS hook,
    NULL::text AS body,
    p.topic, p.post_kind, p.style,
    NULL::text AS tone,
    p.aspect_ratio, p.format, p.media_type,
    p.image_url, p.image_urls, p.image_prompt, p.video_url, p.cover_image_url,
    p.motion_prompt,
    NULL::text AS post_strategy,
    NULL::text AS post_type,
    NULL::boolean AS include_image,
    NULL::text AS content_route,
    p.scheduled_date, p.publish_time, p.status, p.source, p.plan_id,
    p.plan_idea_id, p.campaign_id::text AS campaign_id,
    p.creative_session_id, p.creative_version_id,
    p.zernio_post_id, p.zernio_account_id, p.publish_status, p.published_at,
    p.scheduled_publish_at, p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
   FROM public.generated_posts p;

-- 2) ── Drop the LinkedIn tables ──────────────────────────────────────────
-- linkedin_generated_posts (6 rows), linkedin_schedule (6), and
-- linkedin_manual_posts (1) — the last two backed the dead manual/schedule
-- pages that no workflow has served for some time.
drop table if exists public.linkedin_generated_posts cascade;
drop table if exists public.linkedin_schedule        cascade;
drop table if exists public.linkedin_manual_posts    cascade;

-- 3) ── Plan ideas ────────────────────────────────────────────────────────
delete from public.plan_ideas where platform = 'linkedin';

-- An idea that merely TARGETED LinkedIn alongside Instagram keeps the idea and
-- loses only the dead target, rather than being deleted along with it.
update public.plan_ideas
set platforms = array_remove(platforms, 'linkedin')
where 'linkedin' = any(platforms);

-- 4) ── Analytics ─────────────────────────────────────────────────────────
delete from public.post_analytics where platform = 'linkedin';

-- ════════════════════════════════════════════════════════════════════════
-- Done. No LinkedIn tables, rows, or view branches remain.
-- ════════════════════════════════════════════════════════════════════════
