// ─── Turn the exported rows into one SQL file for the local database ───────
//   node dev/v2db/prod-copy/load.mjs <dump dir> <columns.json> <out.sql>
//
// One transaction with session_replication_role = replica: no trigger fires
// (no welcome rows, no notifications) and foreign keys are not re-checked,
// so tables load in any order. copy-production.sh checks them afterwards.
//
// Two rows are changed on the way in, so a click in the local app can never
// reach a production service: the n8n box URL is blanked (n8n writes to the
// live database) and the Odoo connection loses its key and URL.

import fs from 'node:fs'

const [dir, colsPath, outPath] = process.argv.slice(2)
const columns = JSON.parse(fs.readFileSync(colsPath, 'utf8'))
const LOCAL_PASSWORD = 'arak-v2-local'
const tag = '$prodcopy$'
const lit = (v) => {
  if (v == null) return 'null'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s.includes(tag)) throw new Error('a value contains the quoting tag')
  return `${tag}${s}${tag}`
}

const LOCAL_ONLY = {
  app_config: (r) => (r.key === 'n8n_base_url' ? { ...r, value: '' } : r),
  lead_crm: (r) => ({ ...r, api_key: '', url: 'https://odoo-disconnected.invalid', last_error: 'Disconnected in the local copy: it pointed at the real Odoo.' }),
}

let sql = 'begin;\nset local session_replication_role = replica;\n'
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
  const t = f.slice(0, -5)
  if (!columns[t]) throw new Error(`${t} is in the export but not in the local database`)
  let rows = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))
  if (!rows.length) continue
  if (LOCAL_ONLY[t]) rows = rows.map(LOCAL_ONLY[t])
  // Generated columns (leads.corrected, leads.project_final) are left out.
  const c = columns[t].map((x) => `"${x}"`).join(',')
  sql += `insert into public."${t}" (${c}) select ${c} from json_populate_recordset(null::public."${t}", ${lit(rows)}::json);\n`
}

for (const u of JSON.parse(fs.readFileSync(`${dir}/_auth_users.json`, 'utf8'))) {
  // GoTrue reads the token columns as strings: '' rather than null.
  sql += `insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,last_sign_in_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,phone_change,phone_change_token) values ('00000000-0000-0000-0000-000000000000',${lit(u.id)},'authenticated','authenticated',${lit(u.email)},crypt('${LOCAL_PASSWORD}', gen_salt('bf')),${lit(u.email_confirmed_at || u.created_at)},${lit(u.app_metadata || {})}::jsonb,${lit(u.user_metadata || {})}::jsonb,${lit(u.created_at)},${lit(u.updated_at)},${lit(u.last_sign_in_at)},'','','','','','','','');\n`
  sql += `insert into auth.identities (provider_id,user_id,identity_data,provider,created_at,updated_at) values (${lit(u.id)},${lit(u.id)},${lit({ sub: u.id, email: u.email, email_verified: true })}::jsonb,'email',now(),now());\n`
}
fs.writeFileSync(outPath, sql + 'commit;\n')
