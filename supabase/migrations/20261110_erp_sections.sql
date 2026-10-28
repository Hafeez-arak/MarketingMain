-- ─── Two new sections from Musa's ERP: HR and Contacts (2026-10-28) ────────
-- The owner's direction: the finished, non-accounting parts of Musa's ERP are
-- rewritten into v2 in our own stack, one section each, built in parallel on
-- two branches (v2-hr, v2-contacts). Both need their key allowed wherever a
-- section is named, and a check constraint can only be replaced whole, so the
-- two keys are added here once, before the branches split, rather than by
-- each branch (the later one would silently drop the other's key).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

alter table public.section_access drop constraint if exists section_access_section_check;
alter table public.section_access add constraint section_access_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts'));
alter table public.tasks drop constraint if exists tasks_section_check;
alter table public.tasks add constraint tasks_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts'));
alter table public.meetings drop constraint if exists meetings_section_check;
alter table public.meetings add constraint meetings_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts'));
