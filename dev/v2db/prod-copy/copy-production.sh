#!/usr/bin/env bash
# ─── The local v2 database, filled with production's real rows ─────────────
# 2026-10-25, the owner: "move the main application to the new interface,
# locally first, but with real data". Production is only READ (GETs); the
# copy lives in the local Docker database and is thrown away by a re-run.
#
#   dev/v2db/prod-copy/copy-production.sh [path to the main checkout's .env]
#
# 1. Empties the local database (public schema and its people).
# 2. Builds production's structure: the baseline plus every migration that
#    is on origin/main (main's migrations are the ones production has).
# 3. Reads production's rows and people, and loads them (export.mjs,
#    load.mjs). The secret tables stay behind, every person signs in with
#    the local password, and the n8n URL and Odoo key are blanked.
# 4. Checks every row count against what was read, and every foreign key.
# 5. Applies v2's own migrations (on this branch, not on main) on top, so
#    they run against the real rows as they will in production.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
v2db="$(cd "$here/.." && pwd)"
repo="$(cd "$v2db/../.." && pwd)"
envfile="${1:-$(git -C "$repo" worktree list --porcelain | awk '/^worktree /{print substr($0, 10); exit}')/.env}"
data="$here/data"
db="supabase_db_arak-v2"
psql_db() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$db" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

docker inspect "$db" >/dev/null 2>&1 || { echo "The local stack is not running: npx -y supabase@2 start --workdir dev/v2db" >&2; exit 1; }
[[ -f "$envfile" ]] || { echo "No .env at $envfile" >&2; exit 1; }

# v2's own migrations: in this checkout, not on origin/main.
git -C "$repo" fetch -q origin main
v2_only="$(comm -23 <(cd "$repo/supabase/migrations" && ls *.sql | sort) <(git -C "$repo" ls-tree --name-only origin/main supabase/migrations/ | xargs -n1 basename | sort))"
echo "v2's own migrations (applied after the data):"; sed 's/^/  /' <<<"$v2_only"

echo "1. emptying the local database"
psql_db -f - < "$v2db/reset-public.sql" >/dev/null 2>&1
psql_db -c "delete from auth.identities; delete from auth.users; drop schema if exists v2dev cascade; create schema v2dev; create table v2dev.applied (name text primary key, at timestamptz not null default now());"
# One statement: psql under "docker exec -i" inside a while-read loop eats the loop's input.
in_list="$(sed "/^$/d; s/.*/('&')/" <<<"$v2_only" | paste -sd, -)"
[[ -n "$in_list" ]] && psql_db -c "insert into v2dev.applied(name) values $in_list"

echo "2. production's structure"
"$v2db/apply-migrations.sh" | tail -1

echo "3. reading production (GET only) and loading"
rm -rf "$data"; mkdir -p "$data"
psql_db -At -c "select string_agg(relname, ' ' order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'" > "$data/_tables.txt"
psql_db -At -c "select json_object_agg(table_name, cols) from (select table_name, json_agg(column_name order by ordinal_position) cols from information_schema.columns where table_schema='public' and is_generated='NEVER' and table_name in (select relname from pg_class where relnamespace='public'::regnamespace and relkind='r') group by table_name) x" > "$data/_columns.json"
node "$here/export.mjs" "$envfile" "$data" "$data/_tables.txt"
local_key="$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$repo/.env.v2" | cut -d= -f2- | tr -d "\"'")"
node "$here/load.mjs" "$data" "$data/_columns.json" "$data/_load.sql" "$local_key"
psql_db -f - < "$data/_load.sql" >/dev/null

echo "4. checking"
psql_db -At -c "select json_object_agg(relname, (xpath('/row/c/text()', query_to_xml('select count(*) c from public.'||quote_ident(relname), false, true, '')))[1]::text::int) from pg_class where relnamespace='public'::regnamespace and relkind='r'" > "$data/_local_counts.json"
node -e '
const read = JSON.parse(require("fs").readFileSync(process.argv[1])), local = JSON.parse(require("fs").readFileSync(process.argv[2]))
const off = Object.entries(read).filter(([t, n]) => local[t] !== n).map(([t, n]) => `${t}: read ${n}, loaded ${local[t]}`)
if (off.length) { console.error("COUNTS DIFFER\n" + off.join("\n")); process.exit(1) }
console.log(`   every table holds what was read (${Object.keys(read).length} tables)`)' "$data/_counts.json" "$data/_local_counts.json"
psql_db -f - < "$here/check-foreign-keys.sql" 2>&1 | sed -n 's/.*WARNING: */   /p'

echo "5. v2's own migrations on the real rows"
[[ -n "$in_list" ]] && psql_db -c "delete from v2dev.applied where name in ($(sed "/^$/d; s/.*/'&'/" <<<"$v2_only" | paste -sd, -))"
"$v2db/apply-migrations.sh"
echo "Done. Sign in at the v2 app with a real email and the password arak-v2-local."
