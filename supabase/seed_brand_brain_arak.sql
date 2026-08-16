-- ════════════════════════════════════════════════════════════════════════
-- Brand Brain structure — Arak Lighting (workspace 0000…0001)
-- ════════════════════════════════════════════════════════════════════════
-- Reproduces, as data, the structure that used to be hardcoded in
-- src/pages/settings/BrandBrain.jsx. Arak's page must look and behave
-- exactly as before after v4 — this file is what makes that true.
--
-- Also lifts the 24 supplier + 7 competitor rows out of the fixed
-- brand_suppliers / brand_competitors tables into the generic
-- brand_directory_rows model. The old tables are left in place untouched:
-- nothing reads them after v4, but the data stays recoverable.
--
-- Idempotent: structure inserts are ON CONFLICT DO NOTHING so re-running
-- never undoes a rename made by marketing in the web interface.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare ws uuid := '00000000-0000-0000-0000-000000000001';
begin

-- 1) ── Sections ─────────────────────────────────────────────────────────
insert into public.brand_sections (workspace_id, key, title, description, kind, icon, sort_order) values
  (ws, 'identity_voice',    'Identity & Voice',    'The foundation — who Arak is and how it speaks. Read first on every generation.', 'fields',    'identity',    10),
  (ws, 'guardrails',        'Guardrails',          'Hard rules the AI must follow — what to always do and what to never do.',         'fields',    'guardrails',  20),
  (ws, 'audience',          'Audience',            'Who the content is actually written for.',                                        'fields',    'audience',    30),
  (ws, 'market_references', 'Market & References', 'KSA market context and landmark work worth name-dropping.',                       'fields',    'market',      40),
  (ws, 'visual',            'Visual',              'Colours, photography, and how AI-generated imagery should look.',                 'fields',    'visual',      50),
  (ws, 'knowledge_centre',  'Knowledge Centre',    'Contact details, languages, offers and compliance — powers email & WhatsApp too.','fields',    'knowledge',   60),
  (ws, 'asset_library',     'Asset Library',       'Real photos, logos, and references the AI draws from instead of inventing.',      'assets',    'assets',      70),
  (ws, 'products',          'Products',            'The actual fixtures Arak sells — so content can feature specific products.',      'directory', 'products',    80),
  (ws, 'message_templates', 'Message Templates',   'Reusable, approved WhatsApp / email / social copy.',                              'directory', 'templates',   90),
  (ws, 'suppliers',         'Suppliers',           'Supply partners and the product lines they carry.',                               'directory', 'suppliers',  100),
  (ws, 'competitors',       'Competitor Watch',    'Who we''re up against and the angle that sets Arak apart.',                       'directory', 'competitors',110)
on conflict (workspace_id, key) do nothing;

-- 2) ── Fields (all 18 map to existing brand_profile columns) ─────────────
insert into public.brand_fields
  (workspace_id, section_key, key, label, hint, placeholder, input_type, rows, storage_column, prompt_label, sort_order) values
  (ws, 'identity_voice', 'mission', 'Mission', 'Why Arak exists — the purpose behind the work.',
   'e.g. To light the Kingdom’s landmark spaces with precision and lasting quality', 'textarea', 2, 'mission', 'Mission', 10),
  (ws, 'identity_voice', 'positioning', 'Market Positioning', 'Where Arak sits in the market, in one line.',
   'e.g. KSA’s premium architectural lighting specialist for landmark projects', 'textarea', 2, 'positioning', 'Market positioning', 20),
  (ws, 'identity_voice', 'value_proposition', 'Value Proposition', 'The core promise to customers.',
   'e.g. Engineering-grade lighting, specified right the first time', 'textarea', 2, 'value_proposition', 'Value proposition', 30),
  (ws, 'identity_voice', 'brand_story', 'Brand Story', 'The narrative the AI draws on — history, milestones, what makes Arak, Arak.',
   'e.g. 45+ years lighting Saudi Arabia’s most demanding projects — from King Fahad Airport to the Ritz Carlton Riyadh...', 'textarea', 4, 'brand_story', 'Brand story', 40),
  (ws, 'identity_voice', 'company_facts', 'Company Facts', 'Hard facts the AI can state with confidence — one per line.',
   'e.g. Founded 1980
45+ years in business
3,000+ projects delivered
In-house photometric lab', 'textarea', 4, 'company_facts', 'Facts the brand can state', 50),
  (ws, 'identity_voice', 'voice_descriptors', 'Brand Voice', 'A few descriptors — comma separated. The first thing every AI call reads.',
   'e.g. premium, authoritative, warm but never casual', 'text', 1, 'voice_descriptors', 'Brand voice', 60),

  (ws, 'guardrails', 'tone_dos', 'Always Do', 'Habits the AI should reach for by default.',
   'e.g. End every post with a genuine question to drive comments
Mention our 45+ years legacy when relevant
Use "we" not "I" — Arak speaks as a company', 'textarea', 4, 'tone_dos', 'Always do', 10),
  (ws, 'guardrails', 'tone_donts', 'Never Do', 'Banned phrases and patterns. Be specific — vague rules get ignored.',
   'e.g. "We are excited to announce"
"In today''s world"
Exclamation marks in headlines
Generic stock-photo language', 'textarea', 4, 'tone_donts', 'Never do', 20),

  (ws, 'audience', 'target_personas', 'Target Personas', 'Who the content is actually written for.',
   'e.g. Architects and interior designers specifying for hospitality projects
Real estate developers in KSA and the wider GCC
MEP contractors evaluating suppliers', 'textarea', 4, 'target_personas', 'Target audience', 10),

  (ws, 'market_references', 'market_context', 'Market Context', 'KSA market dynamics, seasonal angles, and themes worth riding.',
   'e.g. Vision 2030 giga-projects (NEOM, Diriyah, Red Sea)
Ramadan & National Day seasonal moments
Shift toward energy-efficient facade lighting', 'textarea', 4, 'market_context', 'Market context', 10),
  (ws, 'market_references', 'key_projects', 'Key Projects & Clients to Reference', 'Landmark work the AI can credibly name-drop when relevant.',
   'e.g. King Fahad Airport
Ritz Carlton Riyadh
Solitaire Mall
NEOM hospitality lighting', 'textarea', 4, 'key_projects', 'Reference when relevant', 20),
  -- Bound to product_index. The legacy hardcoded builder emitted this column,
  -- so without a field pointing at it Arak's existing product summary would
  -- silently stop reaching the AI after v4.
  (ws, 'market_references', 'product_index_summary', 'Product Range Summary', 'A lightweight summary of the range, used in prompts. Ask for the full sheet for specifics.',
   'e.g. Indoor downlights, facade floodlighting, linear profiles, lighting control', 'textarea', 5, 'product_index', 'Product range (ask for the full sheet for specifics)', 30),

  (ws, 'visual', 'visual_identity', 'Visual Identity', 'Colours, typography, and photography style — the look of the brand.',
   'e.g. Brand colours: warm amber + charcoal
Typography: clean modern serif headlines
Photography: real installations, warm light, no harsh white', 'textarea', 4, 'visual_identity', 'Visual identity', 10),
  (ws, 'visual', 'brand_colors', 'Brand Colours', 'Palette + hex codes + what each colour is for. Fed to the image generator to keep visuals on-brand.',
   'e.g. Warm bronze #94765e (primary)
Charcoal #1b1715 (dark base)
Cream #e0cfbc (light backgrounds)', 'textarea', 4, 'brand_colors', 'Brand colours', 20),
  (ws, 'visual', 'visual_style_notes', 'AI Image Style Defaults', 'How AI-generated imagery should default to looking, before a user picks a style.',
   'e.g. Prefer warm residential and facade/exterior styles over cool commercial
Avoid harsh white light in generated imagery
Default to portrait crops for Instagram', 'textarea', 4, 'visual_style_notes', 'Visual style defaults', 30),

  (ws, 'knowledge_centre', 'contact_info', 'Contact & Conversion', 'Phone, email, address, hours, main call-to-action. Used in every email footer and WhatsApp reply.',
   'e.g. Phone: +966-11-441-1131
Address: Hittin, Riyadh 13513
Primary CTA: Request a lighting consultation', 'textarea', 4, 'contact_info', 'Contact & conversion details', 10),
  (ws, 'knowledge_centre', 'languages', 'Languages', 'Which languages content is produced in, and any per-language tone rules.',
   'e.g. English + Arabic. Arabic should read native, not translated. Same premium tone in both.', 'textarea', 4, 'languages', 'Languages', 20),
  (ws, 'knowledge_centre', 'offers_ctas', 'Offers & CTAs', 'The specific actions we push audiences toward — one per line.',
   'e.g. Request a quote
Book a showroom visit
Download the product catalogue
Seasonal facade-lighting consultation', 'textarea', 4, 'offers_ctas', 'Offers & calls-to-action to push', 30),
  (ws, 'knowledge_centre', 'compliance_notes', 'Compliance', 'Opt-in / unsubscribe / legal rules — required for WhatsApp template approval and email sends.',
   'e.g. WhatsApp: opt-in required, add "Reply STOP to unsubscribe".
Email: unsubscribe link + address in footer.', 'textarea', 4, 'compliance_notes', 'Compliance rules (esp. WhatsApp/email)', 40)
on conflict (workspace_id, key) do nothing;

-- 3) ── Directory columns ────────────────────────────────────────────────
insert into public.brand_directory_columns (workspace_id, section_key, key, label, placeholder, wide, sort_order) values
  (ws, 'products', 'name',        'Name',        'e.g. CoreLine Downlight', false, 10),
  (ws, 'products', 'category',    'Category',    'indoor / facade / outdoor / automation', false, 20),
  (ws, 'products', 'supplier',    'Supplier',    'e.g. Philips', false, 30),
  (ws, 'products', 'price_range', 'Price Range', 'optional', false, 40),
  (ws, 'products', 'description', 'Description', '', true, 50),
  (ws, 'products', 'specs',       'Specs',       'wattage, lumens, IP rating, CCT…', true, 60),

  (ws, 'message_templates', 'name',     'Name',             'e.g. Ramadan facade promo', false, 10),
  (ws, 'message_templates', 'channel',  'Channel',          'whatsapp / email / social', false, 20),
  (ws, 'message_templates', 'category', 'Category',         'marketing / utility / newsletter / promo', false, 30),
  (ws, 'message_templates', 'subject',  'Subject / Header', 'email subject or template header', true, 40),
  (ws, 'message_templates', 'body',     'Body',             'the message copy', true, 50),
  (ws, 'message_templates', 'status',   'Status',           'draft / pending / approved', false, 60),

  (ws, 'suppliers', 'name',        'Name',          'e.g. Philips', false, 10),
  (ws, 'suppliers', 'category',    'Category',      'e.g. LED drivers, facade lighting', false, 20),
  (ws, 'suppliers', 'brand_lines', 'Product Lines', 'e.g. Hue, CoreLine', false, 30),
  (ws, 'suppliers', 'notes',       'Notes',         '', true, 40),

  (ws, 'competitors', 'name',          'Name',          'e.g. Competitor Co', false, 10),
  (ws, 'competitors', 'positioning',   'Positioning',   '', false, 20),
  (ws, 'competitors', 'strengths',     'Strengths',     '', true, 30),
  (ws, 'competitors', 'how_we_differ', 'How We Differ', '', true, 40),
  (ws, 'competitors', 'watch_url',     'Watch URL',     'https://...', false, 50)
on conflict (workspace_id, section_key, key) do nothing;

-- 4) ── Lift existing supplier / competitor rows into the generic model ───
--     Guarded on "nothing migrated yet" so a re-run can't duplicate them.
if not exists (select 1 from public.brand_directory_rows where workspace_id = ws and section_key = 'suppliers') then
  insert into public.brand_directory_rows (workspace_id, section_key, data, sort_order, created_at)
  select ws, 'suppliers',
         jsonb_strip_nulls(jsonb_build_object(
           'name', s.name, 'category', s.category, 'brand_lines', s.brand_lines, 'notes', s.notes)),
         (row_number() over (order by s.created_at)) * 10,
         s.created_at
  from public.brand_suppliers s where s.workspace_id = ws;
end if;

if not exists (select 1 from public.brand_directory_rows where workspace_id = ws and section_key = 'competitors') then
  insert into public.brand_directory_rows (workspace_id, section_key, data, sort_order, created_at)
  select ws, 'competitors',
         jsonb_strip_nulls(jsonb_build_object(
           'name', c.name, 'positioning', c.positioning, 'strengths', c.strengths,
           'how_we_differ', c.how_we_differ, 'watch_url', c.watch_url)),
         (row_number() over (order by c.created_at)) * 10,
         c.created_at
  from public.brand_competitors c where c.workspace_id = ws;
end if;

end $$;
