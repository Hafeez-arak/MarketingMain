-- ─── v2: a read-only mirror of Odoo ────────────────────────────────────────
-- 2026-10-19. The CEO's rule 7: Odoo is the single source of truth; Campai
-- displays and alerts. His requirements 16 and 17: pull the data from Odoo,
-- refreshed at least every hour, so his numbers (open pipeline, revenue
-- this month, quotes, win rate, overdue invoices, projects at risk) are
-- Odoo's, never typed in twice.
--
-- One table holds every mirrored record as Odoo sent it (the fields asked
-- for, in Odoo's own shape), keyed by company, model and Odoo id. The
-- arithmetic on it is code (src/lib/control/odoo.js), tested without Odoo.
-- api/leads/_odooSync.js fills it: only records changed since the last
-- round (Odoo's write_date), at most once an hour unless asked.
--
-- Nothing is written back to Odoo from here.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create table if not exists public.odoo_records (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  model        text not null,
  odoo_id      integer not null,
  data         jsonb not null,
  write_date   text not null default '',   -- Odoo's, "YYYY-MM-DD HH:MM:SS" UTC
  synced_at    timestamptz not null default now(),
  primary key (workspace_id, model, odoo_id)
);
create index if not exists odoo_records_model_idx on public.odoo_records (workspace_id, model);

-- One row per company: when it last ran, where each model's cursor is,
-- which Odoo apps exist there, and what went wrong if anything did.
create table if not exists public.odoo_sync (
  workspace_id  uuid primary key references public.workspaces(id) on delete cascade,
  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  last_error    text not null default '',
  cursors       jsonb not null default '{}'::jsonb,   -- { "crm.lead": "2026-10-19 07:00:00|101", … } (write_date|id)
  models        jsonb not null default '[]'::jsonb,   -- the models Odoo has (installed apps)
  counts        jsonb not null default '{}'::jsonb,   -- records mirrored per model
  updated_at    timestamptz not null default now()
);

alter table public.odoo_records enable row level security;
alter table public.odoo_sync enable row level security;

-- Money and customers: read by those who may see the CEO panel or Sales.
-- Written only by the server (service key).
drop policy if exists odoo_records_read on public.odoo_records;
create policy odoo_records_read on public.odoo_records for select to authenticated
  using (public.has_section(workspace_id, 'ceo', 'view') or public.has_section(workspace_id, 'sales', 'view'));

drop policy if exists odoo_sync_read on public.odoo_sync;
create policy odoo_sync_read on public.odoo_sync for select to authenticated
  using (public.has_section(workspace_id, 'ceo', 'view') or public.has_section(workspace_id, 'sales', 'view'));

grant select on public.odoo_records, public.odoo_sync to authenticated;
grant all on public.odoo_records, public.odoo_sync to service_role;
