-- ════════════════════════════════════════════════════════════════════════
-- Stop sending price lists into every prompt
-- ════════════════════════════════════════════════════════════════════════
-- The directory price COLUMNS were already `in_prompt = false`, so the
-- service/alterations tables never carried prices into a generation. But both
-- brands also have a free-text summary field bound to `product_index`
-- ("Massage (60 min): Relax 195 · Hot Stone 255 · Cupping 245 SAR"), and that
-- field was `include_in_prompt = true` — so the full price list reached every
-- prompt by the other door.
--
-- That became actively risky once the no-invented-facts guardrail was added:
-- it permits stating any price that appears verbatim in the brand context, so
-- prices present in context are prices a caption may publish. A price change
-- not mirrored into the Brand Brain the same day would publish a wrong number.
--
-- The values are KEPT, only withheld from prompts — they are wanted later for
-- the WhatsApp agents, where quoting a price is the actual job. The planner
-- still knows every service by name through the directory index.
-- ════════════════════════════════════════════════════════════════════════

update public.brand_fields f
set include_in_prompt = false
from public.workspaces w
where w.id = f.workspace_id
  and w.name in ('Aqeeq', 'Alo Kheyatah')
  and f.storage_column = 'product_index';

-- Second source, found by re-running the verification after the update above:
-- Alo Kheyatah's free-text "Pricing Rules" field carries the minimum charge,
-- the rush surcharge and the cups/measuring add-ons as SAR figures. Same
-- category of fact, same treatment — the field's own values are untouched.
--
-- Worth noting for anyone adding fields later: prices are not confined to
-- anything named "price". Grep the values, not the field names:
--   select ... where bp.custom_fields->>f.key ~ 'SAR|ريال'
update public.brand_fields f
set include_in_prompt = false
from public.workspaces w
where w.id = f.workspace_id
  and w.name = 'Alo Kheyatah'
  and f.key = 'pricing_rules';
