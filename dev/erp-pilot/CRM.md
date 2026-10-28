# CRM (الفرص البيعية): Musa's CRM, rewritten in our stack

2026-10-28, branch `v2-crm` (from `v2` at c9b6d51). The third module done
the way Contacts and HR were: **our own clean tables in `public`**, our row
level security, our screens. Nothing of his runs; his CRM was read (views,
controllers, models, routes, schema §97 and changes 0001, 0018, 0034, plus
every other file that names `crm_`) for the parity list and the rules. The
pilot (`CRM-PILOT.md`, his schema loaded into `erp`) is not used.

The owner's rule: **exactly his module, in our stack, nothing extra.** The
only differences are what our stack forces, and parts that read modules v2
does not have yet (marked ⏳ below). Ideas of mine are under "Suggestions
(not built)".

## How to see it

```sh
dev/v2db/apply-migrations.sh                       # 20261125_crm_1_tables, _2_rules
docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/v2db/seed-contacts.sql
docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/v2db/seed-crm.sql
npx vite --mode v2 --port 5184 --strictPort
```

Sign in at http://localhost:5184 as `staff.admin@arak-sa.com` (password
`arak-v2-local`). The rail has a new section **CRM** (between Sales and
Marketing), with Pipeline, My opportunities, Planned activities, All
opportunities, Analysis, CRM settings. Arak Lighting has eight invented
opportunities (every state), Ghusn one. `staff.dev@` has the CRM at Work and
`staff.marketing@` at View in Arak Lighting (seed-crm.sql), to try the
member paths. The top bar's العربية switches every CRM page to Arabic.

## Where it sits, and why

His menu has CRM as **its own app** in the sales group (Pipeline, My
opportunities, Planned activities, All opportunities, Clients, Analysis,
Settings), with its own three permissions. So it is its own v2 section `crm`,
not pages under Sales:

- his three permissions map one-to-one onto our three levels
  (`crm.view` → view, `crm.manage` → work, `crm.settings` → manage);
- Sales keeps its own grant for the lead agent's pipeline (923 leads), which
  is left untouched;
- the section key is added to the three check constraints
  (`section_access`, `tasks`, `meetings`), replaced whole with every key
  already there plus `crm` (in `20261125_crm_1_tables.sql`).

How his CRM and our Sales > Leads relate is the owner's decision (below).

## His CRM vs ours: the parity checklist

Legend: ✅ same · ⏳ waits on another module (the CRM side is built as far as
it goes) · ≈ same, with the difference our stack forces (explained).

### Menu and access

| His | Ours |
|---|---|
| CRM app in the sales group: Pipeline, My opportunities, Planned activities, All opportunities | ✅ section `crm`, same four entries |
| Menu → Clients (the clients list) | ≈ a "Clients" link in the page header opens Contacts filtered to clients (shown to people with Contacts); a v2 menu can only list its own section's pages |
| Menu → Analysis (also under Reports) | ✅ Analysis (v2 has no Reports module; CRM's entry only) |
| Menu → Settings, readable by crm.view, edited by crm.settings | ✅ every level reads, manage edits |
| `crm.view` / `crm.manage` / `crm.settings` | ≈ view / work / manage of the `crm` section, enforced by RLS (his are PHP checks) |
| "Create client from the lead" also needs `clients.manage` | ≈ needs Contacts at Work |
| Activity log on the record needs `audit.view` | ≈ CRM Manage (as Contacts chose) |
| Home board: late sales activities on you; planned for you today; your open opportunities with nothing planned (manage only); each shown only when non-zero, each a link | ✅ on Home, under the greeting, same three, same links |

### Pipeline and list (his `index`)

| His | Ours |
|---|---|
| Search: title, number, contact, organisation, phone, client name, tag name | ✅ (client name in both languages, tag in both) |
| Filters: Open / Won / Lost · Mine / No owner · Late activity / No planned activity · Starred · Added this month; OR inside a group, AND across | ✅ same, in the URL |
| Group by stage / status / source / owner / priority (list) | ✅ |
| Two views: pipeline (kanban) and list | ✅ |
| No stages yet: empty state with a link to settings (settings permission) | ✅ |
| Pipeline shows open ones unless a status filter is on; at most 800 | ✅ |
| Columns: active stages, plus an archived one while something sits in it | ✅ |
| Column head: name, count, "+" (new in this stage), sum of known values, "+N?" unknown | ✅ |
| Column activity bar: late / today / planned later / none | ✅ |
| Card: title, stars, tags, party, value, owner or "No owner", status badge (closed) or next activity (late/today coloured) or "No activity", bid chip (open) | ✅ |
| Drag a card to another stage; drag onto "Won" (needs a client; refusal shown, card goes back) | ✅ (checked with synthetic drag events: move works; "Won" without a client shows the refusal in Arabic) |
| Four figures: open (and how many with no value), known expected value (before VAT), weighted (and how many lack a value or probability), late activities | ✅ (checked by hand: 1,925,000 / 732,500 / 2 on the seed) |
| List columns: number, opportunity, party, stage, owner, expected value, probability, bid due (chip when open), next activity (open), status | ✅ |
| 30 a page; grouped lists up to 1,000 with a count per group | ✅ |
| Hint under the board | ✅ |

### The record (his `show`)

| His | Ours |
|---|---|
| Edit (open), Won (open + client, confirm), Lost (reason required from active ones, details; message when none), Reopen (lost), Delete (open) | ✅ |
| Stage bar: click a stage to move (active + current; current and archived disabled); closed shows status + stage | ✅ |
| Won / Lost ribbon, stars, title, number · party, tags | ✅ |
| Details: client (link), organisation, contact, mobile, email, city, consultant, owner/developer, existing project · owner, source, expected value, probability, weighted (with its hint), expected close, bid due (chip), tender reference | ✅ all but "existing project" ⏳ Projects |
| Lost reason and details, closed on, notes | ✅ |
| Client card: none yet → "Create a client from the opportunity's details" and "link an existing client" | ≈ both, onto Contacts: create opens Contacts' own organisation form prefilled (type, name, phone, email, city, "Contact: …" note, Client role) with its duplicate guard, then links; link picks any active organisation |
| Client card: the quotation (link, status); "New quotation for the opportunity"; link an existing quotation of the client; "Financial offer from the approved pricing sheet" | ⏳ Quotations, Pricing |
| Pricing sheets card | ⏳ Pricing |
| Bank guarantees on the opportunity | ⏳ Bank guarantees |
| Technical offers card | ⏳ Technical offers |
| Activities: count planned; type, activity, date (late/today coloured), owner, outcome; "Done" with an optional outcome; delete a planned one (confirm); add form (type, activity, date = today, owner = the opportunity's owner or me) | ✅ |
| Tasks on the opportunity (his Tasks module, `tasks.lead_id`) | ⏳ v2's Tasks has no CRM link yet (its `lead_id` points at Sales' leads) |
| Activity log (the opportunity and its activities, field by field) | ✅ (stage, source, client, people… shown by name) |

### The form (his `create` / `edit`)

| His | Ours |
|---|---|
| Title, priority (Normal / ★ / ★★ / ★★★) | ✅ |
| Registered client, organisation, contact, mobile, email, city; "one is enough" hint | ✅ (client = a Contacts organisation) |
| Client locked once a quotation is linked | ⏳ Quotations |
| Consultant (with his hint), owner/developer | ✅ |
| Tender: bid due date, tender reference | ✅ |
| Follow-up: stage (active + current), source (active + current), owner, expected close, expected value (hint: empty is not zero), probability (hint: no suggested figure) | ✅ |
| Existing project (must be the client's) | ⏳ Projects |
| Tags (active + already chosen, coloured; hint when none) | ✅ |
| Notes | ✅ |
| New from a pipeline column (that stage) or from a client page (client, its name, phone, email, city) | ✅ |
| Defaults: first active stage, owner = me | ✅ |
| No active stage: back to settings with a message | ✅ message + link |
| Editing a closed one is refused | ✅ |
| Checks: title 255, contact/organisation 255, phone 30, city 100, consultant/owner/tender 255, email, value 0…999,999,999,999, probability 0–100, priority 0–3, someone to talk to | ✅ on screen and in the database |

### Planned activities (his `activities`)

| His | Ours |
|---|---|
| Not done only; mine unless "Everyone's"; Late / Today / Coming up; group by type / owner; search the activity, the opportunity's title or number; 50 a page; earliest first | ✅ |
| Columns: date, type, activity, opportunity (number · title, status badge if closed), owner, "Done" with outcome | ✅ |
| Empty state with the hint | ✅ |

### Settings (his `CrmSettingsController`)

| His | Ours |
|---|---|
| Stages, sources, loss reasons, tags; each with its hint | ✅ |
| Name (unique in its list), English name, max 120 | ✅ (unique per company, in the database) |
| Stage order (0–9999; a new one goes last: highest + 10) | ✅ |
| Stage "moves here on" event (pricing / technical / financial / revision), one stage per event | ✅ stored and enforced; the move itself is `crm_auto_stage()` ⏳ waits for the modules that raise the events |
| Tag colour (8) | ✅ |
| Switch on/off; never delete; active first, stages by order, the rest by name | ✅ |
| "Create the suggested stages" when there is none | ✅ (`crm_suggest_stages`, our own wording of the five names) |
| Read-only view for those without settings | ✅ |

### Analysis (his CRM report on the pivot engine)

| His | Ours |
|---|---|
| Dimensions: stage, status, source, owner, loss reason, month; rows and optional columns; swap | ✅ |
| Measures: count, expected (known only), weighted (known only), without value, won, win rate of the closed (computed per set, never summed) | ✅ |
| Filters open / closed; date range on the date added; quick ranges (this/last month, this quarter, this/last year); swapped dates noted | ✅ |
| Pivot with totals and a share column (additive measures); graph view (bars, stacked by up to 7 columns + other); three figures (total, number of rows, top with share) | ✅ |
| PDF / print, CSV | ✅ (print dialog, as v2's other reports) |
| Excel export | ✗ not built: his app writes .xlsx with its own writer; v2 has no spreadsheet writer and adding a package is out of the rules. CSV opens in Excel |

### His other CRM parts

| His | Ours |
|---|---|
| Client page: "Opportunities" summary button with the count (opens the list searched by the client), "New opportunity" (active client), the client's opportunities (number, title, stage, value, status) | ✅ on Contacts' organisation page (`OrgLeads.jsx`), for people with the CRM |
| Delete via his shared delete action (open only) | ✅ |
| Excel import of opportunities (his import framework: templates, preview batches, lookups by name) | ⏳ his Import module |
| Auto-stage when pricing starts, a technical offer is submitted, a financial offer is sent, a revision is issued | ⏳ Pricing / Technical offers / Quotations (function ready) |
| Demo data, user guide chapter | not CRM screens: our seed is `dev/v2db/seed-crm.sql` |

### His database rules

All in the database (`20261125_crm_2_rules.sql`), each proved in
`supabase/crm.test.js`:

| Rule | Ours |
|---|---|
| Starts open; won is final; lost changes only by reopening; reopen clears the loss | ✅ |
| Closed fields only when closed; a loss reason exactly when lost; loss note only when lost | ✅ check constraints |
| Won needs a client | ✅ check + trigger |
| Someone to talk to; title not empty; value ≥ 0; probability 0–100; priority 0–3 | ✅ |
| Number L-YYYY-000001, per company and year, gap-free; number and creator never change | ✅ |
| Only an active stage on insert / move | ✅ (plus source, loss reason and tags, his PHP checks, now in the database) |
| Assignee is a member of the company | ≈ an approved login of the company with the CRM (or the access admin) |
| No new opportunity for an archived client (on insert or a client change) | ✅ |
| A done activity is history; an activity stays on its opportunity; nothing new on a closed one (a planned one may still be marked done) | ✅ |
| A closed opportunity's tags are frozen | ✅ |
| Delete only an open one without done activities; planned ones and tags go with it | ✅ |
| Quotation belongs to the client and serves one opportunity; project belongs to the client | ⏳ Quotations, Projects |
| Audit trail | ✅ `crm_history` (kept after a delete) |
| Company isolation | ✅ RLS on every table, composite `(id, workspace_id)` keys between every CRM row and to Contacts, `workspace_id` in every query |

## What was built

| Layer | Files |
|---|---|
| Tables, keys, RLS, the section key | `supabase/migrations/20261125_crm_1_tables.sql` |
| Rules, numbering, history, pickers, suggested stages, auto-stage | `supabase/migrations/20261125_crm_2_rules.sql` |
| Screen logic (filters, board, figures, groups, form checks, pivot, CSV) | `src/lib/crm/logic.js` (+ `logic.test.js`, 30 tests) |
| Reads and writes, refusal words | `src/lib/crm/client.js` |
| Screens and words | `src/pages/crm/`: `Leads.jsx` (pipeline + list, three menu entries), `Lead.jsx`, `LeadForm.jsx`, `Activities.jsx`, `Analysis.jsx`, `Settings.jsx`, `HomeItems.jsx`, `OrgLeads.jsx`, `parts.jsx`, `useCrmBase.js`, `words.js` |
| Registration | `src/lib/modules.js` (one SECTIONS entry), `src/App.jsx` (9 routes), `src/lib/sectionAccess.js` (`GRANTABLE`), `src/components/layout/icons.jsx` (`kanban`), `src/pages/home/index.jsx` (one line), `src/pages/contacts/Org.jsx` (one line) |
| Tests | `supabase/crm.test.js` (PGlite, 21), `dev/v2db/check-crm.mjs` (live stack, 25), `src/lib/i18n.test.js` + `modules.test.js` + `sectionAccess.test.js` updated |
| Test data | `dev/v2db/seed-crm.sql` (not a migration) |

**Schema.** `crm_stages`, `crm_sources`, `crm_lost_reasons`, `crm_tags` (the
company's lists, `name` + `name_en`, `is_active`, unique name per company);
`crm_leads` (his columns minus `quotation_id` and `project_id`, which wait
for those modules; the client is `client_org_id` → `contacts_orgs` through
`(client_org_id, workspace_id)`); `crm_lead_tags`; `crm_activities`;
`crm_counters` (numbering, nobody reads it); `crm_history` (managers read
it, only triggers write it).

**Functions.** `crm_people(ws)` and `crm_clients(ws)` (security definer: the
pickers, for anyone with the CRM, including people without Contacts, as his
client picker needs no clients permission); `crm_member`, `crm_org_active`,
`crm_mark_client` (definer helpers the rules use); `crm_set_tags`;
`crm_suggest_stages`; `crm_auto_stage` (for the modules to come);
`crm_today` (Riyadh's day).

**The Contacts link** (CONTACTS.md "Next Contacts step"): the composite key,
the archived-client rule, "create a client" with Contacts' own form and
duplicate guard, and the organisation page's summary button and list. One
thing differs from that plan, on purpose: the plan said "won needs an
*active* client"; his rule checks archived only when the client is set or
changed, and won needs a client. That is what is built (exact parity).
Nothing was added to the `contacts_*` tables: Contacts' delete already
refuses an organisation an opportunity points at, through the foreign key.
Linking an organisation that is not yet a client adds the Client role to it
(one record, several roles), through `crm_mark_client`.

## Tests and results

- `supabase/crm.test.js` (PGlite: the three Contacts migrations and the two
  CRM ones, each run twice to prove they re-run, as six kinds of person):
  **21/21**. Company separation (reads, writes, every cross-company key, a
  row never moves company), the levels (no grant, view, work, manage, the
  history, the counters, no delete of lists), numbering (gap-free, kept),
  every opportunity rule, the client rules and role, won / lost / reopen,
  activities, delete with its cascade, the history's field diff, settings
  uniqueness and the one-event rule, the suggested stages, auto-stage, and
  deleting a whole company.
- `src/lib/crm/logic.test.js`: **30/30**.
- `node dev/v2db/check-crm.mjs` (the live local stack, real logins
  staff.admin@, staff.dev@ at Work, staff.marketing@ at View,
  outside.two@): **25/25**; it deletes what it made.
- Full suite: **204 files, 3,708 tests, all passing**. Lint: 0 errors (7
  warnings, all in older files). `npx vite build --mode v2`: passes.
- In the running app on :5184 as staff.admin@ (Chrome): the pipeline in
  English and Arabic (figures checked by hand); a record: moved by the stage
  bar, planned an activity, marked it done with an outcome, the log showing
  each change; in Arabic, "create a client from the opportunity's details"
  on a contact-only opportunity (Contacts' form prefilled), then Won (the
  record froze, no actions left); dragging a card to another column (moves)
  and onto Won without a client (refusal shown in Arabic); the list grouped
  by status; Planned activities for everyone; the analysis pivot (stage ×
  status, expected value); settings (saving a stage's event, then the
  "one stage per event" refusal); in English the new-opportunity form's
  errors ("name a contact…", "0 to 100"), a save (numbered, tagged), Lost
  with a reason, Reopen, Delete; the client page's opportunities and its
  "New opportunity" prefill; Home's two CRM items.

## How long it took

| Step | From | To |
|---|---|---|
| Read the pilot notes, Contacts notes, his CRM (views, controllers, models, schema, changes, report, import, home board, client page) and v2's idiom | ~11:55 | 12:07 |
| Migrations (tables, RLS, rules), applied, cascade checked | 12:07 | 12:11 |
| Logic + 30 tests, client | 12:11 | 12:14 |
| Words, screens, registration, Home, Contacts link; lint, build | 12:14 | 12:22 |
| PGlite tests (21), one fix | 12:22 | 12:24 |
| Seed and live check (25) | 12:24 | 12:27 |
| In the browser, two fixes | 12:27 | 12:34 |
| These notes | 12:34 | 12:40 |

About **50 minutes** of agent time.

## Traps

1. **`amber` is grey in this app.** `tailwind.config.js` remaps the amber
   scale to neutral greys (v1's accent); warning colour is `yellow`. The
   first build's "today" dates and soon-due chips came out black. Contacts'
   amber panels have the same problem (not changed here).
2. **`INSERT … ON CONFLICT DO NOTHING` uses up a number.** BEFORE INSERT
   triggers run before the conflict is found, so a skipped row still
   advances `crm_counters`. The app never upserts opportunities; the seed
   uses `where not exists`. Anything that bulk-loads opportunities later
   (an import) must do the same.
3. **Contacts' `contacts_org_is_active()` runs as the caller.** For someone
   with the CRM but not Contacts it always says "archived". The CRM uses
   its own definer `crm_org_active()`.
4. **A BEFORE trigger runs before RLS's check.** Someone without the CRM
   inserting an opportunity is refused with `CRM_STAGE_INACTIVE` (the
   trigger cannot see the stage) rather than "row-level security". Still
   refused; the screen never offers it to them.
5. **Rules must step aside for "delete company".** Won and lost
   opportunities and done activities cannot be deleted, so a company's
   deletion would fail; the guards and the history trigger check
   `crm_company_gone()`. **Found in Contacts, not fixed (not my table):**
   deleting a company that has any Contacts organisation fails, because
   `contacts_log()` writes a history row for the vanished company
   (`contacts_activity_workspace_id_fkey`). One line fixes it (return when
   the workspace is gone), for the Contacts owner.
6. **React Compiler and `useMemo`.** A dependency like `active.join()` is
   refused by lint; the list page computes without `useMemo`.
7. **Editing an applied migration does nothing** (`apply-migrations.sh`
   records names). The rules file was re-run by hand after a fix; it is
   written to be re-runnable.

## Decisions for the owner

Each taken the safe, reversible way.

1. **His CRM and our Sales > Leads.** *Taken:* two separate things. Leads
   (the lead agent's 923, Odoo push) stay exactly as they are; the CRM is
   its own section with its own opportunities. Nothing moves between them.
   *Options:* (a) a "Create opportunity" action on an approved lead that
   opens the CRM form prefilled (organisation, contact, phone, email,
   city, source), keeping a link back; (b) the CRM replaces the Pipeline
   part of Sales; (c) keep both apart.
2. **Its own section, not under Sales.** *Taken:* section `crm`, granted
   per person, nobody by default (`adminOnly`). Moving its pages under
   Sales later is a modules.js change plus RLS on `'sales'`.
3. **Who an opportunity can be given to.** *Taken:* approved logins of the
   company with any CRM level, and the access admin. Sales seats (not
   company members) cannot be; his CRM has no seat idea. HR employees are
   not used: his CRM assigns users, not employees.
4. **Linking a non-client organisation makes it a client** (adds the role
   in Contacts), since we keep one record with several roles.
5. **Activity log readers.** *Taken:* CRM Manage (his `audit.view`).
6. **Excel export of the analysis.** *Taken:* CSV and print only (no new
   package). A small hand-written .xlsx writer is possible if Excel files
   are wanted.
7. **Suggested stage names.** Our own wording of his five (New, Qualified,
   Site visit and design, Quotation sent, Negotiation).

## What could not be matched exactly, and why

- Everything marked ⏳: quotations (link, new, from pricing sheet, client
  lock), pricing sheets, technical offers, bank guarantees, existing
  project, tasks on the opportunity, the Excel import, and the automatic
  stage moves. v2 has none of those modules; each becomes a small addition
  once it exists (a column with a composite key, a card on the record).
- Excel export (decision 6).
- Permissions are our three levels, not his per-role permission codes.
- His "Clients" menu entry is a header link into Contacts.
- Assignee rule: "has the CRM in this company" instead of "member of the
  company" (our members are not all CRM users).
- `closed_by` and `done_by` are stamped by the database from the signed-in
  login, not sent by the screen (the browser writes directly, so it cannot
  be trusted with them).

## Suggestions (not built)

- Fold the Arabic letter forms in the search (أ/ا, ة/ه), as Contacts does.
- Show the bid chip's days in the list too, and let the "Won" drop zone
  open the client picker instead of only refusing.
- Remember the last pipeline filters per person.
- A "Create opportunity" button on Sales leads (decision 1a).
- Fix Contacts' company-delete bug and its amber panels (traps 1 and 5).
