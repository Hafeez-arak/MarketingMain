# HR: Musa's HR rewritten into v2, in our own stack (2026-10-28)

The owner chose two ways to bring Musa's ERP into v2. The CRM pilot
(`v2-crm-pilot`) loaded **his** schema into an `erp` schema. For simple
modules the other way: **our own clean tables in `public`**, his business rules
read from his code and rewritten. This is that second way, for HR: Employees,
Leave and Attendance, as one v2 section "HR" / "الموارد البشرية" (key `hr`).
Local only. No pay, payroll or money of any kind (out of scope by the
owner's decision).

## How to see it

```sh
dev/v2db/apply-migrations.sh               # the three 20261112_hr_* files (already applied locally)
docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/erp-pilot/hr/seed.sql
npx vite --mode v2 --port 5182 --strictPort
```

Sign in at http://localhost:5182 as `staff.admin@arak-sa.com` (password
`arak-v2-local`, an admin: HR at Manage everywhere). The rail has **HR**
(id-card icon, between Insights and Admin). Pages: Employees (`/hr`),
Departments, Leave, Attendance, Expiring papers (Work and up), HR settings
(Manage). The top bar's العربية button switches every HR page to Arabic,
right to left.

Test data (invented, every name ends "(test)" / "(تجربة)", emails
`@example.invalid`): Arak Lighting has 5 departments (one archived), 9
employees (one who left), 9 papers (one expired, three expiring within 60
days), 10 contracts, 4 leave types, 2026 balances, 7 requests in every state,
and attendance from 1 September to today. Ghusn has 2 employees and one
leave type, to show company separation. `dev/erp-pilot/hr/unseed.sql`
removes it all (refuses if a non-test row exists).

To give someone HR: Admin → Section access (or Team & Access → person) →
HR → View / Work / Manage.

## Tests

```sh
dev/erp-pilot/hr/run-tests.sh      # 95 SQL checks, as real logins, in a rolled-back transaction
npx vitest run src/lib/hr          # 18 tests of the pure logic
npx vitest run && npm run lint     # full suite: 200 files, 3,606 tests; lint 0 errors (7 old warnings elsewhere)
```

The SQL checks run the way the browser does (role `authenticated`, the
login in `request.jwt.claims`): reading by level and company, every
refusal (writes by the wrong level, cross-company references, loops,
overlaps, self-approval, balance, reasons), the transitions and locks, the
correction history, and that deleting a company still cascades through
every HR table. Writing them found one real bug: the "cancel a pending
request" check compared the caller to an unlinked employee's login with
`=`, got NULL, and let a View person cancel someone else's request. Fixed
(null-safe comparison) before anything else was built on it.

In the browser (English and Arabic, as omar): the directory, an employee
page, approving a request (it moved to Approved, "Approved by omar"),
the who-is-off month grid (right to left in Arabic), the day view, adding a
missing departure (no reason asked, kept as a "departure"), a correction
(reason required, marked "Corrected", before/after kept), the monthly
sheet, expiring papers, settings. Over the local API with real logins: the
admin reads 9 employees; sara (member, no HR grant) and a sales seat read
0 and are refused by the decision function.

## What was built

**Database** (`supabase/migrations/20261112_hr_1_core.sql`, `_2_leave.sql`,
`_3_attendance.sql`; ten `hr_` tables, all with RLS):

| Table | What |
|---|---|
| `hr_departments` | names EN/AR, head, archived (never deleted) |
| `hr_employees` | names EN/AR, number, job title, department, manager, hire date, status active/ended + end date/reason, work email/phone, optional login, notes |
| `hr_documents` | type, number, issue/expiry date, notes |
| `hr_contracts` | fixed/open, start/end, notes (no pay) |
| `hr_settings` | the work week: days, start/end, grace minutes |
| `hr_leave_types` | names EN/AR, paid, keeps a balance, in use |
| `hr_leave_balances` | days granted per employee, type, year |
| `hr_leave_requests` | dates, days, reason, status, who decided/cancelled, note |
| `hr_attendance` | one per employee per day: status, in/out, notes, source, who corrected/why |
| `hr_attendance_changes` | every change to a saved record: kind, reason, before, after, who, when |

Company separation three ways: `workspace_id` on every row; RLS through
`has_section(ws, 'hr', level)`; and **composite `(workspace_id, id)` foreign
keys** between HR rows, so a row can never point at another company's
employee, department or leave type (plain Postgres, no trigger needed). The
browser code filters every query by `workspace_id` as well.

Levels: **View** reads the section (directory, departments, leave,
attendance); **Work** does day-to-day entry (employees, papers, contracts,
attendance and corrections, leave for anyone) and reads papers and
contracts; **Manage** sets it up and decides (departments, leave types,
balances, work week, approving/rejecting, cancelling approved leave,
linking a login, deleting a mistaken attendance record). A login linked to
an employee also reads their own papers and contracts, and with View asks
for their own leave; a linked direct manager with View decides their team's
requests.

Two SQL functions carry the rules that must not be stepped around (no
update policy on those tables): `hr_leave_decide(ws, id, action, note)` and
`hr_attendance_update(ws, id, …, reason)`. Helpers: `hr_my_employee`,
`hr_is_manager_of`, `hr_leave_balance`, `hr_logins` (Manage: logins with
emails, to match by work email), `hr_today` (Riyadh).

**Screens** (`src/pages/hr/`, words in `words.js`, EN + AR complete and
checked by `src/lib/i18n.test.js`): `Employees`, `Employee` (profile, team,
login link, leave this year, attendance this month, papers, contracts),
`Departments`, `Leave` (requests with approve/reject/cancel, who-is-off
month grid, balances table), `Attendance` (day view with record/correct and
history, monthly sheet for everyone or one person), `Documents` (expiring
papers), `Settings` (work week, leave types). Logic in `src/lib/hr/logic.js`,
reads and writes in `src/lib/hr/client.js`.

**Shared files, small separate additions** (to merge with Contacts):
`src/lib/modules.js` (one SECTIONS entry), `src/App.jsx` (7 imports + 7
routes), `src/lib/sectionAccess.js` (`'hr'` in GRANTABLE),
`src/components/layout/icons.jsx` (one `id-card` icon), and the tests that
list sections (`modules.test.js`, `sectionAccess.test.js`, `i18n.test.js`).

## His HR vs ours, feature by feature

| Feature | Musa (Laravel) | Ours (v2) |
|---|---|---|
| Departments | name, English name, parent, manager, active | **Matched (parity pass):** names EN/AR, parent (no loops), head, archived |
| Job positions | a table of positions per department | **Matched:** positions (names EN/AR, department, description, archived); the employee picks one |
| Employee file | ~25 fields incl. national ID, nationality, birth date, gender, IBAN, emergency contact, address, direct/indirect labour, employment type | **Matched except IBAN:** trade, employment type, direct/indirect, and the personal file (Manage only). IBAN left out (payroll) |
| Employee number | automatic `E-…`, never changes | **Matched:** `E-YYYY-NNNNNN` by the system, never changes (old numbers kept) |
| Reporting line | no loops (trigger) | same |
| End of service | date + reason required; re-hire clears them | same |
| Link to a login | one user per employee | same, matched by work email, Manage only |
| Papers | 7 types, number, issue/expiry, "Other" needs a note, 60-day warning, delete. **No file in his app** | same rules; Manage only; **our addition: an optional scan per paper** (private bucket) |
| Contracts | number, type, dates, **salary and allowances**, weekly hours, DRAFT→RUNNING→EXPIRED/CANCELLED, terms locked once running, one running | **Matched except pay:** `HC-` number, type, dates, weekly hours, the same workflow and lock, one running, no delete, list page, "ending soon". Salary and allowances: out of scope |
| Leave types | name, English name, paid, needs allocation, active | same (names EN/AR) |
| Balances | a ledger of allocations with validity windows; immutable, corrections as negative entries with a reason; "all employees" bulk grant | **Matched:** the same ledger, immutable, negative corrections with a reason, bulk grant, balance counted by windows |
| Requests | SUBMITTED→APPROVED/REFUSED/CANCELLED, APPROVED→CANCELLED; decided ones locked; refusal reason; days ≤ span; no overlaps; balance checked on approval; approvals serialised per employee | **same rules** |
| Who decides | anyone with `hr.leave_approve`, never their own | **Matched:** Manage only, never their own; the manager path is removed |
| Who asks | the employee (linked) or approvers / HR | same: Work for anyone, a linked View person for themselves |
| Balance beside each request | yes | yes ("N left after this") |
| Who is off | approved leave on the attendance board | a month grid + "off today" |
| Attendance records | check-in/out timestamps, several per day, no overlaps, one open, max 24 h, optional project | **one record per employee per day**, status present/late/absent/leave, in/out times. **No project, no several sessions, no night shifts** |
| Attendance rules | not future, employed, not on approved leave | same |
| Corrections | edit, device records become CORRECTED, audit log | **reason required**, who/when on the record, before/after in `hr_attendance_changes`; filling a missing departure is not a correction |
| Today board | check-in/out buttons per person | day view with Record / Correct per person (no one-click toggle) |
| Monthly report | days, hours, leave days, missing work days (needs the work week) | same, per person and for everyone |
| Work week | days, daily hours, start/end, grace, effective-from date | days, start/end, grace. **No effective-from date, no daily hours** |
| Lateness | flags table from device punches (late/early), excuses, emails to the employee | "N min late" computed from start + grace on screen; status late chosen by HR. **No flags table, no early-leave, no excuses, no emails** |
| Fingerprint device | yes (below) | **out of scope**; `source` column ready |
| Print views | daily and monthly print pages | none yet |
| Audit | a general audit log of every row | only attendance corrections and leave decisions keep their history |

## The fingerprint device: how his works, what it would take here

**2026-10-28: done.** Attendance, fingerprint device included, was rebuilt in full; see ATTENDANCE.md. The attendance rows of the table above describe the first port.

His (changes 0044–0046, `tools/attendance-bridge`, `AttendanceDeviceSyncController`):
a ZKTeco terminal on the office network is read **read-only** by a
PowerShell script on a Windows PC (vendor's 32-bit Standalone SDK,
`zkemkeeper.dll`), every 5 minutes as a scheduled task. It POSTs the punches
and the device's user list over HTTPS to `/api/attendance/device/sync` with
the **device's own key** (only its SHA-256 is stored; shown once; rotatable).
The server keeps every punch exactly as sent, never changed, duplicates
ignored; device users are linked to employees by their device number; per
employee and day (device's local date, device's time zone) the first punch
becomes check-in and the last check-out; a single punch or punches closer
than the "repeat punch" minutes stay in a review list; a day already entered
by hand is left alone; an HR edit marks a record CORRECTED and the pairing
never touches it again. Lateness/early-leave flags and emails come from the
punches. A CSV upload is the offline fallback.

For us it would take: (1) tables `hr_devices` (key hash, time zone),
`hr_device_users`, `hr_punches` (append-only); (2) **an ingest endpoint**:
the bridge cannot use a person's login, so it needs a SECURITY DEFINER SQL
function called with the device key (PostgREST can expose it to `anon`, with
the key checked inside and rate-limited), which avoids a new `api/` file;
(3) the pairing as a SQL function writing `hr_attendance` rows with
`source = 'device'` (the column exists), skipping days with a manual or
corrected record; (4) a review screen for unpaired days and a device-number
field on the employee; (5) his bridge script reused or rewritten (it is his
code: rewrite, the repo is public). About a day of work plus testing
against a real terminal.

## Traps found

- `apply-migrations.sh` records a file once; editing an applied migration
  does nothing. The files are written to be re-runnable, so a fixed file is
  re-run by hand (`psql … -f`) and stays correct for a fresh database.
- A BEFORE trigger runs before RLS's WITH CHECK: a refused insert can report
  the trigger's error instead of "row-level security".
- `x = auth.uid()` is NULL when x is NULL, and `IF NOT (NULL OR false)` does
  not raise: the cancel bug above. Use `is not distinct from`.
- `'YYYY-MM-31'` is not a date in a 30-day month: the month's last day comes
  from `monthDays()`.
- Postgres `date` and `time` are strings in JS; everything is compared as
  `'YYYY-MM-DD'` / `'HH:MM'` and "today" is Riyadh's (`riyadhToday`,
  `hr_today()`), never the server's UTC.
- The field class has `w-full`; appending `w-auto` does not win in Tailwind,
  so inline controls use `fieldInline`.
- Chrome's native time input ignores typed keys from automation; set the
  value through the native setter and dispatch `input`.

## Decisions for the owner (safe, reversible choices made)

1. **View reads everyone's leave and attendance.** Simple rule: View reads
   the whole section except personal papers and contracts. If ordinary
   employees should only see their own (self-service), the next step is a
   narrower rule for linked logins without Work.
2. **A direct manager decides their team's leave** (with at least View),
   besides Manage. His system had one approval permission. Removing the
   manager path is one line in `hr_leave_decide`.
3. **Balances are one number per year, changed in place** (who/when/note
   kept), not his immutable allocation ledger. A leave starting in December
   counts in that year even if it ends in January.
4. **Work can change an employee's manager**; only Manage links a login. A
   Work person linked to an employee could make that employee someone's
   manager and so approve that person's leave; it is recorded (`updated_by`)
   but not prevented. Moving manager changes to Manage closes it.
5. **No salary, IBAN, GOSI or payroll fields**, as decided; contracts keep
   only type and dates.
6. **Papers have no file upload** yet (a Storage bucket needs the
   `<workspace>/` prefix and `companyFolders()` entry; left for later).
7. **Seed data is a dev script, not a migration**, so production would get
   only the empty tables.

## Time

Wall clock, one agent session (with a pause for a usage limit):

| Step | Took |
|---|---|
| Read his docs, controllers, schema, device bridge; v2's idiom; the CRM pilot notes | ~12 min |
| Three migrations, seed, 95 SQL checks (found and fixed one bug) | ~12 min |
| Logic + 18 tests, client | ~5 min |
| Section registration, seven pages EN/AR, full suite + lint | ~10 min |
| Browser check EN/AR, API check with real logins, two small fixes | ~10 min |
| These notes | ~5 min |

About 55 minutes of agent time.

## Next HR step

Self-service for employees (a linked login sees only their own leave,
balance and attendance, without the whole directory), then the device
ingest above, then file upload for papers and the print views.


---

# Parity pass (2026-10-29, branch `v2-hr-parity`)

Goal: HR (employees, departments, papers, contracts, leave) the same as Musa's,
money excepted. Attendance was already done and is untouched (nothing in it
was forced to change). Read from his controllers (`Employee`, `Department`,
`Contract`, `Leave`, `RecordDelete`), models, `arak_schema.sql` (HR block),
changes 0018/0036/0043, his tests (`HrTest`, `HrTimeTest`,
`ScreenReviewHrAccountingTest`) and his guide pages. His code was read, never
copied; nothing was written there.

## The mapping of his permissions onto our levels

| His permission | Ours | What it gives |
|---|---|---|
| `hr.view` | **View** | directory (work data), departments, positions, own leave, "who is off" |
| `hr.attendance` | **Work** | attendance entry and corrections (already built) |
| `hr.manage` | **Manage** | employee files incl. the personal file, papers (+files), departments, positions, end of service, delete an unused person, link a login |
| `hr.contracts` | **Manage** | contracts, their list and history |
| `hr.leave_approve` | **Manage** | decide and cancel leave, leave types, grants, balances |

Three levels cannot split his five, so his three Manage-like ones are one. Work
is now only attendance: it no longer adds people, papers, contracts or leave
for others (the first port let it). That also closes the manager/self-approval
risk (item 5): only Manage changes a manager, and a manager decides nothing.

## Gap list: found and closed

| # | Gap | Closed by |
|---|---|---|
| 1 | Contracts had only type and dates, state from dates | `20261129_hr_parity_3_contracts.sql`: number, weekly hours, draft/running/expired/cancelled, terms locked, one running, no delete; Contracts list + contract page; old rows mapped by their dates |
| 2 | Balances were one number per year | `_4_leave_ledger.sql`: immutable allocations with windows, negative corrections, bulk "all active", balance by windows; old balances became allocations (the old table is kept, closed) |
| 3 | Manager could decide leave | removed; only Manage decides (his `hr.leave_approve`), never their own; Work cannot cancel others' pending requests |
| 4 | No file on papers | **his papers have none** (only his finance documents take an image); added as an optional scan: private bucket `hr-papers`, `<workspace>/<employee>/<id>.ext`, 10 MB, PDF/JPG/PNG/WebP, Manage writes, the person reads their own; `companyFolders()` includes it |
| 5 | Work could change managers | see mapping: Manage only |
| 6a | Employee number editable | system number `E-YYYY-NNNNNN`, never changes |
| 6b | Free-text job | job positions table (+ Departments page section); `job_title` kept in step by a trigger so attendance screens are unchanged |
| 6c | Department parent | `parent_id` (loops refused) |
| 6d | Employee fields | trade, employment type, direct/indirect labour; personal file table, Manage only (notes moved there) |
| 6e | Delete a never-used employee | `hr_employee_delete()` (the foreign keys decide) |
| 6f | History on employee and contract | `hr_audit` + History panel (Manage) |
| 6g | Directory | direct/indirect, papers-expiring and no-running-contract filters, grouping, cards/list, renewal alert box, "no running contract" badge |
| 6h | Leave list | filters (waiting, approved, rejected, current, mine), grouping with approved days, search; leave types lock paid/needs-balance after creation |
| 6i | Departments page | parent, positions, people counts |

Parity-table rows above marked "first port" describe the state before this pass;
every row of gaps 1 to 6 is now matched, except what is listed below.

## Built

Migrations (apply with `dev/v2db/apply-migrations.sh`):
`20261129_hr_parity_1_people.sql`, `_2_papers.sql`, `_3_contracts.sql`,
`_4_leave_ledger.sql`. New tables: `hr_counters`, `hr_job_positions`,
`hr_employee_private`, `hr_audit`, `hr_leave_allocations` (composite
`(workspace_id, id)` keys, RLS on all). New functions: `hr_next_number`,
`hr_employee_delete`, `hr_leave_allocate`, `hr_leave_balance_on`,
`hr_running_contracts`, `hr_papers_folder_ok`; `hr_leave_decide` rewritten.
Screens: Employees, Employee, Departments (+positions), Contracts, Contract,
Leave (ledger), Settings, Expiring papers (Manage). Words in `wordsParity.js`
(EN + AR). Tests: 213 SQL checks, logic tests, full suite, lint 0 errors, build OK.

Checked in the running app (:5186): Manage in English and Arabic (RTL), a View
person (no write buttons, no papers/contracts, own leave only, contracts page
refused), phone width (no sideways scroll), saving the personal file and
seeing it in the History, and the bucket rules with real logins (Manage
uploads and reads; Work, a bad folder and a .zip are refused).

## Waiting on other modules (listed, not faked)

- Salary, allowances, monthly gross, "In the payroll" on a contract, GOSI
  category, payroll-gap badges, IBAN: payroll is out of scope.
- Assets in an employee's custody (and the end-of-service block while they
  hold assets): needs the fixed-assets module.
- Project on an attendance record: projects (unchanged from attendance).

## Not matched, on purpose

- View still reads everyone's leave requests: attendance needs approved leave
  (RLS and the `hr_punch_days` view) and attendance is not to be touched. His
  non-approvers see only their own list; ours shows a non-Manage person only
  their own requests and balance on screen, but the API still returns more.
  Narrowing needs an on-leave view for attendance: the owner's call.
- Department loops are refused (his forbids only a department under itself).
- A leave type's two flags are locked in the database; he locks them only by
  not offering the field. Renaming is allowed.
- A person still reads their own papers and contracts (not in his).

## Decisions for the owner (all safe and reversible)

1. Collapsing his three Manage-like permissions into our Manage; Work =
   attendance. A clerk with files but not leave would need a fourth level.
2. Paper scans are our addition (his has no upload); dropping the bucket and
   the `file_*` columns removes it.
3. First-port contracts: past -> expired, current -> running, future -> draft.
4. IBAN left out with the other pay data.
5. `seed.sql` now writes the ledger and positions; not re-run on existing data.
