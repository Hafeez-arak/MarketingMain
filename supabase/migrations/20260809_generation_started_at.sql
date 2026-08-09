-- ════════════════════════════════════════════════════════════════════════
-- generation_started_at — timestamp for when plan_ideas.generation_status
-- last flipped to 'processing', so Post Approvals can detect a stuck
-- generation (webhook never reached n8n, or n8n hung with no error ever
-- written back) instead of showing an infinite spinner with no way out.
--
-- Run ONCE in the Supabase SQL editor. Idempotent + additive.
-- ════════════════════════════════════════════════════════════════════════

alter table public.plan_ideas
  add column if not exists generation_started_at timestamptz;
