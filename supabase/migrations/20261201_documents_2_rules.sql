-- ─── v2: Documents, the rules ──────────────────────────────────────────────
-- 2026-10-29, after 20261201_documents_1_tables.sql. Musa's Documents rules
-- (his migration 0058), in the database so every screen and anything
-- written later meets the same ones:
--
--   · a document starts as a draft; its number, issuer and dates are those
--     of its current confirmed version and change only by confirming a version;
--   · a confirmed document is archived with a written reason, never deleted
--     (only a draft is deleted); an archived one is not changed;
--   · the type and the link of a confirmed document never change; the type
--     must be active and allow the link; the responsible belongs to the company;
--   · a version is pending until confirmed; confirmed it is final; the next
--     confirmed one supersedes it (a renewal is a new version); one pending,
--     one current at a time; the same file twice is refused;
--   · confirming needs the fields the type requires (a paper moved from HR
--     keeps what it had);
--   · every field's source is recorded: file, ai or manual;
--   · the alerts and the access log are append-only;
--   · the DOC-2026-000001 number is gap-free per company and year;
--   · a file of a confidential or an employee's document opens only after
--     the opening is logged (the storage policy asks for the log);
--   · every change is in document_history.
--
-- A refusal is an exception whose message is a code (DOCUMENT_…); the screen
-- (lib/documents/client.js) turns it into words. Functions run as the caller
-- unless marked security definer.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── Helpers ──

-- Today in Riyadh: the company's day, whatever the server's clock zone.
create or replace function public.documents_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Riyadh')::date;
$$;
grant execute on function public.documents_today() to authenticated;

-- Is the company being deleted? The rules step aside for the cascade.
create or replace function public.documents_company_gone(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.workspaces w where w.id = ws);
$$;
revoke all on function public.documents_company_gone(uuid) from public, anon;
grant execute on function public.documents_company_gone(uuid) to authenticated;

-- An approved login of this company with the Documents section (or the
-- access admin who belongs to it): who a document can be given to.
create or replace function public.documents_member(ws uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access ua
      join public.workspace_members m on m.user_id = ua.user_id and m.workspace_id = ws
     where ua.user_id = uid and ua.status = 'approved'
       and (ua.role = 'admin'
            or exists (select 1 from public.section_access a where a.workspace_id = ws and a.user_id = uid and a.section = 'documents')));
$$;
revoke all on function public.documents_member(uuid, uuid) from public, anon;
grant execute on function public.documents_member(uuid, uuid) to authenticated;

/** The people of the "responsible" picker, for anyone who reads Documents. */
create or replace function public.documents_people(ws uuid)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select ua.user_id, coalesce(nullif(btrim(ua.full_name), ''), split_part(ua.email, '@', 1))
    from public.user_access ua
   where public.has_section(ws, 'documents', 'view')
     and public.documents_member(ws, ua.user_id)
   order by 2;
$$;
revoke all on function public.documents_people(uuid) from public, anon;
grant execute on function public.documents_people(uuid) to authenticated;

/**
 * The employees a document can be linked to or named for: all of them for
 * whoever reads employees' papers (Documents Manage, HR Manage), and a person
 * themselves for their own. (Creating one needs Manage: the screen checks.)
 */
create or replace function public.documents_employees(ws uuid)
returns table (id uuid, employee_no text, name_en text, name_ar text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.employee_no, e.name_en, e.name_ar, e.status
    from public.hr_employees e
   where e.workspace_id = ws
     and (public.has_section(ws, 'documents', 'manage') or public.has_section(ws, 'hr', 'manage')
          or (public.has_section(ws, 'hr', 'view') and e.id is not distinct from public.hr_my_employee(ws)))
   order by (e.status = 'active') desc, e.name_en;
$$;
revoke all on function public.documents_employees(uuid) from public, anon;
grant execute on function public.documents_employees(uuid) to authenticated;

/** The suppliers a document is linked to or named for: Contacts organisations with the supplier role. */
create or replace function public.documents_suppliers(ws uuid)
returns table (id uuid, contact_no text, name text, name_ar text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.contact_no, o.name, o.name_ar, o.status
    from public.contacts_orgs o
   where o.workspace_id = ws and 'supplier' = any(o.roles) and public.has_section(ws, 'documents', 'view')
   order by (o.status = 'active') desc, o.name;
$$;
revoke all on function public.documents_suppliers(uuid) from public, anon;
grant execute on function public.documents_suppliers(uuid) to authenticated;

create or replace function public.documents_is_supplier(org uuid, ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.contacts_orgs o where o.id = org and o.workspace_id = ws and 'supplier' = any(o.roles));
$$;
revoke all on function public.documents_is_supplier(uuid, uuid) from public, anon;
grant execute on function public.documents_is_supplier(uuid, uuid) to authenticated;

-- ── Types: tidy, and the code and company never change ──
create or replace function public.document_types_tidy()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.name_en := nullif(btrim(new.name_en), '');
  new.number_pattern := nullif(btrim(new.number_pattern), '');
  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id then
      raise exception 'DOCUMENT_WORKSPACE_FIXED' using errcode = 'P0001';
    end if;
    if new.code is distinct from old.code then
      raise exception 'DOCUMENT_TYPE_LOCKED' using errcode = 'P0001';
    end if;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  if new.number_pattern is not null then
    begin
      perform '' ~ new.number_pattern;
    exception when others then
      raise exception 'DOCUMENT_TYPE_PATTERN' using errcode = 'P0001';
    end;
  end if;
  -- Largest first, without repeats; none = no alert.
  if new.alert_days is not null then
    new.alert_days := (select array_agg(distinct d order by d desc) from unnest(new.alert_days) d where d is not null);
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists document_types_tidy on public.document_types;
create trigger document_types_tidy before insert or update on public.document_types
  for each row execute function public.document_types_tidy();

-- ── Numbers: DOC-2026-000001, per company and year, gap-free ──
-- Updated in the insert's own transaction, so a refused insert gives its
-- number back and two people saving at once wait for each other.
create or replace function public.document_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  y integer := extract(year from public.documents_today())::integer;
  n integer;
begin
  if tg_op = 'UPDATE' then
    new.document_no := old.document_no;
    return new;
  end if;
  insert into public.document_counters as c (workspace_id, year, last) values (new.workspace_id, y, 1)
  on conflict (workspace_id, year) do update set last = c.last + 1
  returning last into n;
  new.document_no := 'DOC-' || y || '-' || lpad(n::text, 6, '0');
  return new;
end;
$$;
drop trigger if exists document_number on public.company_documents;
create trigger document_number before insert or update on public.company_documents
  for each row execute function public.document_number();

-- ── The document's rules ──
create or replace function public.company_documents_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  t    public.document_types%rowtype;
  -- coalesce: the setting does not exist yet in a fresh session (null, not false).
  sync boolean := coalesce(current_setting('documents.sync', true) = (case when tg_op = 'DELETE' then old.id else new.id end)::text, false);
begin
  if tg_op = 'DELETE' then
    if public.documents_company_gone(old.workspace_id) then
      return old;
    end if;
    if old.confirmed_at is not null then
      raise exception 'DOCUMENT_DELETE' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.confirmed_at is not null or new.archived_at is not null
       or new.number is not null or new.issuer is not null or new.issue_date is not null or new.expiry_date is not null then
      raise exception 'DOCUMENT_LOCKED' using errcode = 'P0001';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    if new.workspace_id <> old.workspace_id then
      raise exception 'DOCUMENT_WORKSPACE_FIXED' using errcode = 'P0001';
    end if;
    if old.archived_at is not null then
      raise exception 'DOCUMENT_ARCHIVED' using errcode = 'P0001';
    end if;
    if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
       or new.legacy_hr_document_id is distinct from old.legacy_hr_document_id then
      raise exception 'DOCUMENT_LOCKED' using errcode = 'P0001';
    end if;
    -- The number, issuer and dates come with a confirmed version only.
    if not sync and (new.number, new.issuer, new.issue_date, new.expiry_date, new.confirmed_at)
                    is distinct from (old.number, old.issuer, old.issue_date, old.expiry_date, old.confirmed_at) then
      raise exception 'DOCUMENT_LOCKED' using errcode = 'P0001';
    end if;
    if old.confirmed_at is not null and (new.type_id, new.link_kind, new.employee_id, new.asset_id, new.supplier_id)
                                        is distinct from (old.type_id, old.link_kind, old.employee_id, old.asset_id, old.supplier_id) then
      raise exception 'DOCUMENT_LOCKED' using errcode = 'P0001';
    end if;
    if new.archived_at is not null then
      if old.confirmed_at is null then
        raise exception 'DOCUMENT_ARCHIVE_DRAFT' using errcode = 'P0001';
      end if;
      if btrim(coalesce(new.archive_reason, '')) = '' then
        raise exception 'DOCUMENT_ARCHIVE_REASON' using errcode = 'P0001';
      end if;
      new.archived_at := now();
      new.archived_by := auth.uid();
    end if;
  end if;

  select * into t from public.document_types where id = new.type_id and workspace_id = new.workspace_id;
  if tg_op = 'INSERT' or new.type_id is distinct from old.type_id then
    if not t.is_active then
      raise exception 'DOCUMENT_TYPE_INACTIVE' using errcode = 'P0001';
    end if;
  end if;
  if (tg_op = 'INSERT' or (new.type_id, new.link_kind) is distinct from (old.type_id, old.link_kind))
     and not new.link_kind = any (t.link_kinds) then
    raise exception 'DOCUMENT_LINK' using errcode = 'P0001';
  end if;
  -- Fixed assets are not in v2 yet: the link exists, nothing takes it.
  if new.link_kind = 'asset' and (tg_op = 'INSERT' or new.link_kind is distinct from old.link_kind) then
    raise exception 'DOCUMENT_ASSET_WAITS' using errcode = 'P0001';
  end if;
  if new.link_kind = 'supplier' and (tg_op = 'INSERT' or new.supplier_id is distinct from old.supplier_id)
     and not public.documents_is_supplier(new.supplier_id, new.workspace_id) then
    raise exception 'DOCUMENT_SUPPLIER' using errcode = 'P0001';
  end if;
  if new.responsible_id is not null and (tg_op = 'INSERT' or new.responsible_id is distinct from old.responsible_id)
     and not public.documents_member(new.workspace_id, new.responsible_id) then
    raise exception 'DOCUMENT_RESPONSIBLE' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists company_documents_guard on public.company_documents;
create trigger company_documents_guard before insert or update or delete on public.company_documents
  for each row execute function public.company_documents_guard();

-- ── Versions: pending until confirmed, then final ──
create or replace function public.document_versions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  d public.company_documents%rowtype;
  t public.document_types%rowtype;
  k text;
begin
  if tg_op = 'DELETE' then
    if public.documents_company_gone(old.workspace_id) then
      return old;
    end if;
    if old.status <> 'pending' then
      raise exception 'DOCUMENT_VERSION_FINAL' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id then
      raise exception 'DOCUMENT_WORKSPACE_FIXED' using errcode = 'P0001';
    end if;
    -- The previous version, superseded by the confirmation of the next one.
    if old.status = 'current' and new.status = 'superseded'
       and current_setting('documents.sync', true) = new.document_id::text
       and (new.document_id, new.version_no, new.file_bucket, new.file_path, new.sha256, new.number, new.issuer, new.issue_date, new.expiry_date,
            new.sources, new.suggestions, new.confirmed_by, new.confirmed_at)
           is not distinct from
           (old.document_id, old.version_no, old.file_bucket, old.file_path, old.sha256, old.number, old.issuer, old.issue_date, old.expiry_date,
            old.sources, old.suggestions, old.confirmed_by, old.confirmed_at) then
      return new;
    end if;
    if old.status <> 'pending' then
      raise exception 'DOCUMENT_VERSION_FINAL' using errcode = 'P0001';
    end if;
    if (new.document_id, new.version_no, new.file_bucket, new.file_path, new.sha256, new.file_name, new.file_size, new.file_type, new.uploaded_by, new.created_at)
       is distinct from
       (old.document_id, old.version_no, old.file_bucket, old.file_path, old.sha256, old.file_name, old.file_size, old.file_type, old.uploaded_by, old.created_at) then
      raise exception 'DOCUMENT_VERSION_FILE' using errcode = 'P0001';
    end if;
  end if;

  select * into d from public.company_documents where id = new.document_id and workspace_id = new.workspace_id for update;
  if d.archived_at is not null then
    raise exception 'DOCUMENT_ARCHIVED' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'DOCUMENT_VERSION_FINAL' using errcode = 'P0001';
    end if;
    new.version_no := coalesce((select max(version_no) from public.company_document_versions where document_id = new.document_id), 0) + 1;
    if exists (select 1 from public.company_document_versions where document_id = new.document_id and status = 'pending') then
      raise exception 'DOCUMENT_VERSION_PENDING' using errcode = 'P0001';
    end if;
    if new.sha256 is not null
       and exists (select 1 from public.company_document_versions where document_id = new.document_id and sha256 = new.sha256) then
      raise exception 'DOCUMENT_FILE_REPEATED' using errcode = 'P0001';
    end if;
    if auth.uid() is not null then
      new.uploaded_by := auth.uid();
    end if;
    -- A person's upload is stamped now; the system moving old papers keeps their date.
    if auth.uid() is not null then
      new.created_at := now();
    end if;
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.superseded_at := null;
  end if;

  -- Where each field came from.
  for k in select jsonb_object_keys(new.sources) loop
    if k not in ('number', 'issuer', 'issue_date', 'expiry_date') or (new.sources ->> k) not in ('file', 'ai', 'manual') then
      raise exception 'DOCUMENT_SOURCES' using errcode = 'P0001';
    end if;
  end loop;

  -- Confirmation: the type's required fields (a paper moved from HR keeps what it had).
  if new.status = 'current' and (tg_op = 'INSERT' or old.status = 'pending') then
    if tg_op = 'UPDATE' then
      if auth.uid() is not null then
        new.confirmed_by := auth.uid();
      end if;
      new.confirmed_at := coalesce(new.confirmed_at, now());
    end if;
    select * into t from public.document_types where id = d.type_id and workspace_id = d.workspace_id;
    if d.legacy_hr_document_id is null and (
          (t.number_required and btrim(coalesce(new.number, '')) = '')
       or (t.issuer_required and btrim(coalesce(new.issuer, '')) = '')
       or (t.issue_date_required and new.issue_date is null)
       or (t.expiry_required and new.expiry_date is null)) then
      raise exception 'DOCUMENT_FIELDS' using errcode = 'P0001';
    end if;
    -- The current version is superseded in the same statement chain.
    perform set_config('documents.sync', new.document_id::text, true);
    update public.company_document_versions set status = 'superseded', superseded_at = now()
     where document_id = new.document_id and status = 'current' and id <> new.id;
    perform set_config('documents.sync', '', true);
  end if;
  return new;
end;
$$;
drop trigger if exists document_versions_guard on public.company_document_versions;
create trigger document_versions_guard before insert or update or delete on public.company_document_versions
  for each row execute function public.document_versions_guard();

-- The confirmed version becomes the document's data, in the same transaction.
create or replace function public.document_versions_apply()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'current' and (tg_op = 'INSERT' or old.status = 'pending') then
    perform set_config('documents.sync', new.document_id::text, true);
    update public.company_documents
       set number = new.number, issuer = new.issuer, issue_date = new.issue_date, expiry_date = new.expiry_date,
           confirmed_at = coalesce(confirmed_at, new.confirmed_at)
     where id = new.document_id;
    perform set_config('documents.sync', '', true);
  end if;
  return null;
end;
$$;
drop trigger if exists document_versions_apply on public.company_document_versions;
create trigger document_versions_apply after insert or update on public.company_document_versions
  for each row execute function public.document_versions_apply();

-- ── The logs are append-only ──
create or replace function public.document_logs_final()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.documents_company_gone(old.workspace_id) then
    return old;
  end if;
  raise exception 'DOCUMENT_LOG_FINAL' using errcode = 'P0001';
end;
$$;
drop trigger if exists document_alerts_final on public.document_alerts;
create trigger document_alerts_final before update or delete on public.document_alerts
  for each row execute function public.document_logs_final();
drop trigger if exists document_access_log_final on public.document_access_log;
create trigger document_access_log_final before update or delete on public.document_access_log
  for each row execute function public.document_logs_final();

-- ── History: every change, whoever made it ──
create or replace function public.documents_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  rec jsonb := coalesce(n, o);
  diff jsonb := '{}'::jsonb;
  k text;
begin
  if public.documents_company_gone((rec ->> 'workspace_id')::uuid) then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at', 'created_at', 'created_by', 'extracted_text', 'suggestions') and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then
      return null;
    end if;
  end if;
  insert into public.document_history (workspace_id, document_id, table_name, row_id, action, label, changes, actor)
  values (
    (rec ->> 'workspace_id')::uuid,
    case tg_table_name when 'company_documents' then (rec ->> 'id')::uuid when 'company_document_versions' then (rec ->> 'document_id')::uuid end,
    tg_table_name, (rec ->> 'id')::uuid, lower(tg_op),
    case tg_table_name when 'company_documents' then coalesce(rec ->> 'document_no', '') || ' ' || coalesce(rec ->> 'title', '')
                       when 'company_document_versions' then 'v' || coalesce(rec ->> 'version_no', '')
                       else coalesce(rec ->> 'name', '') end,
    diff, auth.uid());
  return null;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['document_types', 'company_documents', 'company_document_versions'] loop
    execute format('drop trigger if exists %1$s_log on public.%1$I', t);
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function public.documents_log()', t);
  end loop;
end $$;

-- ── The suggested types: made for every company, now and when one is created ──
-- Alerts at 90, 30 and 7 days and a renewal task at 30. They are data the
-- company edits (its own names, days, required fields), never constants.
create or replace function public.documents_seed_types(ws uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  insert into public.document_types (workspace_id, code, name, name_en, link_kinds, number_required, expiry_required, number_pattern,
                                     company_field, alert_days, task_days_before, sequence)
  select ws, s.code, s.name, s.name_en, s.links, s.num_req, s.exp_req, s.pattern, s.field, array[90, 30, 7]::smallint[], 30, s.seq
    from (values
      ('CR', 'السجل التجاري', 'Commercial register', array['company'], true, false, '[0-9]{10}', 'cr_number', 10),
      ('VAT_CERT', 'شهادة ضريبة القيمة المضافة', 'VAT registration certificate', array['company'], true, false, '[0-9]{15}', 'vat_number', 20),
      ('ZAKAT_CERT', 'شهادة الزكاة', 'Zakat certificate', array['company'], false, false, null, null, 30),
      ('GOSI_CERT', 'شهادة التأمينات الاجتماعية', 'Social insurance (GOSI) certificate', array['company'], false, false, null, null, 40),
      ('CHAMBER', 'عضوية الغرفة التجارية', 'Chamber of commerce membership', array['company'], false, false, null, null, 50),
      ('MUNICIPAL', 'رخصة البلدية', 'Municipal licence', array['company'], false, false, null, null, 60),
      ('CIVIL_DEFENSE', 'رخصة الدفاع المدني', 'Civil defence licence', array['company'], false, false, null, null, 70),
      ('CONTRACTOR_CLASS', 'تصنيف المقاولين', 'Contractor classification', array['company'], false, false, null, null, 80),
      ('INSURANCE', 'وثيقة تأمين', 'Insurance policy', array['company', 'asset'], false, true, null, null, 90),
      ('LEASE', 'عقد إيجار', 'Lease', array['company'], false, false, null, null, 100),
      ('VEHICLE_REG', 'استمارة مركبة', 'Vehicle registration', array['asset'], false, true, null, null, 110),
      ('AGENCY', 'اتفاقية وكالة أو توزيع', 'Agency or distribution agreement', array['supplier'], false, false, null, null, 120),
      ('NATIONAL_ID', 'الهوية الوطنية', 'National ID', array['employee'], false, false, null, null, 200),
      ('IQAMA', 'الإقامة', 'Iqama', array['employee'], false, false, null, null, 210),
      ('PASSPORT', 'جواز السفر', 'Passport', array['employee'], false, false, null, null, 220),
      ('WORK_PERMIT', 'رخصة العمل', 'Work permit', array['employee'], false, false, null, null, 230),
      ('HEALTH_CERT', 'الشهادة الصحية', 'Health certificate', array['employee'], false, false, null, null, 240),
      ('DRIVING_LICENSE', 'رخصة القيادة', 'Driving licence', array['employee'], false, false, null, null, 250),
      ('EMPLOYEE_OTHER', 'وثيقة أخرى للموظف', 'Other employee document', array['employee'], false, false, null, null, 260)
    ) as s(code, name, name_en, links, num_req, exp_req, pattern, field, seq)
   where not exists (select 1 from public.document_types x where x.workspace_id = ws and x.code = s.code)
     and not exists (select 1 from public.document_types x where x.workspace_id = ws and x.name = s.name);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.documents_seed_types(uuid) from public, anon, authenticated;

/** The button: bring back the suggested types the company removed or never had (none is overwritten). */
create or replace function public.documents_suggest_types(ws uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_section(ws, 'documents', 'work') then
    raise exception 'DOCUMENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  return public.documents_seed_types(ws);
end;
$$;
revoke all on function public.documents_suggest_types(uuid) from public, anon;
grant execute on function public.documents_suggest_types(uuid) to authenticated;

create or replace function public.documents_seed_new_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.documents_seed_types(new.id);
  return null;
end;
$$;
drop trigger if exists documents_seed_new_company on public.workspaces;
create trigger documents_seed_new_company after insert on public.workspaces
  for each row execute function public.documents_seed_new_company();

-- Existing companies.
do $$
declare w record;
begin
  for w in select id from public.workspaces loop
    perform public.documents_seed_types(w.id);
  end loop;
end $$;

-- ── Opening a file: logged first, then the storage policy lets it through ──
-- A confidential or an employee's document (confirmed) is opened only after
-- a row in document_access_log says who and when; the storage policy below
-- asks for that row, so a direct storage call cannot skip the log.
create or replace function public.documents_open_file(version uuid, download boolean default false)
returns table (bucket text, path text, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.company_document_versions%rowtype;
  d public.company_documents%rowtype;
begin
  select * into v from public.company_document_versions where id = version;
  if not found then
    raise exception 'DOCUMENT_NO_FILE' using errcode = 'P0001';
  end if;
  select * into d from public.company_documents where id = v.document_id;
  if not public.documents_can_read(d.workspace_id, d.link_kind, d.employee_id, d.confidential) then
    raise exception 'DOCUMENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if v.file_path is null then
    raise exception 'DOCUMENT_NO_FILE' using errcode = 'P0001';
  end if;
  if (d.confidential or d.link_kind = 'employee') and d.confirmed_at is not null then
    insert into public.document_access_log (workspace_id, document_id, version_no, file_bucket, file_path, action, user_id)
    values (d.workspace_id, d.id, v.version_no, v.file_bucket, v.file_path, case when download then 'download' else 'view' end, auth.uid());
  end if;
  return query select v.file_bucket, v.file_path,
    d.document_no || '-v' || v.version_no || '.' ||
      case v.file_type when 'application/pdf' then 'pdf' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'jpg' end;
end;
$$;
revoke all on function public.documents_open_file(uuid, boolean) from public, anon;
grant execute on function public.documents_open_file(uuid, boolean) to authenticated;

-- May the caller touch this storage object? <workspace>/<document>/<file> in
-- 'company-documents'; HR's old scans in 'hr-papers' are read through the
-- version that points at them.
create or replace function public.documents_file_ok(bkt text, objname text, for_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  parts text[] := string_to_array(objname, '/');
  ws uuid;
  doc uuid;
  d public.company_documents%rowtype;
begin
  if array_length(parts, 1) is null or array_length(parts, 1) < 3 then
    return false;
  end if;
  begin
    ws := parts[1]::uuid;
    doc := parts[2]::uuid;
  exception when others then
    -- hr-papers is <workspace>/<employee>/<file>: the document is found by the file.
    doc := null;
  end;
  if bkt = 'hr-papers' then
    if for_write then
      return false;
    end if;
    select d2.* into d from public.company_documents d2
      join public.company_document_versions v on v.document_id = d2.id
     where v.file_bucket = 'hr-papers' and v.file_path = objname;
  else
    select * into d from public.company_documents where id = doc and workspace_id = ws;
  end if;
  if d.id is null then
    return false;
  end if;
  if for_write then
    return d.archived_at is null and public.documents_can_write(d.workspace_id, d.link_kind, d.confidential);
  end if;
  if not public.documents_can_read(d.workspace_id, d.link_kind, d.employee_id, d.confidential) then
    return false;
  end if;
  if (d.confidential or d.link_kind = 'employee') and d.confirmed_at is not null then
    return exists (select 1 from public.document_access_log l
                    where l.user_id = auth.uid() and l.file_path = objname and l.at > now() - interval '5 minutes');
  end if;
  return true;
end;
$$;
revoke all on function public.documents_file_ok(text, text, boolean) from public, anon;
grant execute on function public.documents_file_ok(text, text, boolean) to authenticated;

drop policy if exists "company-documents read" on storage.objects;
create policy "company-documents read" on storage.objects for select to authenticated
  using (bucket_id = 'company-documents' and public.documents_file_ok(bucket_id, name, false));
drop policy if exists "company-documents insert" on storage.objects;
create policy "company-documents insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'company-documents' and public.documents_file_ok(bucket_id, name, true));
drop policy if exists "company-documents update" on storage.objects;
create policy "company-documents update" on storage.objects for update to authenticated
  using (bucket_id = 'company-documents' and public.documents_file_ok(bucket_id, name, true));
drop policy if exists "company-documents delete" on storage.objects;
create policy "company-documents delete" on storage.objects for delete to authenticated
  using (bucket_id = 'company-documents' and public.documents_file_ok(bucket_id, name, true));
-- A paper's scan that moved here from HR stays in 'hr-papers'; a Documents
-- reader opens it (after the log) through this second, additive policy.
drop policy if exists "hr-papers read by documents" on storage.objects;
create policy "hr-papers read by documents" on storage.objects for select to authenticated
  using (bucket_id = 'hr-papers' and public.documents_file_ok(bucket_id, name, false));

-- ── Saving the review form: the document's details and its pending version, together ──
-- One transaction, so a refused confirmation leaves nothing half saved. Runs
-- as the caller: RLS and the rules above apply to both updates. A draft may
-- also change its type and link (a confirmed document never does: the guard).
create or replace function public.documents_review_save(doc uuid, doc_fields jsonb, ver_fields jsonb, confirm boolean default false)
returns void
language plpgsql
set search_path = public
as $$
declare
  d public.company_documents%rowtype;
  v uuid;
begin
  select * into d from public.company_documents where id = doc;
  if not found then
    raise exception 'DOCUMENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  select id into v from public.company_document_versions where document_id = doc and status = 'pending';
  if v is null then
    raise exception 'DOCUMENT_NO_PENDING' using errcode = 'P0001';
  end if;
  update public.company_documents set
    title = coalesce(nullif(btrim(doc_fields ->> 'title'), ''), title),
    responsible_id = case when doc_fields ? 'responsible_id' then nullif(doc_fields ->> 'responsible_id', '')::uuid else responsible_id end,
    notes = case when doc_fields ? 'notes' then nullif(btrim(doc_fields ->> 'notes'), '') else notes end,
    confidential = case when doc_fields ? 'confidential' then (doc_fields ->> 'confidential')::boolean else confidential end,
    type_id = case when d.confirmed_at is null and doc_fields ? 'type_id' then (doc_fields ->> 'type_id')::uuid else type_id end,
    link_kind = case when d.confirmed_at is null and doc_fields ? 'link_kind' then doc_fields ->> 'link_kind' else link_kind end,
    employee_id = case when d.confirmed_at is null and doc_fields ? 'link_kind' then nullif(doc_fields ->> 'employee_id', '')::uuid else employee_id end,
    supplier_id = case when d.confirmed_at is null and doc_fields ? 'link_kind' then nullif(doc_fields ->> 'supplier_id', '')::uuid else supplier_id end,
    asset_id = case when d.confirmed_at is null and doc_fields ? 'link_kind' then nullif(doc_fields ->> 'asset_id', '')::uuid else asset_id end
  where id = doc;
  update public.company_document_versions set
    number = case when ver_fields ? 'number' then nullif(btrim(ver_fields ->> 'number'), '') else number end,
    issuer = case when ver_fields ? 'issuer' then nullif(btrim(ver_fields ->> 'issuer'), '') else issuer end,
    issue_date = case when ver_fields ? 'issue_date' then nullif(ver_fields ->> 'issue_date', '')::date else issue_date end,
    expiry_date = case when ver_fields ? 'expiry_date' then nullif(ver_fields ->> 'expiry_date', '')::date else expiry_date end,
    sources = coalesce(ver_fields -> 'sources', sources),
    status = case when confirm then 'current' else status end
  where id = v;
end;
$$;
revoke all on function public.documents_review_save(uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.documents_review_save(uuid, jsonb, jsonb, boolean) to authenticated;

-- ── Alerts: once per document, expiry and threshold ──
-- For a confirmed, non-archived document with an expiry date and a
-- responsible who still belongs to the company:
--   · notice: the thresholds of its type (alert days) reached before the
--     expiry: one bell notice for the nearest; the farther ones reached with
--     it are logged 'covered';
--   · task: at the type's "task days before", one renewal task for the
--     responsible, due on the expiry, once per document and expiry (also for
--     one already expired).
-- A renewal (a new expiry) starts them again. No email is sent.
create or replace function public.documents_alerts_one(doc uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d      public.company_documents%rowtype;
  t      public.document_types%rowtype;
  gap    integer;
  due    integer[];
  nearest integer;
  n      integer;
  tid    uuid;
  made   integer := 0;
  shown  text;
begin
  select * into d from public.company_documents where id = doc;
  if not found or d.archived_at is not null or d.confirmed_at is null or d.expiry_date is null or d.responsible_id is null
     or not public.documents_member(d.workspace_id, d.responsible_id) then
    return 0;
  end if;
  select * into t from public.document_types where id = d.type_id;
  gap := d.expiry_date - public.documents_today();
  -- A restricted document shows its type, never its title, in a bell or a task.
  shown := case when d.confidential or d.link_kind = 'employee' then t.name else d.title end;

  if t.task_days_before is not null and gap <= t.task_days_before
     and not exists (select 1 from public.document_alerts a where a.document_id = d.id and a.expiry_date = d.expiry_date and a.kind = 'task') then
    insert into public.tasks (workspace_id, title, details, assigned_to, due_at, priority, section)
    values (d.workspace_id, 'Renew / تجديد ' || d.document_no || ' — ' || shown,
            d.document_no || ' (' || t.name || ') ends ' || d.expiry_date || '. Renew it by adding the new file on its page.',
            d.responsible_id, (d.expiry_date + time '23:59') at time zone 'Asia/Riyadh', 'high', 'documents')
    returning id into tid;
    insert into public.document_alerts (workspace_id, document_id, expiry_date, kind, days_before, sent_to, task_id)
    values (d.workspace_id, d.id, d.expiry_date, 'task', t.task_days_before, d.responsible_id, tid);
    made := made + 1;
  end if;

  if gap >= 0 and t.alert_days is not null then
    select array_agg(x order by x) into due from unnest(t.alert_days) x
     where gap <= x and not exists (select 1 from public.document_alerts a
                                     where a.document_id = d.id and a.expiry_date = d.expiry_date and a.kind = 'notice' and a.days_before = x);
    if due is not null then
      nearest := due[1];
      foreach n in array due loop
        insert into public.document_alerts (workspace_id, document_id, expiry_date, kind, days_before, status, sent_to)
        values (d.workspace_id, d.id, d.expiry_date, 'notice', n, case when n = nearest then 'sent' else 'covered' end, d.responsible_id);
      end loop;
      insert into public.notifications (user_id, workspace_id, kind, title, body, link)
      values (d.responsible_id, d.workspace_id, 'document_expiring',
              d.document_no || ' — ' || shown || ' ends ' || d.expiry_date || ' (' || gap || ' days)',
              t.name, '/documents/document?id=' || d.id);
      made := made + 1;
    end if;
  end if;
  return made;
end;
$$;
revoke all on function public.documents_alerts_one(uuid) from public, anon, authenticated;

/** A company's alerts, run when someone with Documents opens the list (safe to repeat: once per threshold). */
create or replace function public.documents_run_alerts_for(ws uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare r record; total integer := 0;
begin
  if not public.has_section(ws, 'documents', 'view') then
    raise exception 'DOCUMENT_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  for r in select id from public.company_documents
            where workspace_id = ws and confirmed_at is not null and archived_at is null and expiry_date is not null and responsible_id is not null
            order by id loop
    total := total + public.documents_alerts_one(r.id);
  end loop;
  return total;
end;
$$;
revoke all on function public.documents_run_alerts_for(uuid) from public, anon;
grant execute on function public.documents_run_alerts_for(uuid) to authenticated;

/** Every company's alerts: for a daily job on the server (cron), not for the browser. */
create or replace function public.documents_run_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare r record; total integer := 0;
begin
  for r in select id from public.company_documents
            where confirmed_at is not null and archived_at is null and expiry_date is not null and responsible_id is not null
            order by id loop
    total := total + public.documents_alerts_one(r.id);
  end loop;
  return total;
end;
$$;
revoke all on function public.documents_run_alerts() from public, anon, authenticated;
