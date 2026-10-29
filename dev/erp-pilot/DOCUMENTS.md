# Documents («المستندات»): Musa's Documents app, rewritten in our stack

2026-10-29, branch `v2-documents` (from `v2` at 26e4e65). **Musa's commit
read: `43ae96d` (2026-10-29 02:06 +0300)**, read only: schema
`0058_company_documents.sql` and its test, `CompanyDocumentController`,
`DocumentTypeController`, `DocumentAttachmentController` (that one is for
finance documents, not this app), the employee-paper parts of
`EmployeeController`, his models, views, routes, the daily alert command and
his Arabic wording. Exactly his module, our stack, nothing extra; ideas of my
own are under "Suggestions (not built)".

## How to see it

```sh
dev/v2db/apply-migrations.sh            # 20261201_documents_1 … _4
docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/v2db/seed-documents.sql
npx vite --mode v2 --port 5188 --strictPort
```

http://localhost:5188, `staff.admin@arak-sa.com` / `arak-v2-local`. The rail
has **Documents** (grid launcher, pin, Ctrl/Cmd+K "Documents"). The seed also
gives `staff.dev@` Work and `staff.marketing@` View (to try the member
paths); take them away again with `delete from section_access where section = 'documents'`.

## Permissions on our levels (as CRM did)

| His | Ours | What it gives |
|---|---|---|
| `documents.view` | **View** | read and open ordinary company / supplier documents |
| `documents.manage` | **Work** | upload, confirm, renew, archive, edit those; document types and alerts |
| `documents.confidential` | **Manage** | confidential documents **and employees' papers** (brief: the highest level); the access log and history |
| `hr.manage` reading employee papers | HR Manage | reads employees' papers that are not confidential (the employee page and Expiring papers); cannot change them |

A person also reads their own non-confidential papers (HR's rule, kept).
Every open or download of a confidential or employee document is logged, and
the file does not open without the log (storage policy asks for it).

## Parity checklist (his item → ours)

Legend: ✅ done · ⏳ waits on something · ≈ same with the difference our stack forces.

| His | Ours |
|---|---|
| Document types: own list per company, names in both languages | ✅ `document_types` per company, `name` + `name_en` |
| Per type: required fields (number, issuer, issue date, expiry), allowed links, "company requires it", alert days, task days, confidential by default, active | ✅ all, edited on Document types |
| Per type: number pattern, "matches the company's CR/VAT" | ⏳ columns and seeded values kept; no field on screen: they work only with reading the file's text (owner decision 1) and a company profile with CR/VAT numbers (v2 has none) |
| Suggested types for every company (19), alerts 90/30/7, task at 30; "add the missing suggested types" | ✅ data, made for every company now and for each new one; the button never overwrites |
| A type in use is stopped, never deleted | ✅ no delete grant |
| Documents `DOC-YYYY-NNNNNN`, draft → confirmed | ✅ gap-free per company and year (counter row in the insert's transaction) |
| Archive with a reason, never deleted; only a draft is deleted | ✅ in the database (triggers) |
| Number, issuer, dates only from the current confirmed version | ✅ trigger; direct writes refused |
| Type and link of a confirmed document never change; type active and allows the link; responsible belongs to the company | ✅ |
| Links: company, employee, supplier | ✅ composite `(workspace_id, id)` keys to `hr_employees` and `contacts_orgs`; supplier must hold the supplier role |
| Link: fixed asset | ⏳ **waits on Fixed assets**: the kind, the type setting and the `asset_id` column exist; no document can take that link yet (`DOCUMENT_ASSET_WAITS`); two suggested types (vehicle registration; insurance may also name assets) are only usable for other links meanwhile |
| Versions: one file (PDF or picture), append-only, pending until confirmed, then final, previous superseded | ✅ |
| Same file twice refused | ✅ SHA-256 computed in the browser, unique per document |
| Every field's source FILE / AI / MANUAL | ≈ stored (`file`/`ai`/`manual`, validated); with no reading built, every field is `manual` |
| Reading the number and dates from the PDF's text (FILE) | ⏳ needs a PDF text reader = new npm package → **owner decision 1**; not built, not shown |
| Reading by the AI assistant | ⏳ waits on the company AI agent (built last); not built, not shown. The rule that a confidential/employee document is never sent is easy to add then |
| Hijri / Gregorian dates, either may be typed | ✅ Umm al-Qura through the browser's own calendar (no package), both ways, mismatch refused |
| Alerts once per document, expiry and threshold, append-only; nearest sent, farther "covered" | ✅ `document_alerts`; his email → **a bell notice** (no email, per brief) |
| Renewal task at the type's days (TK-) | ✅ a v2 Task for the responsible, section `documents`, due on the expiry; once per expiry; also for an expired one |
| Daily 07:00 command | ≈ no scheduler in our stack: `documents_run_alerts_for(ws)` runs when anyone with Documents opens the list (safe to repeat), `documents_run_alerts()` is ready for a server cron (owner decision 2) |
| Access log of opening/downloading confidential or employee documents, append-only | ✅ + the file will not open without it |
| Three permissions | ✅ see above |
| Employee papers move into Documents: copied with type, number, dates, notes, files; old table stays and refuses writes | ✅ 9 local rows moved; scans stay in `hr-papers` and open through Documents; `hr_documents` refuses insert/update/delete (still goes with its employee/company) |
| HR employee page and Expiring papers read from Documents | ✅ and the directory's "papers to renew" filter and alert box (per type, not 60 days) |
| List: 5 figures, filters (search, type, link, state, responsible, "within N days"), table with state, days left, renewal task | ✅ search covers number, title, DOC- number, issuer, type, who it is for; ⏳ his search inside the file's text (needs reading files) |
| Upload (type, link, optional name, file; without a file you type it) | ✅ |
| Review: data beside a preview, confirm / save draft, discard | ✅ preview is the signed file; "AI reading" button absent |
| Document page: data, renew, download, archive, alert table, versions with sources, who opened it, activity | ✅ |
| Company-match chip (number vs the company's CR/VAT) | ⏳ no company profile in v2 |
| Files: private storage | ✅ bucket `company-documents`, `<workspace>/<document>/<file>`, 20 MB, PDF/JPG/PNG/WebP; added to the company-delete cleanup (`workspaceFiles.js`) |
| Search provider | ✅ `shell_search_documents` + palette group |

## What was built

| Layer | Files |
|---|---|
| Tables, keys, RLS, section key (check constraints on `section_access`, `tasks`, `meetings` replaced whole: ceo, sales, marketing, insights, technical, finance, hr, contacts, crm + **documents**), bucket | `supabase/migrations/20261201_documents_1_tables.sql` |
| Rules, numbering, history, pickers, seeds, alerts, open-file + storage policies, review-save RPC | `20261201_documents_2_rules.sql` |
| HR papers move; old table closed | `20261201_documents_3_hr_move.sql` |
| Ctrl/Cmd+K | `20261201_documents_4_search.sql` |
| Screen logic (states, filters, figures, checks, Hijri, alert schedule, files) | `src/lib/documents/logic.js` (+ test, 29) |
| Reads, writes, refusal words | `src/lib/documents/client.js` |
| Screens and words | `src/pages/documents/`: `Documents.jsx`, `DocumentNew.jsx`, `Review.jsx`, `Document.jsx`, `Types.jsx`, `parts.jsx`, `useDocumentsBase.js`, `words.js` |
| HR | `src/pages/hr/Employee.jsx`, `Documents.jsx`, `Employees.jsx`, `words*.js`, `src/lib/hr/{client,logic}.js` (+ tests updated) |
| Registration | `modules.js`, `App.jsx`, `sectionAccess.js` (`GRANTABLE`), `icons.jsx` (`folder`), Home colours, `shell/search.js`, `workspaceFiles.js` |
| Tests | `supabase/documents.test.js` (PGlite, 42), `dev/v2db/check-documents.mjs` (live, 51), i18n / modules / sectionAccess / search / workspaceFiles tests updated |
| Test data | `dev/v2db/seed-documents.sql` |

## Tests and results

- PGlite `supabase/documents.test.js`: **42/42** (separation, levels, numbering, every rule, access log + storage policy, alerts, the HR move, search, deleting a company; migrations run twice).
- `node dev/v2db/check-documents.mjs`: **51/51** with real logins (staff.admin@, staff.dev@, staff.marketing@, outside.two@), real Storage upload/sign; it gives and removes its own grants, deletes what it made (owner connection, triggers off for that one transaction) and puts the DOC- counter back.
- Full vitest **211 files, 3,857 tests**; lint 0 errors (7 old warnings); `npx vite build --mode v2` passes.
- In the running app on :5188 (Chrome): admin in English and Arabic (RTL): list and figures, a draft document, review with a Hijri date typed in Arabic digits and the "responsible required" refusal, confirm, the document page with its alert schedule and history, Document types; as `staff.marketing@` at View: no employee papers, no confidential document, no upload or types buttons.

## Time

About 2 hours of agent time (reading his module ~25 min, migrations + PGlite tests ~40 min, screens ~35 min, HR move + live check + browser ~25 min).

## Traps

1. **A null is not false.** `current_setting('documents.sync', true)` is null in a fresh session; `not null` skips the guard, so a draft's number could be written directly. Found by the PGlite test, fixed with `coalesce`.
2. **Storage cannot log.** A read policy cannot write a row, so the log is written by `documents_open_file()` and the storage policy requires that row from the last 5 minutes. Without it a direct storage call is refused (proved live).
3. **Deleting an employee.** A person with any document can no longer be deleted (the composite key); HR's "delete a never-used employee" says "used elsewhere". Old `hr_documents` rows still go with their employee/company.
4. **Companies with Contacts organisations cannot be deleted** (Contacts' known bug, CRM.md trap 5); the PGlite delete test uses a company without them.
5. **Section keys.** Whoever merges the next section must replace the three check constraints whole again with `documents` included.
6. **Test cleanup needs the owner connection**: a confirmed document is never deletable through the API.

## Decisions for the owner (all safe and reversible)

1. **Reading the number from a PDF's text (FILE).** Needs a PDF text reader package (e.g. pdf.js): not added. Say yes and the columns (`suggestions`, `extracted_text`, `number_pattern`) are ready.
2. **Who runs the daily alerts.** Today: on opening the list. For a true daily run, a server cron calling `select documents_run_alerts()` on the Oracle box.
3. **Employees' papers need Documents at Manage** to add or change (HR Manage only reads). His rule was `hr.manage`; the brief said the highest level. To restore his, give HR managers Documents Manage.
4. **Document types at Work** (his `documents.manage`), not Manage.
5. **Alerts are a bell notice, not an email** (brief), plus the Task.
6. **Moved HR scans stay in `hr-papers`** (a SQL migration cannot copy files); they open through Documents. A one-off copy script can move them later.
7. **No "company match" and no pattern fields on screen** until there is something to match.

## Could not match exactly, and why

Asset links, file-text reading, AI reading, the CR/VAT match chip, search inside file text, the 07:00 scheduler (all ⏳ above); his Laravel email; his per-role permission codes (three levels instead).

## Suggestions (not built)

- Fold in the "required documents" figure per link (e.g. each active employee needs an iqama).
- A "Documents" panel on a supplier's Contacts page (the `?supplier=` link already works).
- Copy the HR scans into `company-documents` and retire `hr-papers`.
- Let HR managers add a paper from the employee page without leaving it.
