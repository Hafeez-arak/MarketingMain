-- One-tap reject reasons on plan_ideas (off_brand/repetitive/wrong_product/
-- weak_idea/other) — lets a marketer's rejection reason double as training
-- signal for a future learning loop, instead of a bare status flip.
alter table public.plan_ideas add column if not exists reject_reason text;
