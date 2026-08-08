-- ════════════════════════════════════════════════════════════════════════
-- content_plans.kind — distinguishes a real monthly plan from a one-off
-- "Quick Create" plan (a single idea, created and finalized outside the
-- month-planning flow so a single post can be generated without building
-- a whole month). Each quick create gets its OWN fresh plan row rather
-- than sharing one long-lived hidden plan — simpler, and it means
-- markIdeasProcessing (scoped by plan_id + status=approved) never needs
-- special-casing: a quick plan only ever has the one idea in it.
--
-- kind='quick' plans must be excluded from anywhere that assumes "real
-- plan" — cross-month anti-repetition history (fetchPastIdeas) and the
-- Post Approvals plan-grouped view (fetchApprovalsData) — otherwise a
-- one-off poisons repetition checks for actual monthly plans, or clutters
-- Approvals with a stream of single-post "plans".
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.content_plans
  add column if not exists kind text default 'monthly';

alter table public.content_plans
  drop constraint if exists content_plans_kind_check;
alter table public.content_plans
  add constraint content_plans_kind_check
  check (kind in ('monthly', 'quick'));
