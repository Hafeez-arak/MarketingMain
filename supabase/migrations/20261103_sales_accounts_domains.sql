-- ════════════════════════════════════════════════════════════════════════════
-- sales_accounts: every previous client, found by their email domain
-- Run ONCE in the Supabase SQL editor. Idempotent.
--
-- The 29 accounts from the Oct 2026 analysis were matched to a lead by NAME
-- only (the sender's domain root inside the account name). The previous
-- clients workbook (Odoo 2022–2026 + the email archive since 2018) gives
-- every client we closed a job with, with the email domains they wrote from
-- and their name as Odoo spells it, so:
--   domains    their email domains ("example.sa"): a lead from one of them IS
--              that client, no guessing. The battle card, the prospect
--              finder and the targets lens all read it.
--   odoo_name  the customer exactly as Odoo names it, for the Odoo history
--              lookup when Odoo's contacts carry no email (most do not).
--   sold_by    who closed their jobs, from the CRM: the person who knows them.
-- Client names and domains live only in the database (the repo is public).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.sales_accounts
  add column if not exists domains   text[] not null default '{}',
  add column if not exists odoo_name text   not null default '',
  add column if not exists sold_by   text   not null default '';

create index if not exists sales_accounts_domains_idx on public.sales_accounts using gin (domains);

notify pgrst, 'reload schema';
