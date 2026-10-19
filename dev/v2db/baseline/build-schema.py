#!/usr/bin/env python3
"""Turn the rows from generate-schema.sql into baseline/schema.sql.

Usage:  python3 -I dev/v2db/baseline/build-schema.py <rows> > dev/v2db/baseline/schema.sql

<rows> is either
  - the file the Supabase MCP execute_sql tool saves a large result to
    ({"result": "... <untrusted-data-…> [rows] </untrusted-data-…> ..."}), or
  - a plain JSON array of {"ord", "sub", "ddl"} objects.

The rows are only DDL text produced by pg_get_*def and friends; nothing in
them is application data.
"""
import json
import re
import sys

SECTIONS = {
    10: "Extensions",
    20: "Tables (columns, defaults, generated columns, NOT NULL)",
    30: "Functions",
    40: "Primary key, unique and check constraints",
    42: "Indexes not backing a constraint (a foreign key may point at a unique index)",
    45: "Foreign keys",
    60: "Views (options such as security_invoker copied from production)",
    70: "Triggers (public tables, plus auth.users -> public.handle_new_user)",
    80: "Row level security",
    90: "Policies (public tables and storage.objects)",
    100: "Grants on tables and views (exactly production's ACLs)",
    110: "Grants on functions (exactly production's ACLs)",
    120: "Storage buckets (settings only, no files)",
    130: "Realtime publication",
}


def load(path):
    text = open(path, encoding="utf-8").read()
    data = json.loads(text)
    if isinstance(data, dict) and "result" in data:
        m = re.search(r"<untrusted-data-[0-9a-f-]+>\n(.*)\n</untrusted-data-", data["result"], re.S)
        data = json.loads(m.group(1))
    return data


def main():
    rows = load(sys.argv[1])
    rows.sort(key=lambda r: (r["ord"], r["sub"]))
    out = [
        "-- ─── v2 baseline: production's schema, rebuilt from its catalog ──────────",
        "-- GENERATED FILE. Made by dev/v2db/baseline/generate-schema.sql (read-only",
        "-- catalog queries against production, no rows from application tables) and",
        "-- dev/v2db/baseline/build-schema.py. Do not edit by hand: regenerate it, and",
        "-- put local-only adjustments in local-fixes.sql. See dev/v2db/README.md.",
        f"-- {len(rows)} statements.",
        "",
        "SET client_min_messages = warning;",
        "-- Function bodies reference tables/views created later in this file.",
        "SET check_function_bodies = off;",
        "SET search_path = public, extensions;",
        "",
    ]
    last = None
    for r in rows:
        if r["ord"] != last:
            last = r["ord"]
            out.append("")
            out.append(f"-- ═══ {SECTIONS.get(last, str(last))} " + "═" * 20)
            out.append("")
        ddl = r["ddl"].rstrip()
        out.append(ddl)
        if r["ord"] in (20, 30, 60, 90):
            out.append("")
    out.append("")
    out.append("RESET check_function_bodies;")
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
