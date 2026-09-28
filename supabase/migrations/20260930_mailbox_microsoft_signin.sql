-- ════════════════════════════════════════════════════════════════════════
-- Email: Microsoft 365 outreach mailboxes, connected by signing in
-- ════════════════════════════════════════════════════════════════════════
-- The company's own Microsoft 365 accounts (renamed former-employee accounts
-- on arak-sa.com, the owner's decision of 2026-09-28) as outreach senders.
-- Someone signs in as the mailbox once; the server keeps the refresh token,
-- sealed in email_mailbox_secrets like an app password, and sends and reads
-- through Microsoft Graph (api/email/_graph.js), not SMTP/IMAP.
--
--   provider 'microsoft'   smtp_*/imap_* stay empty; the secret is a sealed
--                          JSON { rt, at, exp } of Microsoft tokens.
--
-- Also the two columns the inbox reader needs:
--   email_sends.thread_id           Microsoft's conversationId of the send;
--                                   a reply or bounce arrives in the same one.
--   email_mailboxes.inbox_checked_at  where the last read of the inbox stopped.
--
-- Run ONCE. Idempotent.

alter table public.email_mailboxes
  drop constraint if exists email_mailboxes_provider_check;
alter table public.email_mailboxes
  add constraint email_mailboxes_provider_check check (provider in ('smtp','instantly','microsoft'));

alter table public.email_mailboxes
  add column if not exists inbox_checked_at timestamptz;

alter table public.email_sends
  add column if not exists thread_id text;

create index if not exists email_sends_mailbox_thread_idx
  on public.email_sends (mailbox_id, thread_id)
  where thread_id is not null;

notify pgrst, 'reload schema';
