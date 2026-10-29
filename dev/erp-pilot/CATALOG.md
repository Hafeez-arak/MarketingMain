# Catalog (الكتالوج) in v2

2026-10-30. Musa's product catalog, rewritten in our own stack as the v2
section `catalog`, on branch `v2-catalog` (not merged, not pushed). Written
from what his screens do; none of his code was copied.

What it is: the company's items and their specifications. No prices, no stock
quantities.

## What was built

**Database** (`supabase/migrations/`, applied with `dev/v2db/apply-migrations.sh`, all re-runnable):

| File | Holds |
| --- | --- |
| `20261130_catalog_1_tables.sql` | `catalog` allowed in `section_access`, `tasks` and `meetings` checks (the CRM migration was the last to touch them); `catalog_spec_fields`, `catalog_items`, `catalog_item_specs`, `catalog_audit`; triggers; RLS |
| `20261130_catalog_2_files.sql` | private bucket `catalog-files` and its folder rule |
| `20261130_catalog_3_search.sql` | `shell_search_catalog(ws, q, lim)` |

- Every table has `workspace_id … on delete cascade`, RLS on, and
  `(workspace_id, id)` keys: a spec's item and field are tied to its own company.
- Items: unique `(workspace_id, code)`, code not empty and not padded.
  Fields: unique per company by `lower(btrim(name))`. Neither is ever deleted
  (no grant, no policy), only switched off (`active`).
- A spec with a blank value is refused; the app deletes the row instead
  ("no value is assumed"). One value per item and field.
- `catalog_audit` is filled by triggers (`catalog_audit_row`, as `hr_audit`):
  old and new row, who, when; spec rows are kept under their item. A company
  delete removes its history with it.
- `workspace_id` of a row can never change (`CATALOG_WORKSPACE_FIXED`);
  `updated_at` is the database's clock.
- Files: `<workspace>/<item>/<file>`, 20 MB, PDF / JPG / PNG / WebP. Manage
  uploads (only into an item that exists in that company), View reads. The
  item's path is replaced and the **old file stays**: there is no update
  policy, and no delete policy for a live company. One delete exists, for
  clean-up after a company is deleted (access admin, company row gone), so
  Settings → Delete company can empty the folder (`companyFolders()` now
  lists `catalog-files`).

**App**
- `src/lib/catalog/logic.js` (pure, tested), `client.js` (reads and writes,
  error words in both languages).
- `src/pages/catalog/`: `index.jsx` (Items), `Item.jsx`, `ItemForm.jsx`
  (new and edit), `Fields.jsx`, `History.jsx`, `words.js`, `useCatalog.js`.
- Routes `/catalog`, `/catalog/item?id=`, `/catalog/new`, `/catalog/edit?id=`,
  `/catalog/fields`. Section in `lib/modules.js` right after `crm`
  (`adminOnly`, English and Arabic blurb), icon `box`, Home colour
  `['#a16207', '#ca8a04']`, `catalog` in `GRANTABLE` (the Section access
  screen reads the label from the section list), a search provider
  (group "Catalog items" / "أصناف الكتالوج") and the palette's failed-part name.
- Items list: columns code, name, brand, model, category, unit and a
  "Stopped" pill; Active / Stopped; group by category or brand ("No
  category" / "No brand" last); search over code, name, brand, model,
  category; 50 a page; everything in the URL.
- Item page: details, specifications with field name and unit, datasheet
  link, picture, Edit and Stop / Start (manage), History (view reads it).
- Form: unit and category suggest values already used (`<datalist>`); one
  input per active field plus a stopped field the item already has a value
  for, by order; the hint "Leave blank if the value is not known…".
- Fields page (manage): inline edit, add form (order defaults to highest + 10),
  Stop / Start with the note.

## Permission mapping

Musa has `catalog.view` and `catalog.manage` only.

| Our level | Does |
| --- | --- |
| view | reads items, fields, specs, files and the history |
| work | the same as view |
| manage | adds and edits items, switches items and fields on and off, edits specs, manages fields, uploads files |

The access admin is manage everywhere. `/catalog/fields`, `/new` and `/edit`
need manage in the menu rules and again in the page.

## Decisions I made where the brief was silent

- `catalog_item_specs` has an `updated_at` column, so "touch updated_at on all
  tables" holds for it too (the brief's column list did not name it).
- The history is readable at view (the brief lists the History panel on the
  item page without a manage mark); HR's is manage-only.
- A pending item with a failed file upload stays saved; pressing Save again
  updates it instead of creating a second one.
- A stopped item can still be edited (the brief does not forbid it).

## Waiting (not built)

- Musa's rule "a stocked item stays stocked once it has stock documents" waits
  for the stock module. It is a comment in `catalog_items_rules()` in
  `20261130_catalog_1_tables.sql`, where the check will go (error code
  `CATALOG_STOCKED_IN_USE` reserved).
- CSV import waits for the Imports module.
- Use by pricing sheets, tech offers, quotations, sales orders and purchasing
  comes with those modules.

## Tests

- `dev/erp-pilot/catalog/run-tests.sh` runs `catalog_test.sql` in one
  rolled-back transaction as real logins: 62 checks, all pass. They cover
  view reads / cannot write, work cannot write, manage writes, code unique per
  company and reusable in another, no deleting items or fields, a blank spec
  refused, company separation, a company delete cascading through all four
  tables and their history, the history written, RLS on for every `catalog_`
  table, the search, and the bucket refusing another company's folder.
  (Storage refuses a direct SQL `DELETE`, so the clean-up delete is tested
  through its rule, `catalog_orphan_ok`.)
- `seed.sql`: 5 fields and 6 items, every name ending "(test)", Arak
  Lighting only. `unseed.sql` removes them (and refuses if anything else is there).
- vitest: `src/lib/catalog/logic.test.js` (19: validation, spec ordering,
  filters, grouping, paging, spec diff, files, history), the Arabic words in
  `src/lib/i18n.test.js`, and the updated section, search and company-files tests.
- Results: `npx vitest run` all pass; `npx eslint src` 0 errors (7 old
  warnings elsewhere); `npx vite build --mode v2` builds.
- In the app at :5187: as admin (manage) the list, grouping, an edit that
  changed a spec, blanked another, uploaded a datasheet and a picture (both
  open through signed links, history shows each step), Stop / Start, field
  add / duplicate refusal, Arabic and right-to-left, phone width (375 px, no
  page scroll, the table scrolls inside its box); as view-only (`staff.marketing`,
  Arak Lighting): list and item pages without any button, `/catalog/fields`
  sends them home, the search finds items.

## Known loose ends

- Two test files from the in-app upload check remain in the `catalog-files`
  bucket (storage cannot be emptied from SQL); they are test data.
- `staff.dev` is only a member of Aqeeq in the app's company list, so the
  view-only check used `staff.marketing` instead.
