# Technical and Finance (v2)

Built 2026-10-19 on branch `v2`, against the local database (`dev/v2db`) and
the fake Odoo only. Never run against production; not merged into main.

The owner's answer that shapes both: **Odoo manages the projects and the
accounts; Campai watches them** (submittals, delays, reminders, follow-ups).
Nothing is written back to Odoo.

## Where the data comes from

The hourly Odoo mirror (`api/leads/_odooSync.js`, models in
`src/lib/control/odoo.js` → `SYNC_MODELS`) now also reads:

| Model | For |
|---|---|
| `project.project.stage` | Arak's project stages, matched to the nine |
| `project.project` (+ stage date, analytic account, sales order where Odoo has them) | the projects, their manager and dates |
| `project.task` | open / late Odoo tasks per project |
| `project.update` | Odoo's own status updates (count as the weekly update) |
| `res.users` | matching an Odoo project manager to a Campai login, by email |
| `account.payment` (customer) | collected this month |
| `account.analytic.line` | each project's income and costs to date (actual margin) |
| `sale.order` (+ margin, project where Odoo has them) | planned margin, and which invoices belong to which project |
| `account.move` (+ total, origin) | invoices, what is still owed |

**Optional fields.** Fields that come with other Odoo apps or versions
(Sales margin, Sales↔Project, 17's `analytic_account_id` vs 18's
`account_id`) are asked for only when `fields_get` says this Odoo has them.
Asking Odoo for a field it lacks fails the whole read, so without this one
missing app would stop the hourly round.

**Paging.** The API returns at most 1,000 rows per request. `readMirror`
used to ask for 50,000 in one request and silently got the first 1,000; it
now pages (`readAll` in `api/leads/_technical.js`), and so does the browser
(`src/lib/odooMirror.js`).

## Who sees what (migration `20261105_technical_finance.sql`)

| Section level | Technical | Finance |
|---|---|---|
| view / work | only projects where they are the **Project Manager in Odoo** (Odoo user matched by login or email); work may record submittals and write the update | — |
| manage | every project; stage limits and reminder timings | — |
| view | — | invoices, payments, analytic lines, sales orders, project names |
| CEO view | everything | everything |

The mirror is now read per model (`odoo_record_visible`): money
(`account.*`) is Finance's and the CEO's; Sales keeps deals, stages and
orders, and **no longer reads invoices** unless it also has CEO or Finance.

## Technical

**The nine stages** (`src/lib/technical/projects.js` → `STAGES`): Awarded →
Technical submittal → Client review → Purchase order → Production & shipping
→ Delivery to site → Installation & commissioning → Handover → Collection &
maintenance. They are **Odoo's project stages**: name them in Odoo Project.
Campai matches names in English or Arabic, or, when Odoo has exactly nine
unnamed ones, takes them in order. Technical → Stage limits shows which
Odoo name matched which stage, and any that matched none.

**Red / amber / green** (`projectHealth`):

- red: longer in its stage than the stage allows · delivery date passed
  before Handover · the latest update says off track · a C/D resubmission
  overdue;
- amber: at 75% of the stage's days · at risk · no weekly update for 7 days
  · a submittal with the client 10 days · a resubmission due · stage not one
  of the nine.

Default days per stage: 7, 14, 14, 7, 60, 14, 30, 14, 60. Technical managers
change them, and the reminder timings, on Technical → Stage limits.

**When a project entered its stage** (`project_stage_log`): the monitor
round records it when the mirror sees the stage change. A project seen for
the first time takes Odoo's `date_last_stage_update` when Odoo has it, else
its last change, marked "about".

**Submittals** (`project_submittals`): per item (Lighting fixtures, Shop
drawings…), each round with its submitted date, the client's code and the
return date. A = Approved, B = Approved as noted, C = Revise and resubmit,
D = Rejected.

**Weekly update** (`project_updates`): on track / at risk / off track, what
moved, what is next, what is holding it. An update written in Odoo
(`project.update`) counts too; the newest wins.

**Reminders and follow-ups are Tasks** (`public.tasks`, section
`technical`, `odoo_project_id`, made once each through `auto_key`), so the
Tasks system's due-soon, overdue and morning digest apply:

| Made by | When | Task | Closed when |
|---|---|---|---|
| monitor round (`api/leads/_technical.js`, after each mirror round) | a stage over its days | "‹project›: N days over in ‹stage›" | the stage moves on |
| monitor round | no update for 7 days | "Weekly update for ‹project›", due next day | the update is written (database trigger, at once) |
| monitor round | a submittal with the client 10 days | "Chase the client: ‹item› (round N)" | a code comes back (trigger) |
| database trigger, at once | a C or D code is saved | "Resubmit ‹item› (round N+1)", due in 7 days, high | the next round is recorded (trigger) |

Each goes to the project's manager in Campai; when Odoo's manager has no
Campai login it stays unassigned (Technical managers see it) and is given to
them once they do. The bell says "Campai gave you a task".

**Pages:** Technical → Projects (`/technical`), a project
(`/technical/project?id=`), Submittals, Stage limits (manage). The rail's
Technical icon counts red projects.

## Finance

Read only (`src/lib/finance/finance.js`), all amounts with VAT:

- **Invoices & collections** (`/finance`): invoiced and collected this
  month, outstanding (with the average days unpaid), overdue = unpaid more
  than **60 days past the due date**; how long the unpaid have been
  outstanding (days since the invoice date, in five bands); every unpaid
  invoice, oldest first, linked to Odoo.
- **Project margins** (`/finance/projects`): per project, invoiced and
  collected from its sales order's invoices (refunds taken off), % collected,
  % of the order invoiced; **planned margin** = the order's margin when quoted
  (Odoo Sales margin), **actual** = income less costs on the project's
  analytic account to date. **Red when the actual is more than 5 points under
  plan.** What Odoo is missing for a project (no order linked, no analytic
  account, no margin on the order) is said on its row.

## The CEO

- The daily alert lists **projects that turned red** first, once each time
  they turn red (`project_flags.alerted_at`), with the reason in Arabic and
  English.
- "Projects at risk" on his panel counts Technical's red projects.

## Checking it locally

```sh
node dev/v2db/seed.mjs                 # people (incl. technical@, pm.sara@, pm.khalid@, finance@)
node dev/v2db/fakeOdoo.js 8069 &       # the fake Odoo
node dev/v2db/connect-fake-odoo.mjs
node dev/v2db/odoo-round.mjs           # one mirror round + the monitor
node dev/v2db/check-sections.mjs       # who reads/changes what, every login
node dev/v2db/check-technical.mjs      # submittal codes → follow-ups, update closes its reminder
npx vite --mode v2 --port 5180
node dev/v2db/check-api-gates.mjs      # Email's section gate (needs the dev server)
```

## Before it goes live

1. Arak uses **Odoo Project** with stages named as the nine (or nine stages
   in that order), and each project's **Project Manager** set to an Odoo user
   whose login or email is their Campai login.
2. **Odoo Accounting** in use, projects linked to their sales order, an
   analytic account per project, and Sales margin installed for planned
   margins.
3. The permanent Odoo key (the mirror's prerequisite since step 3).
4. Apply `20261104`, `20261105` with the rest of v2.

## Not done

- Reminder task titles are written in English (the bell and Tasks show them
  as written).
- Odoo records deleted in Odoo stay in the mirror (true of the mirror since
  it was built): an incremental read sees changes, not deletions.
