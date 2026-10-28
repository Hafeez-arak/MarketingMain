# Contacts (جهات الاتصال): Musa's ERP item 3, rewritten in our stack

2026-10-28, branch `v2-contacts` (from `v2` at d513448). This is the second
approach the owner chose for simple ERP modules. The CRM pilot
(`CRM-PILOT.md`) loaded Musa's own schema into an `erp` schema. Contacts
instead uses **our own clean tables in `public`**, our row level security,
and our screens. Nothing of his runs; his code was read for the rules only.

It was built in two rounds:

1. **The core:** one record with several roles, people, the duplicate
   guard, the national address, archive, CSV import.
2. **Full parity, after the owner's review ("everything his application
   has"):** record numbers, supplier categories, banking and payment terms,
   the activity log, his delete rule, and his list's filters, grouping and
   card view.

The only parts of his client and supplier screens not here are the ones that
read *other* modules (quotations, CRM, projects, invoices, payments). v2
does not have those modules yet (see "Not in Contacts").

## What was built

One new v2 section, `contacts` ("Contacts" / "جهات الاتصال"). It sits in the
rail between Insights and Admin and has four pages:

| Page | URL | Who |
|---|---|---|
| Organisations | `/contacts` | view |
| People | `/contacts/people` | view |
| Supplier categories | `/contacts/categories` | view reads, manage edits |
| One organisation (hidden; opened from the lists) | `/contacts/org?id=…` | view |

**Organisations list** (his client list and supplier list, on one list).
- Quick filters with counts: All, Clients, Suppliers, Contractors (main or
  sub), Consultants.
- Filters:
  - one of the six roles;
  - status: Active (the default), Archived (his "stopped dealing" filter),
    All;
  - company or individual;
  - VAT registered or not;
  - supplier category;
  - outside the Kingdom only.
- His "group by": type, city or category, with a count per group.
- His two views: a table, or cards (an initial avatar, name, number, city,
  phone, role badges).
- Search over names in both languages, the number, VAT, CR, city, phone and
  email. Arabic letter forms are folded, so أ/ا and ة/ه both match.
- Everything lives in the URL, so a filtered list can be linked to.
- Table columns: number; name, with the other-language name, type,
  category and the foreign tag under it; role badges; city; VAT number;
  primary contact.
- "+ New organisation" (work) and "Import CSV" (manage).

**Organisation page** (his client page and supplier page).
- Number, kind, category, the "supplier outside the Kingdom" badge, role
  badges.
- Registration (VAT, CR, country).
- Contact details (phone, email, website).
- National address (building, street, district, city, postal code,
  additional number) plus a free-text address.
- Supplier details for a supplier or subcontractor: category, payment terms
  in days, IBAN, SWIFT.
- Notes and contact persons.
- The activity log (his "سجل النشاط"), for managers: who did what and when,
  field by field, old → new, including changes to the record's people.
- Actions:
  - Work: Edit, and add or edit people.
  - Manage: Archive (his "stop dealing"), Restore, Delete.
- An archived organisation shows when it was archived, offers only Restore,
  and is locked.

**People page.**
- Everyone in the company, filtered by "with an organisation" or "on their
  own", with a search.
- A person is put only under an *active* organisation.

**Supplier categories page** (his "تصنيفات الموردين").
- The company names its own categories, in Arabic and English, each with an
  active switch and a count of suppliers that links to the filtered list.
- A category is switched off, never deleted (his rule). Its suppliers keep
  it; a new supplier cannot pick it, and the database refuses that too.

**Forms.**
- Every field has its own error, in both languages.
- The national-address note turns amber when the address becomes required.
- The supplier section appears when Supplier or Subcontractor is ticked.
- His IBAN rule: a Saudi IBAN while the country is SA, any country's shape
  once the country is set.
- SWIFT is 8 or 11 characters; payment terms are 0 to 3,650 days.

**Duplicate guard, as you type.**
- Same VAT or same CR: a red panel naming the existing organisation, and
  Save is disabled. The database refuses it too (his rule).
- A very similar name: an amber panel. The first Save becomes "It is a
  different one: save", so saving takes a second, deliberate click.
- Archived organisations count as duplicates (restore it instead of
  re-entering it).

**CSV import (manage).**
- Choose a file or paste it, download a template.
- Every line is previewed: Ready, what is wrong (field by field), a
  duplicate VAT/CR, or a similar name.
- Similar-name rows stay out unless ticked in.
- Only Ready rows are sent, and the database inserts each row on its own,
  reporting refused ones by line.
- Columns in English, as field names, or in Arabic, including the supplier
  columns (IBAN, SWIFT, payment terms, address).

**Test data.** `dev/v2db/seed-contacts.sql` holds 11 organisations in Arak
Lighting and 2 in Ghusn, 10 people, and 3 categories (one switched off).
Three suppliers have banking and terms; one of them is foreign (Italy, with
an Italian IBAN). Every name says "(test)" / "(تجربة)" and every number is
invented. It is not a migration, so it never reaches production.

## How

| Layer | Files |
|---|---|
| Tables, RLS | `supabase/migrations/20261120_contacts_1_tables.sql` |
| Rules (triggers, import, helper) | `supabase/migrations/20261120_contacts_2_rules.sql` |
| The rest of his screens: numbers, categories, banking, activity log, delete cascade | `supabase/migrations/20261120_contacts_3_musa_parity.sql` |
| Pure logic: validation, duplicate guard, filters, grouping, history rows, CSV | `src/lib/contacts/logic.js` (+ `logic.test.js`) |
| Reads and writes, error words | `src/lib/contacts/client.js` |
| Screens and words | `src/pages/contacts/` (`index.jsx`, `Org.jsx`, `People.jsx`, `Categories.jsx`, `parts.jsx`, `useContactsBook.js`, `words.js`) |
| Registration | `src/lib/modules.js` (one SECTIONS entry), `src/App.jsx` (4 routes), `src/lib/sectionAccess.js` (`GRANTABLE` + `contacts`), `src/components/layout/icons.jsx` (one icon) |
| Tests | `supabase/contacts.test.js` (PGlite), `dev/v2db/check-contacts.mjs` (live local stack), i18n list in `src/lib/i18n.test.js` |

**Schema.**
- `contacts_orgs`: one row per organisation or individual. `roles` is a
  `text[]` limited to the six values. `contact_no` is
  `C-<year>-<6 digits>`, per company. It has the supplier fields
  (`category_id`, `iban`, `swift`, `payment_terms_days`) and a free-text
  `address`.
- `contacts_people`: `org_id` may be null. Its foreign key is
  `(org_id, workspace_id)` against `(id, workspace_id)`, so a person can
  only belong to an organisation of the same company. `on delete cascade`
  removes the people with their organisation (his rule).
- `contacts_categories`: the company's categories. The organisation's
  `(category_id, workspace_id)` reference keeps it to its own company.
- `contacts_counters`: the number series, written only by the numbering
  trigger (security definer). Nobody else can read or write it.
- `contacts_activity`: the log, written by triggers (security definer) on
  both tables. Only managers can read it, and nobody can write it directly.
  It has no foreign key to the record, so a deleted record's history stays.

**Access.** Through `has_section(ws, 'contacts', level)`:

| Level | Can do |
|---|---|
| view | read organisations, people, categories |
| work | add and edit organisations and people |
| manage | archive and restore, delete, import, name categories, read the activity log |

- Every query in `client.js` also filters by `workspace_id`.

**Errors.**
- The triggers raise a code (`CONTACTS_DUPLICATE_VAT`,
  `CONTACTS_CATEGORY_INACTIVE`, …) with the data the screen needs in
  `detail`.
- `client.js` (`errorText`) turns these, and Postgres's own errors, into
  English or Arabic.

**Stack rules kept.**
- No `api/` files, no new npm packages, no outside services, nothing Vercel.
- Plain Postgres: no `pg_trgm`, no extensions.
- Plain JS.

## How long it took

| Step | From | To | Time |
|---|---|---|---|
| Survey: his controllers, models, schema, routes; the CRM pilot notes; v2 idioms | 11:01 | 11:06 | ~5 min |
| Round 1: schema, rules, logic, client, screens, registration, tests, browser checks, notes | 11:06 | 11:27 | ~21 min |
| Re-split the branch into one commit per part (owner's request) | 11:27 | 11:28 | ~1 min |
| Round 2: a full inventory of his client, supplier and contact screens, then numbers, categories, banking, activity log, delete cascade, list filters, grouping and cards, with tests and browser checks | 11:28 | 11:40 | ~12 min |

About **40 minutes** of agent time in all.

## His Contacts vs ours, feature by feature

Legend: ✅ same rule · 🟢 ours goes further · ⏳ needs another module first.

| Feature | Musa's ERP | Ours |
|---|---|---|
| One record with several roles (client, supplier, main contractor, consultant, subcontractor, sister company) | Planned (MODULES.md item 3); built as two tables, `clients` and `suppliers` | 🟢 one table, `roles text[]` |
| Company vs individual | `client_type` | ✅ `kind` |
| Record number | `C-2026-000001` (clients), `S-2026-000001` (suppliers) | ✅ `C-2026-000001`, one series per company and year |
| Name | one name | 🟢 English and Arabic, shown by language |
| VAT number: 15 digits | ✅ | ✅ (spaces removed first) |
| CR number, free text | ✅ | ✅ |
| One per VAT / CR in the company, naming the other | ✅ trigger + form | ✅ trigger + unique indexes + live warning |
| Similar-name warning | ❌ | 🟢 |
| National address, digits only | ✅ | ✅ |
| Full address required for a VAT-registered company client | ✅ (form only) | ✅ form + trigger + check constraint |
| Free-text address | ✅ | ✅ |
| Supplier category list (Arabic + English, active, count, never deleted) | ✅ | ✅ |
| Supplier country, IBAN (Saudi/foreign rule), SWIFT, payment terms | ✅ | ✅ (also offered for subcontractors) |
| "Supplier outside the Kingdom" badge | ✅ | ✅ |
| Supplier sales contact (name, mobile) | two columns | 🟢 real contact persons with a primary flag |
| Contact persons: name, position, phone, email, note | ✅ (clients only) | ✅ for every organisation, plus Arabic name |
| A person on their own | ❌ | 🟢 |
| Archive ("stop dealing"); archived leaves the lists; a filter shows them | ✅ | ✅ |
| Archived = no new opportunity / quotation | ✅ triggers on `crm_leads`, `quotations` | ⏳ `contacts_org_is_active()` is ready for those modules |
| Archived record locked from edits | ❌ | 🟢 locked until restored |
| Delete when nothing references it; contacts go with it | ✅ | ✅ (the foreign keys will refuse it once other modules point at Contacts) |
| Activity log, field by field, old → new | ✅ (`audit.view` permission) | ✅ (managers) |
| List filters: type, archived (clients); active, VAT-registered, foreign, category (suppliers) | ✅ | ✅ all on one list, plus role and quick filters |
| List filters: "owed", "overdue" | ✅ | ⏳ needs supplier invoices and payments |
| Group by: type, city (clients); category, city (suppliers) | ✅ | ✅ type, city, category |
| List view and card (kanban) view | ✅ | ✅ |
| Search: name, phone, city, number | ✅ | ✅ plus Arabic name, VAT, CR, email |
| CSV import | ❌ | 🟢 |
| Summary buttons on a client: quotations, opportunities, projects, invoices, balance due | ✅ | ⏳ needs those modules |
| A client's quotations, opportunities and projects listed on its page | ✅ | ⏳ |
| "New quotation" / "New opportunity" / "New supplier invoice" from the record | ✅ | ⏳ |
| Supplier balance, aging (overdue / not due / no due date / unallocated) | ✅ | ⏳ needs Purchasing and Accounting |
| Supplier's invoices on its page | ✅ | ⏳ |
| Supplier statement: screen, printed on the letterhead, Excel | ✅ | ⏳ |
| Permissions | `clients.*`, `purchases.*`, `audit.view` | our three levels on one section |
| Arabic UI | Arabic only | ✅ English and Arabic, full right-to-left |

## Not in Contacts (the ⏳ rows), and why

Every ⏳ row reads a table that belongs to another of his modules:
quotations, CRM opportunities, projects, sales invoices, receipts, purchase
invoices, supplier payments, and the ledger views built on them. v2 has none
of these yet; the CRM pilot runs his CRM in a separate `erp` schema on
another branch. Building the buttons now would mean showing zeros that look
like facts, so they are left out. Each one becomes a small addition to
`Org.jsx` once its module exists in our stack: a count and a link, or a
table, filtered by `contact_org_id`. The CRM link is described under "Next
Contacts step".

## Traps

1. **Migrations apply in file-name order.** `…_functions.sql` sorted before
   `…_tables.sql`. The files are now numbered `_1_`, `_2_`, `_3_`.
2. **Triggers fire in name order too.** `contacts_orgs_number` must run
   before `contacts_orgs_tidy`, and the names are chosen for that.
3. **This session's worktree hook.** It refuses writes outside its own
   worktree. Switch the session into `.claude/worktrees/v2-contacts`
   (EnterWorktree with `path`) before writing.
4. **Archived means locked, so a no-op update fails too.** Any update to an
   archived organisation that does not restore it is refused. The numbering
   backfill therefore ran with the table's triggers switched off.
5. **The activity log starts when migration 3 went in.** Records made
   before it have no "created" row. Changes made with SQL (the seed, a
   migration) show as "The system", like his entries without a user.
6. **Numbers have gaps.** A refused insert still used its number. His
   Postgres sequences behave the same way.
7. **The browser pane runs hidden.** Screenshots right after navigation
   show a skeleton or the fade-in. Read the page text before concluding
   anything.
8. **`dir="auto"` on a block right-aligns an Arabic name in the English
   layout** (and the reverse). Names are wrapped in `<bdi>`.
9. **`w-full` plus `w-auto` on one element.** Tailwind's stylesheet order
   wins, not the class order; filter selects use `fieldInline`.
10. **Shared database.** The HR agent's `20261112_hr_*` migrations were
    already there. `apply-migrations.sh` applies only files in *this*
    worktree, so the branches never re-run each other's files.

## Decisions for the owner

Each was taken the safe, reversible way so work could continue.

1. **How Contacts relates to `sales_accounts`** (142 previous clients, with
   domains and Odoo names). *Taken:* kept apart. *Suggested:* import each
   account as a Client organisation, matched by domain or Odoo name first.
   Then give `sales_accounts` a nullable `contact_org_id`, keeping it for
   its sales-only fields. Contacts needs a `domains` column for the match.
2. **Leads** (923). *Taken:* no link. *Suggested:* when a lead is won or
   approved, the person picks or creates its organisation (the duplicate
   guard runs), and the lead stores `contact_org_id`. Never automatically.
3. **Email-marketing contacts** (106). *Taken:* kept apart: they carry
   consent and unsubscribe data. *Suggested:* at most a "send to marketing
   list" action, with consent asked.
4. **One number series.** He numbers clients `C-` and suppliers `S-`. With
   one record per firm, ours is a single `C-` series. *Taken:* one series.
5. **Full address for suppliers too?** *Taken:* no (his rule: client
   companies with VAT only).
6. **Supplier fields for subcontractors.** *Taken:* yes, shown for both,
   since we pay subcontractors too.
7. **Who reads the activity log.** He has a separate `audit.view`
   permission. *Taken:* managers of Contacts.
8. **Who sees Contacts by default.** *Taken:* nobody until granted
   (`adminOnly`), sales seats included.
9. **One section or separate Clients/Suppliers grants.** *Taken:* one
   section.

## Tests and results

- `supabase/contacts.test.js` (PGlite, the three real migrations, run twice
  to prove they re-run, acting as six kinds of person): **20/20**. Covers:
  - company separation and the levels;
  - tidy text, VAT format, duplicates, the national address;
  - archived = locked, one primary contact, the import;
  - numbers, categories (managers only, own company only, switched off),
    IBAN, SWIFT and terms;
  - the activity log (who, field by field, kept after a delete, managers
    only, nobody writes it directly);
  - delete taking the people with it.
- `src/lib/contacts/logic.test.js`: **26/26**. Covers validation including
  IBAN/SWIFT/terms, the duplicate guard, all list filters, grouping,
  history rows, and CSV with the supplier columns.
- `src/lib/i18n.test.js`: every Contacts word and error has its Arabic.
- Full suite: **201 files, 3,634 tests, all passing**. Lint: 0 errors (the 7
  warnings are older files).
- `node dev/v2db/check-contacts.mjs` (live local stack, real logins
  `hafeez@arak-sa.com`, `junaid@arak-sa.com`, `junaidatif40@gmail.com`):
  **33/33**. It cleans up its grant and its organisation; the deleted
  organisation's history stays in the log by design.
- In the running app on :5181, signed in as `hafeez@arak-sa.com`:
  - Round 1, every page in English and Arabic: creating an organisation
    (blocking warning, then similar-name warning and save-anyway); edit,
    archive and restore; adding and deleting a person; deleting the
    organisation; the CSV import.
  - Round 2: the list grouped by category and by city, the card view in
    Arabic, Luce Italia's page (category, terms, Italian IBAN, foreign
    badge, the activity log right to left), editing payment terms 60 → 90
    (logged under "hafeez"), and the categories page in English (adding
    one, and the "name already taken" refusal).

## Next Contacts step

1. **Link the first consumer: the CRM's "won needs a client".** When the CRM
   is rebuilt in our stack, its opportunity gets
   `client_org_id uuid references contacts_orgs`. Make it a composite
   `(client_org_id, workspace_id)` foreign key, as people do, so a deal
   cannot point at another company's client. Then:
   - A trigger refuses status `won` unless `client_org_id` is set and
     `contacts_org_is_active()` is true. That is his rule plus his "no new
     document for an archived client".
   - "Mark won" opens a picker over Contacts organisations, with "+ New
     organisation" using the same form and duplicate guard. It adds the
     Client role if the organisation lacks it.
   - That foreign key also makes Contacts' delete refuse an organisation
     with deals (his "nothing references it"), with no extra code.
   - The organisation page gains its first summary button: Opportunities,
     with a count and a link.
2. **Bring in the 142 `sales_accounts`** as Client organisations
   (decision 1).
3. **The remaining summary buttons and the supplier account** (balance,
   aging, invoices, statement), as Quotations, Projects, Sales and
   Purchasing arrive.
