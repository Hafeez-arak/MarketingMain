# Pricing (التسعير) in v2

2026-12-01. Musa's pricing module rewritten in our own stack as the v2 section
`pricing`: pricing sheets per CRM opportunity, supplier quotes, landed cost,
margin, and the submit / approve workflow. His code was read (never copied);
the rules were written again as Postgres functions and triggers on our own
tables. Branch `v2-pricing` (from `v2`), local v2 database only.

## What he has (the gap list, read from his code before building)

Source files read: `0002_catalog_pricing.sql` (pricing parts), `0048` (the
`cost_category` column), `0035` (how the approved sheet is used later, read
only), `PricingSheetController`, `SupplierQuoteController`, the models,
`resources/views/pricing/*`, `PricingTest`, the routes, and the opportunity
page's pricing panel.

| His rule, screen or action | Here |
|---|---|
| Sheet per open opportunity; opportunity never changes | `pricing_sheets.lead_id` → `crm_leads` by `(id, workspace_id)`; guard refuses a closed opportunity (`PRICING_LEAD_CLOSED`); a new sheet moves the opportunity to the stage tied to "pricing started" (`crm_auto_stage`, as his `CrmAutoStage`) |
| Numbers `PS-…` / `SQ-…`, per company, never changed | `PS-YYYY-NNNNNN`, `SQ-YYYY-NNNNNN` from `pricing_counters` (the CRM's `lead_no` method), gap-free |
| Workflow DRAFT → SUBMITTED → APPROVED, back to DRAFT, CANCELLED (reason) | lowercase statuses; `pricing_sheets_guard` + four transition functions; clients cannot write status (column grants) |
| Submit and approve refused with blocking issues; the minimum margin in force is kept | guard checks `pricing_sheet_issues`, stores `min_margin_pct` at submit/approve; return to draft clears the stamps |
| Locks: cancelled final, approved only cancellable, submitted only approve/return/cancel | same, in the guard |
| Lines, supplier quotes and their lines change only in a draft; delete only a draft | `pricing_require_draft` in every guard; `PRICING_DELETE_NOT_DRAFT` |
| Chosen offer must be a priced offer of a received quote, for that line | line guard (`PRICING_SELECTION`) |
| A chosen quote stays received; a chosen offer keeps its price | quote and offer guards (`PRICING_QUOTE_SELECTED`) |
| One main offer per line in a quote, alternatives beside it | partial unique index |
| An offer answers a line of the same sheet; offer stays on its quote and line | `PRICING_QUOTE_LINE` |
| Quote in the company currency has rate 1, never typed | `fx_rate := 1` for SAR in the quote guard |
| A rate belongs to its currency | a changed currency with the same rate leaves the rate unknown |
| Landed cost spread by value; unknown stays unknown; totals only when every line is known | views `pricing_supplier_quote_line_cost`, `pricing_line_cost`, `pricing_sheet_totals` |
| Ten issue codes, blocking or warning, margin note frees below-cost / below-minimum | `pricing_sheet_issues` (same ten, same order) |
| `cost_category` on lines, draft only | lowercase `goods / installation / subcontract / other` or null |
| Catalog item on lines and offers; "apply catalog item" action | composite key to `catalog_items`; `pricing_apply_catalog` (active items only) |
| Sheets list: filters (status, mine), grouping, search, bid-date order, pages | `/pricing` |
| Sheet form (new from an open opportunity, edit title / notes / margin reason) | `/pricing/new`, `/pricing/edit` |
| Sheet page: workflow buttons, status bar, figures, checks, lines with prices, quotes, history, self-approval badge, ribbon | `/pricing/sheet` |
| Lines editor, remove with offers warning, categories, catalog link | `/pricing/lines` |
| BOQ import + template | `/pricing/lines` (see decision 8) |
| Comparison: pick the offer per line, lowest marked, short quantity, lead time, pending count | `/pricing/compare` |
| Supplier quote create / edit with lines and alternatives, delete quote, delete alternative | `/pricing/quote-new`, `/pricing/quote` |
| Settings: minimum margin | `/pricing/settings` |
| Opportunity page shows its sheets, "New pricing sheet" | panel on `/crm/lead` |
| History (his activity log) | `pricing_audit`, shown on the sheet |
| Company delete removes everything | cascades; guards step aside (`crm_company_gone`) |

## What was built

Migrations (apply with `dev/v2db/apply-migrations.sh`):

- `20261201_pricing_1_tables.sql`: section key, `currencies`, `pricing_settings`,
  `pricing_sheets`, `pricing_lines`, `supplier_quotes`, `supplier_quote_lines`,
  `pricing_counters`, `pricing_audit`, grants, RLS.
- `20261201_pricing_2_rules.sql`: numbering, guards, cost views, issues,
  history triggers, the four transition functions.
- `20261201_pricing_3_work.sql`: save BOQ, import, prices, choose offers,
  link catalog item, request a quote, save a quote; the lookups
  (`pricing_leads`, `pricing_suppliers`, `pricing_catalog_items`,
  `pricing_people`); `shell_search_pricing`.

App: `src/lib/pricing/{logic,client}.js`, `src/pages/pricing/*`, the rail
entry (`modules.js`, new `calculator` icon, after Catalog, admin-only),
routes, `GRANTABLE`, the Home tile colour `['#047857', '#10b981']`, the
Ctrl/Cmd+K provider, and the panel on the CRM opportunity page.

Tests and data: `dev/erp-pilot/pricing/{pricing_test.sql,run-tests.sh,seed.sql,unseed.sql}`,
`src/lib/pricing/logic.test.js`, words in `src/lib/i18n.test.js`.

## Who may do what (his three permissions on our three levels)

| Level | His permission | Can |
|---|---|---|
| view | `pricing.view` | read everything: sheets, quotes, cost, margin, the history, settings |
| work | `pricing.manage` | create sheets; edit a draft, its lines, prices, quotes, offers, selections; link catalog items; import BOQ; submit; **return** a submitted sheet to draft; **cancel a draft**; delete a draft |
| manage | `pricing.approve` | approve; **cancel a submitted or approved sheet**; set the minimum margin |

His `transition()` was read for the rest: return needs `manage || approve`
(here: work, which manage includes); cancel of a draft needs `manage || approve`
(work); cancel of a submitted or approved sheet needs `approve` (manage);
approve needs `approve` (manage); submit needs `manage` (work). The delete
button needs `pricing.manage` and only drafts (work). Self-approval is allowed
and shown with a badge, as in his.

Cost and margin are not hidden from anyone who can open Pricing: view reads
them (decision 2). The transition functions check the grant themselves; the
save functions run as the caller, so RLS decides.

## Decisions made while building

1. **Section-key constraints are rebuilt from what they hold plus the known keys.**
   The local database is shared by several branches and the live constraint
   held `documents` but not `catalog`. Writing a fixed list would have dropped
   another branch's key (and failed on its rows), so the migration reads the
   current keys, adds `catalog` and `pricing`, and writes them back. It leaves the
   list as `…, 'crm', 'catalog', 'pricing'` plus anything else already there.
2. **Lookups for people without CRM, Contacts or Catalog.** A pricing user must
   see the opportunity, supplier and catalog item names, so those are
   security-definer functions that check the Pricing grant (the CRM's
   `crm_clients` is the model). Supplier validity uses `contacts_org_is_active()`
   inside a definer function, because that function runs as the caller and would
   say "no" to someone without Contacts.
3. **Status values are written only by the transition functions** (the client has
   no update grant on the workflow columns). The guard still enforces every rule.
4. **Guards are security definer** so they can see the opportunity, the supplier
   and the numbers whatever the caller's other grants are.
5. **Issue codes stay upper case** (`UNPRICED` …): they are labels, not statuses.
6. **Currencies:** global `currencies` table (SAR, USD, EUR, GBP, CNY, AED, TRY,
   JPY), read by any login, no writes from the app. SAR is the base for every
   company. A new quote needs an active currency; an existing quote may keep a
   currency that was switched off (as his update does).
7. **Deleting a login** sets the person's columns to null; the sheet guard lets
   that one change through, so a removed user does not break locked sheets.
8. **BOQ import (the one difference in how it works).** His import takes an
   Excel or CSV file and needs `data.import`. Ours needs Work, and takes a **CSV
   file or rows pasted from Excel (tab-separated)** with the same columns,
   Arabic or English headers in any order, the same row checks (one bad row imports
   nothing; the row number is reported; at most 2,000 rows). "Download template"
   gives an `.xlsx` from our writer `src/lib/xlsx.js`. An `.xlsx` cannot be
   uploaded: save it as CSV, or paste the cells.
9. **Stopped catalog items:** "link a catalog item" (his applyCatalog) accepts only
   active items. The lines editor, like his, lists active items and any already
   used; the database accepts any item of the company there.
10. **Lead ordering and bid chip:** the list's order and the due-date colouring
    follow his (work in progress first, nearest bid first, red when past, amber
    within 7 days).

## Waiting for their modules (not built, not faked)

- AI pricing review: the company AI agent comes last.
- The technical offers panel on the sheet and `pricing_settings.tech_reply_alert_days`:
  Tech offers module.
- Financial offer / quotation from an approved sheet: Quotations module.
- Exchange-rate suggestions (his `fx-hint` on the quote): accounting module; the
  rate is typed on each quote.
- Project files and the project's use of the approved sheet (`0035`, `0048`
  spend views): Projects module. `cost_category` is stored and ready for it.

## Tests (2026-12-01)

- `dev/erp-pilot/pricing/run-tests.sh`: **213 checks, 0 failed.** It builds its
  own opportunities, suppliers, items and a throw-away company inside a rolled-back
  transaction, so it needs no live data. Covers each level (view reads and cannot
  write; work edits drafts, submits, returns, cancels a draft; only manage approves,
  cancels submitted/approved and sets the margin), company separation, the full
  workflow with every lock, all ten issue codes (blocking vs warning, the margin
  note freeing below-cost and below-minimum), the cost math (spread by value, 40→44,
  alternative 35→38.5, unknown rate or charges → unknown cost, a USD quote 8×3.75=30,
  totals only when every line is known), SAR forced to rate 1, the rate dropped with
  a changed currency, selection rules, one main offer per line, a closed opportunity,
  a non-supplier and an archived supplier refused, delete-draft-only, company delete,
  RLS and grants on every pricing table, the history, and the search.
- `npx vitest run`: 211 files, 3,838 tests passed (28 of them in
  `src/lib/pricing/logic.test.js`; the Arabic of every word is checked by
  `i18n.test.js`).
- `npx eslint src`: 0 errors (7 warnings that were already there).
- `npx vite build --mode v2`: builds.
- `dev/erp-pilot/catalog/run-tests.sh`: 62 passed, 0 failed.
- `dev/erp-pilot/hr/run-tests.sh`: **fails at a check about HR documents
  (`DOCUMENT_HR_MOVED`)**. That comes from another branch's migration
  (`20261201_documents_3_hr_move`) already applied to the shared local database; it
  is not in this branch and pricing does not touch HR documents.

Checked in the app at :5188 (English, Arabic right-to-left, phone width 375):
as the admin (list, sheet, submit and return, compare, quote, lines, CRM panel)
and as a view-only login (`staff.marketing`, granted view in Arak Lighting and
then removed): sees cost and margin, no buttons that write, no price inputs.
No horizontal page scroll at phone width.

## Seed data

`dev/erp-pilot/pricing/seed.sql` adds two sheets on existing test
opportunities and three supplier quotes (one in USD), every title ending
"(test)", Arak Lighting only. `unseed.sql` removes them. The seed is currently
loaded in the local database.
