-- ════════════════════════════════════════════════════════════════════════
-- Weekly AI email drafts: an on/off switch per company
-- ════════════════════════════════════════════════════════════════════════
-- Email → Settings → "Weekly AI drafts". Off: the Monday run on the n8n box
-- (server/agentHandlers/emailWeekly.js) skips this company, so no model is
-- called and nothing is spent. The "Write this week's drafts now" button on
-- Newsletters still works: a person pressing it has asked for them.
--
-- On by default, so every company keeps what it has today.
--
-- Run ONCE. Idempotent.

alter table public.email_settings
  add column if not exists weekly_drafts_enabled boolean not null default true;

notify pgrst, 'reload schema';
