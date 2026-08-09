-- ════════════════════════════════════════════════════════════════════════
-- Zernio publishing + analytics
--
-- Zernio (https://docs.zernio.com) is a unified social-publishing API —
-- one REST surface for Instagram/LinkedIn/TikTok/Snapchat/etc — used here
-- so the MVP ships without building four separate platform OAuth +
-- publishing integrations. It is deliberately an ADAPTER, not a dependency
-- the rest of the app knows about: everything below stores the Zernio id
-- alongside our own row, so swapping providers later (Ayrshare's SDK is
-- wire-compatible, which is part of why Zernio was chosen) means changing
-- one workflow, not the schema or the UI.
--
-- Three parts:
--   1. publish tracking on the three generated-post tables
--   2. social_accounts — local cache of Zernio's connected accounts
--   3. post_analytics — per-day metric snapshots pulled back from Zernio
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Publish tracking ─────────────────────────────────────────────────
-- NOTE: publish_status is deliberately SEPARATE from the existing `status`
-- column. `status` is the human review decision (pending_review →
-- pending_publish → rejected); publish_status is what the platform
-- actually did with it. Conflating them was tempting but wrong: a post can
-- be approved (status=pending_publish) and still have failed to publish,
-- and that distinction is exactly what an operator needs to see.
--
-- zernio_post_id is the join key for everything in part 3 — it's what
-- Zernio's analytics endpoints accept, so analytics rows are matched back
-- to our posts through it rather than through our own uuid.

do $$
declare t text;
begin
  foreach t in array array[
    'instagram_generated_posts',
    'linkedin_generated_posts',
    'generated_posts'
  ] loop
    execute format($f$
      alter table public.%I
        add column if not exists zernio_post_id       text    default '',
        add column if not exists publish_status       text    default 'not_published',
        add column if not exists published_at         timestamptz,
        add column if not exists scheduled_publish_at timestamptz,
        add column if not exists publish_error        text    default '',
        add column if not exists platform_post_url    text    default '';
    $f$, t);

    execute format($f$
      alter table public.%I drop constraint if exists %I;
    $f$, t, t || '_publish_status_check');

    execute format($f$
      alter table public.%I add constraint %I
        check (publish_status in ('not_published','scheduled','publishing','published','failed'));
    $f$, t, t || '_publish_status_check');

    -- Partial index: only published/scheduled rows are ever looked up by
    -- Zernio id (the analytics sync's join), and those are a small subset.
    execute format($f$
      create index if not exists %I on public.%I(zernio_post_id)
        where zernio_post_id <> '';
    $f$, t || '_zernio_id_idx', t);
  end loop;
end $$;


-- ── 2. social_accounts ──────────────────────────────────────────────────
-- A local mirror of GET /v1/accounts. Cached rather than fetched live on
-- every render for two reasons: the frontend must never hold the Zernio
-- API key (it's a server-side secret living in n8n's env, same as every
-- other key in this project), and the publish flow needs a stable
-- accountId to target without a round-trip through n8n just to list
-- accounts.
--
-- zernio_account_id is Zernio's `_id`. UNIQUE per workspace so the sync
-- can upsert idempotently.

create table if not exists public.social_accounts (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,

  zernio_account_id  text not null,
  platform           text not null,
  username           text default '',
  display_name       text default '',
  profile_picture    text default '',
  profile_url        text default '',

  is_active          boolean default true,
  needs_reconnection boolean default false,
  followers_count    integer default 0,

  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (workspace_id, zernio_account_id)
);

create index if not exists social_accounts_ws_idx       on public.social_accounts(workspace_id);
create index if not exists social_accounts_platform_idx on public.social_accounts(workspace_id, platform);

alter table public.social_accounts enable row level security;

drop policy if exists social_accounts_rw on public.social_accounts;
create policy social_accounts_rw on public.social_accounts
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));


-- ── 3. post_analytics ───────────────────────────────────────────────────
-- One row per (post, platform, day) — the shape GET /v1/analytics/post-
-- timeline returns. Stored as a daily TIME SERIES rather than a single
-- current-totals row on the post itself, because engagement accumulating
-- over time is the actual interesting signal (Zernio even exposes a
-- /content-decay endpoint for it), and a totals column would throw that
-- away. Current totals are just the latest row per post.
--
-- Metrics are all nullable-with-0-default on purpose: no platform returns
-- every metric (saves is Instagram-ish, views is video-ish), and a missing
-- metric must not be confused with a real zero — see metrics_present.

create table if not exists public.post_analytics (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,

  -- Join keys. zernio_post_id is authoritative (it's what Zernio's API
  -- speaks); post_table + post_id point back at OUR row so the UI can go
  -- from a metric to the post without a second lookup table.
  zernio_post_id    text not null,
  platform          text not null,
  platform_post_id  text default '',
  post_table        text default '',
  post_id           uuid,

  metric_date       date not null,

  impressions       integer default 0,
  reach             integer default 0,
  likes             integer default 0,
  comments          integer default 0,
  shares            integer default 0,
  saves             integer default 0,
  clicks            integer default 0,
  views             integer default 0,

  -- Which of the above the platform actually reported for this row, so a
  -- genuine 0 is distinguishable from "this platform doesn't measure it".
  -- Without this, averaging `saves` across platforms silently treats every
  -- LinkedIn post as a post with zero saves.
  metrics_present   text[] default '{}',

  synced_at         timestamptz not null default now(),

  unique (zernio_post_id, platform, metric_date)
);

create index if not exists post_analytics_ws_idx    on public.post_analytics(workspace_id);
create index if not exists post_analytics_post_idx  on public.post_analytics(post_id) where post_id is not null;
create index if not exists post_analytics_date_idx  on public.post_analytics(workspace_id, metric_date desc);

alter table public.post_analytics enable row level security;

drop policy if exists post_analytics_rw on public.post_analytics;
create policy post_analytics_rw on public.post_analytics
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
