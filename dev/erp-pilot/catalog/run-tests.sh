#!/usr/bin/env bash
# ─── Catalog: run the database tests on the LOCAL v2 database (2026-10-30) ──
# catalog_test.sql runs inside one transaction that is rolled back: it reads
# and writes the live local database as real logins would, then leaves
# nothing. Needs the catalog migrations applied (dev/v2db/apply-migrations.sh)
# and the test data loaded once (seed.sql). Prints PASS/FAIL per check; exits
# 1 on a FAIL.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
docker exec -i supabase_db_arak-v2 psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off -f - < "$here/catalog_test.sql"
