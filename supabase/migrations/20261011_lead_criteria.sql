-- ─── Lead agent: the sales team's criteria (2026-10-11) ────────────────────
-- Who is writing (a trader from the market is not a lead), whether the source
-- checks out (signature first, then the sender's website), the project's
-- phase (JIH / tender / maintenance, only when the email says it), what they
-- want (a requirement, or an inquiry such as supplier registration), how
-- Philips is named (Philips only is not a lead), the folder the email sat in
-- (a real enquiry in Junk is one nobody saw), and company vs free email.
-- The model reads these; src/lib/leads/qualify.js decides the verdict.

alter table public.leads add column if not exists sender_type      text not null default '';
alter table public.leads add column if not exists sender_evidence  text not null default '';
alter table public.leads add column if not exists source_check     text not null default '';
alter table public.leads add column if not exists source_evidence  text not null default '';
-- '' = the email does not say: sales fills it in after the call.
alter table public.leads add column if not exists project_type     text not null default '';
alter table public.leads add column if not exists project_evidence text not null default '';
alter table public.leads add column if not exists request_type     text not null default '';
alter table public.leads add column if not exists philips          text not null default '';
-- The criteria rule that decided, when one did (philips_only, trader, unverified, unsure).
alter table public.leads add column if not exists rule             text not null default '';
-- The domain whose website was checked, '' when none.
alter table public.leads add column if not exists website          text not null default '';
-- inbox / junk / deleted / archive / other for email, website for the form.
alter table public.leads add column if not exists folder           text not null default '';
-- company / free / none.
alter table public.leads add column if not exists email_kind       text not null default '';
-- 1 = read before these criteria, 2 = with them.
alter table public.leads add column if not exists criteria_version int  not null default 1;

-- ── The website check's memory ──────────────────────────────────────────────
-- One row per domain: what its homepage said, or why it could not be read.
-- Public information about companies, shared by every workspace, so no
-- workspace_id. RLS on and no policy: only the server reads and writes it.
create table if not exists public.lead_domains (
  domain       text primary key,
  ok           boolean not null default false,
  title        text not null default '',
  description  text not null default '',
  text         text not null default '',
  error        text not null default '',
  checked_at   timestamptz not null default now()
);

alter table public.lead_domains enable row level security;
