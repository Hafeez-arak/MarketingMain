-- ════════════════════════════════════════════════════════════════════════
-- social_accounts.login_method — which Instagram connection an account has
--
-- Instagram can be connected two ways, and the difference is invisible
-- everywhere except one place that matters:
--
--   instagram_login (the default) — connects the professional account
--     directly, `instagram_business_*` scopes, no Page picker.
--   facebook_login — authorises through the linked Facebook Page,
--     `instagram_*` plus `pages_show_list` / `pages_read_engagement` /
--     `business_management`, and a Page selection step.
--
-- Publishing, analytics, comments and the inbox behave IDENTICALLY either
-- way. Catalog audio does not: attaching a track to a Reel on an account
-- connected with Instagram Login fails with a 400 and
-- `instagram_audio_requires_facebook_login`. The Meta Ads add-on is the same
-- story — it can ride on a facebook_login connection instead of needing a
-- separate Facebook account.
--
-- So this column exists to answer one question before the user hits that
-- 400: can THIS account use catalog audio? Without it the composer would
-- have to offer the audio picker to every account and let Instagram refuse
-- half of them after the fact, which is the worst possible moment to find
-- out — the Reel is already composed.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.social_accounts
  add column if not exists login_method text;

comment on column public.social_accounts.login_method is
  'Instagram only: ''facebook_login'' or ''instagram_login''. Catalog audio and the Ads add-on require facebook_login. NULL means connected before this was recorded — treated as instagram_login, i.e. no catalog audio.';

-- Deliberately NOT backfilled to a guess.
--
-- Existing rows are NULL, and NULL is read as "assume no catalog audio". That
-- is the safe direction: an account that CAN do audio but is not offered it
-- is a missing feature someone will ask about, whereas an account that is
-- offered audio it cannot use is a composed Reel that fails at publish.
--
-- In practice every row predating this migration really is instagram_login,
-- because facebook_login was never requested until now — but the column
-- records what we know rather than what we assume, and a reconnect fills it
-- in truthfully. See the reconnect prompt in ConnectAccounts.jsx.
create index if not exists social_accounts_login_method_idx
  on public.social_accounts(workspace_id, platform, login_method)
  where platform = 'instagram';


-- ════════════════════════════════════════════════════════════════════════
-- Verify:
--   select platform, login_method, count(*)
--     from public.social_accounts group by 1,2;
--   -> instagram rows are NULL until each is reconnected
-- ════════════════════════════════════════════════════════════════════════
