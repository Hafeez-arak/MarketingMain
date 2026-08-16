-- ════════════════════════════════════════════════════════════════════════
-- Brand Brain structure + content — Alo Kheyatah (آلو خياطة)
-- ════════════════════════════════════════════════════════════════════════
-- On-demand tailoring & alterations, Riyadh. Source: the marketing team's
-- brand brain document.
--
-- Structure differs from both Arak and Aqeeq: it carries a "Service Model"
-- field (pickup/drop-off vs. the on-site tailoring truck) that neither of
-- the others needs, a "Pricing Rules" field for the 300 SAR minimum and
-- express surcharge, and an Alterations & Pricing directory that splits
-- general from kids' work. No Suppliers and no Competitor Watch — the
-- brand brain supplies neither, and marketing can add them from the
-- interface if that changes.
--
-- Prices are stored but the price column is in_prompt = false, so the
-- catalogue can inform generation without pushing 20 price points into
-- every call.
--
-- Idempotent: ON CONFLICT DO NOTHING throughout.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare ws uuid;
begin
  select id into ws from public.workspaces where name = 'Alo Kheyatah';
  if ws is null then raise exception 'Alo Kheyatah workspace not found'; end if;

-- 1) ── Sections ─────────────────────────────────────────────────────────
insert into public.brand_sections (workspace_id, key, title, description, kind, icon, sort_order) values
  (ws, 'identity_voice',   'Identity & Craft',       'Who Alo Kheyatah is, how it serves, and the register it speaks in.',        'fields',    'identity',  10),
  (ws, 'guardrails',       'Guardrails',             'Hard rules — the editorial atelier tone and what cheapens it.',             'fields',    'guardrails',20),
  (ws, 'audience',         'Audience',               'The clients who care about fit, and what brings them in.',                  'fields',    'audience',  30),
  (ws, 'visual',           'Visual Identity',        'The burgundy / beige / olive world and the editorial look.',                'fields',    'visual',    40),
  (ws, 'market',           'Market Context',         'Riyadh alterations market and the seasonal moments worth riding.',          'fields',    'market',    50),
  (ws, 'knowledge_centre', 'Knowledge Centre',       'Languages, pricing rules, offers and contact — powers WhatsApp & email.',   'fields',    'knowledge', 60),
  (ws, 'asset_library',    'Asset Library',          'Garment photography, the wordmark, fabric references the AI draws from.',   'assets',    'assets',    70),
  (ws, 'alterations',      'Alterations & Pricing',  'Every alteration service with its Arabic name, unit and price.',            'directory', 'products',  80)
on conflict (workspace_id, key) do nothing;

-- 2) ── Fields ───────────────────────────────────────────────────────────
insert into public.brand_fields
  (workspace_id, section_key, key, label, hint, placeholder, input_type, rows, storage_column, prompt_label, sort_order) values

  (ws, 'identity_voice', 'positioning', 'Positioning', 'Where Alo Kheyatah sits, in one line.',
   'e.g. Professional tailoring that comes to you', 'textarea', 3, 'positioning', 'Market positioning', 10),
  (ws, 'identity_voice', 'core_feeling', 'Core Feeling', 'The single impression every post should leave behind.',
   'e.g. Refined, detail-oriented craftsmanship', 'textarea', 2, '', 'Core feeling to evoke', 20),
  (ws, 'identity_voice', 'value_proposition', 'What Alo Kheyatah Promises', 'The core promise to the client.',
   'e.g. Atelier-standard alterations, collected and returned', 'textarea', 3, 'value_proposition', 'Value proposition', 30),
  (ws, 'identity_voice', 'service_model', 'Service Model', 'The two ways a client can be served. Content should make the choice obvious.',
   'e.g. 1. Pickup & drop-off  2. On-site tailoring truck', 'textarea', 5, '', 'How the service is delivered', 40),
  (ws, 'identity_voice', 'brand_personality', 'Brand Personality', 'Alo Kheyatah as a person — the AI writes in this character.',
   'e.g. A detail-obsessed atelier friend', 'textarea', 2, '', 'Brand personality', 50),
  (ws, 'identity_voice', 'voice_descriptors', 'Tone Words', 'A few descriptors, comma separated. The first thing every AI call reads.',
   'e.g. elegant, precise, trustworthy, editorial', 'text', 1, 'voice_descriptors', 'Brand voice', 60),
  (ws, 'identity_voice', 'company_facts', 'Company Facts', 'Hard facts the AI can state with confidence — one per line.',
   'e.g. On-demand tailoring service based in Riyadh', 'textarea', 4, 'company_facts', 'Facts the brand can state', 70),

  (ws, 'guardrails', 'tone_dos', 'Always Do', 'Habits the AI should reach for by default.',
   'e.g. Write in an educational, expert register', 'textarea', 5, 'tone_dos', 'Always do', 10),
  (ws, 'guardrails', 'tone_donts', 'Never Do', 'Banned phrases and patterns. Be specific — vague rules get ignored.',
   'e.g. Never position as a discount alterations shop', 'textarea', 5, 'tone_donts', 'Never do', 20),

  (ws, 'audience', 'target_personas', 'Who We Serve', 'The clients the content is actually written for.',
   'e.g. Women in Riyadh who own evening wear and abayas needing precise alteration', 'textarea', 4, 'target_personas', 'Target audience', 10),
  (ws, 'audience', 'booking_occasions', 'Booking Occasions', 'The moments that make someone book — drives the content calendar.',
   'e.g. Weddings, Eid, seasonal wardrobe updates', 'textarea', 4, '', 'Occasions clients book for', 20),
  (ws, 'audience', 'client_values', 'What They Value', 'What the client is really buying, beyond the alteration itself.',
   'e.g. Precision fit, convenience, reliability', 'textarea', 4, '', 'What the audience values', 30),
  (ws, 'audience', 'pain_points', 'Pain Points We Solve', 'The frustrations Alo Kheyatah removes — the angle most posts should hit.',
   'e.g. Repeated trips to a physical tailor', 'textarea', 4, '', 'Pain points we solve', 40),

  (ws, 'visual', 'brand_colors', 'Brand Colours', 'Palette + what each colour is for. Fed to the image generator.',
   'e.g. Burgundy (primary accent), beige (neutral base), olive (secondary)', 'textarea', 5, 'brand_colors', 'Brand colours', 10),
  (ws, 'visual', 'visual_identity', 'Logo & Typography', 'The wordmark, where it sits, and the type treatment.',
   'e.g. آلو خياطة in gold Arabic calligraphy with a needle-and-thread icon', 'textarea', 4, 'visual_identity', 'Logo & typography', 20),
  (ws, 'visual', 'visual_modes', 'Visual Modes', 'The distinct looks the brand alternates between — pick one per post.',
   'e.g. Editorial atelier · Infographic · Mood board · Collection grid · Flat-lay', 'textarea', 6, '', 'Visual modes (pick one per post)', 30),
  (ws, 'visual', 'visual_style_notes', 'AI Image Style Defaults', 'How generated imagery should default to looking, before a user picks a style.',
   'e.g. Rich fabric texture, editorial lighting, considered backgrounds', 'textarea', 5, 'visual_style_notes', 'Visual style defaults', 40),
  (ws, 'visual', 'content_formats', 'Recurring Content Formats', 'The post formats that already work — reach for these first.',
   'e.g. Before/after transformations, fabric guides, tip carousels', 'textarea', 6, '', 'Recurring content formats', 50),

  (ws, 'market', 'market_context', 'Market Context', 'Riyadh market dynamics and seasonal angles worth riding.',
   'e.g. Wedding season, Eid, seasonal wardrobe changeovers', 'textarea', 5, 'market_context', 'Market context', 10),

  (ws, 'knowledge_centre', 'languages', 'Languages', 'Which languages content is produced in, and per-language tone rules.',
   'e.g. Bilingual Arabic + English; Arabic must read native', 'textarea', 4, 'languages', 'Languages', 10),
  (ws, 'knowledge_centre', 'arabic_rendering', 'Arabic on Images', 'How Arabic text gets onto generated images. A real production trap — keep it here.',
   'e.g. Never trust the image model to letter Arabic; overlay manually', 'textarea', 3, '', 'Arabic text handling on images', 20),
  (ws, 'knowledge_centre', 'offers_ctas', 'Offers & CTAs', 'The specific actions we push audiences toward — one per line.',
   'e.g. Book a pickup for your alterations', 'textarea', 4, 'offers_ctas', 'Offers & calls-to-action to push', 30),
  (ws, 'knowledge_centre', 'pricing_rules', 'Pricing Rules', 'The rules that sit on top of the price list — minimums, surcharges, what is excluded.',
   'e.g. Minimum 300 SAR incl. delivery; express +100 SAR', 'textarea', 5, '', 'Pricing rules', 40),
  (ws, 'knowledge_centre', 'price_list_summary', 'Price List Summary', 'A compact prompt-friendly version of the full list. The Alterations directory below is the editable source.',
   'e.g. Evening wear taking in / shortening 300 SAR per piece…', 'textarea', 6, 'product_index', 'Alterations price list', 50),
  (ws, 'knowledge_centre', 'contact_info', 'Contact & Booking', 'Phone, WhatsApp, booking link, service hours, coverage area.',
   'e.g. WhatsApp: +966…  Booking: …  Areas covered: Riyadh', 'textarea', 4, 'contact_info', 'Contact & booking details', 60),
  (ws, 'knowledge_centre', 'compliance_notes', 'Compliance', 'Opt-in / unsubscribe rules — needed before WhatsApp or email campaigns go out.',
   'e.g. WhatsApp: opt-in required, add "Reply STOP to unsubscribe".', 'textarea', 3, 'compliance_notes', 'Compliance rules (esp. WhatsApp/email)', 70)
on conflict (workspace_id, key) do nothing;

-- 3) ── Directory columns ────────────────────────────────────────────────
insert into public.brand_directory_columns (workspace_id, section_key, key, label, placeholder, wide, in_prompt, sort_order) values
  (ws, 'alterations', 'name',      'Service (English)', 'e.g. Shortening evening wear', false, true,  10),
  (ws, 'alterations', 'name_ar',   'Service (Arabic)',  'e.g. تقصير قطع السهرة',          false, true,  20),
  (ws, 'alterations', 'category',  'List',              'General / Kids',               false, true,  30),
  (ws, 'alterations', 'unit',      'Unit',              'e.g. per piece, per 5 pieces', false, true,  40),
  (ws, 'alterations', 'price_sar', 'Price (SAR)',       'e.g. 300',                     false, false, 50),
  (ws, 'alterations', 'notes',     'Notes',             'exclusions, add-ons, conditions', true, true, 60)
on conflict (workspace_id, section_key, key) do nothing;

-- 4) ── The profile itself — fixed columns + custom_fields JSON ──────────
insert into public.brand_profile (
  workspace_id, positioning, value_proposition, voice_descriptors, company_facts,
  tone_dos, tone_donts, target_personas, brand_colors, visual_identity,
  visual_style_notes, market_context, languages, offers_ctas, product_index,
  contact_info, compliance_notes, caption_language, arabic_dialect, custom_fields, updated_at
) values (
  ws,
  'Convenient, professional tailoring that comes to you — precision and craftsmanship without the back-and-forth of a traditional tailor shop. Premium and editorial, never a bargain alterations counter.',
  'Garment alterations done to atelier standard, collected from and returned to the client — or altered on the spot by a mobile tailoring truck at their door.',
  'elegant, precise, trustworthy, editorial, quality-focused',
  'On-demand tailoring and alterations service based in Riyadh, Saudi Arabia
Two service models: pickup and drop-off by driver, and an on-site mobile tailoring truck
Handles evening wear, abayas, jackets, formal suits and casual pieces
A separate price list covers kids'' alterations
Bilingual service and content: Arabic and English
Brand name آلو خياطة (Alo Kheyatah)',
  'Write in an educational, expert register — fabric guides, styling tips, body-shape guidance
Show the craft: fabric texture, sewing detail, before-and-after transformations
Reference quality fabric and construction details specifically
Keep captions polished and editorial
Produce bilingual Arabic and English content
Speak like a knowledgeable stylist or atelier, not a shop',
  'Never position as a discount or bargain alterations shop — this is a premium, precision service
No cluttered or low-quality product photography
No hashtag or emoji overload — keep captions polished
Avoid casual, chatty phrasing that undercuts the atelier tone
Do not lead with price',
  'Women in Riyadh who own evening wear, abayas and formal pieces needing precise alteration
Fashion-conscious clients who value fit and craftsmanship
Style-savvy, higher-end clientele — the feed references designer pieces (Dior, Prada) as style inspiration
Mothers arranging alterations for children''s occasion wear',
  'Beige / cream — neutral base, used in styled flat-lays and mood boards
Burgundy / wine — primary accent; dominant in logo backgrounds, fabric shots and dress collections
Olive green — secondary accent; styled outfit flat-lays alongside burgundy and beige
Teal blue — accent used to add contrast within fabric and outfit palettes
Black — bold background block (top of the price list, some post backgrounds)',
  'Logo: آلو خياطة in elegant gold Arabic calligraphy, paired with a needle-and-thread icon above the wordmark, set on a deep burgundy or black background. Premium and editorial, never casual.
Typography: elegant gold Arabic calligraphy for the logo; clean minimal sans-serif (English and Arabic) for captions and infographic text.
Every post carries the آلو خياطة wordmark, usually bottom-left or bottom-centre.',
  'Default to the beige / burgundy / olive palette
Rich fabric texture and close sewing detail rather than wide product shots
Editorial lighting — soft and directional, never flat
Clean, uncluttered compositions with a considered background
Show real garments and real workmanship, not generic tailoring stock imagery',
  'Riyadh, Saudi Arabia. Demand is driven by event and occasion wear — weddings, formal gatherings, Eid — alongside everyday abaya and casualwear fit adjustments.
The convenience angle (pickup/drop-off and the on-site truck) is the main differentiator against traditional tailor shops, which require repeated visits.
Seasonal peaks: wedding season, Eid, and seasonal wardrobe changeovers.',
  'All content bilingual — Arabic and English — unless stated otherwise.
Arabic should read as natural, native Saudi-market Arabic, not translated English, while keeping the polished editorial register.
Keep the same premium tone in both languages.',
  'Book a pickup for your alterations
Request the on-site tailoring truck
Book a measuring service
Get evening wear altered before your event
Request express turnaround',
  'General alterations: taking in evening wear 300 · shortening evening wear 300 · every 5 casual pieces 300 · every 3 wool pieces 300 · jackets tweed/leather 300 · jackets wool 150 · jackets lined 200 · velvet jalabiyas / lined abayas 150 · lined or velvet abayas 150 · formal suit trousers 70 · formal suit jacket 150 · closing openings on evening wear 300 · installing lining from 150 (fabric not included) · custom shalha tailoring 150 (fabric not included) · installing cups 100 (added to the dress price) · installing waistband 150 · measuring service 100 SAR.
Kids: every 5 regular pieces 300 · shortening evening dresses 200 per piece · taking in evening dresses 200 per piece.
Minimum charge for tailoring plus delivery: 300 SAR. Express service: +100 SAR.',
  '',   -- contact_info: not supplied by the brand brain — for marketing to fill
  '',   -- compliance_notes: not supplied — needed before WhatsApp/email campaigns
  'both',
  'saudi',
  jsonb_build_object(
    'core_feeling',      'Refined, professional, detail-oriented craftsmanship — elevated but approachable.',
    'service_model',     'Two ways to be served:
1. Pickup and drop-off — a driver collects the item(s) from the client, takes them to the workshop for alteration, then returns them.
2. On-site truck service — a mobile tailoring truck comes directly to the client''s home and performs the alteration on the spot.',
    'brand_personality', 'A skilled, detail-obsessed atelier friend who makes sure every piece fits exactly right — polished, editorial, never rushed.',
    'booking_occasions', 'Weddings and formal events
Eid and family gatherings
Seasonal wardrobe updates
Everyday abaya and casualwear fit adjustments
Children''s occasion wear before a family event',
    'client_values',     'Precision fit
Convenience — no trip to a tailor shop
Reliability and predictable turnaround
Quality of workmanship
Privacy of doorstep service',
    'pain_points',       'Time-consuming trips to a physical tailor, often more than once
Uncertainty about fit and craftsmanship quality
Lack of convenient on-demand alteration options',
    'visual_modes',      'Editorial atelier — polaroid-style before/after garment transformations, sewing machine close-ups with rich fabric (burgundy satin), thread spool flat-lays.
Infographic / educational — fabric guide pie charts, body-shape-to-dress-style guides, numbered tip carousels.
Mood board / collage — fabric swatches, designer tags and garment details combined.
Collection grid — rows of dresses or abayas in a consistent palette (black, cream, taupe, burgundy) with matching fabric swatches underneath.
Styled flat-lay — outfit pieces (blazer, blouse, trousers, bag) arranged in the brand palette.',
    'content_formats',   'Fabric-type infographics (e.g. best fabrics for sensitive skin)
Before/after garment alteration posts, polaroid style
Sewing machine and atelier process video
Seasonal greeting posts (e.g. "Hello August") tied to a garment
Mood-board / collage posts with fabric swatches and garment details
Dress and abaya collection lineups matched with fabric swatches
Numbered styling tip carousels (e.g. ideas for closing a neckline gap)
Styled outfit flat-lays
Clothing rack lifestyle shots
Body-shape-to-dress-style guides
Thread spool and fabric pattern flat-lays',
    'pricing_rules',     'Minimum charge for tailoring service plus delivery: 300 SAR.
Express / rush service: +100 SAR.
Installing lining and custom shalha tailoring are quoted from the listed price — fabric is not included.
Installing cups (100 SAR) is added on top of the dress price.
Measuring service is 100 SAR, or 100 SAR combined with an alteration service.',
    'arabic_rendering',  'Arabic text on AI-generated images must be manually verified or added via an overlay step. Arabic rendering is a known weak point for image generators — never trust the model to letter it correctly.
Check letter joining and right-to-left order before anything is published.'
  ),
  now()
) on conflict (workspace_id) do nothing;

-- 5) ── Alterations & pricing rows ───────────────────────────────────────
if not exists (select 1 from public.brand_directory_rows where workspace_id = ws and section_key = 'alterations') then
  insert into public.brand_directory_rows (workspace_id, section_key, sort_order, data)
  select ws, 'alterations', (ordinality * 10)::int, d
  from unnest(array[
    jsonb_build_object('name','Taking in evening wear','name_ar','تضييق قطع السهرة','category','General','unit','per piece','price_sar','300','notes',''),
    jsonb_build_object('name','Shortening evening wear','name_ar','تقصير قطع السهرة','category','General','unit','per piece','price_sar','300','notes',''),
    jsonb_build_object('name','Casual pieces','name_ar','كل خمس قطع عادية','category','General','unit','per 5 pieces','price_sar','300','notes',''),
    jsonb_build_object('name','Wool pieces','name_ar','كل ثلاث قطع صوف','category','General','unit','per 3 pieces','price_sar','300','notes',''),
    jsonb_build_object('name','Jackets — tweed / leather','name_ar','الجاكيتات الجوخ/الجلد','category','General','unit','per piece','price_sar','300','notes',''),
    jsonb_build_object('name','Jackets — wool','name_ar','الجاكيتات الصوف','category','General','unit','per piece','price_sar','150','notes',''),
    jsonb_build_object('name','Jackets — lined pieces','name_ar','الجاكيتات قطع مبطنة','category','General','unit','per piece','price_sar','200','notes',''),
    jsonb_build_object('name','Velvet — jalabiyas / lined abayas','name_ar','المخمل، جلابيات، عبايات مبطنة','category','General','unit','per piece','price_sar','150','notes',''),
    jsonb_build_object('name','Abayas — lined / velvet','name_ar','العبايات المبطنة/المخمل','category','General','unit','per piece','price_sar','150','notes',''),
    jsonb_build_object('name','Formal suit — trousers','name_ar','البدلة الرسمية البناطيل','category','General','unit','per piece','price_sar','70','notes',''),
    jsonb_build_object('name','Formal suit — jacket','name_ar','البدلة الرسمية الجاكيت','category','General','unit','per piece','price_sar','150','notes',''),
    jsonb_build_object('name','Closing openings on evening wear','name_ar','تسكير الفتحات للسهرة','category','General','unit','per piece','price_sar','300','notes',''),
    jsonb_build_object('name','Installing lining','name_ar','تركيب البطانة','category','General','unit','per piece','price_sar','from 150','notes','Fabric not included.'),
    jsonb_build_object('name','Custom shalha tailoring','name_ar','تفصيل شلحة','category','General','unit','per piece','price_sar','150','notes','Fabric not included.'),
    jsonb_build_object('name','Installing cups','name_ar','تركيب كب','category','General','unit','per piece','price_sar','100','notes','Added on top of the dress price.'),
    jsonb_build_object('name','Installing waistband','name_ar','تركيب كمر','category','General','unit','per piece','price_sar','150','notes',''),
    jsonb_build_object('name','Measuring service','name_ar','خدمة القياس','category','General','unit','per visit','price_sar','100','notes','100 SAR, or 100 SAR combined with an alteration service.'),
    jsonb_build_object('name','Kids — regular pieces','name_ar','كل ٥ قطع عادية','category','Kids','unit','per 5 pieces','price_sar','300','notes',''),
    jsonb_build_object('name','Kids — shortening evening dresses','name_ar','تقصير فساتين السهرة','category','Kids','unit','per piece','price_sar','200','notes',''),
    jsonb_build_object('name','Kids — taking in evening dresses','name_ar','تضييق فساتين السهرة','category','Kids','unit','per piece','price_sar','200','notes','')
  ]) with ordinality as t(d, ordinality);
end if;

end $$;
