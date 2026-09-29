-- The website's contact form posts enquiries that ticked the marketing box
-- to /api/email/website-signup with this key, which names the workspace.
-- Not a secret (it ships in the website's page); rotate it to cut a site off.
alter table public.email_settings
  add column if not exists website_signup_key text;

create unique index if not exists email_settings_website_signup_key_idx
  on public.email_settings (website_signup_key) where website_signup_key is not null;
