-- ─── Auto-replies go live: the switch, each mailbox's signature, one per lead
-- 2026-10-29. Qualified leads get one short reply 15–20 minutes after their
-- email arrives (api/leads/_reply.js), from the mailbox it came to, with that
-- mailbox's own Outlook signature.
--
-- lead_agent_settings.auto_reply_since: null = auto-replies off. Switching
-- them on stores the moment, and only leads that arrive after it are
-- answered, so turning it on never replies to a backlog.
--
-- lead_mailboxes.reply_signature: the mailbox's Outlook signature. Outlook
-- keeps signatures where the API cannot read them, so it is copied from a
-- draft or sent email in that mailbox ("Copy signature from Outlook" on Agent
-- settings, or scripts/lead-qualifier/copy-signature.mjs): its
-- <div id="Signature"> HTML plus the inline pictures it points at.
--   { html, images: [{ cid, name, type, bytes (base64) }], copied_from, copied_at }
-- Empty means "not copied yet": the reply then ends with a plain
-- "Best Regards, / ARAK Lighting".
--
-- lead_replies: at most one real reply per lead (test rows aside), so two
-- rounds running at once can never queue the same lead twice.
--
-- Applied by hand. Safe to re-run.

alter table public.lead_agent_settings add column if not exists auto_reply_since timestamptz;

alter table public.lead_mailboxes add column if not exists reply_signature jsonb not null default '{}'::jsonb;

create unique index if not exists lead_replies_one_real_per_lead
  on public.lead_replies (lead_id) where status <> 'test';

create index if not exists lead_replies_due on public.lead_replies (workspace_id, send_after) where status = 'due';
