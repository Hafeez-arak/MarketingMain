-- ─── Lead agent: the master Sheet ──────────────────────────────────────────
-- A Google workbook with every lead from every source ("All enquiries") and
-- the qualified ones ("Qualified"), kept up to date by its own Apps Script
-- (scripts/lead-qualifier/LeadsMaster.gs) asking /api/leads/export every
-- five minutes. Its key is separate from the website Sheet's intake key: this
-- one can READ every lead, email ones included.

alter table public.lead_agent_settings add column if not exists export_key uuid not null default gen_random_uuid();
alter table public.lead_agent_settings add column if not exists last_export_at timestamptz;
create unique index if not exists lead_agent_settings_export_key_idx on public.lead_agent_settings (export_key);

-- The export reads "changed since", in order.
create index if not exists leads_ws_updated_idx on public.leads (workspace_id, updated_at, id);
