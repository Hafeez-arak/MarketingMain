-- ─── v2: Pricing (التسعير), the tables ─────────────────────────────────────
-- 2026-12-01. Musa's pricing module rewritten in our own stack as the v2
-- section `pricing` (dev/erp-pilot/PRICING.md). Our own clean tables in
-- `public`, not his schema: his rules were read from his app and written here
-- again (20261201_pricing_2_rules.sql).
--
--   currencies            the currencies a supplier can quote in (global list)
--   pricing_settings      one row per company: the minimum margin
--   pricing_sheets        the pricing of one open opportunity (the CRM's):
--                         draft → submitted → approved, or cancelled
--   pricing_lines         the client's bill of quantities, with our selling price
--   supplier_quotes       a supplier's answer for a sheet (an organisation of
--                         Contacts with the role supplier)
--   supplier_quote_lines  what the supplier offers per line, alternatives beside
--   pricing_counters      the PS-2026-000001 / SQ-2026-000001 series
--   pricing_audit         who changed what, filled by triggers (as catalog_audit)
--
-- Every row names its company; rows of one company point at each other only
-- through (id, workspace_id) keys, so a sheet can never name another company's
-- opportunity, supplier or catalog item.
--
-- Who may do what (the section grant, 20261101_section_access). Musa's three
-- permissions mapped onto our three levels:
--   view    pricing.view     reads everything, cost and margin included
--   work    pricing.manage   creates and edits drafts, lines, supplier quotes,
--                            prices and selections; submits; returns a
--                            submitted sheet to draft; cancels a draft; deletes
--                            a draft
--   manage  pricing.approve  approves; cancels a submitted or approved sheet;
--                            sets the minimum margin
-- A sheet's workflow columns are written only by the transition functions
-- (20261201_pricing_2_rules.sql); the client may change a draft's title, notes
-- and margin note, and nothing else on the sheet.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

-- ── The section key ──
-- The check constraints are replaced whole, from the keys they hold now plus
-- every key v2 has added so far and 'pricing': the local database is shared
-- by several branches, each of which adds its own key.
do $$
declare
  r record;
  keys text[];
  wanted constant text[] := array['ceo', 'sales', 'marketing', 'insights', 'technical', 'finance', 'hr', 'contacts', 'crm', 'catalog', 'pricing'];
begin
  for r in select * from (values ('section_access', 'section_access_section_check'), ('tasks', 'tasks_section_check'), ('meetings', 'meetings_section_check')) v(t, c) loop
    select coalesce(array_agg(m[1] order by m[1]), '{}') into keys
      from pg_constraint k, regexp_matches(pg_get_constraintdef(k.oid), '''([a-z_]+)''::text', 'g') m
     where k.conname = r.c and k.conrelid = ('public.' || r.t)::regclass;
    keys := wanted || array(select x from unnest(keys) x where x <> all (wanted) order by x);
    execute format('alter table public.%I drop constraint if exists %I', r.t, r.c);
    execute format('alter table public.%I add constraint %I check (section in (%s))', r.t, r.c,
                   (select string_agg(quote_literal(x), ', ') from unnest(keys) x));
  end loop;
end $$;

-- ── Currencies ──
-- A small global list. The base currency of every company is SAR; a quote in
-- SAR has rate 1 (set by the rules, never typed). Nothing writes to it from
-- the app. Exchange-rate suggestions belong to accounting and wait.
create table if not exists public.currencies (
  code    text primary key check (code ~ '^[A-Z]{3}$'),
  name_en text not null check (length(btrim(name_en)) > 0),
  name_ar text not null check (length(btrim(name_ar)) > 0),
  active  boolean not null default true
);
insert into public.currencies (code, name_en, name_ar) values
  ('SAR', 'Saudi riyal', 'ريال سعودي'),
  ('USD', 'US dollar', 'دولار أمريكي'),
  ('EUR', 'Euro', 'يورو'),
  ('GBP', 'Pound sterling', 'جنيه إسترليني'),
  ('CNY', 'Chinese yuan', 'يوان صيني'),
  ('AED', 'UAE dirham', 'درهم إماراتي'),
  ('TRY', 'Turkish lira', 'ليرة تركية'),
  ('JPY', 'Japanese yen', 'ين ياباني')
on conflict (code) do nothing;

-- ── Settings: one row per company ──
create table if not exists public.pricing_settings (
  workspace_id   uuid primary key references public.workspaces(id) on delete cascade,
  -- Gross margin on the selling price, %. Null = not set: the margin check is off.
  min_margin_pct numeric(5,2) check (min_margin_pct is null or (min_margin_pct >= 0 and min_margin_pct < 100)),
  updated_at     timestamptz not null default now()
);

-- ── The sheet ──
create table if not exists public.pricing_sheets (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  -- PS-2026-000001: per company and year, gap-free (pricing_next_no).
  sheet_no       text not null default '',
  lead_id        uuid not null,
  title          text not null check (length(btrim(title)) between 1 and 255),
  status         text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'cancelled')),
  notes          text check (notes is null or length(notes) <= 10000),
  -- Why a margin below the minimum (or below cost) is accepted; needed for those lines to pass.
  margin_note    text check (margin_note is null or (length(btrim(margin_note)) > 0 and length(margin_note) <= 2000)),
  -- The company minimum in force when submitted / approved (kept: the setting may change later).
  min_margin_pct numeric(5,2),
  submitted_at   timestamptz,
  submitted_by   uuid references auth.users(id) on delete set null,
  approved_at    timestamptz,
  approved_by    uuid references auth.users(id) on delete set null,
  cancelled_at   timestamptz,
  cancelled_by   uuid references auth.users(id) on delete set null,
  cancel_reason  text check (cancel_reason is null or length(cancel_reason) <= 2000),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint pricing_sheets_id_ws unique (id, workspace_id),
  constraint pricing_sheets_lead_fk foreign key (lead_id, workspace_id) references public.crm_leads (id, workspace_id),
  -- Who submitted / approved stays a column that may go null when the login is removed; the time stays.
  constraint pricing_sheets_submitted check (status not in ('submitted', 'approved') or submitted_at is not null),
  constraint pricing_sheets_approved check (status <> 'approved' or approved_at is not null),
  constraint pricing_sheets_cancelled check ((status = 'cancelled') = (cancelled_at is not null and length(btrim(coalesce(cancel_reason, ''))) > 0))
);
create unique index if not exists pricing_sheets_no_uq on public.pricing_sheets (workspace_id, sheet_no);
create index if not exists pricing_sheets_list_idx on public.pricing_sheets (workspace_id, status);
create index if not exists pricing_sheets_lead_idx on public.pricing_sheets (lead_id);

-- ── The lines (the client's BOQ) ──
create table if not exists public.pricing_lines (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces(id) on delete cascade,
  sheet_id               uuid not null,
  line_no                integer not null check (line_no > 0),
  boq_ref                text check (boq_ref is null or (length(btrim(boq_ref)) > 0 and length(boq_ref) <= 60)),
  description            text not null check (length(btrim(description)) between 1 and 2000),
  quantity               numeric(12,3) not null check (quantity > 0),
  unit                   text not null check (length(btrim(unit)) between 1 and 30),
  catalog_item_id        uuid,
  -- Selling price per unit before VAT; null = not priced yet.
  unit_price             numeric(14,2) check (unit_price is null or unit_price >= 0),
  -- The supplier offer chosen for this line (a deleted offer unselects).
  selected_quote_line_id uuid,
  notes                  text,
  -- The estimate category; null = unclassified. Changes with the line, in a draft sheet only.
  cost_category          text check (cost_category is null or cost_category in ('goods', 'installation', 'subcontract', 'other')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint pricing_lines_id_ws unique (id, workspace_id),
  constraint pricing_lines_sheet_fk foreign key (sheet_id, workspace_id) references public.pricing_sheets (id, workspace_id) on delete cascade,
  constraint pricing_lines_item_fk foreign key (catalog_item_id, workspace_id) references public.catalog_items (id, workspace_id),
  -- Deferrable so a renumbering can pass through a clash inside one statement.
  constraint pricing_lines_no_uq unique (sheet_id, line_no) deferrable initially immediate
);
create index if not exists pricing_lines_ws_idx on public.pricing_lines (workspace_id, sheet_id);
create index if not exists pricing_lines_item_idx on public.pricing_lines (catalog_item_id);
create index if not exists pricing_lines_selected_idx on public.pricing_lines (selected_quote_line_id);

-- ── Supplier quotes ──
create table if not exists public.supplier_quotes (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  -- SQ-2026-000001: per company and year, gap-free (pricing_next_no).
  quote_no       text not null default '',
  sheet_id       uuid not null,
  -- An organisation of Contacts with the role supplier.
  supplier_id    uuid not null,
  -- requested: asked, no answer yet; received: prices in hand; declined: the supplier did not quote.
  status         text not null default 'requested' check (status in ('requested', 'received', 'declined')),
  requested_on   date not null default current_date,
  received_on    date,
  supplier_ref   text check (supplier_ref is null or (length(btrim(supplier_ref)) > 0 and length(supplier_ref) <= 120)),
  valid_until    date,
  currency       text not null references public.currencies(code),
  -- Units of the base currency (SAR) per one unit of the quote currency. Null = unknown.
  fx_rate        numeric(18,8) check (fx_rate is null or fx_rate > 0),
  -- Landed charges in the quote currency. Null = unknown (not zero); 0 = known to be none.
  freight_amount numeric(14,2) check (freight_amount is null or freight_amount >= 0),
  customs_amount numeric(14,2) check (customs_amount is null or customs_amount >= 0),
  other_charges  numeric(14,2) check (other_charges is null or other_charges >= 0),
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint supplier_quotes_id_ws unique (id, workspace_id),
  constraint supplier_quotes_sheet_fk foreign key (sheet_id, workspace_id) references public.pricing_sheets (id, workspace_id) on delete cascade,
  constraint supplier_quotes_supplier_fk foreign key (supplier_id, workspace_id) references public.contacts_orgs (id, workspace_id),
  constraint supplier_quotes_received check (status <> 'received' or received_on is not null),
  constraint supplier_quotes_validity check (valid_until is null or received_on is null or valid_until >= received_on)
);
create unique index if not exists supplier_quotes_no_uq on public.supplier_quotes (workspace_id, quote_no);
create index if not exists supplier_quotes_sheet_idx on public.supplier_quotes (workspace_id, sheet_id);
create index if not exists supplier_quotes_supplier_idx on public.supplier_quotes (supplier_id);

create table if not exists public.supplier_quote_lines (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  quote_id            uuid not null,
  pricing_line_id     uuid not null,
  offered_description text check (offered_description is null or (length(btrim(offered_description)) > 0 and length(offered_description) <= 2000)),
  brand               text check (brand is null or length(brand) <= 120),
  model_no            text check (model_no is null or length(model_no) <= 120),
  catalog_item_id     uuid,
  quantity            numeric(12,3) not null check (quantity > 0),
  -- Unit price in the quote currency; null = not quoted for this line.
  unit_price          numeric(14,4) check (unit_price is null or unit_price >= 0),
  is_alternative      boolean not null default false,
  lead_time_days      integer check (lead_time_days is null or lead_time_days >= 0),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint supplier_quote_lines_id_ws unique (id, workspace_id),
  constraint supplier_quote_lines_quote_fk foreign key (quote_id, workspace_id) references public.supplier_quotes (id, workspace_id) on delete cascade,
  constraint supplier_quote_lines_line_fk foreign key (pricing_line_id, workspace_id) references public.pricing_lines (id, workspace_id) on delete cascade,
  constraint supplier_quote_lines_item_fk foreign key (catalog_item_id, workspace_id) references public.catalog_items (id, workspace_id)
);
create index if not exists supplier_quote_lines_quote_idx on public.supplier_quote_lines (workspace_id, quote_id);
create index if not exists supplier_quote_lines_line_idx on public.supplier_quote_lines (pricing_line_id);
-- One main offer per line in a quote; alternatives beside it.
create unique index if not exists supplier_quote_lines_main_uq on public.supplier_quote_lines (quote_id, pricing_line_id) where not is_alternative;

-- The chosen offer: a deleted offer unselects its line (set null on the one column).
alter table public.pricing_lines drop constraint if exists pricing_lines_selected_fk;
alter table public.pricing_lines add constraint pricing_lines_selected_fk
  foreign key (selected_quote_line_id) references public.supplier_quote_lines (id) on delete set null;

-- ── Numbers ──
-- Nobody reads or writes it but the numbering function (security definer).
create table if not exists public.pricing_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind         text not null check (kind in ('PS', 'SQ')),
  year         integer not null,
  last         integer not null default 0,
  primary key (workspace_id, kind, year)
);

-- ── The history ──
-- One row per change, written by the database whoever made it. No foreign key
-- to the sheet: a deleted draft's history stays. A company's history goes with
-- the company.
create table if not exists public.pricing_audit (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  table_name   text not null,
  row_id       text not null,
  -- The sheet the row belongs to (the row itself for a sheet); null for the settings.
  sheet_id     uuid,
  action       text not null check (action in ('insert', 'update', 'delete')),
  changed_by   uuid,
  changed_at   timestamptz not null default now(),
  old_data     jsonb,
  new_data     jsonb
);
create index if not exists pricing_audit_sheet_idx on public.pricing_audit (workspace_id, sheet_id, id desc);

-- ── Who reads, who writes ──
alter table public.currencies enable row level security;
alter table public.pricing_settings enable row level security;
alter table public.pricing_sheets enable row level security;
alter table public.pricing_lines enable row level security;
alter table public.supplier_quotes enable row level security;
alter table public.supplier_quote_lines enable row level security;
alter table public.pricing_counters enable row level security;
alter table public.pricing_audit enable row level security;

revoke all on public.currencies, public.pricing_settings, public.pricing_sheets, public.pricing_lines, public.supplier_quotes,
  public.supplier_quote_lines, public.pricing_counters, public.pricing_audit from anon, authenticated;
grant select on public.currencies, public.pricing_audit to authenticated;
grant select, insert, update on public.pricing_settings to authenticated;
-- The sheet: a draft's title, notes and margin note are the client's to change.
-- Status, the workflow stamps and the minimum margin in force are written only by
-- the transition functions; the number, opportunity and creator never change.
grant select, delete on public.pricing_sheets to authenticated;
grant insert (workspace_id, lead_id, title, notes, margin_note) on public.pricing_sheets to authenticated;
grant update (title, notes, margin_note) on public.pricing_sheets to authenticated;
grant select, delete on public.pricing_lines, public.supplier_quotes, public.supplier_quote_lines to authenticated;
grant insert (workspace_id, sheet_id, line_no, boq_ref, description, quantity, unit, catalog_item_id, unit_price, selected_quote_line_id, notes, cost_category)
  on public.pricing_lines to authenticated;
grant update (line_no, boq_ref, description, quantity, unit, catalog_item_id, unit_price, selected_quote_line_id, notes, cost_category)
  on public.pricing_lines to authenticated;
grant insert (workspace_id, sheet_id, supplier_id, status, requested_on, received_on, supplier_ref, valid_until, currency, fx_rate, freight_amount, customs_amount, other_charges, notes)
  on public.supplier_quotes to authenticated;
grant update (status, requested_on, received_on, supplier_ref, valid_until, currency, fx_rate, freight_amount, customs_amount, other_charges, notes)
  on public.supplier_quotes to authenticated;
grant insert (workspace_id, quote_id, pricing_line_id, offered_description, brand, model_no, catalog_item_id, quantity, unit_price, is_alternative, lead_time_days, notes)
  on public.supplier_quote_lines to authenticated;
grant update (offered_description, brand, model_no, catalog_item_id, quantity, unit_price, lead_time_days, notes)
  on public.supplier_quote_lines to authenticated;

drop policy if exists currencies_read on public.currencies;
create policy currencies_read on public.currencies for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array['pricing_settings', 'pricing_sheets', 'pricing_lines', 'supplier_quotes', 'supplier_quote_lines', 'pricing_audit'] loop
    execute format('drop policy if exists %1$s_read on public.%1$I', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.has_section(workspace_id, ''pricing'', ''view''))', t);
  end loop;
  -- The sheet, its lines and its supplier quotes: work writes.
  foreach t in array array['pricing_sheets', 'pricing_lines', 'supplier_quotes', 'supplier_quote_lines'] loop
    execute format('drop policy if exists %1$s_add on public.%1$I', t);
    execute format('create policy %1$s_add on public.%1$I for insert to authenticated with check (public.has_section(workspace_id, ''pricing'', ''work''))', t);
    execute format('drop policy if exists %1$s_change on public.%1$I', t);
    execute format('create policy %1$s_change on public.%1$I for update to authenticated using (public.has_section(workspace_id, ''pricing'', ''work'')) with check (public.has_section(workspace_id, ''pricing'', ''work''))', t);
    execute format('drop policy if exists %1$s_remove on public.%1$I', t);
    execute format('create policy %1$s_remove on public.%1$I for delete to authenticated using (public.has_section(workspace_id, ''pricing'', ''work''))', t);
  end loop;
end $$;

-- The minimum margin: manage (his pricing.approve).
drop policy if exists pricing_settings_add on public.pricing_settings;
create policy pricing_settings_add on public.pricing_settings
  for insert to authenticated with check (public.has_section(workspace_id, 'pricing', 'manage'));
drop policy if exists pricing_settings_change on public.pricing_settings;
create policy pricing_settings_change on public.pricing_settings
  for update to authenticated using (public.has_section(workspace_id, 'pricing', 'manage')) with check (public.has_section(workspace_id, 'pricing', 'manage'));
