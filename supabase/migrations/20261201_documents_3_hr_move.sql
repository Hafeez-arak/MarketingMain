-- ─── v2: Documents, the employees' papers move here ────────────────────────
-- 2026-10-29, after 20261201_documents_2_rules.sql. Musa moved the papers of
-- employees into Documents («تنتقل إلى المستندات») and so does v2:
--
--   · each HR paper (hr_documents) becomes a confirmed document linked to
--     its employee, with one version holding its type, number, dates, notes
--     and its scan (the file stays in the 'hr-papers' bucket where it is);
--   · the HR employee page and HR's Expiring papers read them from Documents
--     from now on (src/pages/hr);
--   · the old table stays for the history and refuses new writes. Its rows
--     may still go when their employee or company is deleted.
--
-- The seven HR types map onto the suggested types of the same names; "other"
-- becomes "Other employee document". The title is the type and the
-- employee's name (for "other", the note HR required with it).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run: a paper already
-- moved is skipped.

create or replace function public.documents_move_hr_papers(ws uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_type uuid;
  v_doc  uuid;
  v_name text;
  n      integer := 0;
begin
  perform public.documents_seed_types(ws);
  for r in
    select h.*, e.name_en as employee_name
      from public.hr_documents h
      join public.hr_employees e on e.workspace_id = h.workspace_id and e.id = h.employee_id
     where h.workspace_id = ws
       and not exists (select 1 from public.company_documents d where d.legacy_hr_document_id = h.id)
     order by h.created_at, h.id
  loop
    select t.id, t.name into v_type, v_name from public.document_types t
     where t.workspace_id = ws
       and t.code = case r.doc_type when 'national_id' then 'NATIONAL_ID' when 'iqama' then 'IQAMA' when 'passport' then 'PASSPORT'
                                    when 'work_permit' then 'WORK_PERMIT' when 'health_cert' then 'HEALTH_CERT'
                                    when 'driving_license' then 'DRIVING_LICENSE' else 'EMPLOYEE_OTHER' end;
    insert into public.company_documents (workspace_id, type_id, title, link_kind, employee_id, notes, legacy_hr_document_id, created_by, created_at)
    values (ws, v_type,
            left((case when r.doc_type = 'other' then coalesce(nullif(btrim(r.notes), ''), v_name) else v_name end) || ' — ' || r.employee_name, 200),
            'employee', r.employee_id, nullif(btrim(r.notes), ''), r.id, r.created_by, r.created_at)
    returning id into v_doc;
    insert into public.company_document_versions (workspace_id, document_id, file_bucket, file_path, file_name, file_size, file_type,
                                                   number, issue_date, expiry_date, sources, uploaded_by, created_at)
    values (ws, v_doc,
            case when r.file_path is not null then 'hr-papers' end, r.file_path, r.file_name, r.file_size, r.file_type,
            nullif(btrim(r.doc_number), ''), r.issue_date, r.expiry_date,
            jsonb_strip_nulls(jsonb_build_object(
              'number', case when nullif(btrim(r.doc_number), '') is not null then 'manual' end,
              'issue_date', case when r.issue_date is not null then 'manual' end,
              'expiry_date', case when r.expiry_date is not null then 'manual' end)),
            r.created_by, r.created_at);
    update public.company_document_versions set status = 'current', confirmed_at = r.created_at
     where document_id = v_doc;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.documents_move_hr_papers(uuid) from public, anon, authenticated;

do $$
declare w record;
begin
  for w in select id from public.workspaces loop
    perform public.documents_move_hr_papers(w.id);
  end loop;
end $$;

-- ── The old table keeps its rows for the history and takes nothing new ──
create or replace function public.hr_documents_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Rows still go with their employee or company (the cascade); nothing else.
  if tg_op = 'DELETE' and not exists (select 1 from public.hr_employees e where e.id = old.employee_id) then
    return old;
  end if;
  raise exception 'DOCUMENT_HR_MOVED' using errcode = 'P0001';
end;
$$;
drop trigger if exists hr_documents_moved on public.hr_documents;
create trigger hr_documents_moved before insert or update or delete on public.hr_documents
  for each row execute function public.hr_documents_moved();
