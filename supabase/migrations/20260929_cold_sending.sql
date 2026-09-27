-- ════════════════════════════════════════════════════════════════════════
-- Email: the cold lane sends, from our own outreach mailboxes
-- ════════════════════════════════════════════════════════════════════════
-- Until now a cold campaign could be written but not sent. This adds the
-- mailboxes it is sent FROM: real mailboxes (Google, bought through any
-- seller) on a separate outreach domain, connected with an app password and
-- driven over SMTP (send) and IMAP (read replies and bounces).
--
-- Never Resend, never arak-sa.com. The server refuses a mailbox on the
-- marketing domain, on the signed-in person's own domain, or on a free-mail
-- domain, and the marketing sender still refuses every cold campaign.
--
-- `provider` exists so a second way of sending (Instantly) can sit beside
-- this one later without a rewrite. Only 'smtp' is built.
--
-- Run ONCE. Idempotent.

create table if not exists public.email_mailboxes (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  provider            text not null default 'smtp' check (provider in ('smtp','instantly')),
  email               text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  from_name           text not null default '',
  -- Plain text under every email from this mailbox: name, role, phone.
  signature           text not null default '',
  smtp_host           text not null default '',
  smtp_port           int  not null default 465 check (smtp_port between 1 and 65535),
  imap_host           text not null default '',
  imap_port           int  not null default 993 check (imap_port between 1 and 65535),
  username            text not null default '',
  -- The most this mailbox may send in a day, AFTER the ramp. 40 is also a
  -- hard ceiling in code (src/lib/email/cold.js); the check is the backstop.
  daily_limit         int  not null default 15 check (daily_limit between 0 and 40),
  -- The day the warm-up service started on this mailbox. Cold sending waits
  -- until two weeks after it; null means warm-up has not been started.
  warmup_started_on   date,
  -- The first real cold send. The ramp (5/day, then 10/day, then the limit)
  -- counts from here.
  first_sent_on       date,
  last_sent_at        timestamptz,
  -- Not before this moment: the random gap between two sends. Moved forward
  -- in one conditional PATCH before a send, which is also the claim that
  -- stops two overlapping runs sending from the same mailbox at once.
  next_send_at        timestamptz,
  status              text not null default 'active' check (status in ('active','paused','error')),
  -- Why it stopped: a person paused it, the bounce brake did, or the login
  -- failed. Shown next to the mailbox.
  status_reason       text not null default '',
  last_error          text not null default '',
  last_checked_at     timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists email_mailboxes_ws_email_idx
  on public.email_mailboxes (workspace_id, email);

-- The app password, encrypted (AES-256-GCM, api/email/_secrets.js). Its own
-- table with RLS on and NO policy: only the service key reads it, so neither
-- a signed-in person nor the anon key can ever select it, even by mistake in
-- a `select('*')` on the mailbox.
create table if not exists public.email_mailbox_secrets (
  mailbox_id    uuid primary key references public.email_mailboxes(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  secret        text not null,
  updated_at    timestamptz not null default now()
);

-- Which mailboxes a cold campaign may send from. Empty = any active one.
alter table public.email_campaigns
  add column if not exists mailbox_ids uuid[] not null default '{}';

-- Which mailbox sent a row, and the Message-ID it went out with. Follow-ups
-- reply to that id (In-Reply-To / References), so they arrive in the same
-- thread; the inbox reader matches replies and bounces back to it.
alter table public.email_sends
  add column if not exists mailbox_id uuid references public.email_mailboxes(id) on delete set null;
alter table public.email_sends
  add column if not exists message_id text;
alter table public.email_sends
  add column if not exists replied_at timestamptz;

create index if not exists email_sends_mailbox_sent_idx
  on public.email_sends (mailbox_id, sent_at desc);
create index if not exists email_sends_message_id_idx
  on public.email_sends (message_id);

-- The cold lane's master switch, off until someone turns it on. Off is also
-- the emergency stop: the sender checks it before every email.
alter table public.email_settings
  add column if not exists cold_sending_enabled boolean not null default false;

-- ── RLS ──
-- Members may read mailboxes; every write goes through the server, which
-- checks the domain, verifies the login and keeps the limits.
alter table public.email_mailboxes        enable row level security;
alter table public.email_mailbox_secrets  enable row level security;

drop policy if exists email_mailboxes_read on public.email_mailboxes;
create policy email_mailboxes_read on public.email_mailboxes
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

-- email_mailbox_secrets: deliberately no policy at all.

-- ── Per-campaign numbers, now with replies ──
-- Drop and create (not create-or-replace) so security_invoker is set on the
-- new view for certain; see 20260821_restore_scheduled_posts_rls.sql.
drop view if exists public.email_campaign_stats;
create view public.email_campaign_stats
with (security_invoker = true) as
select
  s.campaign_id,
  s.workspace_id,
  count(*)                                                        as total,
  count(*) filter (where s.status = 'queued')                     as queued,
  count(*) filter (where s.sent_at is not null)                   as sent,
  count(*) filter (where s.delivered_at is not null)              as delivered,
  count(*) filter (where s.opened_at is not null)                 as opened,
  count(*) filter (where s.clicked_at is not null)                as clicked,
  count(*) filter (where s.bounced_at is not null)                as bounced,
  count(*) filter (where s.complained_at is not null)             as complained,
  count(*) filter (where s.status in ('failed','skipped'))        as failed,
  count(*) filter (where s.replied_at is not null)                as replied
from public.email_sends s
group by s.campaign_id, s.workspace_id;

notify pgrst, 'reload schema';
