-- ════════════════════════════════════════════════════════════════════════
-- Brand Brain structure + content — Ghusn (غُصن)
-- ════════════════════════════════════════════════════════════════════════
-- Landscape design and build company, Riyadh. Sources, all in the Ghusn
-- website repository: the live site copy (dist/index.html and the six
-- project pages), its Arabic strings (i18n/ar.json), the 20-page company
-- profile (source-materials/company-profile-original.pdf), the site's colour
-- tokens (dist/site.css) and docs/image-brief.md.
--
-- The shape is a project company's, not a menu's: a Services directory with
-- no prices (none are published anywhere), a Key Projects directory for the
-- six portfolio sites, and fields for the process, the sectors and the
-- official bilingual lines.
--
-- Decisions taken with the owner on 2026-10-01:
--   · Audience: companies and B2B projects first, villas and homes as well.
--   · Captions in Arabic and English.
--
-- What is deliberately NOT here, because no source supplies it:
--   · Social handles, prices, years in business, awards, certifications.
--   · Competitors — the directory is created empty; "Find rivals" on the
--     Insights page proposes them.
--   · Compliance rules — empty, to be filled before WhatsApp or email
--     campaigns go out.
--
-- Two market lines are general knowledge rather than from the files (the
-- national green-space programmes and the cool-season note); both are in
-- market_context and say so.
--
-- Numbers follow the website (25+ projects). The profile PDF prints "+05"
-- for projects, which reads as a typo next to "+05K m²"; the website figure
-- is the one the team last edited.
--
-- Idempotent: ON CONFLICT DO NOTHING throughout, so re-running never
-- overwrites edits made in the interface.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare ws uuid;
begin
  select id into ws from public.workspaces where name = 'Ghusn';
  if ws is null then raise exception 'Ghusn workspace not found'; end if;

-- 1) ── Sections ─────────────────────────────────────────────────────────
insert into public.brand_sections (workspace_id, key, title, description, kind, icon, sort_order, tasks) values
  (ws, 'identity_voice',   'Identity & Voice',  'Who Ghusn is, what it promises and how it speaks. Read first on every generation.', 'fields',    'identity',    10, '{}'),
  (ws, 'guardrails',       'Guardrails',        'Hard rules: the plain, practical register, and the claims Ghusn does not make.',    'fields',    'guardrails',  20, '{}'),
  (ws, 'audience',         'Audience',          'Business and project clients first, villa owners as well, and what makes them call.', 'fields',  'audience',    30, '{}'),
  (ws, 'visual',           'Visual Identity',   'Forest green, bronze and limestone; real sites by day and after dark.',            'fields',    'visual',      40, '{}'),
  (ws, 'market',           'Market Context',    'Riyadh''s climate and the sectors Ghusn works in.',                                'fields',    'market',      50, '{}'),
  (ws, 'knowledge_centre', 'Knowledge Centre',  'Languages, Arabic handling, calls to action and contact details.',                 'fields',    'knowledge',   60, '{}'),
  (ws, 'asset_library',    'Asset Library',     'Real project photos, the logo and references the AI draws from.',                  'assets',    'assets',      70, '{}'),
  (ws, 'services',         'Services',          'The seven things Ghusn does, with their Arabic names.',                            'directory', 'products',    80, array['plan','caption','chat','research']),
  (ws, 'projects',         'Key Projects',      'The six portfolio sites: what was there and what Ghusn did.',                      'directory', 'market',      90, array['plan','caption','chat']),
  (ws, 'competitors',      'Competitor Watch',  'Other landscape companies Ghusn is measured against, and how it differs.',         'directory', 'competitors',100, array['plan','research','chat'])
on conflict (workspace_id, key) do nothing;

-- 2) ── Fields ───────────────────────────────────────────────────────────
-- brand_name and brand_descriptor are include_in_prompt = false: buildContext
-- emits them as the identity line that opens every prompt, so letting the
-- flattener print them again would say the same thing twice.
insert into public.brand_fields
  (workspace_id, section_key, key, label, hint, placeholder, input_type, rows,
   storage_column, prompt_label, include_in_prompt, sort_order, tasks) values

  (ws, 'identity_voice', 'brand_name', 'Brand Name',
   'How the brand names itself, including the Arabic wordmark. Opens every AI prompt.',
   '', 'text', 1, '', '', false, 1, '{}'),
  (ws, 'identity_voice', 'brand_descriptor', 'One-Line Descriptor',
   'One line finishing the sentence "You are writing for <Brand Name>, ___". What the company actually is.',
   '', 'textarea', 2, '', '', false, 2, '{}'),
  (ws, 'identity_voice', 'positioning', 'Positioning', 'Where Ghusn sits, in one line.',
   'e.g. One landscape team from the first sketch to the weekly visit', 'textarea', 3,
   'positioning', 'Market positioning', true, 10, array['plan','caption','research','chat']),
  (ws, 'identity_voice', 'value_proposition', 'What Ghusn Promises', 'The core promise to a client.',
   'e.g. Design, planting and water that work together', 'textarea', 3,
   'value_proposition', 'Value proposition', true, 20, array['plan','caption','chat']),
  (ws, 'identity_voice', 'mission', 'Vision & Mission', 'The two statements from the company profile.',
   '', 'textarea', 4, 'mission', 'Vision and mission', true, 30, array['plan','caption','chat']),
  (ws, 'identity_voice', 'brand_story', 'Brand Story', 'The narrative the AI draws on: the name, the method, the attitude.',
   '', 'textarea', 5, 'brand_story', 'Brand story', true, 40, array['plan','caption','chat']),
  (ws, 'identity_voice', 'brand_personality', 'Brand Personality', 'Ghusn as a person. The AI writes in this character.',
   'e.g. A calm site engineer who loves plants', 'textarea', 2,
   '', 'Brand personality', true, 50, array['plan','caption','chat']),
  (ws, 'identity_voice', 'voice_descriptors', 'Tone Words', 'A few descriptors, comma separated. The first thing every AI call reads.',
   'e.g. practical, grounded, calm', 'text', 1,
   'voice_descriptors', 'Brand voice', true, 60, array['plan','caption','chat']),
  (ws, 'identity_voice', 'brand_lines', 'Official Lines (English + Arabic)', 'The approved wording of the tagline and recurring lines. Use these exactly; do not re-translate them.',
   '', 'textarea', 6, '', 'Official brand lines (use this exact wording)', true, 70, array['plan','caption','chat']),
  (ws, 'identity_voice', 'company_facts', 'Company Facts', 'Hard facts the AI can state with confidence, one per line.',
   '', 'textarea', 8, 'company_facts', 'Facts the brand can state', true, 80, array['plan','caption','research','chat']),
  (ws, 'identity_voice', 'process', 'How a Project Runs', 'The five steps, in order. Good for process posts and for answering "how does it work?".',
   '', 'textarea', 6, '', 'How a project runs (five steps)', true, 90, array['plan','caption','chat']),

  -- Both are writing rules, so they are tagged away from image and video:
  -- a picture model handed "Say we" and a list of banned phrases has nothing
  -- to do with them, and one lane has rejected a brief for exactly that. The
  -- rules a picture needs live in the Visual Identity section instead.
  (ws, 'guardrails', 'tone_dos', 'Always Do', 'Habits the AI should reach for by default.',
   '', 'textarea', 8, 'tone_dos', 'Always do', true, 10, array['plan','caption','research','chat']),
  (ws, 'guardrails', 'tone_donts', 'Never Do', 'Banned phrases, patterns and claims. Be specific: vague rules get ignored.',
   '', 'textarea', 8, 'tone_donts', 'Never do', true, 20, array['plan','caption','research','chat']),

  (ws, 'audience', 'target_personas', 'Who We Serve', 'Who the content is written for, in priority order.',
   '', 'textarea', 9, 'target_personas', 'Target audience', true, 10, array['plan','caption','research','chat']),
  (ws, 'audience', 'decision_triggers', 'When They Call Us', 'The moments that make someone look for a landscape company. Drives the content calendar.',
   'e.g. A new site is about to open', 'textarea', 6, '', 'Moments that make clients call', true, 20, array['plan','caption','chat']),
  (ws, 'audience', 'client_values', 'What They Value', 'What the client is really buying, beyond the planting itself.',
   '', 'textarea', 6, '', 'What the audience values', true, 30, array['plan','caption','chat']),
  (ws, 'audience', 'pain_points', 'Pain Points We Solve', 'The frustrations Ghusn removes. The angle most posts should hit.',
   '', 'textarea', 6, '', 'Pain points we solve', true, 40, array['plan','caption','chat']),

  (ws, 'visual', 'brand_colors', 'Brand Colours', 'Palette, hex codes and what each colour is for. Fed to the image generator.',
   '', 'textarea', 7, 'brand_colors', 'Brand colours', true, 10, array['image','video']),
  (ws, 'visual', 'visual_identity', 'Logo & Typography', 'The mark, the wordmark, the type and the leaf-corner shape.',
   '', 'textarea', 6, 'visual_identity', 'Logo & typography', true, 20, array['image','video']),
  (ws, 'visual', 'visual_modes', 'Visual Modes', 'The distinct looks the brand alternates between. Pick one per post.',
   '', 'textarea', 6, '', 'Visual modes (pick one per post)', true, 30, array['image','video']),
  (ws, 'visual', 'visual_style_notes', 'AI Image Style Defaults', 'How generated imagery should default to looking, before a user picks a style.',
   '', 'textarea', 7, 'visual_style_notes', 'Visual style defaults', true, 40, array['image','video']),
  (ws, 'visual', 'photo_honesty', 'Real Work & AI Imagery', 'What may be shown as Ghusn''s work, and what the image model must never draw.',
   '', 'textarea', 5, '', 'Rules for real photos and AI imagery', true, 50, array['plan','image','video']),
  (ws, 'visual', 'content_formats', 'Recurring Content Formats', 'The post formats that suit this brand. Reach for these first.',
   '', 'textarea', 8, '', 'Recurring content formats', true, 60, array['plan','caption','chat']),

  (ws, 'market', 'market_context', 'Market Context', 'Riyadh climate, the evening habit, and the national push for green space.',
   '', 'textarea', 7, 'market_context', 'Market context', true, 10, array['plan','research','chat']),
  (ws, 'market', 'sectors', 'Sectors We Work In', 'The six sectors from the company profile, and what each one needs.',
   '', 'textarea', 6, '', 'Sectors served', true, 20, array['plan','research','chat']),
  (ws, 'market', 'key_projects', 'Clients & Reference Work', 'Clients and projects the AI can credibly name when relevant.',
   '', 'textarea', 5, 'key_projects', 'Reference when relevant', true, 30, array['plan','caption','research','chat']),
  (ws, 'market', 'geography', 'Where We Work', 'The market in your own words. The research calendar reads this.',
   'e.g. Riyadh first, projects across Saudi Arabia', 'text', 1, '', 'Where the brand works', true, 40, array['plan','research','chat']),
  -- Read by the research agent to decide which lenses lead (lenses.js
  -- motionOf). A setting, not copy, so it stays out of the prompt.
  (ws, 'market', 'sales_motion', 'How Ghusn Sells', 'One of: specification, local_service, product. Decides what the research agent looks for first.',
   'specification', 'text', 1, '', '', false, 50, '{}'),

  (ws, 'knowledge_centre', 'languages', 'Languages', 'Which languages content is produced in, and per-language tone rules.',
   '', 'textarea', 5, 'languages', 'Languages', true, 10, array['caption','chat']),
  (ws, 'knowledge_centre', 'arabic_rendering', 'Arabic on Images', 'How Arabic text gets onto generated images. A real production trap, so it is written down.',
   '', 'textarea', 3, '', 'Arabic text handling on images', true, 20, array['image','video']),
  (ws, 'knowledge_centre', 'offers_ctas', 'Calls to Action', 'The specific next steps we push audiences toward, one per line.',
   '', 'textarea', 6, 'offers_ctas', 'Calls-to-action to push', true, 30, array['plan','caption','chat']),
  (ws, 'knowledge_centre', 'contact_info', 'Contact', 'Phone, WhatsApp, email, office and website.',
   '', 'textarea', 5, 'contact_info', 'Contact details', true, 40, array['caption','chat']),
  -- Read by the weekly email builder (weekly.js websiteOf) for its links.
  (ws, 'knowledge_centre', 'website', 'Website', 'The public website address.',
   'https://www.example.com', 'text', 1, '', '', false, 50, '{}'),
  (ws, 'knowledge_centre', 'compliance_notes', 'Compliance', 'Opt-in and unsubscribe rules. Needed before WhatsApp or email campaigns go out.',
   'e.g. WhatsApp: opt-in required, add "Reply STOP to unsubscribe".', 'textarea', 3,
   'compliance_notes', 'Compliance rules (esp. WhatsApp/email)', true, 60, '{}')
on conflict (workspace_id, key) do nothing;

-- 3) ── Directory columns ────────────────────────────────────────────────
insert into public.brand_directory_columns (workspace_id, section_key, key, label, placeholder, wide, in_prompt, sort_order) values
  (ws, 'services', 'name',     'Service (English)', 'e.g. Smart irrigation',   false, true, 10),
  (ws, 'services', 'name_ar',  'Service (Arabic)',  'e.g. الري الذكي',          false, true, 20),
  (ws, 'services', 'includes', 'Includes',          'e.g. Design · Installation · Controllers', false, true, 30),
  (ws, 'services', 'notes',    'What It Involves',  'short description used as generation context', true, true, 40),

  (ws, 'projects', 'name',     'Project (English)', 'e.g. A garden to live in', false, true, 10),
  (ws, 'projects', 'name_ar',  'Project (Arabic)',  'e.g. حديقة للحياة اليومية', false, true, 20),
  (ws, 'projects', 'type',     'Type',              'Residential / Commercial / Perimeter', false, true, 30),
  (ws, 'projects', 'location', 'Location',          'e.g. Riyadh',              false, true, 40),
  (ws, 'projects', 'summary',  'What It Is',        'one or two lines about the site and the result', true, true, 50),
  (ws, 'projects', 'scope',    'Scope of Work',     'what Ghusn actually did, comma separated', true, true, 60),
  (ws, 'projects', 'naming',   'Client Naming',     'whether the client may be named, and how', true, true, 70),
  (ws, 'projects', 'page',     'Website Page',      'e.g. /projects/garden-to-live-in', false, false, 80),

  (ws, 'competitors', 'name',          'Name',          'e.g. another Riyadh landscape company', false, true, 10),
  (ws, 'competitors', 'positioning',   'Positioning',   '',            false, true, 20),
  (ws, 'competitors', 'how_we_differ', 'How We Differ', '',            true,  true, 30),
  (ws, 'competitors', 'watch_url',     'Watch URL',     'https://...', false, true, 40)
on conflict (workspace_id, section_key, key) do nothing;

-- 4) ── The profile itself — fixed columns + custom_fields JSON ──────────
insert into public.brand_profile (
  workspace_id, positioning, value_proposition, mission, brand_story, voice_descriptors,
  company_facts, tone_dos, tone_donts, target_personas, brand_colors, visual_identity,
  visual_style_notes, market_context, key_projects, languages, offers_ctas, product_index,
  contact_info, compliance_notes, caption_language, arabic_dialect, custom_fields, updated_at
) values (
  ws,

  -- positioning
  $t$A Riyadh landscape design-and-build company that takes a site from the first sketch to the weekly maintenance visit. One team handles design, construction, planting, irrigation, hardscape, lighting and care, for commercial, hospitality and public sites as well as private villas.$t$,

  -- value_proposition
  $t$One team plans the landscape on paper, builds it under technical supervision, plants it for Riyadh's climate, waters it with smart irrigation, lights it for the evening and keeps it looking right. Design, planting and water work together, so nothing is left for someone else to fix, and the space is still worth sitting in years later.$t$,

  -- mission (vision + mission, website wording)
  $t$Vision: To be one of the leading landscape design and build companies in Saudi Arabia, adding green space that makes cities better to live in.
Mission: Practical, well-engineered landscapes with modern irrigation and planting, delivered on time, committing to high standards.$t$,

  -- brand_story
  $t$Ghusn (غُصن) is Arabic for branch. Ghusn is a Riyadh landscape company that plans every garden on paper first, then builds it, plants it and keeps it growing.
Every site is different. Ghusn looks at the soil, the sun, the way people will move through the space and how much water it can reasonably use, then puts design, planting and irrigation together as one job.
"We don't just plant and install, we design. Every project begins on paper, shaped around your space, your climate and your vision, before a single tool touches the ground."
The work covers villas, courtyards and roof terraces, and commercial, hospitality and public sites where the landscape has to survive heavy daily use.
Most of a good landscape is careful work done every day: preparation, planting, trimming and checking the water.$t$,

  -- voice_descriptors
  'practical, grounded, calm, confident, precise, warm',

  -- company_facts
  $t$Ghusn Landscaping Company (شركة غصن لتنسيق الحدائق): landscape design and build, based in Hittin, Riyadh, Saudi Arabia
"Ghusn" (غُصن) is Arabic for branch
Seven services: landscape design, landscape execution, planting and turf, smart irrigation, hardscape and outdoor features, lighting, care and maintenance
Lighting covers gardens, paths and facades, plus event lighting and 3D projection
5,000+ m² designed and built across its projects
1,000+ plants and trees in the ground
20+ clients from different sectors
25+ projects planned, built and handed over
Six sectors: residential, commercial and offices, healthcare, public and utility sites, infrastructure, hospitality and tourism
Every project starts with a site visit and a design on paper before any work on the ground
Quality control: inspections at each stage, approved technical specs, trained crews, and a final check against the agreed design before handover
Health, safety and environment: risk is assessed through the build; materials and methods are chosen to save water and cut waste
Handover includes operating guidance for the irrigation and a maintenance plan that suits the garden
The website is bilingual, English and Arabic$t$,

  -- tone_dos
  $t$Lead with the site and the result: what was there, what Ghusn did, what it is like to use now
Be specific: name the plant, the material, the step and the reason (shade, water, heavy daily use)
Say "we". Ghusn speaks as one team that designs, builds and maintains
Tie every design choice to how the space is used: shade, movement, evenings outside, the water it can reasonably use
Bring in the Riyadh climate when it explains a choice: heat-tolerant planting, irrigation on a schedule, outdoor life after sunset
For business audiences, talk about durability under heavy daily use, technical supervision, quality checks, on-time delivery, handover and maintenance
Keep sentences short and plain, one idea per post
Write Arabic that reads native to a Saudi reader, never translated; keep the English just as plain
Spell the name Ghusn in English and غصن in Arabic
End with one clear next step: WhatsApp, the enquiry form, or the company profile$t$,

  -- tone_donts
  $t$No hype words: "stunning", "breathtaking", "paradise", "dream garden", "world-class", "luxury redefined"
No claims the brand cannot back: no awards, certifications, years in business, prices, timelines or guarantees
No numbers beyond the four in the company facts (area, plants and trees, clients, projects)
Never present an AI-generated or stock garden as a Ghusn project
Do not name a client as the owner of a specific project unless that project's entry says it may be named; otherwise clients appear only in the "clients who have trusted us" list
Never write "Ghosn"
No urgency tactics, countdowns or discounts
No exclamation-mark headlines, emoji strings or hashtag walls
No advice that ignores the Riyadh climate: thirsty planting, species that cannot take the heat, watering by hand in midday sun
Do not promise work outside the seven listed services$t$,

  -- target_personas
  $t$Companies and project clients come first:
Developers, owners and operators of commercial, office and retail sites who need frontages and grounds that stay presentable under heavy daily use
Hotels, resorts and hospitality operators: arrivals and guest-facing gardens
Restaurant and retail chains' project and facilities teams: drive-through, roadside and branch sites
Healthcare, public, utility and infrastructure sites that need durable planting and irrigation
Main contractors, architects, interior designers and consultants who need a landscape partner that designs, builds and maintains
Facility and property managers looking for regular landscape maintenance
Homes as well:
Villa and estate owners in Riyadh: gardens, courtyards, roof terraces, outdoor seating and lighting
Owners of older gardens that need bringing back: new turf, irrigation corrected, palms cared for$t$,

  -- brand_colors
  $t$Forest green #10271F: the primary brand colour; dark backgrounds, covers and title cards
Pine green #24493B: secondary green for panels and depth on dark layouts
Night #0A1310: the darkest tone, for after-dark imagery
Bronze #B48B5E: the logo mark; headings, lines and accents. Light bronze #D2B085 on dark backgrounds
Limestone #E8E6DE and paper #F4F3EE: light backgrounds, the alternating page colour in the company profile
Ink #15211C: body text on light backgrounds
Lamp amber #F2B96A: for lighting content only, the glow of garden lights after dark
The core pair is forest green and bronze, on limestone when a light background is needed. Amber is never a base colour.$t$,

  -- visual_identity
  $t$The logo is always added afterwards from the real file in the Asset Library. It is described here so layouts leave room for it, not so it can be drawn.
Logo: a leaf-shaped bronze mark, a square with one large rounded corner, cut by a branch and its veins. Beside it sits the Arabic wordmark غُصن above the Latin GHUSN, with "Landscaping Company" underneath. Light version on forest green, dark version on limestone. The mark alone is used small as a sign-off in a corner.
The leaf corner: one large rounded corner and three tight ones, taken from the mark. Used on photos, cards and buttons. It flips for Arabic layouts.
Typography, English: Marcellus for headlines, Figtree for text, IBM Plex Mono for small labels. The company profile sets headings in bronze capitals.
Typography, Arabic: El Messiri for headlines, IBM Plex Sans Arabic for text.
Layouts are calm: one strong photo, a short headline, generous space. Thin bronze line drawings of the leaf mark are used as background decoration.$t$,

  -- visual_style_notes
  $t$Real Riyadh settings: sand-coloured rendered villa walls, limestone paving, date palms and fan palms, clipped hedges and topiary, natural turf, stepping-stone paths, mature shade trees
Daylight shots are clear and natural, with strong sun and real shadows, never over-saturated
Evening shots use warm light only: uplit trees, strip lights under steps, path bollards, wall washes and LED edging. Warm amber, never cool white or coloured light
Only plants that grow in Riyadh. No tulips, temperate woodland or English flower borders
Tidy, finished compositions. Keep the lower part of the frame calm so a caption bar can sit there
Crew shown at work in the Ghusn uniform: dark green, high-visibility vest, cap. Hands and tools matter more than faces
Never ask the image model to draw the logo, the wordmark or any lettering$t$,

  -- market_context
  $t$Riyadh first, with projects across Saudi Arabia: "Rooted in Riyadh. Growing across the Kingdom."
The climate decides everything: plants chosen to cope with Riyadh heat, drip and spray irrigation on controllers that water on schedule and waste less, and shade where people sit and walk.
In Riyadh a lot of outdoor life starts once the sun goes down, so lighting is what makes a garden usable. Ghusn lights steps, paths, trees and walls so a garden is safe to walk through and pleasant to sit in at night.
Commercial, hospitality and public sites need landscapes that survive heavy daily use, not only ones that look right on handover day.
General context, not from Ghusn's own files: Saudi cities are adding green space under Vision 2030 quality-of-life programmes such as Green Riyadh and the Saudi Green Initiative, which is the setting for Ghusn's vision of "green space that makes cities better to live in".
General context, not from Ghusn's own files: the cooler months, roughly October to April, are when gardens are planted and used most; summer is when irrigation and plant survival matter most. Ramadan and Eid evenings, Founding Day (22 February) and National Day (23 September) are natural moments for lit outdoor spaces.$t$,

  -- key_projects
  $t$Clients who have trusted Ghusn, as named on the website and in the company profile: Burj Rafal, Mövenpick Hotels & Resorts, McDonald's, Solitaire, Osus.
They are named as a list of clients. Which site belongs to which client is said only where a Key Projects entry allows it.
Six portfolio projects, all in Riyadh, are described in Key Projects.$t$,

  -- languages
  $t$Every caption is written in both Arabic and English.
Arabic comes first and must read as natural Saudi-market Arabic, never as translated English. Warm and direct rather than formal.
Ghusn's own Arabic uses the word لاندسكيب for landscape (تصميم وتنفيذ اللاندسكيب) and تنسيق الحدائق in the company name. Keep to those.
The English is equally plain: short sentences, no marketing vocabulary.
Service and project names have approved Arabic wording in the Services and Key Projects lists. Use it exactly.$t$,

  -- offers_ctas
  $t$Start a project: send a few lines about the site and what you have in mind
Chat on WhatsApp: +966 55 484 5811
Ask for a site visit, the first step of every project
Download the company profile (PDF, 20 pages)
Ask about lighting
Ask about a maintenance plan$t$,

  -- product_index: the Services directory is the source, so no summary is kept
  '',

  -- contact_info
  $t$Phone / WhatsApp: +966 55 484 5811
Email: info@ghusnsa.com
Office: Hittin, Riyadh, Saudi Arabia
Website: www.ghusnsa.com$t$,

  -- compliance_notes: not supplied; needed before WhatsApp/email campaigns
  '',

  'both',
  'saudi',

  jsonb_build_object(
    'brand_name',       'Ghusn (غُصن)',
    'brand_descriptor', 'a landscape design and build company in Riyadh, Saudi Arabia: it designs, builds, plants, irrigates, lights and maintains gardens and commercial landscapes',
    'brand_personality', 'A calm, experienced site engineer who loves plants: practical, exact, proud of careful daily work, and never showy.',
    'brand_lines', $t$Tagline: "Spaces that come alive." / "مساحات تنبض بالحياة."
Sign-off: "Rooted in Riyadh. Growing across the Kingdom." / "جذورنا في الرياض، وأغصاننا تمتد في أرجاء المملكة."
Method: "It starts on paper, before any tool touches the ground." / "كل مشروع يبدأ على الورق، قبل أن تلمس أي أداة الأرض."
Services: "From the first sketch to the weekly visit." / "من أول رسمة إلى زيارة المتابعة الأسبوعية."
Lighting: "The same garden, after dark." / "الحديقة نفسها، حين يحل الليل."
Promise: "We want every space we hand over to still be worth sitting in years from now." / "نريد لكل مساحة نسلّمها أن تبقى مكاناً يستحق الجلوس فيه لسنوات قادمة."$t$,
    'process', $t$1. Site visit: we walk the site, test the soil, note sun and shade, and listen to what the client needs.
2. Design: layouts and visuals that balance looks with how the space will be used.
3. Technical plan: plant species, irrigation and materials chosen for the local climate.
4. Build: our crews carry out the work under technical supervision and quality control.
5. Handover and care: operating guidance for the irrigation and a maintenance plan that suits the garden.$t$,
    'decision_triggers', $t$A new building, branch or site is approaching handover or opening
A frontage, entrance or roadside perimeter looks tired or was never landscaped
A hotel or venue wants a better arrival for guests
An older garden has declined: patchy turf, a failing irrigation system, neglected palms
The garden is not usable in the evening and needs lighting
Irrigation is wasting water or plants are not surviving the summer
The site needs regular upkeep and nobody owns it$t$,
    'client_values', $t$One team from design to maintenance, with one point of responsibility
Seeing drawings and visuals before anything is dug
Plants that survive Riyadh heat, and irrigation that does not waste water
Technical supervision and quality checks at every stage
Delivery on time
A landscape that still looks right a year later, not only on handover day$t$,
    'pain_points', $t$Design, planting and irrigation split between different parties, with gaps nobody owns
Plants that die in the first summer because they were wrong for the climate
Irrigation that wastes water or was laid out without the planting plan
Gardens that cannot be used after dark
Landscapes that look good at handover and decline within months
Contractors who start digging before there is a design$t$,
    'visual_modes', $t$Five modes, all on brand:
1. Finished sites by day: real gardens and frontages after handover, in clear natural light.
2. After sunset: the same kind of space at dusk and at night, lit warm. Day, dusk and night versions of one garden are a signature format.
3. On site: the crew preparing, planting, laying turf, trimming and checking the water.
4. Paper to reality: a plan, sketch or 3D visual next to the built result.
5. Commercial and public sites: clipped hedges, structured planting and hardscape around a working business.$t$,
    'photo_honesty', $t$Use real Ghusn photos from the Asset Library whenever a post is about Ghusn's work.
Relighting or tidying a real Ghusn photo is fine. A fully AI-invented garden must never be shown or captioned as a Ghusn project; use it only as a concept or illustration, and say so.
Do not let the image model draw the logo, the wordmark or lettering on uniforms and vehicles: it misspells the name (earlier AI clips rendered it as "GHISN"). Add the real logo file afterwards.
Client logos and client buildings are shown only as they already appear on the website and in the company profile.$t$,
    'content_formats', $t$Project spotlight: one of the six portfolio sites, its scope and the result
Before and after of a real site
Day to night: the same garden at dusk and after dark
On site with the crew: planting, turf laying, pruning, irrigation checks, installing lights
It starts on paper: the plan or visual next to the built result
The five-step process, one step per post
Service explainers: smart irrigation, hardscape, lighting, maintenance
Sector posts: what a hotel arrival, a drive-through, an office frontage or a healthcare garden needs
Plant and tree notes for Riyadh heat
The numbers and the clients who have trusted Ghusn
Care tips that lead to a maintenance plan$t$,
    'sectors', $t$Residential: villa gardens, private courtyards, roof terraces and outdoor living areas
Commercial and offices: workplaces, retail frontages and business destinations
Healthcare: calm, accessible outdoor space for patients, visitors and staff
Public and utility sites: civic spaces, service buildings and public realm upgrades
Infrastructure: durable planting and irrigation for large and difficult sites
Hospitality and tourism: hotel arrivals, resorts and guest-facing gardens
Each sector has its own rules, budgets and users; the design and the build are adjusted to fit them.$t$,
    'geography',    'Riyadh first, with projects across Saudi Arabia',
    'sales_motion', 'specification',
    'website',      'https://www.ghusnsa.com',
    'arabic_rendering', $t$Arabic text on AI-generated images must be added as a manual overlay or checked letter by letter. Image models get Arabic letter-joining and right-to-left order wrong, and they misspell the brand name in both scripts.
Use El Messiri for Arabic headlines and IBM Plex Sans Arabic for text, to match the website.$t$
  ),
  now()
) on conflict (workspace_id) do nothing;

-- 5) ── Services ─────────────────────────────────────────────────────────
if not exists (select 1 from public.brand_directory_rows where workspace_id = ws and section_key = 'services') then
  insert into public.brand_directory_rows (workspace_id, section_key, sort_order, data)
  select ws, 'services', (ordinality * 10)::int, d
  from unnest(array[
    jsonb_build_object('name','Landscape design','name_ar','تصميم اللاندسكيب','includes','Site plans · Concepts · 3D visuals',
      'notes','Layouts for homes and commercial sites that balance planting, shade, movement and how the space will actually be used. The client sees drawings and visuals before anything is dug.'),
    jsonb_build_object('name','Landscape execution','name_ar','تنفيذ اللاندسكيب','includes','Site prep · Construction · Quality checks',
      'notes','Ghusn builds what it designs, under technical supervision, from site preparation to the last plant.'),
    jsonb_build_object('name','Planting and turf','name_ar','الزراعة والعشب','includes','Plant selection · Tree supply · Natural turf',
      'notes','Trees, shrubs and turf that suit the site and cope with Riyadh heat. Ghusn supplies them and plants them.'),
    jsonb_build_object('name','Smart irrigation','name_ar','الري الذكي','includes','Design · Installation · Controllers',
      'notes','Drip and spray networks laid out around the planting plan, with controllers that water on schedule and waste less.'),
    jsonb_build_object('name','Hardscape and outdoor features','name_ar','الأعمال الصلبة والعناصر الخارجية','includes','Walkways · Seating · Pergolas',
      'notes','Paths, seating areas, pergolas and edging that give the garden its structure.'),
    jsonb_build_object('name','Lighting','name_ar','الإضاءة','includes','Trees · Paths · Facades · Events',
      'notes','Garden, path and facade lighting, so a space is safe to walk through and pleasant to sit in at night. Ghusn also lights events and runs 3D projection.'),
    jsonb_build_object('name','Care and maintenance','name_ar','العناية والصيانة','includes','Pruning · Lawn care · Irrigation checks',
      'notes','Pruning, hedge shaping, lawn care and irrigation checks on a regular schedule, so the garden still looks right a year later.')
  ]) with ordinality as t(d, ordinality);
end if;

-- 6) ── Key projects ─────────────────────────────────────────────────────
-- 'naming' is what keeps a caption from attributing a site to a client the
-- website itself does not name. Only the commercial project has a client
-- shown anywhere, and the site copy calls it "a recognizable international
-- brand" rather than by name.
if not exists (select 1 from public.brand_directory_rows where workspace_id = ws and section_key = 'projects') then
  insert into public.brand_directory_rows (workspace_id, section_key, sort_order, data)
  select ws, 'projects', (ordinality * 10)::int, d
  from unnest(array[
    jsonb_build_object('name','A garden to live in','name_ar','حديقة للحياة اليومية','type','Residential','location','Riyadh',
      'summary','A residential garden planned as a complete outdoor space, with a stepping-stone route through lawn and mature planting.',
      'scope','Landscape design and execution, natural turf installation, stepping-stone pathway, ornamental planting and trees, irrigation system setup',
      'naming','Private home. Never name or locate the owner.','page','/projects/garden-to-live-in'),
    jsonb_build_object('name','A greener arrival','name_ar','مدخل أكثر اخضراراً','type','Commercial','location','Riyadh',
      'summary','Geometric hedges, ornamental trees and irrigation set into the hardscape of a busy drive-through site, giving a recognizable international brand a cleaner, more welcoming arrival.',
      'scope','Commercial landscape execution, geometric hedge planting and shaping, ornamental tree installation, irrigation system setup, hardscape integration',
      'naming','The client is McDonald''s, which appears in Ghusn''s client list and in the project photo. The website copy says "a recognizable international brand"; keep to that wording in captions unless the team confirms the name may be used.','page','/projects/greener-arrival'),
    jsonb_build_object('name','Room for gathering','name_ar','مساحة للتجمع','type','Residential','location','Riyadh',
      'summary','Lawn, palms, reshaped hedges, a wide stone path and decorative lighting organise this estate garden for everyday use and evenings outside.',
      'scope','Landscape design and execution, natural turf and palm planting, hedge trimming and reshaping, decorative lighting, pathway, hardscape and irrigation',
      'naming','Private home. Never name or locate the owner.','page','/projects/room-for-gathering'),
    jsonb_build_object('name','A quiet retreat','name_ar','ملاذ هادئ','type','Residential','location','Riyadh',
      'summary','An older private garden brought back: new turf, a textured path, palm care and a corrected irrigation system, with a shaded tent setting.',
      'scope','Garden design and enhancement, natural turf installation, hedge shaping and palm care, pathway and tent-area setup, irrigation inspection and adjustment',
      'naming','Private home. Never name or locate the owner.','page','/projects/quiet-retreat'),
    jsonb_build_object('name','A considered edge','name_ar','حدود مدروسة','type','Perimeter','location','Riyadh',
      'summary','A roadside strip turned into planting: a palm, layered ornamental grasses and crisp hedges on prepared soil, so the site perimeter reads as designed landscape rather than a leftover edge.',
      'scope','Perimeter landscape execution, palm and ornamental grass planting, hedge installation and trimming, soil preparation, irrigation and roadside enhancement',
      'naming','No client is named on the website. Do not name one.','page','/projects/considered-edge'),
    jsonb_build_object('name','Landscape in layers','name_ar','حديقة متعددة الطبقات','type','Residential','location','Riyadh',
      'summary','Mature trees, turf and a stepping-stone walkway arranged so an open lawn has shade and somewhere to walk at any hour.',
      'scope','Residential landscape design and execution, natural turf installation, stepping-stone pathway, ornamental planting and trees, irrigation system setup',
      'naming','Private home. Never name or locate the owner.','page','/projects/landscape-in-layers')
  ]) with ordinality as t(d, ordinality);
end if;

end $$;
