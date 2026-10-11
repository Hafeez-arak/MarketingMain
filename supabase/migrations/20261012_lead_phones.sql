-- ─── Lead agent: every phone number a lead gave (2026-10-11) ────────────────
-- Read in code from the email's text (usually the signature) and, for a lead
-- with none in its text, from its signature picture. The website form's own
-- phone field comes first. Up to five, as written.
alter table public.leads add column if not exists phones jsonb not null default '[]'::jsonb;
