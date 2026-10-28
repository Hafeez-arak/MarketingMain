-- ─── Contacts: invented test rows for the LOCAL v2 database ────────────────
-- 2026-10-28. Not a migration: test data must never reach production. Every
-- name says "(test)" / "(تجربة)"; every number is made up. Arak Lighting
-- gets a spread of roles and both kinds; Ghusn gets two, so company
-- separation shows on screen. Fixed ids: safe to re-run (it adds nothing twice).
--
--   docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/v2db/seed-contacts.sql
--
-- To take them out again: delete from public.contacts_people where name like '%(test)%';
-- then the same for public.contacts_orgs.

begin;

insert into public.contacts_orgs
  (id, workspace_id, kind, name, name_ar, roles, vat_number, cr_number,
   nat_building_no, nat_street, nat_district, city, nat_postal_code, nat_additional_no,
   phone, email, website, notes)
values
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'company',
   'Najd Towers Development (test)', 'شركة أبراج نجد للتطوير (تجربة)', '{client}', '399999999900003', '1010999001',
   '7421', 'King Fahd Road', 'Al Olaya', 'Riyadh', '12214', '3381',
   '+966 11 000 0001', 'projects@najd-towers.test', 'najd-towers.test', 'Invented client for testing.'),
  ('c0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'company',
   'Red Sea Lighting Supply (test)', 'مؤسسة البحر الأحمر للإنارة (تجربة)', '{supplier}', '399999999900013', '4030999002',
   null, null, null, 'Jeddah', null, null,
   '+966 12 000 0002', 'sales@redsea-lighting.test', null, ''),
  ('c0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'company',
   'Al Bunyan Contracting (test)', 'شركة البنيان للمقاولات (تجربة)', '{client,main_contractor}', '399999999900023', '1010999003',
   '2210', 'Prince Sultan Street', 'Al Rawdah', 'Jeddah', '23435', '6620',
   '+966 12 000 0003', 'tenders@albunyan.test', 'albunyan.test', 'Main contractor on two of our projects; also buys directly.'),
  ('c0000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'company',
   'Diriyah Design Consultants (test)', 'الدرعية للاستشارات الهندسية (تجربة)', '{consultant}', null, '1010999004',
   null, null, null, 'Riyadh', null, null,
   '+966 11 000 0004', 'mep@diriyah-design.test', null, 'Approves lighting submittals.'),
  ('c0000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'company',
   'Eastern Electrical Works (test)', 'الأعمال الكهربائية الشرقية (تجربة)', '{supplier,subcontractor}', '399999999900043', null,
   null, null, null, 'Dammam', null, null,
   null, 'info@eastern-electrical.test', null, 'Installs for us on site.'),
  ('c0000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'company',
   'CLB Controls (test)', 'سي إل بي للتحكم (تجربة)', '{supplier,sister_company}', null, null,
   null, null, null, 'Riyadh', null, null,
   null, null, null, 'Sister company.'),
  ('c0000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'individual',
   'Faisal Al-Harbi (test)', 'فيصل الحربي (تجربة)', '{client}', null, null,
   null, null, null, 'Riyadh', null, null,
   '+966 50 000 0007', null, null, 'Private villa owner.'),
  ('c0000000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'company',
   'Gulf Facade Systems (test)', 'أنظمة واجهات الخليج (تجربة)', '{subcontractor}', null, '2050999008',
   null, null, null, 'Khobar', null, null,
   null, null, null, ''),
  ('c0000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', 'company',
   'Luce Italia S.r.l. (test)', 'لوتشي إيطاليا (تجربة)', '{supplier}', null, null,
   null, null, null, 'Milan', null, null,
   '+39 02 0000 0009', 'export@luce-italia.test', 'luce-italia.test', 'Foreign supplier: no Saudi VAT or CR.'),
  ('c0000000-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000001', 'company',
   'Old Horizon Trading (test)', 'مؤسسة الأفق القديم (تجربة)', '{client}', null, '1010999010',
   null, null, null, 'Riyadh', null, null,
   null, null, null, 'Stopped dealing with them.'),
  ('c0000000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000001', 'company',
   'Najd Tower Development Co (test)', null, '{}', null, null,
   null, null, null, null, null, null,
   null, null, null, 'Entered twice by mistake: shows the similar-name warning.'),
  ('c0000000-0000-4000-8000-000000000021', 'c688dfbe-9d93-4a88-adbb-605e8b81e8f8', 'company',
   'Ghusn Landscape Client (test)', 'عميل غصن للتنسيق (تجربة)', '{client}', null, null,
   null, null, null, 'Riyadh', null, null,
   null, null, null, 'Ghusn only.'),
  ('c0000000-0000-4000-8000-000000000022', 'c688dfbe-9d93-4a88-adbb-605e8b81e8f8', 'company',
   'Ghusn Nursery Supplier (test)', 'مشتل غصن (تجربة)', '{supplier}', null, null,
   null, null, null, 'Qassim', null, null,
   null, null, null, 'Ghusn only.')
on conflict (id) do nothing;

-- Archived after insert, as the screen does it (archived_at is stamped).
update public.contacts_orgs set status = 'archived'
 where id = 'c0000000-0000-4000-8000-000000000010' and status = 'active';

insert into public.contacts_people
  (id, workspace_id, org_id, name, name_ar, job_title, phone, email, is_primary)
values
  ('d0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'Omar Saleh (test)', 'عمر صالح (تجربة)', 'Projects Director', '+966 50 000 1001', 'omar@najd-towers.test', true),
  ('d0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'Huda Nasser (test)', 'هدى ناصر (تجربة)', 'Procurement', '+966 50 000 1002', 'huda@najd-towers.test', false),
  ('d0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Yousef Bakr (test)', 'يوسف بكر (تجربة)', 'Sales Manager', '+966 55 000 1003', 'yousef@redsea-lighting.test', true),
  ('d0000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000003',
   'Khalid Otaibi (test)', 'خالد العتيبي (تجربة)', 'MEP Manager', '+966 53 000 1004', 'khalid@albunyan.test', true),
  ('d0000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000004',
   'Eng. Reem Fahad (test)', 'م. ريم فهد (تجربة)', 'Lighting Consultant', '+966 54 000 1005', 'reem@diriyah-design.test', true),
  ('d0000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000005',
   'Ahmed Zahrani (test)', 'أحمد الزهراني (تجربة)', 'Site Supervisor', '+966 56 000 1006', null, false),
  ('d0000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-000000000009',
   'Marco Rossi (test)', null, 'Export Manager', '+39 333 000 1007', 'marco@luce-italia.test', true),
  ('d0000000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', null,
   'Sara Qahtani (test)', 'سارة القحطاني (تجربة)', 'Interior designer (freelance)', '+966 59 000 1008', 'sara.design@example.test', false),
  ('d0000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', null,
   'Nawaf Dosari (test)', 'نواف الدوسري (تجربة)', null, '+966 58 000 1009', null, false),
  ('d0000000-0000-4000-8000-000000000021', 'c688dfbe-9d93-4a88-adbb-605e8b81e8f8', 'c0000000-0000-4000-8000-000000000021',
   'Ghusn Contact (test)', 'جهة غصن (تجربة)', 'Owner', null, null, true)
on conflict (id) do nothing;

commit;
