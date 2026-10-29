-- ─── v2: Documents («المستندات»), the tables ───────────────────────────────
-- 2026-10-29. Musa's Documents app rewritten in our own stack as the v2
-- section `documents` (dev/erp-pilot/DOCUMENTS.md). His read at commit
-- 43ae96d; his rules are written here again, not copied.
--
-- One place for the company's documents and those of its employees,
-- suppliers and (later) fixed assets: commercial register, VAT and zakat
-- certificates, licences, insurance, leases, agency agreements, iqamas,
-- passports…
--
--   document_types              the company's list of kinds, in two languages:
--                               required fields, allowed links, alert days
--   company_documents           DOC-2026-000001: draft → confirmed, archived
--                               with a reason, never deleted once confirmed
--   company_document_versions   one file each, append-only; pending until
--                               confirmed, then final; a renewal is a new one
--   document_alerts             what was announced, once per document, expiry
--                               and threshold (append-only)
--   document_access_log         who opened or downloaded a confidential or
--                               an employee's document (append-only)
--   document_counters           the DOC- numbers, per company and year
--   document_history            who changed what (managers read it)
--
-- Links: an employee (hr_employees) and a supplier (a Contacts organisation
-- with the supplier role) through composite (workspace_id, id) keys, so a
-- document can never name another company's person or supplier. A fixed
-- asset waits for its module: the column and the kind exist, a document
-- cannot take that link yet (20261201_documents_2_rules.sql).
--
-- Who may do what (his three permissions on our three levels of the section):
--   view    documents.view         read and download the company's, suppliers'
--                                  documents that are neither confidential nor
--                                  an employee's
--   work    documents.manage       upload, confirm, renew, archive, edit those
--                                  documents; the document types and their alerts
--   manage  documents.confidential confidential documents and employees'
--                                  papers; every opening is logged
-- Also: HR Manage reads the employees' papers that are not confidential (the
-- employee page and Expiring papers read them here), and a person reads
-- their own non-confidential papers (HR's rule, kept).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── The section key ──
-- A check constraint is replaced whole: every key in the newest constraint
-- (20261125_crm_1_tables.sql) plus 'documents'.
alter table public.section_access drop constraint if exists section_access_section_check;
alter table public.section_access add constraint section_access_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts', 'crm', 'documents'));
alter table public.tasks drop constraint if exists tasks_section_check;
alter table public.tasks add constraint tasks_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts', 'crm', 'documents'));
alter table public.meetings drop constraint if exists meetings_section_check;
alter table public.meetings add constraint meetings_section_check
  check (section in ('ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts', 'crm', 'documents'));

-- ── Document types: the company's own list ──
create table if not exists public.document_types (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  -- Set only on the suggested types the system made (stable across renames).
  code                 text check (code is null or code ~ '^[A-Z][A-Z_]{1,29}$'),
  name                 text not null check (length(btrim(name)) between 1 and 120),
  name_en              text check (name_en is null or length(btrim(name_en)) between 1 and 120),
  link_kinds           text[] not null default array['company']
                       check (cardinality(link_kinds) > 0 and link_kinds <@ array['company', 'employee', 'asset', 'supplier']::text[]),
  number_required      boolean not null default false,
  issuer_required      boolean not null default false,
  issue_date_required  boolean not null default false,
  expiry_required      boolean not null default false,
  -- A regular expression for the number in the file's text (waits on reading files).
  number_pattern       text check (number_pattern is null or length(number_pattern) <= 200),
  -- The company's own record the number is compared with (waits on a company profile).
  company_field        text check (company_field is null or company_field in ('cr_number', 'vat_number')),
  -- The company must hold one in force.
  is_required          boolean not null default false,
  -- Days before the expiry when the responsible is told (empty = never), and
  -- when a renewal task opens (null = never).
  alert_days           smallint[] check (alert_days is null or (cardinality(alert_days) between 1 and 6 and 0 < all (alert_days) and 1000 >= all (alert_days))),
  task_days_before     smallint check (task_days_before is null or task_days_before between 0 and 1000),
  confidential_default boolean not null default false,
  is_active            boolean not null default true,
  sequence             integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint document_types_id_ws unique (id, workspace_id)
);
create unique index if not exists document_types_name_uq on public.document_types (workspace_id, name);
create unique index if not exists document_types_code_uq on public.document_types (workspace_id, code) where code is not null;

-- ── The document ──
create table if not exists public.company_documents (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  -- DOC-2026-000001: per company and year, gap-free (document_number).
  document_no    text not null default '',
  type_id        uuid not null,
  title          text not null check (length(btrim(title)) between 1 and 200),
  link_kind      text not null check (link_kind in ('company', 'employee', 'asset', 'supplier')),
  employee_id    uuid,
  supplier_id    uuid,
  -- Waits on a Fixed assets module: no key yet, and no document takes this link.
  asset_id       uuid,
  responsible_id uuid references auth.users(id) on delete set null,
  confidential   boolean not null default false,
  notes          text check (notes is null or length(notes) <= 2000),
  -- The current version's data, written only by confirming a version.
  number         text check (number is null or length(number) <= 60),
  issuer         text check (issuer is null or length(issuer) <= 200),
  issue_date     date,
  expiry_date    date,
  confirmed_at   timestamptz,
  archived_at    timestamptz,
  archived_by    uuid references auth.users(id) on delete set null,
  archive_reason text check (archive_reason is null or length(archive_reason) <= 500),
  -- The HR paper this document was moved from (20261201_documents_3_hr_move.sql).
  legacy_hr_document_id uuid,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint company_documents_id_ws unique (id, workspace_id),
  constraint company_documents_type_fk foreign key (type_id, workspace_id) references public.document_types (id, workspace_id),
  constraint company_documents_employee_fk foreign key (workspace_id, employee_id) references public.hr_employees (workspace_id, id),
  constraint company_documents_supplier_fk foreign key (supplier_id, workspace_id) references public.contacts_orgs (id, workspace_id),
  constraint company_documents_link check (
       (link_kind = 'company'  and employee_id is null and asset_id is null and supplier_id is null)
    or (link_kind = 'employee' and employee_id is not null and asset_id is null and supplier_id is null)
    or (link_kind = 'asset'    and asset_id is not null and employee_id is null and supplier_id is null)
    or (link_kind = 'supplier' and supplier_id is not null and employee_id is null and asset_id is null)),
  constraint company_documents_archived check (archived_at is null or (btrim(coalesce(archive_reason, '')) <> '' and confirmed_at is not null)),
  constraint company_documents_dates check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);
create unique index if not exists company_documents_no_uq on public.company_documents (workspace_id, document_no);
create unique index if not exists company_documents_legacy_uq on public.company_documents (legacy_hr_document_id) where legacy_hr_document_id is not null;
create index if not exists company_documents_type_idx on public.company_documents (type_id);
create index if not exists company_documents_employee_idx on public.company_documents (employee_id) where employee_id is not null;
create index if not exists company_documents_supplier_idx on public.company_documents (supplier_id) where supplier_id is not null;
create index if not exists company_documents_expiry_idx on public.company_documents (workspace_id, expiry_date) where expiry_date is not null;

-- ── Versions: one file each ──
create table if not exists public.company_document_versions (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  document_id    uuid not null,
  version_no     integer not null default 0 check (version_no >= 0),
  -- 'company-documents' for files uploaded here; 'hr-papers' for scans moved
  -- from HR (they stay where they are).
  file_bucket    text check (file_bucket is null or file_bucket in ('company-documents', 'hr-papers')),
  file_path      text,
  file_name      text check (file_name is null or length(file_name) <= 200),
  file_size      integer check (file_size is null or file_size between 1 and 20971520),
  file_type      text check (file_type is null or file_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  sha256         text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  number         text check (number is null or length(number) <= 60),
  issuer         text check (issuer is null or length(issuer) <= 200),
  issue_date     date,
  expiry_date    date,
  -- What was suggested from the file (FILE / AI) and where each confirmed
  -- field came from: {"number": "manual", …} (the keys are checked by the guard).
  suggestions    jsonb not null default '{}'::jsonb check (jsonb_typeof(suggestions) = 'object'),
  sources        jsonb not null default '{}'::jsonb check (jsonb_typeof(sources) = 'object'),
  extracted_text text,
  page_count     integer check (page_count is null or page_count >= 0),
  status         text not null default 'pending' check (status in ('pending', 'current', 'superseded')),
  uploaded_by    uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  confirmed_by   uuid references auth.users(id) on delete set null,
  confirmed_at   timestamptz,
  superseded_at  timestamptz,
  constraint company_document_versions_doc_fk foreign key (document_id, workspace_id) references public.company_documents (id, workspace_id) on delete cascade,
  constraint company_document_versions_file check ((file_bucket is null) = (file_path is null)),
  constraint company_document_versions_sha check (file_bucket is distinct from 'company-documents' or sha256 is not null),
  constraint company_document_versions_place check (
    file_path is null
    or (file_bucket = 'company-documents' and file_path like workspace_id::text || '/' || document_id::text || '/%')
    or (file_bucket = 'hr-papers' and file_path like workspace_id::text || '/%')),
  constraint company_document_versions_confirmed check ((status = 'pending') = (confirmed_at is null)),
  constraint company_document_versions_superseded check ((status = 'superseded') = (superseded_at is not null)),
  constraint company_document_versions_dates check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);
create unique index if not exists company_document_versions_no_uq on public.company_document_versions (document_id, version_no);
create unique index if not exists company_document_versions_file_uq on public.company_document_versions (document_id, sha256) where sha256 is not null;
create unique index if not exists company_document_versions_pending_uq on public.company_document_versions (document_id) where status = 'pending';
create unique index if not exists company_document_versions_current_uq on public.company_document_versions (document_id) where status = 'current';
create index if not exists company_document_versions_ws_idx on public.company_document_versions (workspace_id, document_id);

-- ── What was announced (append-only) ──
create table if not exists public.document_alerts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id  uuid not null,
  expiry_date  date not null,
  -- 'notice' = the bell; 'task' = the renewal task. (His first kind was an email; we send none.)
  kind         text not null check (kind in ('notice', 'task')),
  days_before  smallint not null check (days_before >= 0),
  -- 'sent', or 'covered': reached together with a nearer threshold whose single notice covered it.
  status       text not null default 'sent' check (status in ('sent', 'covered')),
  sent_to      uuid references auth.users(id) on delete set null,
  task_id      uuid references public.tasks(id) on delete set null,
  sent_at      timestamptz not null default now(),
  constraint document_alerts_doc_fk foreign key (document_id, workspace_id) references public.company_documents (id, workspace_id),
  constraint document_alerts_task check (kind = 'task' or task_id is null)
);
create unique index if not exists document_alerts_once_uq on public.document_alerts (document_id, expiry_date, kind, days_before);

-- ── Who opened a confidential or an employee's document (append-only) ──
create table if not exists public.document_access_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id  uuid not null,
  version_no   integer,
  file_bucket  text,
  file_path    text,
  action       text not null check (action in ('view', 'download')),
  user_id      uuid references auth.users(id) on delete set null,
  at           timestamptz not null default now(),
  constraint document_access_log_doc_fk foreign key (document_id, workspace_id) references public.company_documents (id, workspace_id)
);
create index if not exists document_access_log_doc_idx on public.document_access_log (document_id, at desc);
create index if not exists document_access_log_file_idx on public.document_access_log (user_id, file_path, at desc);

-- Nobody reads or writes it but the numbering trigger (security definer).
create table if not exists public.document_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  year         integer not null,
  last         integer not null default 0,
  primary key (workspace_id, year)
);

-- One row per change, written by the database whoever made it. No key to the
-- document: a deleted draft's history stays.
create table if not exists public.document_history (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id  uuid,
  table_name   text not null check (table_name in ('document_types', 'company_documents', 'company_document_versions')),
  row_id       uuid not null,
  action       text not null check (action in ('insert', 'update', 'delete')),
  label        text not null default '',
  changes      jsonb not null default '{}'::jsonb,
  actor        uuid references auth.users(id) on delete set null,
  at           timestamptz not null default now()
);
create index if not exists document_history_doc_idx on public.document_history (workspace_id, document_id, id desc);

-- ── Who may read and write which document ──
-- Definer helpers so a policy can ask without reading the other tables itself.

/** A document of this kind, person and confidentiality: may the caller read it? */
create or replace function public.documents_can_read(ws uuid, kind text, emp uuid, conf boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when conf then public.has_section(ws, 'documents', 'manage')
    when kind = 'employee' then public.has_section(ws, 'documents', 'manage')
                             or public.has_section(ws, 'hr', 'manage')
                             or (emp is not null and public.has_section(ws, 'hr', 'view') and emp is not distinct from public.hr_my_employee(ws))
    else public.has_section(ws, 'documents', 'view')
  end;
$$;
revoke all on function public.documents_can_read(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.documents_can_read(uuid, text, uuid, boolean) to authenticated;

/** May the caller write a document of this kind and confidentiality? */
create or replace function public.documents_can_write(ws uuid, kind text, conf boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when conf or kind = 'employee' then public.has_section(ws, 'documents', 'manage')
              else public.has_section(ws, 'documents', 'work') end;
$$;
revoke all on function public.documents_can_write(uuid, text, boolean) from public, anon;
grant execute on function public.documents_can_write(uuid, text, boolean) to authenticated;

create or replace function public.documents_doc_readable(doc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.documents_can_read(d.workspace_id, d.link_kind, d.employee_id, d.confidential)
                     from public.company_documents d where d.id = doc), false);
$$;
revoke all on function public.documents_doc_readable(uuid) from public, anon;
grant execute on function public.documents_doc_readable(uuid) to authenticated;

create or replace function public.documents_doc_writable(doc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.documents_can_write(d.workspace_id, d.link_kind, d.confidential)
                     from public.company_documents d where d.id = doc), false);
$$;
revoke all on function public.documents_doc_writable(uuid) from public, anon;
grant execute on function public.documents_doc_writable(uuid) to authenticated;

-- ── Row level security ──
alter table public.document_types enable row level security;
alter table public.company_documents enable row level security;
alter table public.company_document_versions enable row level security;
alter table public.document_alerts enable row level security;
alter table public.document_access_log enable row level security;
alter table public.document_counters enable row level security;
alter table public.document_history enable row level security;

revoke all on public.document_types, public.company_documents, public.company_document_versions, public.document_alerts,
  public.document_access_log, public.document_counters, public.document_history from anon, authenticated;
-- Types are switched off, never deleted (a type in use is stopped).
grant select, insert, update on public.document_types to authenticated;
-- A confirmed document is never deleted; the rule is the trigger's.
grant select, insert, update, delete on public.company_documents, public.company_document_versions to authenticated;
grant select on public.document_alerts, public.document_access_log, public.document_history to authenticated;

drop policy if exists document_types_read on public.document_types;
create policy document_types_read on public.document_types for select to authenticated
  using (public.has_section(workspace_id, 'documents', 'view'));
drop policy if exists document_types_add on public.document_types;
create policy document_types_add on public.document_types for insert to authenticated
  with check (public.has_section(workspace_id, 'documents', 'work'));
drop policy if exists document_types_change on public.document_types;
create policy document_types_change on public.document_types for update to authenticated
  using (public.has_section(workspace_id, 'documents', 'work'))
  with check (public.has_section(workspace_id, 'documents', 'work'));
-- HR Manage and a person reading their own papers also need the type's name.
drop policy if exists document_types_read_hr on public.document_types;
create policy document_types_read_hr on public.document_types for select to authenticated
  using (public.has_section(workspace_id, 'hr', 'view'));

drop policy if exists company_documents_read on public.company_documents;
create policy company_documents_read on public.company_documents for select to authenticated
  using (public.documents_can_read(workspace_id, link_kind, employee_id, confidential));
drop policy if exists company_documents_add on public.company_documents;
create policy company_documents_add on public.company_documents for insert to authenticated
  with check (public.documents_can_write(workspace_id, link_kind, confidential));
drop policy if exists company_documents_change on public.company_documents;
create policy company_documents_change on public.company_documents for update to authenticated
  using (public.documents_can_write(workspace_id, link_kind, confidential))
  with check (public.documents_can_write(workspace_id, link_kind, confidential));
drop policy if exists company_documents_remove on public.company_documents;
create policy company_documents_remove on public.company_documents for delete to authenticated
  using (public.documents_can_write(workspace_id, link_kind, confidential));

drop policy if exists company_document_versions_read on public.company_document_versions;
create policy company_document_versions_read on public.company_document_versions for select to authenticated
  using (public.documents_doc_readable(document_id));
drop policy if exists company_document_versions_add on public.company_document_versions;
create policy company_document_versions_add on public.company_document_versions for insert to authenticated
  with check (public.documents_doc_writable(document_id));
drop policy if exists company_document_versions_change on public.company_document_versions;
create policy company_document_versions_change on public.company_document_versions for update to authenticated
  using (public.documents_doc_writable(document_id)) with check (public.documents_doc_writable(document_id));
drop policy if exists company_document_versions_remove on public.company_document_versions;
create policy company_document_versions_remove on public.company_document_versions for delete to authenticated
  using (public.documents_doc_writable(document_id));

drop policy if exists document_alerts_read on public.document_alerts;
create policy document_alerts_read on public.document_alerts for select to authenticated
  using (public.documents_doc_readable(document_id));
-- Who opened what: the managers of the section.
drop policy if exists document_access_log_read on public.document_access_log;
create policy document_access_log_read on public.document_access_log for select to authenticated
  using (public.has_section(workspace_id, 'documents', 'manage'));
drop policy if exists document_history_read on public.document_history;
create policy document_history_read on public.document_history for select to authenticated
  using (public.has_section(workspace_id, 'documents', 'manage'));

-- ── The files: a private bucket, <workspace>/<document>/<file> ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-documents', 'company-documents', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 20971520,
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
