#!/usr/bin/env bash
# ─── Load production's schema into the LOCAL v2 database ───────────────────
# 2026-10-19. v2 never touches production (the owner's rule). It runs against
# a local Supabase stack started from this folder:
#
#   npx -y supabase@2 start --workdir dev/v2db   (Docker must be running)
#   dev/v2db/apply-migrations.sh                 (this file)
#
# supabase/migrations cannot build the database from nothing: the first
# tables (brand_profile, workspaces, workspace_members…) were made by hand in
# the dashboard before migrations existed. So this loads in two steps:
#
#   1. baseline/schema.sql — production's structure, rebuilt from its catalog
#      (no data), then baseline/local-fixes.sql. Once only: a 'baseline' row
#      in v2dev.applied marks it, together with every migration listed in
#      baseline/applied-in-production.txt (already inside the baseline).
#   2. every other file in supabase/migrations, in file-name order, each once.
#
# The Supabase CLI cannot do step 2 itself: several files share a date prefix
# (20261025_…, 20261025_…), which the CLI reads as one version. So files run
# here through psql inside the database container, each in one transaction,
# recorded in v2dev.applied, stopping at the first failure so it can be read
# and fixed. A local-only fix for one migration goes in
# dev/v2db/fixes/<file>.before.sql and runs just before it.
#
# Safe to re-run: the baseline and applied files are skipped.
# To start again from empty: dev/v2db/reset-public.sql (see README.md).

set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
db="supabase_db_arak-v2"

psql_db() { docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$db" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

psql_db -c "create schema if not exists v2dev; create table if not exists v2dev.applied (name text primary key, at timestamptz not null default now());" >/dev/null

# ── 1. the baseline ──
if [[ "$(psql_db -At -c "select count(*) from v2dev.applied where name = 'baseline'")" == "0" ]]; then
  existing="$(psql_db -At -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','v')")"
  if [[ "$existing" != "0" ]]; then
    echo "public already has $existing tables/views but no baseline marker." >&2
    echo "Empty it first: docker exec -i $db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < \"$here/reset-public.sql\"" >&2
    exit 1
  fi
  # One transaction: the schema, the local fixes and the markers, or nothing.
  {
    cat "$here/baseline/schema.sql"
    echo
    cat "$here/baseline/local-fixes.sql"
    echo
    echo "insert into v2dev.applied(name) values ('baseline');"
    grep -v '^#' "$here/baseline/applied-in-production.txt" | grep -v '^[[:space:]]*$' \
      | sed "s/'/''/g; s/.*/insert into v2dev.applied(name) values ('&') on conflict do nothing;/"
  } | psql_db -1 -f - >/dev/null
  echo "loaded baseline ($(grep -vc '^#' "$here/baseline/applied-in-production.txt") migrations already inside it)"
fi

# ── 2. the migrations production does not have yet ──
applied="$(psql_db -At -c 'select name from v2dev.applied')"
n=0
# A glob, not $(ls …): the repo lives under "Arak neww", and word-splitting
# on that space broke the first version. Bash sorts globs by name.
for f in "$repo"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  if grep -qxF "$name" <<<"$applied"; then continue; fi
  if ! {
    if [[ -f "$here/fixes/$name.before.sql" ]]; then cat "$here/fixes/$name.before.sql"; echo; fi
    cat "$f"
    echo
    echo "insert into v2dev.applied(name) values ('${name//\'/\'\'}');"
  } | psql_db -1 -f -; then
    echo "FAILED: $name" >&2
    exit 1
  fi
  n=$((n + 1))
  echo "applied $name"
done
# PostgREST (the local API) caches the schema; tell it to read the new one.
psql_db -c "notify pgrst, 'reload schema'" >/dev/null
echo "done: $n new, $(psql_db -At -c "select count(*) from v2dev.applied where name <> 'baseline'") migrations recorded in total"
