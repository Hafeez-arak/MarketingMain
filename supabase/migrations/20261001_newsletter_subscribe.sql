-- ════════════════════════════════════════════════════════════════════════
-- Email: prospects sign up to the newsletter from an outreach email
-- ════════════════════════════════════════════════════════════════════════
-- A cold email may carry one button, {{subscribe_url}}. Pressing it and
-- confirming on the page (api/email/[action].js, /subscribe) moves the
-- contact from the cold lane to the marketing lane with consent 'opted_in',
-- into the "Newsletter subscribers" group. The Subscribers tab lists them.
--
-- Run ONCE. Idempotent.

-- When they signed up, and from which outreach campaign.
alter table public.email_contacts
  add column if not exists subscribed_at timestamptz;
alter table public.email_contacts
  add column if not exists subscribed_campaign_id uuid references public.email_campaigns(id) on delete set null;
create index if not exists email_contacts_subscribed_idx
  on public.email_contacts (workspace_id, subscribed_at desc) where subscribed_at is not null;

-- The outreach email that brought the sign-up, so a campaign counts them.
alter table public.email_sends
  add column if not exists subscribed_at timestamptz;

-- What the sign-up page says and gives. All optional.
alter table public.email_settings
  add column if not exists newsletter_name text not null default '';
alter table public.email_settings
  add column if not exists subscribe_offer text not null default '';
alter table public.email_settings
  add column if not exists subscribe_gift_url text not null default '';

-- ── Per-campaign numbers, now with sign-ups ──
-- Drop and create (not create-or-replace) so security_invoker is set on the
-- new view for certain; see 20260821_restore_scheduled_posts_rls.sql.
drop view if exists public.email_campaign_stats;
create view public.email_campaign_stats
with (security_invoker = true) as
select
  s.campaign_id,
  s.workspace_id,
  count(*)                                                        as total,
  count(*) filter (where s.status = 'queued')                     as queued,
  count(*) filter (where s.sent_at is not null)                   as sent,
  count(*) filter (where s.delivered_at is not null)              as delivered,
  count(*) filter (where s.opened_at is not null)                 as opened,
  count(*) filter (where s.clicked_at is not null)                as clicked,
  count(*) filter (where s.bounced_at is not null)                as bounced,
  count(*) filter (where s.complained_at is not null)             as complained,
  count(*) filter (where s.status in ('failed','skipped'))        as failed,
  count(*) filter (where s.replied_at is not null)                as replied,
  count(*) filter (where s.subscribed_at is not null)             as subscribed
from public.email_sends s
group by s.campaign_id, s.workspace_id;

notify pgrst, 'reload schema';
