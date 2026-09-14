-- ─── social_accounts.is_protected — the account nobody may publish to ──────
--
-- ARAK Lighting's LinkedIn is the company's REAL, official page. Instagram in
-- this workspace is @lightingaaa, a test account with one follower that has
-- been connected, disconnected and reconnected three times while this product
-- was built. The two have been treated identically by every code path, and
-- that is the whole problem: every guard rail here was written for a channel
-- where a mistake costs nothing, and one of the channels is now a real
-- audience the business cannot un-post to.
--
-- So the account carries the rule, rather than the rule living only in
-- whichever screen happens to be in front of someone.
--
-- WHY A COLUMN AND NOT ONLY A CODE CHECK:
--
-- Both, deliberately, and they cover different failures.
--
-- The code check (PROTECTED_PLATFORMS in src/lib/platformSafety.js) is keyed
-- on the PLATFORM, so it cannot be defeated by reconnecting: a new LinkedIn
-- row inserted tomorrow is still LinkedIn, and a fresh row defaulting to
-- is_protected=false would otherwise silently drop the protection at exactly
-- the moment someone is fiddling with the connection. Reconnection is how this
-- workspace's Instagram ended up with three rows, so it is not hypothetical.
--
-- The column is what makes the state VISIBLE and per-account: it can be read
-- by a query, shown in the UI, audited, and — when the business decides
-- LinkedIn publishing should be turned on — cleared for one named account by a
-- person, rather than by deleting a line of code and redeploying.
--
-- Neither alone is enough. A column alone loses the rule on reconnect; a code
-- check alone leaves no way to see or change it without a deploy.
--
-- Additive and defaulted false, so every existing row keeps exactly the
-- behaviour it has today. The only row this migration flips is LinkedIn's, at
-- the bottom, and that flip is scoped by platform rather than by id so it is
-- correct whichever row is live when it runs.

alter table public.social_accounts
  add column if not exists is_protected boolean not null default false;

comment on column public.social_accounts.is_protected is
  'Publishing and disconnecting are refused for this account. Set for real '
  'company pages whose audience cannot be un-posted to. Enforced server-side '
  'in api/zernio/[action].js and in the n8n publish workflow, not only in the '
  'browser. See src/lib/platformSafety.js — LinkedIn is additionally protected '
  'by platform so that reconnecting cannot clear the flag.';

create index if not exists social_accounts_protected_idx
  on public.social_accounts(workspace_id, platform)
  where is_protected;

-- Every LinkedIn account, in every workspace, present and future-proofed by
-- the platform check in code. Written as an UPDATE rather than a one-row fix
-- so that re-running this migration after a reconnection re-asserts it.
update public.social_accounts
   set is_protected = true
 where platform = 'linkedin'
   and is_protected is distinct from true;
