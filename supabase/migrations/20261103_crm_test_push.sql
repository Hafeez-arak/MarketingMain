-- ─── A test push to Odoo (2026-10-20) ─────────────────────────────────────
-- The owner wants to try the whole Approve → Odoo path on one real lead
-- without anyone on the sales team getting it: the access admin may approve
-- "Test only". The lead goes to Odoo with no salesperson of ours (its owner
-- is the Odoo connection's own user), nothing is forwarded, and this mark
-- says which lead it was, so the test can be taken out of Odoo afterwards
-- and the lead put back. Additive only.
alter table public.leads add column if not exists crm_test boolean not null default false;
