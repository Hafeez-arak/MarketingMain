-- A research lead someone marked "not for outreach" on Email → Contacts.
-- Owned by people, like status and owner_note: the research agent's upsert
-- never names this column, so a later run cannot bring the lead back.
alter table public.research_opportunities
  add column if not exists outreach_dismissed_at timestamptz;
