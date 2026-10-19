-- ─── Local-only adjustments to the baseline ───────────────────────────────
-- Runs once, right after baseline/schema.sql, in the same transaction.
-- Every statement here must say why the local copy has to differ from
-- production. Fixes that belong to one migration go in
-- dev/v2db/fixes/<migration file>.before.sql instead.
--
-- None needed (2026-10-19): schema.sql loads on the local stack with no
-- errors, and regenerating the DDL from the local database gives a file
-- byte-for-byte identical to production's (see README.md, "Checking parity").
select 1;
