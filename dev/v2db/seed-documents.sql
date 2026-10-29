-- ─── Documents: invented test rows for the LOCAL v2 database ───────────────
-- 2026-10-29, dev/erp-pilot/DOCUMENTS.md. Not a migration: test data must
-- never reach production. Every title says "(test)" / "(تجربة)"; every
-- number is made up. Arak Lighting gets documents in every state (valid,
-- expiring, expired, no expiry, a draft, one with a renewal waiting, one
-- confidential, one archived) and one linked to a supplier from
-- seed-contacts.sql (run that first). The employees' papers are the ones
-- HR's move brought across. Ghusn gets none, so company separation shows.
--
-- It also gives two stand-in logins Documents in Arak Lighting, so the
-- member paths can be tried: staff.dev@ at work, staff.marketing@ at view.
-- Safe to re-run: a document with the same title is not made twice.
--
--   docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/v2db/seed-documents.sql
--
-- To take it out again, see the cleanup at the end of check-documents.mjs
-- (a confirmed document is never deleted through the API, by design).

begin;

insert into public.section_access (workspace_id, user_id, section, level)
select '00000000-0000-0000-0000-000000000001', ua.user_id, 'documents', x.level
  from public.user_access ua
  join (values ('staff.dev@arak-sa.com', 'work'), ('staff.marketing@arak-sa.com', 'view')) as x(email, level) on x.email = ua.email
on conflict do nothing;

create temporary table seed_docs (code text, title text, number text, issuer text, issued int, expires int, who text, conf boolean, archive text, renewal boolean, draft boolean, supplier text) on commit drop;
insert into seed_docs values
  ('CR',        'السجل التجاري (تجربة)',                  '1010999001', 'Ministry of Commerce (test)', -400, 330,  'staff.admin@arak-sa.com', false, null, false, false, null),
  ('VAT_CERT',  'VAT certificate (test)',                  '300000000000003', 'ZATCA (test)',           -300, 25,   'staff.dev@arak-sa.com',   false, null, false, false, null),
  ('INSURANCE', 'Warehouse insurance (test)',              'POL-7781', 'Insurer (test)',                -375, -10,  'staff.admin@arak-sa.com', false, null, false, false, null),
  ('LEASE',     'Head office lease (test)',                'LS-2024-18', 'Landlord (test)',             -700, null, 'staff.admin@arak-sa.com', false, null, false, false, null),
  ('MUNICIPAL', 'Municipal licence (test)',                'ML-4410', 'Municipality (test)',            -200, 60,   'staff.dev@arak-sa.com',   false, null, true,  false, null),
  ('GOSI_CERT', 'GOSI certificate (test)',                 null, null,                                  null, null, null,                      false, null, false, true,  null),
  ('LEASE',     'Confidential shareholder lease (test)',   'SH-01', 'Owner (test)',                     -100, 900,  'staff.admin@arak-sa.com', true,  null, false, false, null),
  ('ZAKAT_CERT','Old zakat certificate (test)',            'ZK-2024', 'ZATCA (test)',                   -800, -430, 'staff.admin@arak-sa.com', false, 'Replaced by the 2025 certificate (test)', false, false, null),
  ('AGENCY',    'Red Sea Lighting agency agreement (test)','AG-55', 'Red Sea Lighting Supply (test)',   -90, 275,  'staff.admin@arak-sa.com', false, null, false, false, 'Red Sea Lighting Supply (test)');

do $$
declare
  ws constant uuid := '00000000-0000-0000-0000-000000000001';
  r record; v_type uuid; v_doc uuid; v_resp uuid; v_sup uuid; v_ver uuid;
begin
  for r in select * from seed_docs loop
    if exists (select 1 from public.company_documents where workspace_id = ws and title = r.title) then continue; end if;
    select id into v_type from public.document_types where workspace_id = ws and code = r.code;
    select user_id into v_resp from public.user_access where email = r.who;
    select id into v_sup from public.contacts_orgs where workspace_id = ws and name = r.supplier;
    insert into public.company_documents (workspace_id, type_id, title, link_kind, supplier_id, responsible_id, confidential)
    values (ws, v_type, r.title, case when r.supplier is not null then 'supplier' else 'company' end, v_sup, v_resp, r.conf)
    returning id into v_doc;
    insert into public.company_document_versions (workspace_id, document_id, number, issuer, issue_date, expiry_date, sources)
    values (ws, v_doc, r.number, r.issuer, current_date + r.issued, current_date + r.expires,
            case when r.number is null then '{}'::jsonb else '{"number":"manual"}'::jsonb end);
    if not r.draft then
      update public.company_document_versions set status = 'current' where document_id = v_doc and status = 'pending';
    end if;
    if r.renewal then
      insert into public.company_document_versions (workspace_id, document_id, number, issuer) values (ws, v_doc, r.number, r.issuer);
    end if;
    if r.archive is not null then
      update public.company_documents set archived_at = now(), archive_reason = r.archive where id = v_doc;
    end if;
  end loop;
end $$;

commit;
