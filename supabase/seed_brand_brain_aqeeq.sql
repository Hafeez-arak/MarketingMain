-- ════════════════════════════════════════════════════════════════════════
-- Brand Brain structure + content — Aqeeq (عقيق)
-- ════════════════════════════════════════════════════════════════════════
-- At-home spa & beauty service, Riyadh. Source: the marketing team's brand
-- brain document.
--
-- The structure here is deliberately NOT the lighting-company shape: no
-- Suppliers directory, no "Key Projects", and the Products directory is a
-- Service Menu with Arabic names, durations and SAR prices. Marketing can
-- add either back from the web interface if they ever need them.
--
-- Prices are stored on the service rows but the price column is marked
-- in_prompt = false, so the menu can be shown to the AI without pushing
-- 27 price points into every generation.
--
-- Fields whose value the brand brain does not supply (contact details,
-- compliance rules) are created EMPTY rather than invented — they show up
-- as gaps in the completion ring for marketing to fill.
--
-- Idempotent: ON CONFLICT DO NOTHING throughout, so re-running never
-- overwrites edits made in the interface.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare ws uuid;
begin
  select id into ws from public.workspaces where name = 'Aqeeq';
  if ws is null then raise exception 'Aqeeq workspace not found'; end if;

-- 1) ── Sections ─────────────────────────────────────────────────────────
insert into public.brand_sections (workspace_id, key, title, description, kind, icon, sort_order) values
  (ws, 'identity_voice',   'Identity & Vibe',   'Who Aqeeq is and the feeling every post should leave behind.',                'fields',    'identity',    10),
  (ws, 'guardrails',       'Guardrails',        'Hard rules — the calm, unhurried register and what breaks it.',               'fields',    'guardrails',  20),
  (ws, 'audience',         'Audience',          'The women Aqeeq writes for, and what makes them book.',                       'fields',    'audience',    30),
  (ws, 'visual',           'Visual Identity',   'The sage / cream / wine world, and how generated imagery should look.',       'fields',    'visual',      40),
  (ws, 'market',           'Market Context',    'Riyadh at-home beauty market and the seasonal moments worth riding.',         'fields',    'market',      50),
  (ws, 'knowledge_centre', 'Knowledge Centre',  'Languages, Arabic handling, offers and contact — powers WhatsApp & email.',   'fields',    'knowledge',   60),
  (ws, 'asset_library',    'Asset Library',     'Real photos, the wordmark, and references the AI draws from.',                'assets',    'assets',      70),
  (ws, 'services',         'Service Menu',      'Every service with its Arabic name, duration and price.',                     'directory', 'products',    80),
  (ws, 'competitors',      'Competitor Watch',  'The at-home platforms Aqeeq is measured against, and how it differs.',        'directory', 'competitors', 90)
on conflict (workspace_id, key) do nothing;

-- 2) ── Fields ───────────────────────────────────────────────────────────
insert into public.brand_fields
  (workspace_id, section_key, key, label, hint, placeholder, input_type, rows, storage_column, prompt_label, sort_order) values

  (ws, 'identity_voice', 'positioning', 'Positioning', 'Where Aqeeq sits, in one line.',
   'e.g. A luxurious escape without leaving home', 'textarea', 3, 'positioning', 'Market positioning', 10),
  (ws, 'identity_voice', 'core_feeling', 'Core Feeling', 'The single feeling every post should leave behind.',
   'e.g. Relaxation, escape, indulgence', 'textarea', 2, '', 'Core feeling to evoke', 20),
  (ws, 'identity_voice', 'value_proposition', 'What Aqeeq Promises', 'The core promise to the client.',
   'e.g. Spa-quality care delivered to your door', 'textarea', 3, 'value_proposition', 'Value proposition', 30),
  (ws, 'identity_voice', 'brand_personality', 'Brand Personality', 'Aqeeq as a person — the AI writes in this character.',
   'e.g. A calm, well-groomed friend who never rushes you', 'textarea', 2, '', 'Brand personality', 40),
  (ws, 'identity_voice', 'voice_descriptors', 'Tone Words', 'A few descriptors, comma separated. The first thing every AI call reads.',
   'e.g. calm, luxurious, warm, gentle', 'text', 1, 'voice_descriptors', 'Brand voice', 50),
  (ws, 'identity_voice', 'company_facts', 'Company Facts', 'Hard facts the AI can state with confidence — one per line.',
   'e.g. At-home spa service based in Riyadh', 'textarea', 4, 'company_facts', 'Facts the brand can state', 60),

  (ws, 'guardrails', 'tone_dos', 'Always Do', 'Habits the AI should reach for by default.',
   'e.g. Emphasise privacy and being at home', 'textarea', 5, 'tone_dos', 'Always do', 10),
  (ws, 'guardrails', 'tone_donts', 'Never Do', 'Banned phrases and patterns. Be specific — vague rules get ignored.',
   'e.g. No urgency or pressure tactics', 'textarea', 5, 'tone_donts', 'Never do', 20),

  (ws, 'audience', 'target_personas', 'Who We Serve', 'The women the content is actually written for.',
   'e.g. Women 25–45 in Riyadh — professionals, mothers, brides-to-be', 'textarea', 4, 'target_personas', 'Target audience', 10),
  (ws, 'audience', 'booking_occasions', 'Booking Occasions', 'The moments that make someone book — drives the content calendar.',
   'e.g. Pre-event grooming, post-Ramadan pampering', 'textarea', 4, '', 'Occasions clients book for', 20),
  (ws, 'audience', 'client_values', 'What They Value', 'What the client is really buying, beyond the service itself.',
   'e.g. Convenience, privacy, hygiene, consistent quality', 'textarea', 4, '', 'What the audience values', 30),
  (ws, 'audience', 'pain_points', 'Pain Points We Solve', 'The frustrations Aqeeq removes — the angle most posts should hit.',
   'e.g. Salon travel time, discomfort in public salons', 'textarea', 4, '', 'Pain points we solve', 40),

  (ws, 'visual', 'brand_colors', 'Brand Colours', 'Palette + hex codes + what each colour is for. Fed to the image generator.',
   'e.g. Sage #A8B78C (primary background)', 'textarea', 5, 'brand_colors', 'Brand colours', 10),
  (ws, 'visual', 'visual_identity', 'Logo & Typography', 'The wordmark, where it sits, and the type treatment.',
   'e.g. عقيق wordmark on a horizontal underline, bottom-left of every post', 'textarea', 4, 'visual_identity', 'Logo & typography', 20),
  (ws, 'visual', 'visual_modes', 'Visual Modes', 'The distinct looks the brand alternates between — pick one per post.',
   'e.g. 1. Product/editorial on sage damask  2. Ambient low-lit spa photography', 'textarea', 5, '', 'Visual modes (pick one per post)', 30),
  (ws, 'visual', 'visual_style_notes', 'AI Image Style Defaults', 'How generated imagery should default to looking, before a user picks a style.',
   'e.g. Soft diffused light, generous negative space', 'textarea', 5, 'visual_style_notes', 'Visual style defaults', 40),
  (ws, 'visual', 'content_formats', 'Recurring Content Formats', 'The post formats that already work — reach for these first.',
   'e.g. Service close-ups, flat-lays, self-care quote graphics', 'textarea', 5, '', 'Recurring content formats', 50),

  (ws, 'market', 'market_context', 'Market Context', 'Riyadh market dynamics and seasonal angles worth riding.',
   'e.g. Ramadan and Eid pampering peaks, wedding season', 'textarea', 5, 'market_context', 'Market context', 10),

  (ws, 'knowledge_centre', 'languages', 'Languages', 'Which languages content is produced in, and per-language tone rules.',
   'e.g. Bilingual Arabic + English; Arabic must read native', 'textarea', 4, 'languages', 'Languages', 10),
  (ws, 'knowledge_centre', 'arabic_rendering', 'Arabic on Images', 'How Arabic text gets onto generated images. A real production trap — keep it here.',
   'e.g. Never trust the image model to letter Arabic; overlay manually', 'textarea', 3, '', 'Arabic text handling on images', 20),
  (ws, 'knowledge_centre', 'offers_ctas', 'Offers & CTAs', 'The specific actions we push audiences toward — one per line.',
   'e.g. Book an at-home spa session', 'textarea', 4, 'offers_ctas', 'Offers & calls-to-action to push', 30),
  (ws, 'knowledge_centre', 'service_menu_summary', 'Service Menu Summary', 'A compact prompt-friendly version of the full menu. The Service Menu directory below is the editable source.',
   'e.g. Massage 60 min: Relax 195 · Stone 255 · Cup 245 SAR', 'textarea', 6, 'product_index', 'Service menu', 40),
  (ws, 'knowledge_centre', 'contact_info', 'Contact & Booking', 'Phone, WhatsApp, booking link, service hours, coverage area.',
   'e.g. WhatsApp: +966…  Booking: …  Areas covered: Riyadh', 'textarea', 4, 'contact_info', 'Contact & booking details', 50),
  (ws, 'knowledge_centre', 'compliance_notes', 'Compliance', 'Opt-in / unsubscribe rules — needed before WhatsApp or email campaigns go out.',
   'e.g. WhatsApp: opt-in required, add "Reply STOP to unsubscribe".', 'textarea', 3, 'compliance_notes', 'Compliance rules (esp. WhatsApp/email)', 60)
on conflict (workspace_id, key) do nothing;

-- 3) ── Directory columns ────────────────────────────────────────────────
--    price_sar is in_prompt = false: stored and editable, but not pushed
--    into every generation.
insert into public.brand_directory_columns (workspace_id, section_key, key, label, placeholder, wide, in_prompt, sort_order) values
  (ws, 'services', 'name',      'Service (English)', 'e.g. Stone Massage',        false, true,  10),
  (ws, 'services', 'name_ar',   'Service (Arabic)',  'e.g. المساج بالأحجار الساخنة', false, true,  20),
  (ws, 'services', 'category',  'Category',          'Massage / Mani & Pedi / Polish / Hair / Waxing', false, true, 30),
  (ws, 'services', 'duration',  'Duration',          'e.g. 60 min',               false, true,  40),
  (ws, 'services', 'price_sar', 'Price (SAR)',       'e.g. 255',                  false, false, 50),
  (ws, 'services', 'notes',     'What It Involves',  'short description used as generation context', true, true, 60),

  (ws, 'competitors', 'name',          'Name',          'e.g. Urban Company', false, true, 10),
  (ws, 'competitors', 'positioning',   'Positioning',   '',                   false, true, 20),
  (ws, 'competitors', 'how_we_differ', 'How We Differ', '',                   true,  true, 30),
  (ws, 'competitors', 'watch_url',     'Watch URL',     'https://...',        false, true, 40)
on conflict (workspace_id, section_key, key) do nothing;

-- 4) ── The profile itself — fixed columns + custom_fields JSON ──────────
insert into public.brand_profile (
  workspace_id, positioning, value_proposition, voice_descriptors, company_facts,
  tone_dos, tone_donts, target_personas, brand_colors, visual_identity,
  visual_style_notes, market_context, languages, offers_ctas, product_index,
  contact_info, compliance_notes, caption_language, arabic_dialect, custom_fields, updated_at
) values (
  ws,
  'A luxurious, relaxing escape without leaving home — spa-quality self-care brought to the client''s door. A boutique, curated at-home spa service in Riyadh, not a broad on-demand marketplace.',
  'Spa-quality massage, nails, hair and waxing delivered to the client''s home in Riyadh — the privacy and comfort of home with none of the salon travel, waiting, or exposure.',
  'calm, luxurious, warm, gentle, indulgent, private, restorative',
  'At-home spa and beauty service based in Riyadh, Saudi Arabia
Every service is delivered at the client''s home — no salon visit required
Service range: massage, manicure and pedicure, polish, hair blow-out, hair cut, waxing
Bilingual service and content: Arabic and English
Brand name عقيق (Aqeeq)',
  'Use calm, unhurried language — the pace of the writing should feel like the service itself
Emphasise privacy, comfort, and being at home
Keep visuals soft, warm, and uncluttered
Write Arabic that reads native and natural, never translated
Speak like a calm friend who has time for you and never rushes you
Lead with how it feels, not what it costs',
  'No urgency or pressure tactics — no countdowns, no "book before it''s gone"
No clinical or medical-spa language
No bright, high-contrast "salon flyer" graphics
No generic stock-photo spa imagery (orchid on a white towel, stacked stones)
No hashtag or emoji overload — keep it minimal and elegant
Never imply the client should leave home',
  'Women aged 25–45 in Riyadh
Working professionals with limited free time
Mothers who cannot easily leave the house
Brides-to-be and women preparing for events
Style-aware clients who value privacy and consistent quality over the cheapest option',
  'Sage / light olive green #A8B78C — primary brand colour; used as a full-bleed background with a subtle damask/floral pattern overlay
Beige / cream #E9E1D3 — warm neutral; product shots and skin-tone-adjacent imagery
Deep wine red / burgundy #7A1F2B — secondary accent; nail polish product shots, bold contrast against sage
Warm charcoal / deep brown #3B2E28 — massage and spa-room imagery, moody and low-lit
Core pair is sage + cream. Burgundy is the accent, never the base.',
  'Logo: the wordmark عقيق in a thin, minimal, elegant Arabic sans-serif, sitting on a horizontal underline with small tick/gate marks at each end. Clean and understated — used small, bottom-left or bottom-centre of every post.
Typography: clean minimal sans-serif for English headlines, all-caps with wide letter spacing; soft elegant Arabic type for subheads.
Every post carries the wordmark.',
  'Default to the sage / cream / wine palette in every generated image
Soft, warm, diffused light — never harsh or clinical
Uncluttered compositions with generous negative space
Macro and close-up crops for hands, nails, feet and product
Low-lit warm charcoal tones for anything massage-related
Avoid generic stock-spa clichés',
  'Riyadh, Saudi Arabia. At-home beauty and wellness is a growing category with several on-demand platforms competing.
Aqeeq differentiates on a distinct luxurious sage/beige visual identity and a boutique, curated service menu rather than a broad marketplace feel.
Seasonal peaks: Ramadan and post-Ramadan pampering, Eid, wedding season, and the run-up to major family gatherings.',
  'All content bilingual — Arabic and English — unless stated otherwise.
Arabic should read as natural, native Saudi-market Arabic, not translated English. Warm and conversational rather than formal MSA.
Typical pattern: an English headline with an Arabic subhead.',
  'Book an at-home spa session
Book a massage — Relax, Hot Stone, or Cupping
Book a mani and pedi at home
Book a pre-event blow-out or styling
Book an at-home waxing session',
  'Massage (60 min): Relax 195 · Hot Stone 255 · Cupping 245 SAR
Mani & Pedi: Classic Manicure 90 · Classic Pedicure 80 · Classic Mani+Pedi 149 · Signature Mani+Pedi 195 · Paraffin hands 50 · Paraffin feet 50 SAR
Polish: Normal 20 · Gel 120 · Cat Eye 120 · Classic French 40 · Design per nail 20 · Acrylic nails 150 · Gel removal 175 SAR
Hair Blow Out: Short 150 · Medium 170 · Long 200 · Styling 250–300 SAR
Hair Cut: Trim 50 · Trim and bangs 100 · Model cut 150 SAR
Waxing: Half hands and half legs 150 · Face 80 · Eyebrow bleaching 40 · Eyebrow tinting 40 SAR
Every service is delivered at the client''s home in Riyadh.',
  '',   -- contact_info: not supplied by the brand brain — for marketing to fill
  '',   -- compliance_notes: not supplied — needed before WhatsApp/email campaigns
  'both',
  'saudi',
  jsonb_build_object(
    'core_feeling',      'Relaxation, escape, indulgence — "a getaway in your own home."',
    'brand_personality', 'A calm, well-groomed friend who always has time for you and never rushes you.',
    'booking_occasions', 'Regular self-care days
Stress relief after a demanding week
Pre-event grooming — weddings, Eid, family gatherings
Post-Ramadan pampering
Seasonal and holiday moments',
    'client_values',     'Convenience — no travel, no waiting
Privacy — the service happens in their own space
Hygiene and trust
Consistent quality every visit
Feeling genuinely pampered, not processed',
    'pain_points',       'Travel time to and from a salon
Discomfort in public salon settings
Wanting privacy during personal grooming
Busy schedules that do not fit salon opening hours',
    'visual_modes',      'Two modes, both on-brand:
1. Product / editorial — sage-green damask-textured background, macro shots of nail polish, wax, gloves and hands, laid out in clean graphic compositions with bilingual text overlays (English headline + Arabic subhead).
2. Ambient / lifestyle — warm, low-lit, moody real spa photography (candles, rolled towels, oils, stones, cupping sets) for the massage and relaxation side of the brand.',
    'content_formats',   'Service close-ups (hands, nails, feet)
Flat-lay product shots
Creative styled shots (e.g. polish paired with fruit)
Motivational self-care quote graphics
Checklist / to-do graphics
Monthly content calendar graphics
Phone-notification mockups ("Do Not Disturb", "Relax", "Self-care")
Massage benefit carousels
Nail polish application reels
Seasonal and travel-themed nail shots
Hair tool flat-lays',
    'arabic_rendering',  'Arabic text on AI-generated images must be double-checked or added via a manual overlay step. Arabic rendering is a known weak point for image generators — never trust the model to letter it correctly.
Check letter joining and right-to-left order before anything is published.'
  ),
  now()
) on conflict (workspace_id) do nothing;

-- 5) ── Service menu rows ────────────────────────────────────────────────
if not exists (select 1 from public.brand_directory_rows where workspace_id = ws and section_key = 'services') then
  insert into public.brand_directory_rows (workspace_id, section_key, sort_order, data)
  select ws, 'services', (ordinality * 10)::int, d
  from unnest(array[
    jsonb_build_object('name','Massage Relax','name_ar','مساج الاسترخاء','category','Massage','duration','60 min','price_sar','195','notes','Full relaxation session with light-to-medium strokes — eases tension and improves circulation.'),
    jsonb_build_object('name','Stone Massage','name_ar','المساج بالأحجار الساخنة','category','Massage','duration','60 min','price_sar','255','notes','Heated stones placed on key points to relax deep muscles and improve blood flow.'),
    jsonb_build_object('name','Cup Massage','name_ar','مساج الأكواب','category','Massage','duration','60 min','price_sar','245','notes','Light suction cups boost circulation, ease muscle pain and stimulate renewal.'),
    jsonb_build_object('name','Classic Manicure','name_ar','مانيكير كلاسيكي','category','Mani & Pedi','duration','','price_sar','90','notes',''),
    jsonb_build_object('name','Classic Pedicure','name_ar','باديكير كلاسيكي','category','Mani & Pedi','duration','','price_sar','80','notes',''),
    jsonb_build_object('name','Classic Manicure & Pedicure','name_ar','مانيكير وباديكير كلاسيكي','category','Mani & Pedi','duration','','price_sar','149','notes','Cut, file, buff, scrub and moisturise — no polish.'),
    jsonb_build_object('name','Signature Manicure & Pedicure','name_ar','سيغنتشر','category','Mani & Pedi','duration','','price_sar','195','notes','Everything in the classic plus a 15 min hand and foot massage — no polish.'),
    jsonb_build_object('name','Paraffin Hand Treatment','name_ar','بارافين لليدين','category','Mani & Pedi','duration','','price_sar','50','notes',''),
    jsonb_build_object('name','Paraffin Foot Treatment','name_ar','بارافين للقدمين','category','Mani & Pedi','duration','','price_sar','50','notes',''),
    jsonb_build_object('name','Normal Polish','name_ar','مناكير عادي','category','Polish','duration','','price_sar','20','notes',''),
    jsonb_build_object('name','Gel Polish','name_ar','مناكير جل','category','Polish','duration','','price_sar','120','notes',''),
    jsonb_build_object('name','Cat Eye Polish','name_ar','مناكير كات آي','category','Polish','duration','','price_sar','120','notes',''),
    jsonb_build_object('name','Classic French','name_ar','كلاسيك فرنش','category','Polish','duration','','price_sar','40','notes',''),
    jsonb_build_object('name','Design, One Nail','name_ar','رسمة على ظفر واحد','category','Polish','duration','','price_sar','20','notes',''),
    jsonb_build_object('name','Acrylic Nails','name_ar','تركيب أظافر','category','Polish','duration','','price_sar','150','notes',''),
    jsonb_build_object('name','Removing Gel','name_ar','إزالة الجل','category','Polish','duration','','price_sar','175','notes',''),
    jsonb_build_object('name','Blow Out — Short Hair','name_ar','سيشوار شعر قصير','category','Hair Blow Out','duration','','price_sar','150','notes',''),
    jsonb_build_object('name','Blow Out — Medium Hair','name_ar','سيشوار شعر متوسط','category','Hair Blow Out','duration','','price_sar','170','notes',''),
    jsonb_build_object('name','Blow Out — Long Hair','name_ar','سيشوار شعر طويل','category','Hair Blow Out','duration','','price_sar','200','notes',''),
    jsonb_build_object('name','Hair Styling','name_ar','تسريحة','category','Hair Blow Out','duration','','price_sar','250–300','notes','Price depends on the style.'),
    jsonb_build_object('name','Hair Trim','name_ar','قص اطراف','category','Hair Cut','duration','','price_sar','50','notes',''),
    jsonb_build_object('name','Hair Trim & Bangs','name_ar','قص اطراف وغرة','category','Hair Cut','duration','','price_sar','100','notes',''),
    jsonb_build_object('name','Model Haircut','name_ar','قص موديل','category','Hair Cut','duration','','price_sar','150','notes',''),
    jsonb_build_object('name','Half Hands & Half Legs Wax','name_ar','نصف يدين ونصف رجلين','category','Waxing','duration','','price_sar','150','notes',''),
    jsonb_build_object('name','Face Wax','name_ar','واكس الوجه','category','Waxing','duration','','price_sar','80','notes',''),
    jsonb_build_object('name','Eyebrow Bleaching','name_ar','تشقير الحواجب','category','Waxing','duration','','price_sar','40','notes',''),
    jsonb_build_object('name','Eyebrow Tinting','name_ar','صبغ الحواجب','category','Waxing','duration','','price_sar','40','notes','')
  ]) with ordinality as t(d, ordinality);
end if;

-- 6) ── Competitor watch rows ────────────────────────────────────────────
if not exists (select 1 from public.brand_directory_rows where workspace_id = ws and section_key = 'competitors') then
  insert into public.brand_directory_rows (workspace_id, section_key, sort_order, data)
  select ws, 'competitors', (ordinality * 10)::int, d
  from unnest(array[
    jsonb_build_object('name','Urban Company','positioning','Broad on-demand home services marketplace operating in the Saudi market.','how_we_differ','Aqeeq is a boutique, curated spa service with its own visual identity — not a marketplace listing among hundreds.','watch_url',''),
    jsonb_build_object('name','Na3iman','positioning','At-home beauty and wellness platform in the Saudi market.','how_we_differ','Aqeeq leads on atmosphere and the feeling of a genuine escape, with a distinct sage/beige world rather than a generic app aesthetic.','watch_url',''),
    jsonb_build_object('name','Ozeyl','positioning','At-home beauty and wellness platform in the Saudi market.','how_we_differ','Aqeeq keeps a tight, curated menu instead of a broad catalogue, which keeps quality consistent.','watch_url',''),
    jsonb_build_object('name','Ozee','positioning','At-home beauty and wellness platform in the Saudi market.','how_we_differ','Aqeeq''s calm, unhurried tone and premium visual language set it apart from transactional on-demand messaging.','watch_url',''),
    jsonb_build_object('name','Hello App','positioning','At-home beauty and wellness platform in the Saudi market.','how_we_differ','Aqeeq positions as a luxurious escape brought home, not a convenience utility.','watch_url','')
  ]) with ordinality as t(d, ordinality);
end if;

end $$;
