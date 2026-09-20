-- ════════════════════════════════════════════════════════════════════════
-- Arak Lighting — the real supplier list, from arak-sa.com
-- ════════════════════════════════════════════════════════════════════════
-- The Suppliers directory held 24 rows scraped off the site in an early
-- pass, and marketing confirmed most of them were wrong: Philips, Legrand,
-- Fumagalli, Luxeled, Jiso, Vatreria and Cluce are not partners at all, and
-- four more were misspellings of brands that are (Ledsc4 → LEDS C4,
-- Lucciolighting → Lucio, CLB → C°LB, Viokef → Viokef Lighting).
--
-- That list was not inert. The Brand Brain feeds every caption, every plan
-- and every research prompt, so a wrong partner is a claim the company
-- makes about itself in public — and "certified partner for Philips" is
-- exactly the kind of sentence an AI writes confidently and nobody catches.
--
-- This replaces all 24 with the 41 brands the live site names, in the site's
-- own order and spelling. Categories are filled where the brand's line is
-- unambiguous and left to a note where it isn't, rather than guessed: an
-- empty category costs a little context, a wrong one gets published.
--
-- Re-runnable, but not harmless: it replaces the list wholesale, so running
-- it again after marketing has edited a row in the Brand Brain UI resets
-- that edit. Scoped to Arak's workspace — Aqeeq's directories are untouched.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare ws uuid := '00000000-0000-0000-0000-000000000001';
begin

delete from public.brand_directory_rows
 where workspace_id = ws and section_key = 'suppliers';

insert into public.brand_directory_rows (workspace_id, section_key, data, sort_order)
select ws, 'suppliers',
       jsonb_build_object('name', s.name, 'category', s.category,
                          'brand_lines', '', 'notes', s.notes),
       s.ord * 10
from (values
  ( 1, 'C°LB',                 'In-house manufacturing — Arak''s own brand',        'Arak''s own manufacturing line, not a third-party partner. Also the brand behind the Smart Pole system (lighting, cameras, 5G, sensors, signage and emergency call on one mast).'),
  ( 2, 'Artemide',             'Decorative & architectural lighting (Italy)',        ''),
  ( 3, 'Reggiani',             'Architectural, retail & museum lighting (Italy)',    ''),
  ( 4, 'Disano Illuminazione', 'Outdoor, road & industrial lighting (Italy)',        ''),
  ( 5, 'Siteco',               'Architectural, road & industrial lighting (Germany)',''),
  ( 6, 'Ledvance',             'Lamps & LED luminaires (Germany)',                   ''),
  ( 7, 'Sylvania',             'Lamps & general lighting',                           ''),
  ( 8, 'LEDS C4',              'Architectural & decorative lighting (Spain)',        ''),
  ( 9, 'ACB',                  'Decorative lighting (Spain)',                        ''),
  (10, 'Arkoslight',           'Architectural & recessed lighting (Spain)',          ''),
  (11, 'Nova Luce',            'Decorative lighting',                                ''),
  (12, 'Viokef Lighting',      'Decorative lighting (Greece)',                       ''),
  (13, 'LUG',                  'Outdoor, industrial & architectural lighting (Poland)',''),
  (14, 'RZB Lighting',         'Indoor, outdoor & emergency lighting (Germany)',     ''),
  (15, 'planlicht',            'Architectural & workplace lighting (Austria)',       ''),
  (16, 'Trevos',               'Industrial & waterproof luminaires (Czech Republic)',''),
  (17, 'Zalux',                'Industrial & waterproof luminaires (Spain)',         ''),
  (18, 'GEWISS',               'Electrical systems & lighting (Italy)',              ''),
  (19, 'Niviss',               'Architectural & custom lighting (Poland)',           ''),
  (20, 'Hormen',               'Architectural & decorative lighting (Italy)',        ''),
  (21, 'espica',               'Architectural lighting',                             'Product line to confirm with sales — the site shows the logo only.'),
  (22, 'Lucio',                'Decorative lighting (Italy)',                        ''),
  (23, 'p.u.k.',               'Architectural lighting (Germany)',                   ''),
  (24, 'Forma Lighting',       'Architectural & facade lighting',                    ''),
  (25, 'Flexxica',             '',                                                   'Product line to confirm with sales — the site shows the logo only.'),
  (26, 'LEDFlex',              'Flexible & linear LED lighting (UK)',                ''),
  (27, 'PHOS',                 'Architectural lighting & design hardware (Germany)', ''),
  (28, 'Nexia',                '',                                                   'Product line to confirm with sales — the site shows the logo only.'),
  (29, 'AFO',                  '',                                                   'Product line to confirm with sales — the site shows the logo only.'),
  (30, 'Eaton',                'Emergency lighting & electrical systems',            ''),
  (31, 'Inotec',               'Central battery & emergency lighting systems (Germany)',''),
  (32, 'ESP',                  'Emergency lighting',                                 'Product line to confirm with sales — the site shows the logo only.'),
  (33, 'EML',                  'Emergency lighting',                                 'Product line to confirm with sales — the site shows the logo only.'),
  (34, 'TM Technologie',       'Emergency lighting (Poland)',                        ''),
  (35, 'Denko',                '',                                                   'Product line to confirm with sales — the site shows the logo only.'),
  (36, 'ABB',                  'Electrical & building automation (KNX)',             ''),
  (37, 'Lutron',               'Lighting control & shading',                         ''),
  (38, 'Zennio',               'KNX home & building automation (Spain)',             ''),
  (39, 'Hager',                'Electrical distribution & building automation (Germany)',''),
  (40, 'Leviton',              'Electrical devices & lighting control',              ''),
  (41, 'Interra',              'KNX automation & guest room management (Turkey)',    '')
) as s(ord, name, category, notes);

end $$;

-- ════════════════════════════════════════════════════════════════════════
-- Competitor Watch — retired from the Brand Brain, not from the product
-- ════════════════════════════════════════════════════════════════════════
-- Competitors are the research agent's job. It keeps them in
-- research_agenda (kind = 'competitor') with a status, a resolved Instagram
-- handle and a verification state, and the Research page is where they are
-- added, retired and reviewed.
--
-- The Brand Brain held a second, frozen copy: six competitors written once
-- and never revisited. Five of the six are already RETIRED on the research
-- agenda — so the two halves of the app disagreed about who Arak even
-- competes with, and the Brand Brain half is the one that reaches the
-- caption writer.
--
-- Disabled rather than deleted: the rows stay in brand_directory_rows, so
-- turning `enabled` back on restores the section exactly as it was. Scoped
-- to Arak — Aqeeq keeps its own Competitor Watch.
do $$
declare ws uuid := '00000000-0000-0000-0000-000000000001';
begin

update public.brand_sections
   set enabled = false,
       description = 'Moved to the Research page — the research agent keeps the live watchlist, with Instagram handles and a status per competitor.'
 where workspace_id = ws and key = 'competitors';

-- One blank row that only ever rendered as an empty card.
delete from public.brand_directory_rows
 where workspace_id = ws and section_key = 'competitors'
   and coalesce(nullif(trim(data->>'name'), ''), '') = '';

end $$;
