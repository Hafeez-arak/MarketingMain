-- ─── Generate the v2 baseline schema from a database's catalog ────────────
-- Read-only: every line below reads pg_catalog (plus storage.buckets' id,
-- name, public and limit columns). It never selects a row from an
-- application table, and it changes nothing.
--
-- It returns one row per DDL statement, in the order they must run. Run it
-- against production (read-only, e.g. through the Supabase MCP execute_sql
-- tool) to refresh baseline/schema.sql, and against the local v2 database to
-- check that the two match (see README.md, "Checking parity").
--
-- search_path is emptied first so every name in the output comes out
-- schema-qualified, whatever the caller's search_path was.
set search_path = '';

with recursive
rel as (
  select c.oid, c.relname, c.relkind, c.reloptions, c.relacl, c.relowner,
         c.relrowsecurity, c.relforcerowsecurity
  from pg_catalog.pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v')
),
-- views in dependency order: depth = longest chain of public views below it
vdep as (
  select distinct r.ev_class as v, d.refobjid as dep
  from pg_catalog.pg_rewrite r
  join pg_catalog.pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
  join rel x on x.oid = d.refobjid and x.relkind = 'v'
  where d.refobjid <> r.ev_class
),
vdepth as (
  select oid as v, 0 as depth from rel where relkind = 'v'
  union all
  select vd.v, vdepth.depth + 1 from vdep vd join vdepth on vdepth.v = vd.dep
  where vdepth.depth < 20
),
fn as (
  select p.oid, p.proname, p.proacl, p.proowner
  from pg_catalog.pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
    and not exists (select 1 from pg_catalog.pg_depend e
                    where e.classid = 'pg_proc'::regclass and e.objid = p.oid and e.deptype = 'e')
),
out(ord, sub, ddl) as (
  -- 10 extensions the app relies on (installed by Supabase already; harmless)
  select 10, e.extname::text,
         format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;', e.extname, e.extnamespace::regnamespace::text)
  from pg_catalog.pg_extension e
  where e.extname not in ('plpgsql','supabase_vault','pg_graphql')

  -- 20 tables: columns, types, defaults, generated expressions, NOT NULL
  union all
  select 20, r.relname::text,
         format(E'CREATE TABLE public.%I (\n%s\n);', r.relname,
           (select string_agg(
              format('  %I %s%s%s', a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod),
                case when a.attgenerated = 's' then format(' GENERATED ALWAYS AS (%s) STORED', pg_catalog.pg_get_expr(d.adbin, d.adrelid))
                     when d.adbin is not null then ' DEFAULT ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid)
                     else '' end,
                case when a.attnotnull then ' NOT NULL' else '' end),
              E',\n' order by a.attnum)
            from pg_catalog.pg_attribute a
            left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped))
  from rel r where r.relkind = 'r'

  -- 30 functions (check_function_bodies is off while loading, so order is free)
  union all
  select 30, f.oid::regprocedure::text, pg_catalog.pg_get_functiondef(f.oid) || ';'
  from fn f

  -- 40 primary key / unique / check / exclusion constraints
  union all
  select 40, r.relname || ' ' || con.contype::text || ' ' || con.conname,
         format('ALTER TABLE ONLY public.%I ADD CONSTRAINT %I %s;', r.relname, con.conname, pg_catalog.pg_get_constraintdef(con.oid))
  from pg_catalog.pg_constraint con join rel r on r.oid = con.conrelid
  where con.contype in ('p','u','c','x')

  -- 45 foreign keys, once every key they point at exists
  union all
  select 45, r.relname || ' ' || con.conname,
         format('ALTER TABLE ONLY public.%I ADD CONSTRAINT %I %s;', r.relname, con.conname, pg_catalog.pg_get_constraintdef(con.oid))
  from pg_catalog.pg_constraint con join rel r on r.oid = con.conrelid
  where con.contype = 'f'

  -- 42 indexes that do not back a constraint (before the foreign keys: a
  --    foreign key may point at a plain unique index, not only a constraint)
  union all
  select 42, i.indexrelid::regclass::text, pg_catalog.pg_get_indexdef(i.indexrelid) || ';'
  from pg_catalog.pg_index i join rel r on r.oid = i.indrelid
  where not exists (select 1 from pg_catalog.pg_constraint con
                    where con.conindid = i.indexrelid and con.conrelid = i.indrelid
                      and con.contype in ('p','u','x'))

  -- 60 views, deepest dependency last, with their options (security_invoker)
  union all
  select 60, lpad((select max(depth) from vdepth where vdepth.v = r.oid)::text, 3, '0') || ' ' || r.relname,
         format(E'CREATE VIEW public.%I%s AS\n%s', r.relname,
                case when r.reloptions is not null then ' WITH (' || array_to_string(r.reloptions, ', ') || ')' else '' end,
                pg_catalog.pg_get_viewdef(r.oid))
  from rel r where r.relkind = 'v'

  -- 70 triggers on public tables, and on auth/storage tables that call public functions
  union all
  select 70, t.tgrelid::regclass::text || ' ' || t.tgname, pg_catalog.pg_get_triggerdef(t.oid) || ';'
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal
    and (c.relnamespace = 'public'::regnamespace or p.pronamespace = 'public'::regnamespace)

  -- 80 row level security switches
  union all
  select 80, r.relname::text, format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.relname)
  from rel r where r.relkind = 'r' and r.relrowsecurity
  union all
  select 80, r.relname || ' force', format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', r.relname)
  from rel r where r.relkind = 'r' and r.relforcerowsecurity

  -- 90 policies (public tables, and storage.objects / storage.buckets)
  union all
  select 90, pol.polrelid::regclass::text || ' ' || pol.polname,
         format('CREATE POLICY %I ON %s AS %s FOR %s TO %s%s%s;',
           pol.polname, pol.polrelid::regclass::text,
           case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end,
           case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
           (select string_agg(case when ro = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(ro)) end, ', ' order by pg_catalog.pg_get_userbyid(ro))
              from unnest(pol.polroles) ro),
           case when pol.polqual is not null then E'\n  USING (' || pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) || ')' else '' end,
           case when pol.polwithcheck is not null then E'\n  WITH CHECK (' || pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) || ')' else '' end)
  from pg_catalog.pg_policy pol
  join pg_catalog.pg_class c on c.oid = pol.polrelid
  where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace)

  -- 100 grants on tables and views, exactly as production has them
  union all
  select 100, r.relname || ' 0', format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role;', r.relname)
  from rel r
  union all
  select 100, r.relname || ' 1 ' || g.who,
         format('GRANT %s ON TABLE public.%I TO %s%s;', g.privs, r.relname, g.who, case when g.grantable then ' WITH GRANT OPTION' else '' end)
  from rel r
  cross join lateral (
    select case when x.grantee = 0 then 'PUBLIC' else quote_ident(pg_catalog.pg_get_userbyid(x.grantee)) end as who,
           x.is_grantable as grantable,
           string_agg(x.privilege_type, ', ' order by x.privilege_type) as privs
    from aclexplode(coalesce(r.relacl, acldefault('r', r.relowner))) x
    where x.grantee <> r.relowner
    group by 1, 2
  ) g

  -- 110 grants on functions (no ACL = the PostgreSQL default: EXECUTE to PUBLIC)
  union all
  select 110, f.oid::regprocedure::text || ' 0',
         format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role;', f.oid::regprocedure::text)
  from fn f
  union all
  select 110, f.oid::regprocedure::text || ' 1 ' || g.who,
         format('GRANT EXECUTE ON FUNCTION %s TO %s%s;', f.oid::regprocedure::text, g.who, case when g.grantable then ' WITH GRANT OPTION' else '' end)
  from fn f
  cross join lateral (
    select case when x.grantee = 0 then 'PUBLIC' else quote_ident(pg_catalog.pg_get_userbyid(x.grantee)) end as who,
           bool_or(x.is_grantable) as grantable
    from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) x
    where x.grantee <> f.proowner
    group by 1
  ) g

  -- 120 storage buckets (settings only; never the files in them)
  union all
  select 120, b.id,
         format('INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES (%L, %L, %s, %s, %s) ON CONFLICT (id) DO NOTHING;',
           b.id, b.name, case when b.public then 'true' else 'false' end, coalesce(b.file_size_limit::text, 'NULL'),
           coalesce(quote_literal(b.allowed_mime_types::text) || '::text[]', 'NULL'))
  from storage.buckets b

  -- 130 realtime publication membership
  union all
  select 130, pt.schemaname || '.' || pt.tablename,
         format('ALTER PUBLICATION %I ADD TABLE %I.%I;', pt.pubname, pt.schemaname, pt.tablename)
  from pg_catalog.pg_publication_tables pt
  where pt.schemaname = 'public'
)
select ord, sub, ddl from out order by ord, sub;
