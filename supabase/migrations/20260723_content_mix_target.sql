-- Freeform target content-mix ratio set at brief time (e.g. "40% product,
-- 20% educational, 20% trust/testimonials, 20% engagement"), shown next to
-- the board's actual-mix bar so imbalance is visible at a glance.
alter table public.content_plans add column if not exists content_mix_target text;
