-- ════════════════════════════════════════════════════════════════════════
-- Brand Brain v3 — Knowledge Centre expansion (ARAK Content Studio)
-- ════════════════════════════════════════════════════════════════════════
-- Turns the brand brain from a "social caption" brain into a full company
-- knowledge centre that can also power WhatsApp + email marketing.
-- Adds: contact/conversion info, language rules, brand colours, compliance,
-- an offers/CTA library, plus FAQ, product-catalogue and message-template
-- tables.
--
-- Run ONCE in the Supabase SQL editor. Every statement is idempotent and
-- ADDITIVE — it never overwrites existing content (seeds only fill columns
-- that are still empty).
-- ════════════════════════════════════════════════════════════════════════

-- 1) ── New brand_profile columns (all text, flatten into the prompt blob) ──
alter table public.brand_profile
  add column if not exists contact_info      text default '',  -- phone/email/address/hours/CTA
  add column if not exists languages         text default '',  -- EN / Arabic voice rules
  add column if not exists brand_colors      text default '',  -- palette + hex + role
  add column if not exists compliance_notes  text default '',  -- opt-in / unsubscribe / legal
  add column if not exists offers_ctas       text default '';  -- the actions we push

-- 2) ── Product catalogue (the actual fixtures Arak sells) ─────────────────
create table if not exists public.brand_products (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  category     text default '',          -- indoor / facade / outdoor / automation
  supplier     text default '',          -- which partner brand it comes from
  description  text default '',
  specs        text default '',          -- wattage, lumens, IP rating, CCT, etc.
  price_range  text default '',
  image_url    text default '',          -- link to a brand_assets image if any
  tags         text[] default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists brand_products_ws_idx on public.brand_products(workspace_id);

-- 3) ── Message template library (approved WhatsApp + email + social copy) ─
create table if not exists public.brand_message_templates (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel      text not null default 'whatsapp'
               check (channel in ('whatsapp','email','social','other')),
  name         text not null,
  category     text default '',          -- marketing / utility / auth / newsletter / promo
  subject      text default '',          -- email subject / template header
  body         text default '',
  status       text default 'draft'
               check (status in ('draft','pending','approved','rejected')),
  notes        text default '',
  created_at   timestamptz not null default now()
);
create index if not exists brand_msg_templates_ws_idx on public.brand_message_templates(workspace_id);

-- 4) ── Row-level security ─────────────────────────────────────────────────
alter table public.brand_products          enable row level security;
alter table public.brand_message_templates enable row level security;

drop policy if exists brand_products_rw on public.brand_products;
create policy brand_products_rw on public.brand_products
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists brand_msg_templates_rw on public.brand_message_templates;
create policy brand_msg_templates_rw on public.brand_message_templates
  for all to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- 5) ── Seed the new profile columns with what we already know from the site
--    (ONLY where still empty — never clobbers anything you've typed) ────────
update public.brand_profile set
  contact_info = 'Email: info@arak-sa.com
Phone: +966-11-441-1131
Address: Exit 2, Northern Ring Branch Road, Hittin, Riyadh 13513, Saudi Arabia
Website: arak-sa.com
Primary CTA: Request a lighting consultation / quote
(Confirm working hours with Arak.)'
where (contact_info is null or contact_info = '')
  and workspace_id = (select id from public.workspaces order by created_at asc limit 1);

update public.brand_profile set
  languages = 'Primary: English and Arabic (the site runs both — arak-sa.com and /ar/).
Arabic content should read as native Modern Standard Arabic, not translated-sounding.
Keep the same premium, heritage-led tone in both languages. For KSA audiences, Arabic often leads on WhatsApp; English suits LinkedIn and B2B specification.'
where (languages is null or languages = '')
  and workspace_id = (select id from public.workspaces order by created_at asc limit 1);

update public.brand_profile set
  brand_colors = 'PROVISIONAL — extracted from real Arak project photos, pending official brand colours from Arak.
Warm bronze / amber (primary accent, the signature warm-light tone): #94765e
Deep charcoal (dark base / backgrounds): #1b1715
Warm neutral tan (secondary): #b59d83
Cream / soft light (light backgrounds, negative space): #e0cfbc
Cool slate (minor accent, daytime/exterior shots): #6b727b
Use warm bronze + charcoal as the core pair; cream for breathing room. Avoid harsh cool white.'
where (brand_colors is null or brand_colors = '')
  and workspace_id = (select id from public.workspaces order by created_at asc limit 1);

update public.brand_profile set
  compliance_notes = 'WhatsApp: only message contacts who have opted in; every marketing template must include clear opt-in context and an easy opt-out ("Reply STOP to unsubscribe"). Meta pre-approves all proactive templates — keep them useful, not purely promotional, or they get rejected.
Email: every send needs a visible unsubscribe link and the company postal address in the footer.
(Confirm Arak''s preferred opt-out wording and any legal/PDPL requirements for KSA.)'
where (compliance_notes is null or compliance_notes = '')
  and workspace_id = (select id from public.workspaces order by created_at asc limit 1);

-- ════════════════════════════════════════════════════════════════════════
-- Done. New: brand_products, brand_message_templates tables;
-- 5 new brand_profile columns (contact_info, languages, brand_colors,
-- compliance_notes, offers_ctas), seeded from known site data where empty.
-- Nothing existing was overwritten.
-- ════════════════════════════════════════════════════════════════════════
