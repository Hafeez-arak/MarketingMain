// ─── Enough of PostgREST, over a real Postgres, for the email server ───────
// The server talks to Supabase only through PostgREST URLs (api/agent/
// _supabase.js and the count() in api/email/[action].js). This answers those
// URLs from PGlite, so the real handler runs unchanged against real tables.
//
// What it covers is what the email code uses, and no more: filters eq neq lt
// lte gt gte in is not.is not.in ilike, or=(…), select with one embedded
// !inner table, order, limit, offset; GET, HEAD (count=exact), POST (with
// on_conflict and ignore/merge-duplicates), PATCH, DELETE; return=minimal
// and return=representation.
//
// Two things it copies from the real one on purpose, because they are
// where bugs hide:
//   • '+' in a query string is a space (as in PostgREST), so an unencoded
//     timestamp like …+00:00 breaks here just as it would in production.
//   • Rows come back through Postgres's own JSON, so timestamps look exactly
//     as PostgREST sends them ("2026-09-27T08:00:00.123+00:00").
//
// Row-level security is not modelled: the server always uses the service
// key. The one read made with a person's token (the membership check on
// `workspaces`) is filtered by workspace_members, so a non-member is refused.

const IDENT = /^[a-z_][a-z0-9_]*$/
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
// Embedded tables the email code joins, by the column that points at them.
const EMBED_FK = { email_campaigns: 'campaign_id', email_contacts: 'contact_id', email_mailboxes: 'mailbox_id', email_groups: 'group_id' }

const ident = s => {
  if (!IDENT.test(s)) throw httpError(400, `bad identifier: ${s}`)
  return `"${s}"`
}
const lit = v => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

function httpError(status, message, code = 'PGRST') {
  const e = new Error(message)
  e.status = status
  e.code = code
  return e
}

// PostgREST (wai) decodes + as a space. So does this.
const decode = s => decodeURIComponent(String(s).replace(/\+/g, ' '))

/** Split "a,b.in.(x,y),c" on top-level commas. */
function splitTop(s) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function listOf(raw) {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '')
  return splitTop(inner).map(v => v.trim().replace(/^"(.*)"$/, '$1'))
}

/** One condition: column, and "op.value" (value already decoded). */
function condition(col, expr, alias = 't') {
  const c = `${alias}.${ident(col)}`
  let neg = false
  let rest = expr
  if (rest.startsWith('not.')) { neg = true; rest = rest.slice(4) }
  const dot = rest.indexOf('.')
  const op = rest.slice(0, dot)
  const val = rest.slice(dot + 1)
  let sql
  switch (op) {
    case 'eq': sql = `${c} = ${lit(val)}`; break
    case 'neq': sql = `${c} <> ${lit(val)}`; break
    case 'lt': sql = `${c} < ${lit(val)}`; break
    case 'lte': sql = `${c} <= ${lit(val)}`; break
    case 'gt': sql = `${c} > ${lit(val)}`; break
    case 'gte': sql = `${c} >= ${lit(val)}`; break
    case 'ilike': sql = `${c} ilike ${lit(val.replace(/\*/g, '%'))}`; break
    case 'like': sql = `${c} like ${lit(val.replace(/\*/g, '%'))}`; break
    case 'in': {
      const items = listOf(val)
      sql = items.length ? `${c} in (${items.map(lit).join(',')})` : 'false'
      break
    }
    case 'is': {
      if (!['null', 'true', 'false'].includes(val)) throw httpError(400, `is.${val}`)
      sql = `${c} is ${val}`
      break
    }
    default: throw httpError(400, `unsupported operator ${op} on ${col}`)
  }
  return neg ? `not (${sql})` : sql
}

/** or=(a.eq.1,b.in.(x,y)) → (a = '1' or b in ('x','y')) */
function orGroup(raw, alias = 't') {
  const parts = splitTop(raw.replace(/^\(/, '').replace(/\)$/, ''))
  return `(${parts.map(p => {
    const dot = p.indexOf('.')
    return condition(p.slice(0, dot), p.slice(dot + 1), alias)
  }).join(' or ')})`
}

/** Parse the query string into filters, select, order, limit… */
function parseQuery(search) {
  const q = { filters: [], embedFilters: [], select: '*', order: [], limit: null, offset: null, onConflict: null }
  for (const pair of search.replace(/^\?/, '').split('&').filter(Boolean)) {
    const eq = pair.indexOf('=')
    const key = decode(pair.slice(0, eq))
    const val = decode(pair.slice(eq + 1))
    if (key === 'select') q.select = val
    else if (key === 'order') q.order = val.split(',')
    else if (key === 'limit') q.limit = Number(val)
    else if (key === 'offset') q.offset = Number(val)
    else if (key === 'on_conflict') q.onConflict = val.split(',')
    else if (key === 'or') q.filters.push({ or: val })
    else if (key.includes('.')) {
      const [table, col] = key.split('.')
      q.embedFilters.push({ table, col, expr: val })
    } else if (!RESERVED.has(key)) q.filters.push({ col: key, expr: val })
  }
  return q
}

/** "id,email_campaigns!inner(status,audience)" → columns and embeds */
function parseSelect(select) {
  const cols = []
  const embeds = []
  for (const part of splitTop(select)) {
    const m = part.match(/^([a-z_]+)(!inner)?\((.*)\)$/)
    if (m) embeds.push({ table: m[1], inner: Boolean(m[2]), cols: m[3] })
    else cols.push(part.trim())
  }
  return { cols, embeds }
}

function where(table, q, extra = []) {
  const conds = [...extra]
  for (const f of q.filters) conds.push(f.or ? orGroup(f.or) : condition(f.col, f.expr))
  for (const e of q.embedFilters) {
    const fk = EMBED_FK[e.table]
    if (!fk) throw httpError(400, `no embed ${e.table} from ${table}`)
    conds.push(`exists (select 1 from public.${ident(e.table)} e where e.id = t.${ident(fk)} and ${condition(e.col, e.expr, 'e')})`)
  }
  return conds.length ? `where ${conds.join(' and ')}` : ''
}

function selectList(table, select) {
  const { cols, embeds } = parseSelect(select || '*')
  const parts = cols.map(c => (c === '*' ? 't.*' : `t.${ident(c)}`))
  const innerConds = []
  for (const e of embeds) {
    const fk = EMBED_FK[e.table]
    if (!fk) throw httpError(400, `no embed ${e.table} from ${table}`)
    const ecols = e.cols === '*' ? 'e.*' : e.cols.split(',').map(c => `e.${ident(c.trim())}`).join(',')
    parts.push(`(select to_json(x) from (select ${ecols} from public.${ident(e.table)} e where e.id = t.${ident(fk)}) x) as ${ident(e.table)}`)
    if (e.inner) innerConds.push(`exists (select 1 from public.${ident(e.table)} e where e.id = t.${ident(fk)})`)
  }
  return { list: parts.join(', ') || 't.*', innerConds }
}

function orderBy(q) {
  if (!q.order.length) return ''
  return `order by ${q.order.map(o => {
    const [col, dir, nulls] = o.split('.')
    return `t.${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`
  }).join(', ')}`
}

async function rows(pg, sql) {
  // A CTE, not a subquery: INSERT/UPDATE/DELETE … RETURNING may only be one.
  const r = await pg.query(`with r as (${sql}) select coalesce(json_agg(r), '[]'::json)::text as j from r`)
  return JSON.parse(r.rows[0].j)
}

function pgError(err) {
  // 23505 unique, 23514 check, 23503 fk, 22P02 bad text for a type.
  const status = ['23505'].includes(err.code) ? 409 : ['23514', '23503', '23502', '22P02', '22007', '22008'].includes(err.code) ? 400 : 500
  return httpError(status, err.message, err.code)
}

/**
 * Answer one PostgREST request.
 * @returns {Promise<{ status: number, body?: any, headers?: object }>}
 */
export async function postgrest(pg, { method, table, search, body, prefer = '', user = null }) {
  if (!IDENT.test(table)) return { status: 404, body: { message: 'no table' } }
  const q = parseQuery(search || '')
  const T = `public.${ident(table)} t`
  const wantRows = /return=representation/.test(prefer)

  try {
    if (method === 'GET' || method === 'HEAD') {
      const { list, innerConds } = selectList(table, q.select)
      // A person's token reads workspaces only where they are a member.
      const scope = user && table === 'workspaces'
        ? [`exists (select 1 from public.workspace_members m where m.workspace_id = t.id and m.user_id = ${lit(user.id)})`]
        : []
      const base = `from ${T} ${where(table, q, [...innerConds, ...scope])}`
      if (method === 'HEAD' || /count=exact/.test(prefer)) {
        const c = await pg.query(`select count(*)::int as n ${base}`)
        const n = c.rows[0].n
        if (method === 'HEAD') return { status: 200, headers: { 'content-range': `0-0/${n}` } }
      }
      const sql = `select ${list} ${base} ${orderBy(q)} ${q.limit != null ? `limit ${Number(q.limit)}` : ''} ${q.offset != null ? `offset ${Number(q.offset)}` : ''}`
      return { status: 200, body: await rows(pg, sql) }
    }

    if (method === 'POST') {
      const items = Array.isArray(body) ? body : [body]
      if (!items.length) return { status: 201, body: [] }
      const cols = [...new Set(items.flatMap(i => Object.keys(i)))]
      cols.forEach(ident)
      const colList = cols.map(ident).join(', ')
      let conflict = ''
      if (q.onConflict) {
        const target = q.onConflict.map(ident).join(', ')
        if (/resolution=merge-duplicates/.test(prefer)) {
          const sets = cols.filter(c => !q.onConflict.includes(c)).map(c => `${ident(c)} = excluded.${ident(c)}`)
          conflict = sets.length ? `on conflict (${target}) do update set ${sets.join(', ')}` : `on conflict (${target}) do nothing`
        } else if (/resolution=ignore-duplicates/.test(prefer)) {
          conflict = `on conflict (${target}) do nothing`
        }
      }
      // json_populate_recordset types every value by its column (uuid[],
      // jsonb, timestamptz…); naming the columns keeps the defaults of the rest.
      const sql = `insert into public.${ident(table)} (${colList})
        select ${colList} from json_populate_recordset(null::public.${ident(table)}, ${lit(JSON.stringify(items))}::json)
        ${conflict} returning *`
      const out = await rows(pg, sql)
      return { status: 201, body: wantRows ? out : null }
    }

    if (method === 'PATCH') {
      const cols = Object.keys(body || {})
      if (!cols.length) return { status: 204, body: wantRows ? [] : null }
      const colList = cols.map(ident).join(', ')
      const sql = `update ${T} set (${colList}) = (select ${colList} from json_populate_record(null::public.${ident(table)}, ${lit(JSON.stringify(body))}::json))
        ${where(table, q)} returning t.*`
      const out = await rows(pg, sql)
      return { status: 200, body: wantRows ? out : null }
    }

    if (method === 'DELETE') {
      const sql = `delete from ${T} ${where(table, q)} returning t.*`
      const out = await rows(pg, sql)
      return { status: 200, body: wantRows ? out : null }
    }
    return { status: 405, body: { message: 'method' } }
  } catch (err) {
    const e = err.status ? err : pgError(err)
    return { status: e.status, body: { code: e.code, message: e.message } }
  }
}
