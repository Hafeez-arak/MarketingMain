-- ─── Empty the LOCAL v2 database's app schema ─────────────────────────────
-- Local only (never run against production). Drops everything the baseline
-- created, so dev/v2db/apply-migrations.sh can rebuild from scratch:
--   docker exec -i supabase_db_arak-v2 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < dev/v2db/reset-public.sql
-- Keeps the public schema itself (its grants and default privileges are
-- Supabase's own and are not ours to recreate), the storage buckets, and
-- every row in auth.
do $$
declare r record;
begin
  -- storage policies the baseline added (the local stack ships with none)
  for r in select polname, polrelid::regclass as tbl from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relnamespace = 'storage'::regnamespace loop
    execute format('drop policy %I on %s', r.polname, r.tbl);
  end loop;
  -- triggers elsewhere (auth.users) that call public functions
  for r in select t.tgname, t.tgrelid::regclass as tbl from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_class c on c.oid = t.tgrelid
           where not t.tgisinternal and p.pronamespace = 'public'::regnamespace and c.relnamespace <> 'public'::regnamespace loop
    execute format('drop trigger %I on %s', r.tgname, r.tbl);
  end loop;
  for r in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('v','m') loop
    execute format('drop view if exists public.%I cascade', r.relname);
  end loop;
  for r in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p') loop
    execute format('drop table if exists public.%I cascade', r.relname);
  end loop;
  for r in select oid::regprocedure as fn from pg_proc where pronamespace = 'public'::regnamespace loop
    execute format('drop function if exists %s cascade', r.fn);
  end loop;
  for r in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'S' loop
    execute format('drop sequence if exists public.%I cascade', r.relname);
  end loop;
  for r in select t.typname from pg_type t left join pg_class c on c.oid = t.typrelid
           where t.typnamespace = 'public'::regnamespace
             and (t.typtype in ('e','d') or (t.typtype = 'c' and c.relkind = 'c')) loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;
end $$;
drop schema if exists v2dev cascade;
