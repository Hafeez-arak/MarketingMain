-- ─── The sales pipeline, and leads added by hand (2026-10-18) ──────────────
-- The owner's decisions:
--   · Approved leads, and leads the team adds by hand, gather in one place:
--     the Pipeline tab of Leads. A lead is in the pipeline when it has a
--     stage; approving gives it one ('new'), and so does adding it by hand.
--   · The stages follow Odoo's own, so they map over when Odoo connects:
--     New → Contacted → RFQ received → Quotation sent → Negotiating → Won / Lost.
--     Lost says why, and who won it.
--   · Every lead in the pipeline carries its next step and a follow-up date,
--     so the list can say what is due.
--   · Anyone on the sales team adds a lead by hand (a phone call, WhatsApp,
--     a walk-in, a referral, an exhibition, a site visit, or one we
--     contacted). It is theirs; a sales admin may add one for someone else.
--
-- Written only through /api/leads (lead_add, stage, card_save) with the
-- service key, after the caller is checked there. The read policies are the
-- leads' own (can_see_lead): a hand-added lead is its owner's.

-- ── 1. A lead can be added by hand ─────────────────────────────────────────
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('website_form', 'email', 'manual'));

-- How a hand-added lead came to us. '' for the website and email.
alter table public.leads add column if not exists channel text not null default ''
  check (channel in ('', 'phone', 'whatsapp', 'walk_in', 'referral', 'exhibition', 'site_visit', 'outbound', 'other'));
alter table public.leads add column if not exists added_by uuid references auth.users(id) on delete set null;

-- ── 2. The stage, and what happens next ───────────────────────────────────
-- null: not in the pipeline (an enquiry nobody has approved yet).
alter table public.leads add column if not exists stage text
  check (stage in ('new', 'contacted', 'rfq', 'quotation', 'negotiating', 'won', 'lost'));
alter table public.leads add column if not exists stage_at timestamptz;
alter table public.leads add column if not exists stage_by uuid references auth.users(id) on delete set null;
alter table public.leads add column if not exists lost_reason text not null default ''
  check (lost_reason in ('', 'price', 'brand', 'lead_time', 'no_reply', 'cancelled', 'other'));
alter table public.leads add column if not exists lost_to text not null default '';
alter table public.leads add column if not exists next_step text not null default '';
alter table public.leads add column if not exists follow_up date;

create index if not exists leads_pipeline on public.leads (workspace_id, stage) where stage is not null;

-- Leads approved before today join the pipeline at the start.
update public.leads set stage = 'new', stage_at = coalesce(approved_at, now())
 where approved_at is not null and stage is null;
