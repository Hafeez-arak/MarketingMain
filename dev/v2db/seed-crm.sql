-- ─── CRM: invented test rows for the LOCAL v2 database ─────────────────────
-- 2026-10-28, dev/erp-pilot/CRM.md. Not a migration: test data must never
-- reach production. Every title says "(test)" / "(تجربة)"; every figure is
-- made up. Arak Lighting gets a pipeline (five stages, sources, loss
-- reasons, tags), eight opportunities in every state and some activities;
-- Ghusn gets three stages and one opportunity, so company separation shows
-- on screen. The clients are seed-contacts.sql's organisations (run that
-- first). Fixed ids: safe to re-run (it adds nothing twice).
--
-- It also gives two stand-in logins the CRM in Arak Lighting, so the member
-- paths can be tried: staff.dev@ at work, staff.marketing@ at view.
--
--   docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/v2db/seed-crm.sql
--
-- To take it out again: delete from public.crm_leads where title like '%(test)%' or title like '%(تجربة)%';
-- (the activities and tags go with them; won/lost ones first need status reset by hand).

begin;

-- Who works the CRM here.
insert into public.section_access (workspace_id, user_id, section, level)
select '00000000-0000-0000-0000-000000000001', ua.user_id, 'crm', x.level
  from public.user_access ua
  join (values ('staff.dev@arak-sa.com', 'work'), ('staff.marketing@arak-sa.com', 'view')) as x(email, level) on x.email = ua.email
on conflict do nothing;

-- ── Arak Lighting's lists ──
insert into public.crm_stages (workspace_id, name, name_en, sequence) values
  ('00000000-0000-0000-0000-000000000001', 'جديدة', 'New', 10),
  ('00000000-0000-0000-0000-000000000001', 'مؤهلة', 'Qualified', 20),
  ('00000000-0000-0000-0000-000000000001', 'معاينة وتصميم', 'Site visit and design', 30),
  ('00000000-0000-0000-0000-000000000001', 'أُرسل عرض السعر', 'Quotation sent', 40),
  ('00000000-0000-0000-0000-000000000001', 'تفاوض', 'Negotiation', 50)
on conflict do nothing;
insert into public.crm_sources (workspace_id, name, name_en) values
  ('00000000-0000-0000-0000-000000000001', 'معرض', 'Exhibition'),
  ('00000000-0000-0000-0000-000000000001', 'توصية', 'Referral'),
  ('00000000-0000-0000-0000-000000000001', 'الموقع الإلكتروني', 'Website'),
  ('00000000-0000-0000-0000-000000000001', 'اتصال', 'Phone call')
on conflict do nothing;
insert into public.crm_lost_reasons (workspace_id, name, name_en) values
  ('00000000-0000-0000-0000-000000000001', 'السعر', 'Price'),
  ('00000000-0000-0000-0000-000000000001', 'ذهبت لمنافس', 'Went to a competitor'),
  ('00000000-0000-0000-0000-000000000001', 'أُلغي المشروع', 'Project cancelled')
on conflict do nothing;
insert into public.crm_tags (workspace_id, name, name_en, color) values
  ('00000000-0000-0000-0000-000000000001', 'إنارة', 'Lighting', 1),
  ('00000000-0000-0000-0000-000000000001', 'أنظمة تحكم', 'Control systems', 2),
  ('00000000-0000-0000-0000-000000000001', 'GRMS', null, 5),
  ('00000000-0000-0000-0000-000000000001', 'واجهات', 'Facades', 3)
on conflict do nothing;

-- ── Ghusn's ──
insert into public.crm_stages (workspace_id, name, name_en, sequence)
select w.id, x.name, x.name_en, x.seq from public.workspaces w
  cross join (values ('جديدة', 'New', 10), ('عرض مُرسل', 'Offer sent', 20), ('تفاوض', 'Negotiation', 30)) as x(name, name_en, seq)
 where w.name = 'Ghusn'
on conflict do nothing;

-- ── Opportunities ──
create temporary table seed_lead (
  id uuid, title text, org text, contact text, client uuid, stage text, source text, value numeric, prob int,
  prio int, who text, bid int, tender text, consultant text, city text, phone text
) on commit drop;
insert into seed_lead values
  ('e0000000-0000-4000-8000-000000000001', 'Office tower lobby lighting (test)', null, 'Majed (test)', 'c0000000-0000-4000-8000-000000000001', 'Negotiation', 'Referral', 450000, 60, 2, 'staff.admin@arak-sa.com', 5, 'NT-RFQ-0091 (test)', 'Diriyah Design Consultants (test)', 'Riyadh', '+966 50 000 0101'),
  ('e0000000-0000-4000-8000-000000000002', 'Villa facade lighting and controls (test)', null, 'Sara (test)', null, 'Qualified', 'Website', null, null, 0, 'staff.dev@arak-sa.com', null, null, null, 'Riyadh', '+966 55 000 0102'),
  ('e0000000-0000-4000-8000-000000000003', 'Hotel guest-room control system (test)', 'Coastal Hotels (test)', null, null, 'Site visit and design', 'Exhibition', 1200000, 30, 3, 'staff.admin@arak-sa.com', 20, 'CH-2026-14 (test)', null, 'Jeddah', null),
  ('e0000000-0000-4000-8000-000000000004', 'Mall car park lighting retrofit (test)', null, null, 'c0000000-0000-4000-8000-000000000003', 'New', 'Website', 180000, 20, 0, null, null, null, null, 'Jeddah', null),
  ('e0000000-0000-4000-8000-000000000005', 'Hospital wing lighting (test)', null, null, 'c0000000-0000-4000-8000-000000000001', 'Quotation sent', 'Referral', 600000, 50, 1, 'staff.admin@arak-sa.com', null, null, null, 'Riyadh', null),
  ('e0000000-0000-4000-8000-000000000006', 'إنارة حرم مدرسة (تجربة)', 'مدارس الرواد (تجربة)', null, null, 'Negotiation', 'Phone call', 320000, 40, 0, 'staff.dev@arak-sa.com', null, null, null, 'الرياض', null),
  ('e0000000-0000-4000-8000-000000000007', 'Museum gallery track lighting (test)', null, null, 'c0000000-0000-4000-8000-000000000007', 'Quotation sent', 'Exhibition', 95000, 70, 1, 'staff.dev@arak-sa.com', -2, null, 'Diriyah Design Consultants (test)', 'Riyadh', null),
  ('e0000000-0000-4000-8000-000000000008', 'إنارة مسجد الحي (تجربة)', null, 'أبو خالد (تجربة)', null, 'New', null, null, null, 0, null, null, null, null, 'الدمام', '+966 53 000 0108');

insert into public.crm_leads (id, workspace_id, title, organization, contact_name, client_org_id, stage_id, source_id,
  expected_revenue, probability, priority, assigned_to, bid_due_date, tender_ref, consultant, city, phone)
select s.id, '00000000-0000-0000-0000-000000000001', s.title, s.org, s.contact, s.client,
       (select id from public.crm_stages where workspace_id = '00000000-0000-0000-0000-000000000001' and name_en = s.stage),
       (select id from public.crm_sources where workspace_id = '00000000-0000-0000-0000-000000000001' and name_en = s.source),
       s.value, s.prob, s.prio,
       (select user_id from public.user_access where email = s.who),
       public.crm_today() + s.bid, s.tender, s.consultant, s.city, s.phone
  from seed_lead s
 -- Not "on conflict do nothing": the numbering trigger runs before the
 -- conflict is seen, so a skipped row would still use up a number.
 where not exists (select 1 from public.crm_leads l where l.id = s.id);

insert into public.crm_leads (id, workspace_id, title, organization, stage_id, expected_revenue, probability)
select 'e0000000-0000-4000-8000-000000000021', w.id, 'Palace garden landscaping (test)', 'Ghusn private client (test)',
       (select id from public.crm_stages s where s.workspace_id = w.id and s.name_en = 'Offer sent'), 250000, 50
  from public.workspaces w where w.name = 'Ghusn'
   and not exists (select 1 from public.crm_leads l where l.id = 'e0000000-0000-4000-8000-000000000021');

-- Tags.
insert into public.crm_lead_tags (workspace_id, lead_id, tag_id)
select '00000000-0000-0000-0000-000000000001', x.lead::uuid, t.id
  from (values ('e0000000-0000-4000-8000-000000000001', 'Lighting'), ('e0000000-0000-4000-8000-000000000001', 'Control systems'),
               ('e0000000-0000-4000-8000-000000000002', 'Facades'), ('e0000000-0000-4000-8000-000000000003', 'GRMS'),
               ('e0000000-0000-4000-8000-000000000003', 'Control systems'), ('e0000000-0000-4000-8000-000000000005', 'Lighting'),
               ('e0000000-0000-4000-8000-000000000006', 'Lighting'), ('e0000000-0000-4000-8000-000000000007', 'Lighting')) as x(lead, tag)
  join public.crm_tags t on t.workspace_id = '00000000-0000-0000-0000-000000000001' and coalesce(t.name_en, t.name) = x.tag
  join public.crm_leads l on l.id = x.lead::uuid and l.status = 'open'
on conflict do nothing;

-- ── Activities ──
insert into public.crm_activities (id, workspace_id, lead_id, activity_type, summary, due_date, assigned_to)
select x.id::uuid, '00000000-0000-0000-0000-000000000001', x.lead::uuid, x.kind, x.summary, public.crm_today() + x.due,
       (select user_id from public.user_access where email = x.who)
  from (values
    ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'call', 'Call the consultant about the revised layout (test)', -3, 'staff.admin@arak-sa.com'),
    ('a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'meeting', 'Price meeting with the client (test)', 0, 'staff.admin@arak-sa.com'),
    ('a0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', 'site_visit', 'Site visit to the sample floor (test)', 4, 'staff.admin@arak-sa.com'),
    ('a0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000007', 'email', 'Send the revised quotation (test)', 0, 'staff.dev@arak-sa.com'),
    ('a0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000002', 'task', 'إعداد مخطط الإنارة الأولي (تجربة)', -1, 'staff.dev@arak-sa.com'),
    ('a0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000005', 'meeting', 'Final meeting before award (test)', -6, 'staff.admin@arak-sa.com'),
    ('a0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000006', 'call', 'اتصال للمتابعة بعد العرض (تجربة)', -10, 'staff.dev@arak-sa.com')
  ) as x(id, lead, kind, summary, due, who)
  join public.crm_leads l on l.id = x.lead::uuid and l.status = 'open'
on conflict (id) do nothing;

update public.crm_activities set done_at = now(), outcome = 'The client agreed the scope and the price (test).'
 where id = 'a0000000-0000-4000-8000-000000000006' and done_at is null;
update public.crm_activities set done_at = now(), outcome = 'السعر أعلى من ميزانيتهم (تجربة).'
 where id = 'a0000000-0000-4000-8000-000000000007' and done_at is null;

-- ── Closing: one won (it has a client), one lost ──
update public.crm_leads set status = 'won'
 where id = 'e0000000-0000-4000-8000-000000000005' and status = 'open';
update public.crm_leads set status = 'lost', lost_note = 'Another supplier came in 15% lower (test).',
       lost_reason_id = (select id from public.crm_lost_reasons where workspace_id = '00000000-0000-0000-0000-000000000001' and name_en = 'Price')
 where id = 'e0000000-0000-4000-8000-000000000006' and status = 'open';

commit;
