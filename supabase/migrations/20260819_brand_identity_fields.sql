-- ════════════════════════════════════════════════════════════════════════
-- Per-brand identity: brand_name + brand_descriptor
-- ════════════════════════════════════════════════════════════════════════
-- Every AI prompt in this system opened by asserting the writer works for
-- "Arak Lighting, Saudi Arabia's leading architectural lighting company" —
-- hardcoded in the generator, ABOVE the brand context block. Aqeeq (an
-- at-home spa) and Alo Kheyatah (a tailoring service) were told they were a
-- lighting manufacturer and then handed their own brand brain underneath it.
--
-- These two fields are what the persona line is built from instead. They are
-- deliberately `include_in_prompt = false`: their value is emitted as the
-- identity line at the very top of the context by buildContext(), so letting
-- the flattener also print them under a heading would say the same thing
-- twice in every prompt.
--
-- Idempotent: on conflict the definition is refreshed but the VALUE is left
-- alone, so a re-run never overwrites wording someone edited in the UI.
-- ════════════════════════════════════════════════════════════════════════

insert into public.brand_fields
  (workspace_id, section_key, key, label, hint, input_type, rows,
   storage_column, prompt_label, include_in_prompt, sort_order, enabled)
select w.id, 'identity_voice', v.key, v.label, v.hint, v.input_type, v.rows,
       '', '', false, v.sort_order, true
from public.workspaces w
cross join (values
  ('brand_name',       'Brand Name',
   'How the brand names itself, including the Arabic wordmark if it has one. Opens every AI prompt.',
   'text', 1, 1),
  ('brand_descriptor', 'One-Line Descriptor',
   'One line finishing the sentence "You are writing for <Brand Name>, ___". What the company actually is.',
   'textarea', 2, 2)
) as v(key, label, hint, input_type, rows, sort_order)
on conflict (workspace_id, key) do update
  set label      = excluded.label,
      hint       = excluded.hint,
      input_type = excluded.input_type,
      sort_order = excluded.sort_order,
      enabled    = true,
      include_in_prompt = false;

-- ── Values ───────────────────────────────────────────────────────────────
-- Derived from each workspace's own brand brain (positioning, company facts,
-- service model). Stored in custom_fields like any other custom field, so
-- marketing can reword them in the Brand Brain page without a migration.
--
-- `||` merges right-into-left, so an existing hand-edited value wins over
-- the seeded default and a re-run is a no-op rather than a revert.
update public.brand_profile bp
set custom_fields = jsonb_build_object(
      'brand_name',       'Aqeeq (عقيق)',
      'brand_descriptor', 'an at-home spa and beauty service in Riyadh, Saudi Arabia — massage, nails, hair and waxing delivered to the client''s own home'
    ) || bp.custom_fields
from public.workspaces w
where w.id = bp.workspace_id and w.name = 'Aqeeq';

update public.brand_profile bp
set custom_fields = jsonb_build_object(
      'brand_name',       'Alo Kheyatah (آلو خياطة)',
      'brand_descriptor', 'an on-demand tailoring and alterations service in Riyadh, Saudi Arabia — garments collected and returned by driver, or altered on the spot by a mobile tailoring truck'
    ) || bp.custom_fields
from public.workspaces w
where w.id = bp.workspace_id and w.name = 'Alo Kheyatah';

update public.brand_profile bp
set custom_fields = jsonb_build_object(
      'brand_name',       'Arak Lighting',
      'brand_descriptor', 'Saudi Arabia''s leading architectural lighting and smart-building company (founded 1976; landmark projects incl. King Fahad International Airport, Solitaire Mall, Ritz Carlton Riyadh)'
    ) || bp.custom_fields
from public.workspaces w
where w.id = bp.workspace_id and w.name = 'Arak Lighting';

-- ── Task tags on the heavy directories ───────────────────────────────────
-- A 27-row service menu with Arabic names and prices is exactly what a
-- monthly planner should reason over, and pure token burn inside an image
-- prompt — the image generator needs the palette, not the price of a
-- pedicure. Tagging them 'plan' and 'caption' is the first real use of the
-- tasks column; everything untagged still goes everywhere, as before.
update public.brand_sections s
set tasks = array['plan','caption','chat','research']
from public.workspaces w
where w.id = s.workspace_id
  and s.kind = 'directory'
  and s.key in ('services','alterations');

-- ════════════════════════════════════════════════════════════════════════
-- Done. brand_name / brand_descriptor exist and are populated for all three
-- workspaces; the two price directories are scoped away from image/video.
-- ════════════════════════════════════════════════════════════════════════
