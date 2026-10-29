#!/usr/bin/env bash
# ─── Pricing: run the database tests on the LOCAL v2 database (2026-12-01) ──
# pricing_test.sql runs inside one transaction that is rolled back: it builds
# its own opportunities, suppliers and catalog items, reads and writes the
# live local database as real logins would, then leaves nothing. Needs the
# pricing migrations applied (dev/v2db/apply-migrations.sh). Prints PASS/FAIL
# per check; exits 1 on a FAIL.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
docker exec -i supabase_db_arak-v2 psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -P pager=off -f - < "$here/pricing_test.sql"
