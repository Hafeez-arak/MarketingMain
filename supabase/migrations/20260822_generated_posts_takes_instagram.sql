-- ════════════════════════════════════════════════════════════════════════
-- generated_posts becomes the single forward table for every platform
-- ════════════════════════════════════════════════════════════════════════
-- Part of retiring the three Instagram generation workflows. Creative Studio
-- is now the only path that makes a post, and it writes through
-- studioBridge's PLATFORM_TABLE — so Instagram stops being a special case
-- with its own table and joins tiktok/snapchat in generated_posts.
--
-- Safe to do now, and only now: generated_posts is EMPTY (0 rows, checked in
-- production before writing this), so widening its CHECK and adding columns
-- cannot conflict with existing data.
--
-- The 21 rows already in instagram_generated_posts are LEFT WHERE THEY ARE,
-- deliberately — not migrated across:
--   • scheduled_posts already UNIONs both tables, so the calendar and
--     Approvals keep showing them with no code change.
--   • the single post_analytics row keeps pointing at a row that still
--     exists, instead of at a moved id.
--   • a copy is a second source of truth for history nobody edits.
-- instagram_generated_posts is therefore FROZEN: read, never written.
-- ════════════════════════════════════════════════════════════════════════

-- 1) ── Let Instagram into generated_posts ────────────────────────────────
-- The CHECK was ('tiktok','snapchat') because Instagram had its own table.
alter table public.generated_posts
  drop constraint if exists generated_posts_platform_check;

alter table public.generated_posts
  add constraint generated_posts_platform_check
  check (platform in ('instagram', 'tiktok', 'snapchat'));

-- 2) ── The two columns instagram_generated_posts had and this lacked ─────
-- Added for shape parity: with Instagram rows landing here, the two tables
-- the scheduled_posts view unions should expose the same columns rather than
-- one branch NULL-padding what the other carries for real.
--
-- Honest note for whoever does the Phase 6 cleanup pass: NEITHER of these has
-- a reader in src/ today. `tone` at least has a live producer (plan_ideas
-- carries it and Phase 3's per-platform voice work will want it on the post).
-- `post_strategy` was written only by the IG v2 workflow being deleted in this
-- same change — it is write-only history. If it is still unread when Phase 6
-- comes round, drop it rather than keeping it out of politeness.
--
-- reference_image_urls is deliberately NOT added: it was an IG-v2 workflow
-- artefact. The reference images that matter live on plan_ideas, which is
-- where IdeaDraftPanel and Creative Studio both already read them from.
alter table public.generated_posts add column if not exists tone           text;
alter table public.generated_posts add column if not exists post_strategy  text;

-- 3) ── Rebuild the union view so the generated_posts branch carries them ──
-- ⚠️  DROP + CREATE, never CREATE OR REPLACE — see
-- 20260821_restore_scheduled_posts_rls.sql. `create or replace view` RESETS
-- reloptions, which is exactly how `security_invoker = true` was silently
-- lost once already and every workspace's posts became readable by every
-- other. The clause below is load-bearing; keep it on every rebuild.
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
    p.zernio_post_id, p.zernio_account_id,
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
    p.zernio_post_id, p.zernio_account_id,
    p.publish_status, p.published_at, p.scheduled_publish_at,
    p.publish_error, p.platform_post_url,
    p.created_at, p.updated_at
  from public.generated_posts p;

grant select on public.scheduled_posts to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- Verify:
--   select relname, reloptions from pg_class where relname='scheduled_posts';
--     -> {security_invoker=true}   (NOT null — if null, the leak is back)
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'generated_posts_platform_check';
--     -> instagram, tiktok, snapchat
-- ════════════════════════════════════════════════════════════════════════
