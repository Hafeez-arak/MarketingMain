#!/usr/bin/env bash
# ─── Musa's ERP database, tested on our local Postgres (2026-10-27) ────────
# The owner is weighing moving Musa's ERP into our app. Its rules live in
# PostgreSQL, so step one is proving they run on our engine, and next to our
# schema in one database. LOCAL ONLY: the Docker database of dev/v2db.
#
# Musa's repo is only READ (no git, no writes, not his hosted copy). His files
# are copied to a git-ignored scratch folder: our repo is public and his code
# is not ours to publish.
#
#   dev/erp-pilot/run-musa-tests.sh alone    a throwaway database, his files
#                                            unchanged: does it run on our engine?
#   dev/erp-pilot/run-musa-tests.sh beside   a scratch copy of our local database
#                                            with his ERP in its own schema `erp`
#
# Steps are the ones in his scripts/test-db.sh: the base schema, the numbered
# changes in order, schema_rules_test, the module tests, isolation last.
set -euo pipefail
mode="${1:-alone}"
musa="${MUSA_REPO:-$HOME/Desktop/Musa Arak /Arak-Lighting}"
here="$(cd "$(dirname "$0")" && pwd)"
work="$here/.work"
container="supabase_db_arak-v2"
db="musa_${mode}_test"

rm -rf "$work"; mkdir -p "$work/changes" "$work/tests"
cp "$musa/database/schema/arak_schema.sql" "$work/"
cp "$musa"/database/schema/changes/[0-9]*.sql "$work/changes/"
cp "$musa"/database/sql-tests/*.sql "$work/tests/"
echo "Musa's repo at $(git -C "$musa" log -1 --format='%h %ci' 2>/dev/null || echo '?') (read only)"

q() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$container" psql -X -q -U postgres -v ON_ERROR_STOP=1 "$@"; }

q -d postgres -c "DROP DATABASE IF EXISTS $db" >/dev/null
if [[ "$mode" == "alone" ]]; then
  q -d postgres -c "CREATE DATABASE $db" >/dev/null
  pre=""
else
  # Our whole local database (schema and the copied rows), then his beside it.
  q -d postgres -c "CREATE DATABASE $db" >/dev/null
  docker exec "$container" pg_dump -U postgres -d postgres --no-owner -N v2dev \
    | docker exec -i "$container" psql -X -q -U postgres -d "$db" >/dev/null 2>&1 || true
  src=$(q -d postgres -At -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r'")
  got=$(q -d "$db" -At -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r'")
  rows=$(q -d "$db" -At -c "select (select count(*) from public.leads)||' leads, '||(select count(*) from auth.users)||' people'")
  echo "our local database copied: $got of $src tables, $rows"
  [[ "$src" == "$got" ]] || { echo "the copy of our database is incomplete" >&2; exit 1; }
  # His SQL names the schema `public` in its self-checks and grants; in the
  # pilot it lives in `erp`. The rename is mechanical and listed here in full.
  for f in "$work"/arak_schema.sql "$work"/changes/*.sql "$work"/tests/*.sql; do
    sed -i '' -e "s/'public'/'erp'/g" -e 's/SCHEMA public/SCHEMA erp/g' "$f"
  done
  q -d "$db" -c "CREATE SCHEMA erp" >/dev/null
  pre="SET search_path = erp, public;"
fi

run() { { echo "$pre"; cat "$1"; } | q -d "$db" "${@:2}" -f -; }
run "$work/arak_schema.sql" >/dev/null
for f in "$work"/changes/*.sql; do { echo "$pre"; cat "$f"; } | q -d "$db" -1 -f - >/dev/null; done
echo "schema + $(ls "$work"/changes | wc -l | tr -d ' ') changes loaded"
# Each file stops with an exception on any failed check (his own rule); the
# count is his PASS rows (the report table) plus PASS notices.
files=0; checks=0
for f in "$work/tests/schema_rules_test.sql" "$work"/tests/[0-9]*_test.sql "$work/tests/company_isolation_test.sql"; do
  out="$( { echo "$pre"; echo "SET client_min_messages = notice;"; cat "$f"; } | docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 -d "$db" -f - 2>&1)" \
    || { echo "FAILED: $(basename "$f")"; echo "$out" | grep -E "FAIL|ERROR" | head -15; exit 1; }
  n=$(( $(printf '%s\n' "$out" | grep -cE '^ *PASS *\|' || true) + $(printf '%s\n' "$out" | grep -cE 'NOTICE: +PASS' || true) ))
  files=$((files + 1)); checks=$((checks + n))
  echo "  ✓ $(basename "$f") ($n checks)"
done
echo "ALL $files TEST FILES PASSED, $checks CHECKS ($mode)"
