-- ─── HR test data for the LOCAL v2 database (never production) ────────────
-- 2026-10-28. Invented people only: every name ends in "(test)" / "(تجربة)",
-- every number and email is made up. Arak Lighting gets a small company
-- (4 departments, 9 employees, papers, contracts, leave, two months of
-- attendance); Ghusn gets two people of its own, so company separation can
-- be seen on screen. Nothing here is a real employee.
--
--   docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/erp-pilot/hr/seed.sql
--
-- Runs once per company: a company that already has employees is skipped.
-- To start the test data again: dev/erp-pilot/hr/unseed.sql first.

\set ON_ERROR_STOP 1
begin;

do $$
declare
  arak uuid := '00000000-0000-0000-0000-000000000001';
  ghusn uuid := (select id from public.workspaces where name = 'Ghusn');
  approver uuid := (select user_id from public.user_access where email = 'hafeez@arak-sa.com');
  d_sales uuid; d_projects uuid; d_admin uuid; d_store uuid;
  e_ceo uuid; e_sales uuid; e_rep uuid; e_pm uuid; e_eng uuid; e_tech uuid; e_hr uuid; e_store uuid; e_left uuid;
  t_annual uuid; t_sick uuid; t_unpaid uuid; t_emergency uuid;
  r uuid;
  emp record;
  d date;
  h int;
begin
  if exists (select 1 from public.hr_employees where workspace_id = arak) then
    raise notice 'Arak Lighting already has HR data: skipped';
  else
    insert into public.hr_settings (workspace_id, work_days, work_start, work_end, grace_minutes)
    values (arak, '{0,1,2,3,4}', '08:00', '17:00', 15)
    on conflict (workspace_id) do nothing;

    insert into public.hr_departments (workspace_id, name_en, name_ar) values (arak, 'Sales (test)', 'المبيعات (تجربة)') returning id into d_sales;
    insert into public.hr_departments (workspace_id, name_en, name_ar) values (arak, 'Projects (test)', 'المشاريع (تجربة)') returning id into d_projects;
    insert into public.hr_departments (workspace_id, name_en, name_ar) values (arak, 'Administration (test)', 'الإدارة (تجربة)') returning id into d_admin;
    insert into public.hr_departments (workspace_id, name_en, name_ar) values (arak, 'Warehouse (test)', 'المستودع (تجربة)') returning id into d_store;
    insert into public.hr_departments (workspace_id, name_en, name_ar, active) values (arak, 'Workshop (test)', 'الورشة (تجربة)', false);

    insert into public.hr_employees (workspace_id, employee_no, name_en, name_ar, job_title, department_id, hire_date, work_email, work_phone)
    values (arak, 'T-001', 'Faisal Test (test)', 'فيصل تجربة (تجربة)', 'General Manager', d_admin, '2015-03-01', 'faisal.test@example.invalid', '+966 50 000 0001') returning id into e_ceo;
    insert into public.hr_employees (workspace_id, employee_no, name_en, name_ar, job_title, department_id, manager_id, hire_date, work_email, work_phone)
    values (arak, 'T-002', 'Noura Sample (test)', 'نورة عينة (تجربة)', 'Sales Manager', d_sales, e_ceo, '2018-09-15', 'noura.sample@example.invalid', '+966 50 000 0002') returning id into e_sales;
    insert into public.hr_employees (workspace_id, employee_no, name_en, name_ar, job_title, department_id, manager_id, hire_date, work_email)
    values (arak, 'T-003', 'Omar Example (test)', 'عمر مثال (تجربة)', 'Sales Engineer', d_sales, e_sales, '2022-01-09', 'omar.example@example.invalid') returning id into e_rep;
    insert into public.hr_employees (workspace_id, employee_no, name_en, name_ar, job_title, department_id, manager_id, hire_date, work_email)
    values (arak, 'T-004', 'Khalid Demo (test)', 'خالد تجريبي (تجربة)', 'Project Manager', d_projects, e_ceo, '2019-06-02', 'khalid.demo@example.invalid') returning id into e_pm;
    insert into public.hr_employees (workspace_id, employee_no, name_en, name_ar, job_title, department_id, manager_id, hire_date)
    values (arak, 'T-005', 'Sara Placeholder (test)', 'سارة افتراضية (تجربة)', 'Lighting Design Engineer', d_projects, e_pm, '2023-02-12') returning id into e_eng;
    insert into public.hr_employees (workspace_id, employee_no, name_en, name_ar, job_title, department_id, manager_id, hire_date, work_phone)
    values (arak, 'T-006', 'Yousef Trial (test)', 'يوسف محاولة (تجربة)', 'Site Technician', d_projects, e_pm, '2024-04-21', '+966 50 000 0006') returning id into e_tech;
    insert into public.hr_employees (workspace_id, employee_no, name_en, name_ar, job_title, department_id, manager_id, hire_date)
    values (arak, 'T-007', 'Huda Mock (test)', 'هدى نموذج (تجربة)', 'HR Officer', d_admin, e_ceo, '2021-11-07') returning id into e_hr;
    insert into public.hr_employees (workspace_id, employee_no, name_en, name_ar, job_title, department_id, manager_id, hire_date)
    values (arak, 'T-008', 'Ali Dummy (test)', 'علي صوري (تجربة)', 'Storekeeper', d_store, e_ceo, '2020-08-16') returning id into e_store;
    insert into public.hr_employees (workspace_id, employee_no, name_en, name_ar, job_title, department_id, manager_id, hire_date, status, end_date, end_reason)
    values (arak, 'T-009', 'Majed Former (test)', 'ماجد سابق (تجربة)', 'Driver', d_store, e_store, '2019-01-06', 'ended', '2026-06-30', 'Resigned (test)') returning id into e_left;
    update public.hr_departments set head_id = e_sales where id = d_sales;
    update public.hr_departments set head_id = e_pm where id = d_projects;
    update public.hr_departments set head_id = e_ceo where id = d_admin;
    update public.hr_departments set head_id = e_store where id = d_store;

    -- Papers: one expired, three within 60 days, the rest later.
    insert into public.hr_documents (workspace_id, employee_id, doc_type, doc_number, issue_date, expiry_date, notes) values
      (arak, e_ceo, 'national_id', '1000000001', '2019-01-01', '2029-01-01', ''),
      (arak, e_sales, 'national_id', '1000000002', '2021-05-10', '2031-05-10', ''),
      (arak, e_rep, 'iqama', '2000000003', '2025-11-20', public.hr_today() + 18, ''),
      (arak, e_rep, 'passport', 'P0000003', '2020-02-01', '2030-02-01', ''),
      (arak, e_eng, 'iqama', '2000000005', '2025-10-01', public.hr_today() - 6, ''),
      (arak, e_tech, 'iqama', '2000000006', '2025-12-01', public.hr_today() + 45, ''),
      (arak, e_tech, 'driving_license', 'DL000006', '2022-03-01', '2027-03-01', ''),
      (arak, e_tech, 'health_cert', 'HC000006', '2025-11-15', public.hr_today() + 30, ''),
      (arak, e_store, 'other', 'FL-0008', '2025-01-01', '2027-01-01', 'Forklift licence (test)');

    insert into public.hr_contracts (workspace_id, employee_id, contract_type, start_date, end_date, notes) values
      (arak, e_ceo, 'open', '2015-03-01', null, ''),
      (arak, e_sales, 'open', '2018-09-15', null, ''),
      (arak, e_rep, 'fixed', '2022-01-09', '2024-01-08', 'First contract (test)'),
      (arak, e_rep, 'fixed', '2024-01-09', '2027-01-08', 'Renewed (test)'),
      (arak, e_pm, 'open', '2019-06-02', null, ''),
      (arak, e_eng, 'fixed', '2023-02-12', '2026-12-31', ''),
      (arak, e_tech, 'fixed', '2024-04-21', '2026-11-20', 'Ends soon (test)'),
      (arak, e_hr, 'open', '2021-11-07', null, ''),
      (arak, e_store, 'open', '2020-08-16', null, ''),
      (arak, e_left, 'fixed', '2019-01-06', '2026-06-30', '');

    insert into public.hr_leave_types (workspace_id, name_en, name_ar, paid, needs_balance) values (arak, 'Annual leave', 'إجازة سنوية', true, true) returning id into t_annual;
    insert into public.hr_leave_types (workspace_id, name_en, name_ar, paid, needs_balance) values (arak, 'Sick leave', 'إجازة مرضية', true, false) returning id into t_sick;
    insert into public.hr_leave_types (workspace_id, name_en, name_ar, paid, needs_balance) values (arak, 'Unpaid leave', 'إجازة بدون راتب', false, false) returning id into t_unpaid;
    insert into public.hr_leave_types (workspace_id, name_en, name_ar, paid, needs_balance) values (arak, 'Emergency leave', 'إجازة اضطرارية', true, true) returning id into t_emergency;

    for emp in select id from public.hr_employees where workspace_id = arak and status = 'active' loop
      insert into public.hr_leave_balances (workspace_id, employee_id, leave_type_id, year, days, note, updated_by)
      values (arak, emp.id, t_annual, 2026, case when emp.id in (e_ceo, e_sales, e_pm) then 30 else 21 end, 'Test balance', approver),
             (arak, emp.id, t_emergency, 2026, 5, 'Test balance', approver);
    end loop;

    -- Approved in the past (attendance skips those days), approved now (today
    -- someone is off), pending ahead, one rejected, one cancelled.
    insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason)
    values (arak, e_rep, t_annual, '2026-09-14', '2026-09-18', 5, 'Family trip (test)') returning id into r;
    update public.hr_leave_requests set status = 'approved', decided_by = approver, decided_at = now() where id = r;
    insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason)
    values (arak, e_eng, t_sick, '2026-10-12', '2026-10-13', 2, 'Flu (test)') returning id into r;
    update public.hr_leave_requests set status = 'approved', decided_by = approver, decided_at = now() where id = r;
    insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason)
    values (arak, e_store, t_annual, public.hr_today() - 1, public.hr_today() + 3, 4, 'Annual leave (test)') returning id into r;
    update public.hr_leave_requests set status = 'approved', decided_by = approver, decided_at = now() where id = r;
    insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason) values
      (arak, e_tech, t_annual, '2026-11-15', '2026-11-19', 5, 'Visiting family (test)'),
      (arak, e_hr, t_emergency, '2026-11-03', '2026-11-03', 1, 'Personal errand (test)');
    insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason)
    values (arak, e_rep, t_annual, '2026-12-20', '2026-12-31', 9, 'Year end (test)') returning id into r;
    update public.hr_leave_requests set status = 'rejected', decided_by = approver, decided_at = now(), decision_note = 'Year-end delivery week (test)' where id = r;
    insert into public.hr_leave_requests (workspace_id, employee_id, leave_type_id, date_from, date_to, days, reason)
    values (arak, e_pm, t_unpaid, '2026-10-05', '2026-10-05', 1, 'Changed plans (test)') returning id into r;
    update public.hr_leave_requests set status = 'cancelled', cancelled_by = approver, cancelled_at = now() where id = r;

    -- Attendance, 1 September to yesterday, Sunday to Thursday. A fixed
    -- pattern per person and day (no randomness), so re-seeding is the same.
    for emp in select id, hire_date, end_date, employee_no from public.hr_employees where workspace_id = arak loop
      for d in select g::date from generate_series(date '2026-09-01', public.hr_today() - 1, interval '1 day') g loop
        continue when extract(dow from d) not in (0, 1, 2, 3, 4);
        continue when d < emp.hire_date or (emp.end_date is not null and d > emp.end_date);
        continue when exists (select 1 from public.hr_leave_requests q where q.employee_id = emp.id and q.status = 'approved' and d between q.date_from and q.date_to);
        h := abs(hashtext(emp.employee_no || d::text)) % 100;
        if h < 4 then
          insert into public.hr_attendance (workspace_id, employee_id, day, status, notes) values (arak, emp.id, d, 'absent', '');
        elsif h < 14 then
          insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in, check_out)
          values (arak, emp.id, d, 'late', time '08:16' + make_interval(mins => h), time '17:05' + make_interval(mins => h % 7));
        elsif h < 17 then
          -- Forgot to record the departure.
          insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in) values (arak, emp.id, d, 'present', time '07:52' + make_interval(mins => h % 9));
        else
          insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in, check_out)
          values (arak, emp.id, d, 'present', time '07:48' + make_interval(mins => h % 12), time '17:00' + make_interval(mins => h % 20));
        end if;
      end loop;
    end loop;
    -- Today: four have arrived so far; the rest have no record yet.
    insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in)
    select arak, id, public.hr_today(), 'present', time '07:55' from public.hr_employees where id in (e_ceo, e_sales, e_pm);
    insert into public.hr_attendance (workspace_id, employee_id, day, status, check_in)
    values (arak, e_rep, public.hr_today(), 'late', time '08:41');
    raise notice 'Arak Lighting: HR test data added';
  end if;

  if ghusn is not null and not exists (select 1 from public.hr_employees where workspace_id = ghusn) then
    insert into public.hr_departments (workspace_id, name_en, name_ar) values (ghusn, 'Operations (test)', 'العمليات (تجربة)') returning id into d_admin;
    insert into public.hr_employees (workspace_id, employee_no, name_en, name_ar, job_title, department_id, hire_date)
    values (ghusn, 'G-001', 'Reem Ghusn (test)', 'ريم غصن (تجربة)', 'Operations Lead', d_admin, '2024-01-07') returning id into e_ceo;
    insert into public.hr_employees (workspace_id, employee_no, name_en, name_ar, job_title, department_id, manager_id, hire_date)
    values (ghusn, 'G-002', 'Tariq Ghusn (test)', 'طارق غصن (تجربة)', 'Coordinator', d_admin, e_ceo, '2025-03-02');
    insert into public.hr_leave_types (workspace_id, name_en, name_ar, paid, needs_balance) values (ghusn, 'Annual leave', 'إجازة سنوية', true, true);
    raise notice 'Ghusn: HR test data added';
  end if;
end $$;

commit;
