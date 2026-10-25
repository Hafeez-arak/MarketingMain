# dev/v2db: v2's local database

v2 runs against a Supabase stack on this machine and never against
production. This folder holds that stack's config and the copy of
production's database structure it is built from. The copy has the schema
only: tables, functions, views, triggers, row level security, policies,
grants and storage bucket settings. It holds no rows from production.

## Start the stack

Docker must be running.

```sh
npx -y supabase@2 start --workdir dev/v2db
```

The project is `arak-v2` (`dev/v2db/supabase/config.toml`): API on
127.0.0.1:54321, Postgres on 127.0.0.1:54322 (`postgres` / `postgres`),
mail catcher on :54324. Studio, analytics, realtime and edge functions are
switched off: the app does not use them, and they are large downloads. The Postgres image is pinned to production's version
(17.6) in `dev/v2db/supabase/.temp/postgres-version` (`17.6.1.136`).
Note that `dev/v2db/supabase/.gitignore` ignores `.temp`, so that pin lives
only on this machine unless it is un-ignored.

## Load the schema

```sh
dev/v2db/apply-migrations.sh
```

The script runs in two steps:

1. **Baseline.** It loads `baseline/schema.sql` (production's structure),
   then `baseline/local-fixes.sql`, all in one transaction. It then records
   `baseline` and every migration listed in
   `baseline/applied-in-production.txt` in `v2dev.applied`. Those
   migrations are already inside the baseline. This step runs once.
2. **Newer migrations.** It runs every other file in `supabase/migrations`,
   in file-name order. Each file runs in its own transaction and is
   recorded in `v2dev.applied`. The script stops at the first failure. If
   one migration needs a local-only fix, put it in
   `dev/v2db/fixes/<file>.before.sql`; that fix runs just before the
   migration, in the same transaction.

You can re-run the script safely, because it skips anything already
applied. When it finishes, it tells the local API (PostgREST) to reload the
schema.

Why a baseline? `supabase/migrations` cannot build the database from
nothing. The first tables (`brand_profile`, `workspaces`,
`workspace_members`…) were created by hand in the dashboard before
migrations existed.

To start again from an empty schema:

```sh
docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/v2db/reset-public.sql
dev/v2db/apply-migrations.sh
```

`reset-public.sql` drops everything in `public`, the storage policies, the
`auth.users` trigger and `v2dev`. It keeps auth users and storage buckets.
`npx -y supabase@2 db reset --workdir dev/v2db` also works: this folder has
no migrations of its own, so the reset leaves an empty database, and you
then run the script.

## Run the app against it

`.env.v2` (git-ignored) holds the local URLs and the Supabase CLI's standard
local demo keys. `npx supabase@2 status --workdir dev/v2db` prints them.

```sh
npx vite --mode v2
```

`vite.config.js` refuses to start in v2 mode unless both
`VITE_SUPABASE_URL` and `SUPABASE_URL` point at localhost or 127.0.0.1.

## How the baseline was made

The baseline came from read-only catalog queries against production, run
through the Supabase MCP `execute_sql` tool. Nothing in production was
changed, and no application table was read. The queries are in
`baseline/generate-schema.sql`, which:

- reads `pg_catalog` (and `storage.buckets` for bucket id, name, public and
  limits);
- returns one DDL statement per row, in load order, built with
  `format_type`, `pg_get_expr`, `pg_get_functiondef`,
  `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_viewdef` (views keep
  their `security_invoker` option) and `pg_get_triggerdef`. Policies come
  from `pg_policy`, and grants are rebuilt from each object's ACL;
- empties `search_path` first, so every name comes out schema-qualified.

`baseline/build-schema.py` turns those rows into `baseline/schema.sql`.

Production also has an `archive` schema holding two retired test tables
(`generated_posts_test_ig_20261013`, `post_analytics_test_ig_20261013`).
The app does not use them, so the baseline leaves them out.

### Refreshing it later

1. Run `baseline/generate-schema.sql` against production, read-only, with
   the MCP `execute_sql` tool. The result is too large to show inline, so
   the tool saves it to a file.
2. Run `python3 -I dev/v2db/baseline/build-schema.py <that file> > dev/v2db/baseline/schema.sql`.
3. Update `baseline/applied-in-production.txt` to list every migration
   production now has.
4. Reset and reload (see above), then check parity.

### Checking parity

Run the same generator against the local database and compare the output
with `schema.sql`:

```sh
S=$(mktemp -d)
{ echo "set search_path = '';"
  echo "select json_agg(json_build_object('ord',ord,'sub',sub,'ddl',ddl) order by ord, sub) from ("
  sed '1,/^set search_path/d' dev/v2db/baseline/generate-schema.sql | sed '$d'
  echo "select ord, sub, ddl from out) z;"; } > "$S/gen.sql"
docker exec -i supabase_db_arak-v2 psql -X -q -U postgres -d postgres -At -f - < "$S/gen.sql" > "$S/rows.json"
python3 -I dev/v2db/baseline/build-schema.py "$S/rows.json" | diff dev/v2db/baseline/schema.sql -
```

On 2026-10-19, with only the baseline loaded, the two files were
byte-for-byte identical. After the newer migrations run, the only
differences are the objects those migrations add.

## Production vs local (2026-10-19)

| | production | local, baseline only | local, all migrations |
|---|---|---|---|
| public tables | 80 | 80 | 83 |
| columns | 1242 | 1242 | 1285 |
| views | 2 | 2 | 2 |
| functions | 40 | 40 | 42 |
| policies, public | 103 | 103 | 114 |
| policies, storage | 27 | 27 | 27 |
| triggers, public | 12 | 12 | 12 |
| triggers, auth.users | 1 (`on_auth_user_created`) | 1 | 1 |
| indexes | 239 | 239 | 244 |
| storage buckets | 8 | 8 | 8 |

Migrations missing from production on 2026-10-19:

- `20261025_ceo_control.sql`: held back on purpose until the CEO agrees the
  plan. It adds `company_targets` and `lead_routing_rules`, plus new columns
  on `leads`, `research_opportunities`, `sales_accounts` and `user_access`.
- `20261101_section_access.sql` to `20261105_technical_finance.sql`: v2's
  section access, tasks, the Odoo mirror, Marketing/Insights locked by
  section, Technical and Finance. In progress on v2.

Locally, `fixes/20261025_ceo_control.sql.before.sql` creates a placeholder
Arak company before that migration runs. The placeholder uses the
well-known id `00000000-0000-0000-0000-000000000001`, so the migration's
`company_targets` insert has a row to point at.

## Test people and data

```sh
node dev/v2db/seed.mjs
```

Makes ten logins and fills the company "Arak Lighting (test)" with invented
leads, key accounts, research projects, a research run and signals, a
competitor, a content plan, posts, a brand profile and an email contact. Every
name is made up; nothing is copied from production. It refuses any address
that is not this machine, and is safe to re-run (it also resets the section
grants to the table below).

| Login (password `arak-v2-local`) | Role | Sections |
|---|---|---|
| owner@arak.test | admin | everything |
| ceo@arak.test | member | CEO manage; Sales, Marketing, Insights, Technical, Finance view |
| salesmanager@arak.test | member | Sales manage; CEO view |
| marketing@arak.test | member | Marketing and Insights work |
| technical@arak.test | member | Technical manage (every project) |
| pm.sara@arak.test | member | Technical work: the fake Odoo's projects 401, 403, 405 (her Odoo login is a username; matched by email) |
| pm.khalid@arak.test | member | Technical work: projects 402, 404, 406 |
| finance@arak.test | member | Finance view |
| rep.omar@arak.test | sales seat | the sales team's app (sees all website leads) |
| rep.lina@arak.test | sales seat | the sales team's app (her own leads) |

## Run v2 against it

```sh
npx vite --mode v2 --port 5180
```

or the `v2-local` launch configuration. `vite --mode v2` reads the database
settings from `.env.v2` alone (git-ignored; it holds the Supabase CLI's
standard local demo keys, listed in `npx supabase@2 status --workdir dev/v2db`),
overwriting anything already in the environment, and drops the keys of every
outside service that could post, email, publish or spend (Zernio, Meta,
Resend, n8n, OpenRouter, Anthropic, Google…). It then refuses to start unless
every database address is this machine. The first run proved why: the
preview launcher's environment carried production's SUPABASE_URL.

`.env.v2`:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
PUBLIC_APP_URL=http://localhost:5180
```

## What was checked (2026-10-19)

Signed in as each test person against this database:

| | leads | key accounts | CEO targets | posts |
|---|---|---|---|---|
| owner | 12 | 5 | 1 | 3 |
| ceo | 12 | 5 | 1 | 3 |
| salesmanager | 12 | 5 | 1 | 3 |
| marketing | 0 | 0 | 0 | 3 |
| rep.omar / rep.lina | 7 / 3 | 0 | 0 | 0 |

In the app, marketing@ sees only Marketing and Insights, is sent Home from
/sales/leads, /ceo and /admin/sections, and gets 403 from the Sales and CEO
APIs. After the owner gave her Sales "View" on Admin > Section access she
read the 12 leads and 5 accounts, and still could not act on them.

## A fake Odoo (for the Odoo mirror)

v2 reads Odoo into a mirror (`odoo_records`, `api/leads/_odooSync.js`)
before Arak has a permanent Odoo key, and is never pointed at the real Odoo
while it is being built. `fakeOdoo.js` answers Odoo 18's JSON-RPC the way the
real one does for what the app uses (sign-in, `ir.model`, `search_read` with
domains, order, limit, `active_test`), with invented deals, quotes, orders,
invoices and projects:

```sh
node dev/v2db/fakeOdoo.js 8069 &
node dev/v2db/connect-fake-odoo.mjs
```

Then, signed in as ceo@arak.test, the CEO page's "Update now" (or the hourly
round) fills the mirror, and the four tiles that waited for Odoo show its
numbers. The tests use the same fake (`api/leads/_odooSync.test.js`).

Or run one round, and Technical's monitor after it, from the command line
(the same server code as the hourly round; refuses any address that is not
this machine):

```sh
node dev/v2db/odoo-round.mjs
```

Since 2026-10-19 the fake also has project stages (the nine), projects with
their managers, tasks and updates, Odoo users, customer payments and
analytic lines, and answers `fields_get`. Like the real one it refuses a
field a model does not have. Its dates are relative to when it starts, so
after restarting it, clear the mirror before a round (`delete from
odoo_records; delete from odoo_sync;`): the cursors from the last run are
newer than the restarted fake's changes.

## Checks (2026-10-19)

```sh
node dev/v2db/check-sections.mjs     # every login: what each reads and may change
node dev/v2db/check-technical.mjs    # submittal codes → follow-ups; the update closes its reminder
node dev/v2db/check-api-gates.mjs    # Email's section gate (with the dev server on :5180)
```

`check-sections.mjs` works out the expected answer from each person's
grants, so a rule that lets too much through fails as loudly as one that
blocks too much. On 2026-10-19 every answer matched: Marketing and Insights
tables (brand profile, plans, ideas, posts, social accounts, email
contacts, research runs, opportunities, signals, competitors), and the Odoo
mirror and project tables. The CEO reads Marketing but cannot change it;
the sales manager reads only the research Sales uses; Sara sees projects
401, 403 and 405 and can record only on hers; Finance reads invoices and no
project tasks; the sales team reads only what their app shows.

## Real data: a local copy of production (2026-10-25)

The owner's call: v2 is checked locally against the real rows before it goes
anywhere near production. One command rebuilds the local database as a copy
of production with v2's own migrations on top:

```sh
dev/v2db/prod-copy/copy-production.sh        # reads the main checkout's .env
```

- Production is only read (GET requests through PostgREST with the service
  key, and the auth admin API). The rows land in `dev/v2db/prod-copy/data/`
  (git-ignored) and in the local Docker database.
- Order matters. The script builds production's structure first (the
  baseline plus every migration on `origin/main`), then loads the rows, then
  applies v2's own migrations (the files on this branch that are not on main).
  Several v2 migrations fill their tables from existing rows (section access
  from today's roles), so they have to run after the data.
- After loading, it compares every table's row count with what was read and
  checks every foreign key, because the load runs with triggers off.
- **Kept out on purpose:**
  - The secret tables (`email_mailbox_secrets`, `lead_mailbox_secrets`,
    `lead_agent_secrets`) are not copied.
  - `app_config.n8n_base_url` is blanked, because n8n writes to the live
    database.
  - The Odoo connection (`lead_crm`) loses its key and URL. Odoo-backed
    screens (Technical, Finance, CEO tiles, battle-card history) read as "not
    connected".
  - `vite --mode v2` already drops the keys for Zernio, Resend, OpenRouter and
    the other outside services, so live social numbers read as "did not
    report".
- **Signing in.** Everyone signs in with their real email and the local
  password `arak-v2-local`. The auth admin API returns no password hashes, so
  real passwords are not copied.
- **Images.** Uploaded files stay in production Storage. Pages that show them
  by their public URL still load them, read only.

The structure was compared with production before the first load (one
md5 over every public table's columns, types, nullability and defaults):
identical, 82 tables.
