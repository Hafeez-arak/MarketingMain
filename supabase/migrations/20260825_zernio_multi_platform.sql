-- ════════════════════════════════════════════════════════════════════════
-- Zernio multi-platform: per-workspace OAuth profiles + composer options
--
-- Two things this unlocks.
--
-- 1. PER-WORKSPACE OAUTH. Until now the Zernio API key in n8n's env was the
--    whole story: one team, one bag of accounts, no notion of whose they
--    were. Zernio's multi-tenant model puts a `profile` between the team and
--    the accounts — one profile per customer, accounts connected inside it,
--    and the mapping held in OUR database. `workspaces.zernio_profile_id` is
--    that mapping. With it, GET /accounts?profileId=X returns exactly one
--    workspace's accounts, and a workspace can connect Instagram/TikTok
--    itself through a normal OAuth redirect instead of someone adding the
--    account by hand on zernio.com.
--
-- 2. THE COMPOSER. Zernio's create-post body carries a nested
--    `platformSpecificData` (Instagram: firstComment, collaborators,
--    userTags, shareToFeed, thumbOffset, isAiGenerated…) and a top-level
--    `tiktokSettings` (privacy_level, allow_comment/duet/stitch, the two
--    mandatory consent flags…). Those are stored here as ONE jsonb blob per
--    post rather than fifteen columns, for the same reason
--    20260810_workspace_webhooks.sql gave for `webhooks jsonb`: the shape is
--    the provider's, not ours, and every option Zernio adds would otherwise
--    be a migration. Nothing in the app filters or joins on these — they are
--    read whole, handed to the publish workflow whole, and that is all.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. workspaces.zernio_profile_id ─────────────────────────────────────
-- Nullable on purpose, and NOT backfilled. A profile is created lazily, the
-- first time someone in the workspace presses Connect (see
-- src/lib/zernioConnect.js). Provisioning one for every workspace up front
-- would create Zernio-side objects for workspaces that never connect an
-- account, and profile names must be unique per team — so a failed backfill
-- is a name collision to untangle rather than a no-op to retry.
--
-- text, not uuid: this is Zernio's `_id`, a Mongo ObjectId string.
alter table public.workspaces
  add column if not exists zernio_profile_id text;

comment on column public.workspaces.zernio_profile_id is
  'Zernio profile _id for this workspace. Created lazily on first account connect; every /connect and /accounts call is scoped by it. Null means nothing has ever been connected here.';

-- One workspace per profile and one profile per workspace. Partial, because
-- null is the normal resting state and many workspaces share it.
create unique index if not exists workspaces_zernio_profile_idx
  on public.workspaces(zernio_profile_id)
  where zernio_profile_id is not null;


-- ── 2. generated_posts.platform_options ─────────────────────────────────
-- Shape mirrors the publish payload:
--   {
--     "instagram": { "contentType": "reel", "firstComment": "...",
--                    "collaborators": ["a","b"], "shareToFeed": true,
--                    "thumbOffset": 1500, "isAiGenerated": true,
--                    "userTags": [{ "username":"x","x":0.4,"y":0.6 }],
--                    "altText": "..." },
--     "tiktok":    { "privacy_level": "PUBLIC_TO_EVERYONE",
--                    "allow_comment": true, "allow_duet": true,
--                    "allow_stitch": true, "video_made_with_ai": true,
--                    "video_cover_timestamp_ms": 1000 }
--   }
--
-- Keyed by platform even though a post row is single-platform, so that a
-- draft retargeted from Instagram to TikTok keeps both sets of choices
-- instead of silently losing the first one.
--
-- The two TikTok consent flags (content_preview_confirmed,
-- express_consent_given) are deliberately NOT stored: TikTok requires them
-- to be true at publish time, and persisting a "yes" from last week to
-- reuse on a post nobody looked at defeats the point of asking. The
-- composer collects them per publish; the workflow refuses without them.
alter table public.generated_posts
  add column if not exists platform_options jsonb not null default '{}'::jsonb;

comment on column public.generated_posts.platform_options is
  'Per-platform publish options, keyed by platform. Handed to the publish workflow as-is — see Zernio platformSpecificData / tiktokSettings. Never filtered or joined on.';


-- ── 3. generated_posts.tags ─────────────────────────────────────────────
-- Team-only organisational labels ("ramadan", "product-launch"). Never sent
-- to any platform — these exist so the calendar and Approvals can be
-- filtered by something the team chose, which campaign_id cannot do because
-- not every post belongs to a campaign.
--
-- text[] rather than a tags table plus a join table: there is no tag entity
-- worth having (no colour, no owner, no description), the distinct set is
-- one unnest away, and renaming one is an update over a small table.
alter table public.generated_posts
  add column if not exists tags text[] not null default '{}';

comment on column public.generated_posts.tags is
  'Team-only organisational labels. Never sent to any platform.';

-- GIN so "show me everything tagged ramadan" stays an index scan as the
-- table grows. Cheap: the array is short and rarely rewritten.
create index if not exists generated_posts_tags_idx
  on public.generated_posts using gin (tags);


-- ── 4. social_accounts: connection provenance ───────────────────────────
-- `connected_at` is when OAUTH completed, which is not created_at: the sync
-- upserts these rows, so created_at is "when we first mirrored this account"
-- and survives a disconnect/reconnect cycle unchanged. Knowing when the
-- token was actually granted is what makes "reconnect, it has been 58 days"
-- answerable — Instagram's long-lived tokens expire at 60.
alter table public.social_accounts
  add column if not exists connected_at timestamptz;

-- Which Zernio profile this account hangs off. Denormalised from
-- workspaces.zernio_profile_id on purpose: the account.connected webhook
-- arrives carrying { accountId, profileId } and nothing else, so the handler
-- needs to resolve profile → workspace. Without this it is a join back
-- through workspaces on every webhook; with it the row is self-describing,
-- and a mismatch between the two is a loud, detectable bug rather than a
-- silent cross-workspace write.
alter table public.social_accounts
  add column if not exists zernio_profile_id text;

create index if not exists social_accounts_profile_idx
  on public.social_accounts(zernio_profile_id)
  where zernio_profile_id is not null;


-- ── 5. Rebuild scheduled_posts so the new columns are visible ───────────
--
-- ⚠️  DROP + CREATE, never CREATE OR REPLACE. `create or replace view`
-- RESETS reloptions, and that is precisely how `security_invoker = true`
-- was silently lost once already, making every workspace's posts readable
-- by every other. See 20260821_restore_scheduled_posts_rls.sql. The clause
-- is load-bearing; it stays on every rebuild, including this one.
--
-- Body below is 20260823's verbatim, plus platform_options and tags in each
-- branch. The frozen instagram_generated_posts branch pads with EMPTY rather
-- than NULL: that table predates the composer and genuinely has no options,
-- and empty means every reader can do `opts.instagram?.firstComment` without
-- a null guard that would only ever be there for 21 historical rows.
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
    '{}'::jsonb   as platform_options,
    '{}'::text[]  as tags,
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
    p.platform_options,
    p.tags,
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
--
--   select column_name from information_schema.columns
--    where table_name='scheduled_posts' and column_name in ('platform_options','tags');
--     -> both rows present
--
--   select count(*) from public.workspaces where zernio_profile_id is not null;
--     -> 0 immediately after this migration; profiles are created on first connect
-- ════════════════════════════════════════════════════════════════════════
