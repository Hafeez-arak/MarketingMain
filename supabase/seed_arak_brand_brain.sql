-- ════════════════════════════════════════════════════════════════════════
-- Brand Brain — real content pulled from arak-sa.com
-- ════════════════════════════════════════════════════════════════════════
-- Run in the Supabase SQL editor, same as the earlier migration.
-- STEP 1: find your workspace id first (uncomment and run alone if you
-- have more than one workspace — otherwise the script below assumes
-- there's exactly one).
-- select id, name from public.workspaces;
-- ════════════════════════════════════════════════════════════════════════

-- ── Brand profile — identity, guardrails, audience, market, visual ────────
update public.brand_profile set
  mission = 'To always offer state-of-the-art products and service in compliance with the highest of international standards.',

  positioning = 'Saudi Arabia''s leading national lighting company — a certified partner of 20+ international lighting and smart-building brands, trusted on landmark hospitality, retail, banking and infrastructure projects across the Kingdom.',

  value_proposition = '45+ years of know-how, leadership and "big love for lights" — premium lighting and smart automation solutions engineered to the highest international standards and tailored to each project''s environment.',

  brand_story = 'Founded in 1976 as an extension of Abdul Rahman Al-Abdul Kadir Corporation, ARAK is a pioneering Saudi establishment with 45+ years of experience in lighting and smart building automation. What began as a local lighting supplier has grown into the Kingdom''s go-to partner for landmark projects — from King Fahad International Airport to the Ritz Carlton Riyadh, Cartier''s Riyadh boutique, Solitaire Mall, and a facade lighting partnership with Seder Group. Vision: to become the leading lighting company nationally and regionally, and KSA''s go-to Smart Lighting Solutions provider, continuing to expand through international brand partnerships and product diversification.',

  company_facts = 'Founded 1976, an extension of Abdul Rahman Al-Abdul Kadir Corporation
45+ years in the lighting industry
Certified partner of 20+ international lighting & smart-building brands
HQ: Exit 2, Northern Ring Branch Road, Hittin, Riyadh 13513, Saudi Arabia
Notable projects: King Fahad International Airport (Dammam), Ritz Carlton Riyadh, Cartier Riyadh, Solitaire Mall Riyadh, Seder Group Riyadh
Notable clients: Four Seasons, Mövenpick, Sheraton Four Points, Burj Rafal Hotel Kempinski, Panda, Al Rajhi Bank, Al Salam Bank, Bank Al Jazira, Emirates NBD, Prince Sultan University',

  voice_descriptors = 'professional, aspirational, heritage-led, confident, premium — formal but warm, never casual',

  tone_dos = 'Reference the 45+ years of heritage and Saudi roots when relevant
Name landmark projects/clients when it strengthens credibility (Ritz Carlton, Cartier, King Fahad Airport, Solitaire Mall)
Emphasize compliance with international standards and technical expertise
Speak as "we" — ARAK is an established institution, not a startup',

  tone_donts = 'Casual or startup-y language ("hey!", excessive exclamation marks)
Generic stock-photo lighting clichés
Overclaiming beyond verifiable facts
Positioning as cheap/budget — ARAK is a premium, certified-partner brand',

  target_personas = 'Architects and interior designers specifying lighting for landmark and hospitality projects
MEP contractors and engineering firms evaluating lighting suppliers
Hotel operators and hospitality brands needing lighting + smart room automation (GRMS)
Real estate developers and mall operators
Banks and financial institutions fitting out branches/HQs
Government and infrastructure bodies (airports, public projects)
Luxury retail brands
Educational institutions',

  market_context = 'KSA Vision 2030 giga-projects and infrastructure expansion driving demand for large-scale lighting and smart building automation
Growing demand for KNX/EIB smart automation in hospitality (Guest Room Management Systems) and commercial buildings
Rising expectations for facade and outdoor lighting on landmark developments
Saudi-first positioning matters — ARAK is a 45-year local establishment, not a foreign import',

  key_projects = 'King Fahad International Airport, Dammam — supply & installation of light fittings
Ritz Carlton Hotel, Riyadh — premium light fittings for a luxury hospitality environment
Cartier, Riyadh — indoor light fittings reflecting the brand''s elegance
Solitaire Mall, Riyadh — indoor, outdoor and smart pole lighting for a large retail development
Seder Group, Riyadh — exterior lighting partnership with a leading MEP engineering firm',

  visual_identity = 'Logo: a stylised "A" formed from a hanging pendant light fixture, paired with a clean geometric "ARAK" wordmark. Primary logo file is white/transparent, designed for dark backgrounds — a dark-on-light variant was not found on the live site; confirm with the client if one is needed. No confirmed brand accent color found on the current site (base palette reads black/white/premium-neutral) — flagging rather than guessing; confirm directly with Arak.',

  product_index = 'Indoor lighting, outdoor lighting, facade lighting, lighting design services, lighting installation & project management, home & building automation (KNX/EIB), Guest Room Management Systems (hospitality), Smart Pole systems (IoT/city infrastructure), Central Battery Systems (emergency backup lighting). Certified partner for 20+ brands — see Suppliers list.',

  updated_at = now()
where workspace_id = (select id from public.workspaces order by created_at asc limit 1);

-- ── Suppliers — brand partners found on arak-sa.com ────────────────────────
-- Category/product-line left blank where I couldn't confirm what the brand
-- actually supplies from the site alone (logo-only, no description) —
-- fill those in once you know, rather than have the AI guess wrong.
insert into public.brand_suppliers (workspace_id, name, category, brand_lines, notes)
select ws.id, s.name, s.category, s.brand_lines, s.notes
from public.workspaces ws
cross join (values
  ('Philips',        'Lighting',                        '', ''),
  ('ABB',            'Electrical / building automation', '', ''),
  ('Legrand',        'Electrical / smart building',      '', ''),
  ('Gewiss',         'Electrical systems',                '', ''),
  ('Leviton',        'Electrical systems',                '', ''),
  ('Reggiani',       'Architectural lighting',            '', ''),
  ('Lug Lighting',   'Lighting fixtures',                 '', ''),
  ('Luxeled',        'LED lighting',                      '', ''),
  ('Disano',         'Lighting fixtures',                 '', ''),
  ('Fumagalli',      'Outdoor / facade lighting',         '', ''),
  ('Planlicht',      'Architectural lighting',            '', ''),
  ('Zalux',          'Lighting fixtures',                 '', ''),
  ('Trevos',         'Industrial / outdoor lighting',     '', ''),
  ('Viokef',         'Decorative lighting',                '', ''),
  ('Interra',        'Smart building / KNX',              '', ''),
  ('Niviss',         '',                                   '', 'Category unconfirmed — logo only, no description on site.'),
  ('Espica',         '',                                   '', 'Category unconfirmed — logo only, no description on site.'),
  ('Hormen',         '',                                   '', 'Category unconfirmed — logo only, no description on site.'),
  ('Jiso',           '',                                   '', 'Category unconfirmed — logo only, no description on site.'),
  ('Ledsc4',         '',                                   '', 'Category unconfirmed — logo only, no description on site.'),
  ('Lucciolighting',  '',                                  '', 'Category unconfirmed — logo only, no description on site.'),
  ('Vatreria',       '',                                   '', 'Category unconfirmed — logo only, no description on site.'),
  ('Cluce',          '',                                   '', 'Category unconfirmed — logo only, no description on site.')
) as s(name, category, brand_lines, notes)
where ws.id = (select id from public.workspaces order by created_at asc limit 1)
  and not exists (
    select 1 from public.brand_suppliers existing
    where existing.workspace_id = ws.id and existing.name = s.name
  );

-- ════════════════════════════════════════════════════════════════════════
-- NOT included on purpose (left for you, per "leave what's confusing"):
--  - Competitors: arak-sa.com doesn't name competitors — only you know who
--    you're actually up against. Add these via the Competitor Watch UI.
--  - The remaining ~20-25 suppliers to reach your full 40-50 list — only
--    22 brand partners had logos on the live site.
--  - Brand accent color — not confidently identifiable from the site.
--  - Logo + 5 real project photos — these are binary files, not SQL. They
--    were downloaded locally; drag them into the Asset Library UI instead
--    (see chat for the exact folder path).
-- ════════════════════════════════════════════════════════════════════════
