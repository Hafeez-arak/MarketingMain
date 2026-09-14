-- ─── post_analytics for posts we did not publish ───────────────────────────
--
-- Measured live on 2026-09-14, against Arak's Instagram:
--
--   Zernio holds analytics for    9 posts
--   published through this app    2
--   posted directly on Instagram  7   <- stored nowhere, ever
--
-- The seven are the account's real history and hold most of its engagement —
-- the best of them has 2 likes and 7 impressions, while both posts this app
-- published sit at zero. Every reader in the product missed all of them, and
-- the brief reported the account as having almost no history.
--
-- The reason is structural rather than a bug in the sync. `post_analytics`
-- was designed as a mirror of OUR posts: `zernio_post_id` is NOT NULL and the
-- upsert key is (zernio_post_id, platform, metric_date). A post made straight
-- on Instagram has no Zernio post object at all — Zernio reports it with
-- `latePostId: null` — so there has never been a legal row shape for it. The
-- sync was not dropping these; it had nowhere to put them.
--
-- WHAT CHANGES:
--
--   1. `zernio_post_id` becomes nullable. It means "the Zernio post object we
--      published", and for an external post that genuinely does not exist.
--      Storing the platform's id there instead would make one column mean two
--      things depending on the row, which is the ambiguity that made
--      `post_id` unreliable in the first place (it pointed at whichever of two
--      tables `post_table` named, and readers joined on it blindly).
--
--   2. `origin` names which kind a row is. Not derived from
--      `zernio_post_id is null` at read time, because a derived rule has to be
--      re-derived identically by every reader, and the last one that was
--      silently disagreed for weeks.
--
--   3. A second partial unique index keys external rows by the PLATFORM's post
--      id, which is the only stable identifier they have. Partial so the
--      existing index keeps owning app-published rows unchanged — two total
--      unique indexes would fight over rows where both ids are present.
--
-- Strictly additive. Existing rows get origin='app', which is what they are,
-- and the existing unique index and every current query keep working
-- untouched.

alter table public.post_analytics
  alter column zernio_post_id drop not null;

alter table public.post_analytics
  add column if not exists origin text not null default 'app';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'post_analytics_origin_check'
  ) then
    alter table public.post_analytics
      add constraint post_analytics_origin_check
      check (origin in ('app', 'external'));
  end if;
end $$;

comment on column public.post_analytics.origin is
  '"app" — published through this product, keyed by zernio_post_id. '
  '"external" — posted directly on the platform, measured by Zernio but never '
  'published by us; zernio_post_id is null and platform_post_id is the key.';

-- An external row must be identifiable, or the upsert has nothing to conflict
-- on and every sync inserts duplicates.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'post_analytics_external_identified'
  ) then
    alter table public.post_analytics
      add constraint post_analytics_external_identified
      check (
        origin <> 'external'
        or (platform_post_id is not null and platform_post_id <> '')
      );
  end if;
end $$;

create unique index if not exists post_analytics_external_key
  on public.post_analytics(workspace_id, platform, platform_post_id, metric_date)
  where origin = 'external';

create index if not exists post_analytics_origin_idx
  on public.post_analytics(workspace_id, origin);

-- Existing rows predate the column and are all app-published, which the
-- default already gave them. Stated explicitly so the migration is honest
-- about touching nothing: this is a no-op today and a safety net if the
-- default is ever changed.
update public.post_analytics
   set origin = 'app'
 where origin is null;
