-- The battle card after the call (2026-11-07, Part 1): the date the quote was
-- sent, and its three follow-ups (day 3, 10, 30), each an Odoo to-do for the
-- salesperson. See src/lib/sales/cardFollowUp.js.
--
--   follow_ups  [{ day, date, note, done_at, activity_id }], one per day
--
-- And two lost reasons the CRM analysis showed matter most: our own delay
-- and declining to quote.

alter table public.lead_cards add column if not exists quote_sent_on date;
alter table public.lead_cards add column if not exists follow_ups jsonb not null default '[]'::jsonb;

alter table public.leads drop constraint if exists leads_lost_reason_check;
alter table public.leads add constraint leads_lost_reason_check
  check (lost_reason in ('', 'price', 'brand', 'lead_time', 'no_reply', 'cancelled', 'arak_late', 'declined', 'other'));

-- The deal's close as Odoo last said it (its own reason's name, in its words).
alter table public.leads add column if not exists crm_lost_reason text not null default '';
