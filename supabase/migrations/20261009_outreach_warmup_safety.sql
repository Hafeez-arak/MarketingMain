-- ─── Outreach: warm-up service, other organisations, domain check ─────────
-- The owner's plan (2026-10-08): three outreach senders, each on its own
-- company's Microsoft 365 (info@araklighting.com, info@clb-sa.com,
-- info@ghusnsa.com), warmed up by Instantly and sent from this app.
--
--   tenant          a mailbox on ANOTHER organisation's Microsoft 365 signs
--                   in at the shared "organizations" endpoint; its own
--                   tenant id is kept so renewals go back to it. '' = ours.
--   warmup_per_day  emails the warm-up service sends from this mailbox each
--                   day. They count against the mailbox's total for the day
--                   (src/lib/email/cold.js, HARD_MAX_TOTAL_PER_MAILBOX), so
--                   warm-up plus outreach never add up to a burst.
--   warmup_days     how long warm-up runs before the first outreach email:
--                   14 for an aged domain, 28 for a brand-new one.
--   dns_check       the sending domain's last check: MX, SPF, DKIM, DMARC,
--                   and what blocks sending. Refreshed by the sending run.
--
-- And the lead agent: a mailbox it reads may also be warmed up (info@clb-sa
-- .com). Warm-up emails carry the service's tag in the subject and body;
-- warmup_tag makes the agent skip them for free, before any model call.
--
-- Run ONCE. Idempotent.

alter table public.email_mailboxes add column if not exists tenant text not null default '';
alter table public.email_mailboxes add column if not exists warmup_per_day int not null default 0;
alter table public.email_mailboxes add column if not exists warmup_days int not null default 14;
alter table public.email_mailboxes add column if not exists dns_check jsonb not null default '{}'::jsonb;
alter table public.email_mailboxes add column if not exists dns_checked_at timestamptz;

alter table public.email_mailboxes drop constraint if exists email_mailboxes_warmup_per_day_check;
alter table public.email_mailboxes add constraint email_mailboxes_warmup_per_day_check check (warmup_per_day between 0 and 40);
alter table public.email_mailboxes drop constraint if exists email_mailboxes_warmup_days_check;
alter table public.email_mailboxes add constraint email_mailboxes_warmup_days_check check (warmup_days between 14 and 60);

alter table if exists public.lead_mailboxes add column if not exists warmup_tag text not null default '';
