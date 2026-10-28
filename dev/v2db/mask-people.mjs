// ─── Real staff addresses out of the local v2 copy (2026-10-28) ────────────
// The repo is public, so its tests, checks and docs name people by stand-in
// addresses (staff.admin@arak-sa.com, staff.dev@…). The local copy of
// production must use the same stand-ins, or those checks could not sign in.
// This rewrites every address in dev/v2db/people.local.json (git-ignored: the
// only place the real and stand-in addresses are paired) across the local
// database: logins, identities and every text column in public.
//
//   node dev/v2db/mask-people.mjs          (copy-production.sh runs it too)
//
// Safe to re-run: an address already replaced is not found again. Local only:
// it talks to the supabase_db_arak-v2 container and nothing else.

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const mapPath = path.join(here, 'people.local.json')
if (!fs.existsSync(mapPath)) {
  console.log('No dev/v2db/people.local.json: the local copy keeps its addresses.')
  process.exit(0)
}
const { emails = {} } = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
const pairs = Object.entries(emails).filter(([from, to]) => from.includes('@') && to.includes('@'))
const q = s => `'${String(s).replace(/'/g, "''")}'`

const sql = `
set session_replication_role = replica;
do $$
declare c record; p record; n bigint; total bigint := 0;
begin
  for p in select * from (values ${pairs.map(([f, t]) => `(${q(f)}, ${q(t)})`).join(', ')}) v(old, new) loop
    update auth.users set email = p.new where lower(email) = lower(p.old);
    update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(p.new))
      where lower(identity_data->>'email') = lower(p.old);
    for c in
      select a.table_name, a.column_name, a.data_type, a.udt_name from information_schema.columns a
      join pg_class t on t.relname = a.table_name and t.relnamespace = 'public'::regnamespace and t.relkind = 'r'
      where a.table_schema = 'public' and a.is_generated = 'NEVER'
        and (a.data_type in ('text', 'character varying', 'jsonb', 'json') or a.udt_name = '_text')
    loop
      execute format('update public.%I set %I = replace(%I::text, %L, %L)::%s where %I::text ilike %L',
        c.table_name, c.column_name, c.column_name, p.old, p.new,
        case when c.udt_name = '_text' then 'text[]' when c.data_type = 'character varying' then 'text' else c.data_type end,
        c.column_name, '%' || p.old || '%');
      get diagnostics n = row_count;
      total := total + n;
    end loop;
  end loop;
  raise warning 'masked: % cells', total;
end $$;
`
const out = execFileSync('docker', ['exec', '-i', 'supabase_db_arak-v2', 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
console.log(out.trim() || `masked ${pairs.length} addresses`)
