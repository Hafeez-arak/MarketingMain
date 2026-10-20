-- ─── The battle card in Odoo, both ways (2026-10-20) ───────────────────────
-- The owner's decisions: every lead pushed to Odoo carries the whole battle
-- card as fields on the lead (Properties of the sales team the leads go
-- into); a change saved here is written to Odoo at once, with a note in the
-- lead's history; Odoo is the master, read back twice a day (07:50 and 13:00
-- Riyadh). See api/leads/_crmCard.js. Additive only.

-- ── The team our leads go into, and the twice-daily read ──────────────────
alter table public.lead_crm add column if not exists team_id integer;
alter table public.lead_crm add column if not exists team_name text not null default '';
alter table public.lead_crm add column if not exists last_pull_at timestamptz;
alter table public.lead_crm add column if not exists last_pull_error text not null default '';
alter table public.lead_crm add column if not exists last_pull_counts jsonb;

-- ── Each card's sync with Odoo ────────────────────────────────────────────
-- crm_props: the card's Odoo fields as last synced (both ways). A save here
-- writes only what differs from it; a read from Odoo takes only what Odoo
-- changed against it. crm_sync_error: a write that failed, retried before
-- the next read.
alter table public.lead_cards add column if not exists crm_props jsonb;
alter table public.lead_cards add column if not exists crm_synced_at timestamptz;
alter table public.lead_cards add column if not exists crm_pulled_at timestamptz;
alter table public.lead_cards add column if not exists crm_sync_error text not null default '';
