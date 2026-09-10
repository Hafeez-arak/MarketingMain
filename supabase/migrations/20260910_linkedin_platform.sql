-- ════════════════════════════════════════════════════════════════════════
-- LinkedIn, as a fourth platform
-- ════════════════════════════════════════════════════════════════════════
-- LinkedIn was REMOVED on 2026-08-16, not hidden: its three tables were
-- dropped, its rows deleted, its n8n workflows retired to `retired-*` paths.
-- (See 20260819_remove_linkedin.sql, which did the view rebuild and the
-- drops.) So bringing it back is new schema, not un-hiding old schema — and
-- deliberately far less of it than there was before.
--
-- What is NOT coming back: linkedin_generated_posts, linkedin_schedule and
-- linkedin_manual_posts. LinkedIn posts live in `generated_posts` alongside
-- Instagram and TikTok, the way every platform added since does. One table,
-- one publish path, one analytics shape — the whole reason those three
-- tables were a mistake the first time.
--
-- Idempotent + additive. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. generated_posts.platform ─────────────────────────────────────────
-- The check constraint is the only thing in the schema that enumerates
-- platforms, which makes it the only thing that has to change to admit a
-- new one — and the thing that fails LOUDLY if it is forgotten. That is
-- the design: an insert of a LinkedIn post today is rejected by Postgres
-- rather than accepted into a column nothing downstream understands.
--
-- Dropped and recreated rather than altered: Postgres has no ALTER for a
-- check constraint's expression, and adding a second constraint would mean
-- both must pass, which is the opposite of widening.
alter table public.generated_posts
  drop constraint if exists generated_posts_platform_check;

alter table public.generated_posts
  add constraint generated_posts_platform_check
  check (platform = any (array['instagram'::text, 'tiktok'::text, 'snapchat'::text, 'linkedin'::text]));

-- `scheduled_posts` is deliberately NOT rebuilt here. It selects
-- generated_posts.platform straight through, so a new permitted value needs
-- no view change — and every rebuild of that view is a chance to lose
-- `security_invoker = true`, which has silently leaked every workspace's
-- posts to every other workspace once already (20260821). Not touching it
-- is the safest correct answer.


-- ── 2. social_accounts.account_type ─────────────────────────────────────
-- LinkedIn is the only platform here where one OAuth grant can produce two
-- different publishing identities: the signed-in person's own profile, or a
-- company page they administer. Zernio models this as `accountType` on the
-- account and the two publish differently — an organisation post is authored
-- by the page, not by the person behind it.
--
-- Without this column the mirror would show "@acme-corp" for both and the
-- composer would have no way to tell them apart, which is a mistake nobody
-- can undo after the post is live.
--
-- Null for every other platform, and for LinkedIn rows connected before this
-- existed. Null means unknown, not personal: guessing "personal" would put a
-- confident, wrong label on exactly the rows we know least about.
alter table public.social_accounts
  add column if not exists account_type text;

alter table public.social_accounts
  drop constraint if exists social_accounts_account_type_check;

alter table public.social_accounts
  add constraint social_accounts_account_type_check
  check (account_type is null or account_type = any (array['personal'::text, 'organization'::text]));

comment on column public.social_accounts.account_type is
  'LinkedIn only: personal | organization. Null elsewhere and on rows predating the column. Decides who a post is authored by.';


-- ════════════════════════════════════════════════════════════════════════
-- Verify:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'generated_posts_platform_check';
--     -> includes 'linkedin'
--
--   select column_name from information_schema.columns
--    where table_name = 'social_accounts' and column_name = 'account_type';
--     -> one row
-- ════════════════════════════════════════════════════════════════════════
