# Contacts (جهات الاتصال): Musa's ERP item 3, rewritten in our stack

2026-10-28, branch `v2-contacts` (from `v2` at d513448). This is the second
approach the owner chose for simple ERP modules. The CRM pilot
(`CRM-PILOT.md`) loaded Musa's own schema into an `erp` schema. Contacts
instead uses **our own clean tables in `public`**, our row level security,
and our screens. Nothing of his runs; his code was read for the rules only.

## What was built

One new v2 section, `contacts` ("Contacts" / "جهات الاتصال"). It sits in the
rail between Insights and Admin and has three pages:

| Page | URL | Who |
|---|---|---|
| Organisations | `/contacts` | view |
| People | `/contacts/people` | view |
| One organisation (hidden; opened from the lists) | `/contacts/org?id=…` | view |

**Organisations list.**
- Quick filters with counts: All, Clients, Suppliers, Contractors (main or
  sub), Consultants.
- A role filter (any of the six roles) and a status filter (Active by
  default, Archived, All).
- A search over names in both languages, VAT, CR, city, phone and email.
  Arabic letter forms are folded, so أ/ا and ة/ه both match.
- The filters live in the URL, so a filtered list can be linked to.
- Columns: name with the other-language name under it, role badges, city,
  VAT number, primary contact.
- "+ New organisation" (work) and "Import CSV" (manage).

**Organisation page.**
- Shows the kind (company or individual), role badges, Registration (VAT,
  CR, country), Contact details (phone, email, website), National address
  (building, street, district, city, postal code, additional number), Notes,
  and the contact persons.
- Work: Edit, add and edit people.
- Manage: Archive or Restore, Delete. Delete appears only while the
  organisation has no people, and the database refuses it otherwise.
- An archived organisation shows when it was archived, offers only Restore,
  and is locked.

**People page.**
- Everyone in the company, filtered by "with an organisation" or "on their
  own", with a search.
- A person can be created on their own or under any *active* organisation.

**Forms.**
- Every field has its own error, in both languages.
- The national-address note turns amber when the address becomes required.
- The roles are tick buttons.

**Duplicate guard, as you type.**
- Same VAT or same CR: a red panel naming the existing organisation, and
  Save is disabled. The database refuses it too.
- A very similar name: an amber panel. The first Save becomes "It is a
  different one: save", so saving takes a second, deliberate click.
- Archived organisations count as duplicates (restore it instead of
  re-entering it).

**CSV import (manage).**
- Choose a file or paste it, download a template.
- Every line is previewed: Ready, what is wrong (field by field), the same
  VAT/CR as an existing organisation or an earlier line, or a similar name.
- Similar-name rows stay out unless ticked in.
- Only Ready rows are sent. The database inserts each row on its own and
  reports refused ones by line; the rest still go in.
- Column names in English, as field names, or in Arabic. Several roles go
  in one cell, separated by `;` (English or Arabic role names).

**Test data.** `dev/v2db/seed-contacts.sql` holds 11 organisations in Arak
Lighting and 2 in Ghusn, plus 10 people. Every name says "(test)" / "(تجربة)"
and every number is invented. It is not a migration, so it never reaches
production. One organisation is archived. One is a deliberate near-duplicate
("Najd Tower Development Co (test)"), so the similar-name warning shows.

## How

| Layer | Files |
|---|---|
| Tables, RLS | `supabase/migrations/20261120_contacts_1_tables.sql` |
| Rules (triggers, import, helper) | `supabase/migrations/20261120_contacts_2_rules.sql` |
| Pure logic: validation, duplicate guard, filters, CSV | `src/lib/contacts/logic.js` (+ `logic.test.js`) |
| Reads and writes, error words | `src/lib/contacts/client.js` |
| Screens and words | `src/pages/contacts/` (`index.jsx`, `Org.jsx`, `People.jsx`, `parts.jsx`, `useContactsBook.js`, `words.js`) |
| Registration | `src/lib/modules.js` (one SECTIONS entry), `src/App.jsx` (3 routes), `src/lib/sectionAccess.js` (`GRANTABLE` + `contacts`), `src/components/layout/icons.jsx` (one icon) |
| Tests | `supabase/contacts.test.js` (PGlite), `dev/v2db/check-contacts.mjs` (live local stack), i18n list in `src/lib/i18n.test.js` |

**Schema.**
- `contacts_orgs`: one row per organisation or individual. `roles` is a
  `text[]` limited to the six values, with a GIN index. `status` is
  `active` or `archived`, with `archived_at` and `archived_by`.
- `contacts_people`: `org_id` may be null. Its foreign key is
  `(org_id, workspace_id)` against the organisation's `(id, workspace_id)`,
  so a person can only belong to an organisation of the same company.
  Postgres checks this; it needs no trigger.
- Unique indexes: `(workspace_id, vat_number)` and
  `(workspace_id, lower(cr_number))`.

**Access.** Through `has_section(ws, 'contacts', level)`:

| Level | Can do |
|---|---|
| view | read |
| work | add and edit organisations and people |
| manage | archive and restore, delete, import |

- RLS covers read, add, edit and delete.
- Archiving needs more than a grant, so a trigger checks Manage when the
  status changes.
- The import function checks Manage itself.
- Every query in `client.js` also filters by `workspace_id`.

**Errors.**
- The triggers raise a code (`CONTACTS_DUPLICATE_VAT`, `CONTACTS_ARCHIVED`,
  …) with the data the screen needs in `detail`: the other organisation's
  name, or the missing fields.
- `client.js` (`errorText`) turns these, and Postgres's own errors (unique
  race, foreign key, RLS), into English or Arabic.

**Stack rules kept.**
- No `api/` files, no new npm packages, no outside services, nothing Vercel.
- Plain Postgres only: no `pg_trgm`. Name similarity is computed in the
  browser, in `logic.js`.
- Plain JS.

## How long it took

| Step | From | To | Time |
|---|---|---|---|
| Survey: Musa's controllers, models, schema, routes; the CRM pilot notes; v2 idioms | 11:01 | 11:06 | ~5 min |
| Schema, rules, PGlite test (15 green first run), applied locally, test data | 11:06 | 11:09 | ~4 min |
| Logic + 20 tests, client, words, the three pages, registration; suite + lint green | 11:09 | 11:18 | ~9 min |
| Browser checks EN and AR, two layout fixes, live-stack check (26/26) | 11:18 | 11:23 | ~5 min |
| These notes | 11:23 | 11:27 | ~4 min |

About **26 minutes** of agent time end to end, with no waiting on anyone.

## His Contacts vs ours, feature by feature

Legend: ✅ same rule · 🟢 ours goes further · 🟡 simplified · ❌ not built.

| Feature | Musa's ERP | Ours |
|---|---|---|
| One record with several roles (client, supplier, main contractor, consultant, subcontractor, sister company) | Planned (MODULES.md item 3); built as two tables, `clients` and `suppliers` | 🟢 one table, `roles text[]` |
| Company vs individual | `client_type` COMPANY / INDIVIDUAL | ✅ `kind` |
| Name | one name (Arabic or English) | 🟢 English and Arabic names, shown by language |
| VAT number: 15 digits | ✅ | ✅ (spaces removed first) |
| CR number | free text ≤ 30 for clients | ✅ same |
| One per VAT / CR in the company | ✅ trigger + app check, error names the other client | ✅ trigger + unique indexes + live warning naming it |
| Similar-name warning | ❌ | 🟢 warns, needs a second click |
| National address (building, street, district, city, postal, additional), digits only | ✅ | ✅ |
| Full address required for a VAT-registered company client | ✅ (app only) | ✅ app + trigger + check constraint |
| Archive instead of delete; archived leaves lists | ✅ | ✅ |
| Archived = no new opportunity / quotation | ✅ triggers on `crm_leads`, `quotations` | 🟡 `contacts_org_is_active()` is ready for those modules; nothing to guard yet |
| Archived record locked from edits | ❌ (still editable) | 🟢 locked until restored; no people added |
| Delete | ❌ never (clients) | 🟡 Manage may delete one with no people; the database refuses otherwise |
| Contact persons: name, position, phone, email, note | ✅ `client_contacts` (clients only) | ✅ for every organisation, plus Arabic name and primary flag |
| A person on their own | ❌ | 🟢 |
| One primary contact | ❌ | 🟢 enforced (the newest takes the flag) |
| Supplier: category list, country, IBAN, SWIFT, payment terms, sales contact | ✅ | 🟡 country only; the rest skipped (see below) |
| Supplier balances, ledger, aging, statement | ✅ | ❌ belongs with Purchasing / Accounting |
| Client "smart buttons" (counts of quotations, projects…) | ✅ | ❌ no such modules in v2 yet |
| Activity log per client | ✅ `fn_audit` | ❌ `created_by` / `updated_by` / timestamps only |
| Document number (`C-…`, `S-…`) | ✅ | ❌ uuid only |
| List filters | type, city, archived; supplier: active, VAT, owed, overdue, foreign, category | 🟡 quick role filters, role, status, search |
| CSV import | ❌ | 🟢 row by row, with preview |
| Permissions | `clients.view` / `clients.manage`, `purchases.view` / `purchases.manage` | 🟡 our three levels on one section |
| Arabic UI | Arabic only | ✅ English and Arabic, full right-to-left |

## Skipped or simplified, and why

1. **Supplier banking (IBAN, SWIFT, payment terms) and categories.** These
   matter when paying a supplier, which is Purchasing. They are easy to add
   as columns when Purchasing comes. IBAN rule to reuse: Saudi
   `^SA[0-9]{2}[0-9A-Z]{20}$`, foreign `^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,30}$`
   when the country is not SA.
2. **Balances, ledger, aging, statements.** Accounting, not Contacts.
3. **Document numbers.** Nothing prints a contact number yet. A
   `contact_no` with a per-company sequence can be added without breaking
   anything.
4. **Activity log.** v2 has no audit table yet. `created_by`, `updated_by`
   and `archived_by` cover who for now.
5. **Similar names in the database.** Plain Postgres has no fuzzy match
   without `pg_trgm`, so the warning is computed in the browser over the
   company's list. Only exact VAT/CR duplicates are hard rules.
6. **Saudi VAT check digits.** A real Saudi VAT number starts and ends with
   3. Musa checks only 15 digits, and so do we. It would be easy to warn
   about.
7. **Supplier "contact name / mobile" columns.** Replaced by real contact
   persons.

## Traps

1. **Migration order.** `apply-migrations.sh` applies files in name order,
   and `…_functions.sql` sorts before `…_tables.sql`. The first apply failed
   (each file is one transaction, so nothing was left half-done). The files
   are now `…_1_tables.sql` and `…_2_rules.sql`.
2. **This session's worktree hook.** It refuses writes outside its own
   worktree. The fix was to switch the session into
   `.claude/worktrees/v2-contacts` (EnterWorktree with `path`) before
   writing.
3. **Archived means locked, so a no-op update fails too.** Any update to an
   archived organisation that does not restore it is refused, including
   "write the same value back". `check-sections.mjs`'s write-back style of
   check would read this as "cannot write"; `check-contacts.mjs` tests the
   lock on purpose.
4. **The browser pane runs hidden.** Screenshots right after navigation
   show a skeleton or the fade-in. Read the page text (or wait) before
   concluding anything.
5. **`dir="auto"` on a block right-aligns an Arabic name in the English
   layout** (and the reverse). Names are wrapped in `<bdi>`: the text keeps
   its own direction, and the line keeps the page's alignment.
6. **`w-full` plus `w-auto` on one element.** Tailwind's order wins, not
   the class order, so the filter selects stretched. They now use
   `fieldInline`.
7. **Shared database.** The HR agent's `20261112_hr_*` migrations were
   already applied when ours went in. `apply-migrations.sh` applies only
   files present in *this* worktree, so the two branches never re-run each
   other's files.

## Decisions for the owner

Each was taken the safe, reversible way so work could continue.

1. **How Contacts relates to `sales_accounts`** (142 previous clients, with
   domains and Odoo names). *Taken:* kept apart. *Suggested next:* when
   Contacts goes live, import each account as a Contacts organisation with
   the role Client. Then give `sales_accounts` a nullable `contact_org_id`
   and keep it for its sales-only fields (orders, value, priority, plays,
   owner). Matching on domain or Odoo name first, as the lead card does,
   avoids duplicates. Contacts needs a `domains` column for that, which is
   one small migration.
2. **Leads** (923). *Taken:* no link. *Suggested:* a lead stays a lead. When
   one is won or approved, the person picks or creates its Contacts
   organisation (the duplicate guard runs), and the lead stores
   `contact_org_id`. Leads should not create Contacts organisations
   automatically: most leads never become clients.
3. **Email-marketing contacts and groups** (106 contacts). *Taken:* kept
   apart. They hold consent, unsubscribe and send history, which Contacts
   must not carry. *Suggested:* at most a "Send to marketing list" action
   from a Contacts person, which creates or updates the
   `email_contacts` row by email, with consent asked, never assumed.
4. **Role-specific rules.** Following Musa, the full national address is
   required only for a client company with a VAT number. Should it also be
   required for suppliers? *Taken:* no (his rule).
5. **Delete.** Musa never deletes a client. We let Manage delete an
   organisation that has no people, for typing mistakes. *Taken:* allowed.
   When other modules point at Contacts, their foreign keys will block
   deleting anything in use without further code.
6. **Who sees Contacts by default.** The section is `adminOnly`: members get
   nothing until granted. Sales seats do not get it either; they use their
   own app.
7. **One section or several.** Contacts is one section. Giving the sales
   team Clients while purchasing gets Suppliers would need per-role grants.
   *Taken:* one section for now.

## Tests and results

- `supabase/contacts.test.js` (PGlite, the real migrations, acting as six
  kinds of person): **15/15**. Covers company separation, no grant, view,
  work, manage, tidy text, VAT format, duplicates, the national address,
  archived = locked, one primary contact, and import row by row.
- `src/lib/contacts/logic.test.js`: **20/20**. Covers validation, the
  duplicate guard (Arabic folding, typos, firm-type words, cross-language),
  quick filters, role and status filters, search, and CSV parsing and roles.
- `src/lib/i18n.test.js`: Contacts words and error words have Arabic for
  every English key.
- Full suite: **201 files, 3,623 tests, all passing**. Lint: 0 errors (the 7
  warnings are older files).
- `node dev/v2db/check-contacts.mjs` (live local stack, real logins
  `hafeez@arak-sa.com`, `junaid@arak-sa.com`, `junaidatif40@gmail.com`):
  **26/26**. It cleans up its grant and its organisation.
- In the running app on :5181, signed in as `hafeez@arak-sa.com`:
  - Every page in English and Arabic.
  - Creating an organisation with the blocking warning, then the
    similar-name warning and save-anyway.
  - Edit, archive (locks, stamps the date), restore, adding a person (first
    one becomes primary), deleting the person, deleting the organisation.
  - CSV import with one ready row, one duplicate VAT and one missing name.
  - Every Contacts API request returned 200.

## Next Contacts step

1. **Link the first consumer: the CRM's "won needs a client".** When the CRM
   is rebuilt in our stack, its opportunity gets
   `client_org_id uuid references contacts_orgs`. Make it a composite
   `(client_org_id, workspace_id)` foreign key, as people do, so a deal
   cannot point at another company's client. Then:
   - A trigger refuses status `won` unless `client_org_id` is set, the
     organisation has the `client` role, and `contacts_org_is_active()` is
     true. That is Musa's rule plus his "no new document for an archived
     client".
   - "Mark won" opens a picker over Contacts organisations, with "+ New
     organisation" using the same `OrgForm` and duplicate guard.
   - If the picked organisation lacks the Client role, the database adds
     it (a role is a fact about the relationship).
   - Deleting a Contacts organisation then becomes impossible while a deal
     points at it, through the foreign key. That is exactly "never delete
     one in use", with no extra code.
2. **Bring in the 142 `sales_accounts`** as Client organisations (decision 1),
   with a `domains` column on Contacts.
3. **The organisation page's "what this contact has" strip** (Musa's smart
   buttons): deals, quotations and projects, once those modules exist.
4. **Optional:** an audit trail and document numbers, when v2 has a shared
   pattern for both.
