-- ─── Lead agent: health alerts ─────────────────────────────────────────────
-- The owner's decision (2026-10-07): when any part of the lead agent stops
-- (a Sheet's 5-minute timer, a mailbox, the AI, credit, budget), email
-- junaid@arak-sa.com straight away; a reminder once a day while it lasts, and
-- a "fixed" email when it recovers. See api/leads/_health.js.

alter table public.lead_agent_settings add column if not exists alert_emails text[] not null default '{}';
-- { "<problem key>": { "since": iso, "sentAt": iso, "title": "..." } }
alter table public.lead_agent_settings add column if not exists alert_state jsonb not null default '{}'::jsonb;
-- When the last health check ran: the two Sheets' calls both trigger one,
-- and only the call that moves this forward (at most every 10 minutes) runs it.
alter table public.lead_agent_settings add column if not exists last_health_at timestamptz;

update public.lead_agent_settings set alert_emails = '{junaid@arak-sa.com}'
  where workspace_id = '00000000-0000-0000-0000-000000000001' and alert_emails = '{}';
