-- ─── Outreach: wording per prospect, list columns, A/B versions ───────────
-- What a cold-email platform does that our sender did not yet:
--
--   email_contacts.custom    the columns of an imported list we have no
--                            field for (an opening line, a project name),
--                            merged as {{ice_breaker}}. Keys are lower-case
--                            letters, digits and _ (src/lib/email/csv.js).
--   email_campaigns.variants up to two more versions (B, C) of an outreach
--                            campaign's first email: [{ subject, body }].
--                            The campaign's own subject/body is version A.
--   email_sends.variant      which version this prospect was given (0 = A),
--                            for good, so the campaign page can compare the
--                            versions' reply rates.
--
-- The {a|b} wording choices need no column: they are resolved per prospect
-- from a seed at send time (src/lib/email/variation.js).
--
-- Run ONCE. Idempotent.

alter table public.email_contacts add column if not exists custom jsonb not null default '{}'::jsonb;
alter table public.email_campaigns add column if not exists variants jsonb not null default '[]'::jsonb;
alter table public.email_sends add column if not exists variant smallint not null default 0;

alter table public.email_sends drop constraint if exists email_sends_variant_check;
alter table public.email_sends add constraint email_sends_variant_check check (variant between 0 and 2);
alter table public.email_campaigns drop constraint if exists email_campaigns_variants_check;
alter table public.email_campaigns add constraint email_campaigns_variants_check
  check (jsonb_typeof(variants) = 'array' and jsonb_array_length(variants) <= 2);
alter table public.email_contacts drop constraint if exists email_contacts_custom_check;
alter table public.email_contacts add constraint email_contacts_custom_check check (jsonb_typeof(custom) = 'object');

notify pgrst, 'reload schema';
