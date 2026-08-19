-- ════════════════════════════════════════════════════════════════════════
-- Meta Graph API publishing + insights
--
-- Replaces Zernio as the ACTIVE publishing path with Instagram's own
-- Graph API, which is what the company requires: an official developer-
-- portal app, our own access token, no third party between us and Meta.
--
-- Zernio's tables, columns and workflows are left exactly as they are and
-- are simply not called any more. That was the plan from the start — see
-- the header of 20260809_zernio_publishing_analytics.sql, which says the
-- provider ids are "an ADAPTER, not a dependency the rest of the app knows
-- about ... swapping providers later means changing one workflow, not the
-- schema or the UI." This migration is that promise being cashed in, so it
-- is deliberately SMALL.
--
-- What the existing columns now mean on a Meta-published row:
--   zernio_post_id     -> the Instagram MEDIA id (e.g. 18100921226195738)
--   zernio_account_id  -> the Instagram BUSINESS ACCOUNT id (ig user id)
--   platform_post_url  -> the media's `permalink`
--
-- Renaming them was considered and rejected: the names are load-bearing in
-- the scheduled_posts view, four screens, the analytics join key and the
-- post_analytics unique constraint. A rename buys nicer identifiers and
-- costs a coordinated change across all of that, for a column whose value
-- is opaque either way. `publish_provider` below records which provider
-- actually produced the id, which is the part that was genuinely missing.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. Provenance + publish bookkeeping on the post tables ──────────────
--
-- publish_provider answers "who published this?" for a row that has a
-- zernio_post_id. Without it, a Zernio media id and an Instagram media id
-- are both just text in the same column, and any future reconciler would
-- have to guess which API to ask about it. Defaults to 'zernio' so every
-- EXISTING row keeps telling the truth; the Meta workflow writes 'meta'.
--
-- meta_container_id holds the media container between step 1 (create) and
-- step 2 (publish) of Instagram's two-step flow. It is written before the
-- publish call and is the only thing that makes a crash in that window
-- recoverable: a container survives 24h at Meta, so a run that died after
-- creating one can be finished rather than restarted (restarting would
-- upload the media a second time and risk a double post).
--
-- publish_started_at is stamped at claim time so a row stuck in
-- 'publishing' can be aged. `updated_at` cannot serve this — any unrelated
-- edit touches it, so a post stuck for an hour can look one second old.

do $$
declare t text;
begin
  foreach t in array array['instagram_generated_posts','generated_posts'] loop
    if to_regclass('public.' || t) is null then continue; end if;

    execute format($f$
      alter table public.%I
        add column if not exists publish_provider   text default 'zernio',
        add column if not exists meta_container_id  text default '',
        add column if not exists publish_started_at timestamptz;
    $f$, t);

    -- The sweeper's hot query: "everything due, right now". Partial, because
    -- 'scheduled' is a small slice of a table that is mostly drafts and
    -- already-published rows.
    execute format($f$
      create index if not exists %I on public.%I(scheduled_publish_at)
        where publish_status = 'scheduled';
    $f$, t || '_due_idx', t);
  end loop;
end $$;


-- ── 2. Provenance on the analytics rows ─────────────────────────────────
alter table public.post_analytics
  add column if not exists publish_provider text default 'zernio';

alter table public.social_accounts
  add column if not exists publish_provider text default 'zernio';


-- ── 3. account_analytics — the account-level daily series ───────────────
--
-- New table rather than more columns on post_analytics, because these are
-- measurements of the ACCOUNT, not of any post: followers, profile views,
-- accounts reached across all content including stories and ads. Hanging
-- them off a post row would mean either duplicating them onto every post
-- of that day or inventing a fake post to own them.
--
-- This exists at all because Zernio served the follower-history and daily-
-- rollup charts from its own pre-aggregated endpoints. Meta has no such
-- thing: /insights returns a snapshot for a window you ask about, and
-- nothing is retained for you. So the daily series is one we accumulate
-- ourselves, one row per account per day — which is also what makes the
-- "engagement accumulation" chart possible, since that needs yesterday's
-- numbers to compare today's against.
--
-- followers_count is taken from the account's own profile field rather
-- than the follower_count insight metric on purpose: the insight metric
-- returns an empty series on small accounts (verified against the test
-- account, which has 1 follower and gets `data: []`), while the profile
-- field is always populated. A chart that silently blanks below some
-- follower threshold is worse than one that is merely flat.

create table if not exists public.account_analytics (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,

  -- Matches social_accounts.zernio_account_id — the ig user id under Meta.
  account_id         text not null,
  platform           text not null default 'instagram',
  publish_provider   text not null default 'meta',

  metric_date        date not null,

  followers_count    integer default 0,
  follows_count      integer default 0,
  media_count        integer default 0,

  reach              integer default 0,
  views              integer default 0,
  profile_views      integer default 0,
  accounts_engaged   integer default 0,
  total_interactions integer default 0,
  likes              integer default 0,
  comments           integer default 0,
  saves              integer default 0,
  shares             integer default 0,
  clicks             integer default 0,

  -- Same contract as post_analytics.metrics_present: which of the above the
  -- platform actually reported, so a real 0 is distinguishable from "not
  -- measured". Instagram genuinely returns 0 for a quiet day AND omits
  -- metrics it does not support for the account type, and averaging those
  -- together is how a dashboard starts lying.
  metrics_present    text[] default '{}',

  synced_at          timestamptz not null default now(),

  unique (workspace_id, account_id, metric_date)
);

create index if not exists account_analytics_ws_idx
  on public.account_analytics(workspace_id, metric_date desc);

alter table public.account_analytics enable row level security;

drop policy if exists account_analytics_rw on public.account_analytics;
create policy account_analytics_rw on public.account_analytics
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
