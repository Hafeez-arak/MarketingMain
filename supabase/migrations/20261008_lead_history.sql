-- ─── Lead agent: three sources, new leads from 1 Oct, Jul–Sep history ──────
-- The owner's decisions (2026-10-07): the website, info@arak-sa.com and
-- info@clb-sa.com; one workbook with "New leads" (from 1 October 2026) and
-- "Jul–Sep 2026" (history); every folder is read, Junk included (not Sent,
-- Drafts or Outbox); clb-sa.com is part of Arak but on its own Microsoft 365.

-- How the page and the workbook name the mailbox: the address people write
-- to. a.rak@arak-sa.com answers to info@arak-sa.com, so it is shown as that.
alter table public.lead_mailboxes add column if not exists label text not null default '';
-- The Microsoft 365 organisation (tenant id) the mailbox signed in from. Empty
-- = our own; set for another organisation's mailbox (clb-sa.com), whose
-- tokens are renewed against its own tenant.
alter table public.lead_mailboxes add column if not exists tenant text not null default '';

-- The July–September history pass, separate from reading new mail: it walks
-- from history_from to history_until once, then stops.
alter table public.lead_mailboxes add column if not exists history_from timestamptz not null default '2026-07-01T00:00:00+03:00';
alter table public.lead_mailboxes add column if not exists history_until timestamptz not null default '2026-10-01T00:00:00+03:00';
alter table public.lead_mailboxes add column if not exists history_cursor timestamptz;
alter table public.lead_mailboxes add column if not exists history_done boolean not null default false;

update public.lead_mailboxes set label = 'info@arak-sa.com' where email = 'a.rak@arak-sa.com' and label = '';
update public.leads set mailbox = 'info@arak-sa.com' where mailbox = 'a.rak@arak-sa.com';

-- New mail is now read from every folder, not just the Inbox: read info@'s
-- again from 1 October. Mail already decided is matched by Message-ID and
-- costs nothing; only what sat in Junk or another folder is new.
update public.lead_mailboxes set read_from = '2026-10-01T00:00:00+03:00' where email = 'a.rak@arak-sa.com' and read_from > '2026-10-01T00:00:00+03:00';
