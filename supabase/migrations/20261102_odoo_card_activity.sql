-- ─── The next step as an Odoo Activity (2026-10-20) ────────────────────────
-- The battle card in Odoo was simplified the same day (the owner): the prep
-- is a brief in the lead's Internal Notes, the outcome six fields, and the
-- next step + follow-up date an Odoo Activity (a to-do with a due date) for
-- the salesperson. This is the id of that activity, so a change here moves
-- it and a done one in Odoo clears our next step. Additive only.
alter table public.lead_cards add column if not exists crm_activity_id integer;
