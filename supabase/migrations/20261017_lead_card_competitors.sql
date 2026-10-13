-- ─── "Who else is quoting" on a lead's battle card (2026-10-12) ────────────
-- A fifth thing the salesperson records after the first call: the
-- competitors on the deal, in their words. The card shows what Research
-- knows about any watchlist competitor named here.

alter table public.lead_cards add column if not exists competitors text not null default '';
