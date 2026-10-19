-- ─── Assigned leads join the Pipeline (2026-10-19) ─────────────────────────
-- The owner: a lead gets its battle card and its place in the Pipeline when
-- it is assigned, not when it is approved. Leads assigned before this change
-- join it at New (their card is made the first time it is opened).
update public.leads set stage = 'new', stage_at = coalesce(assigned_at, now())
 where assigned_to is not null and stage is null;
