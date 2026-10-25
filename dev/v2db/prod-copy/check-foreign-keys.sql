-- Every foreign key, checked by hand: the load runs with triggers off, so
-- Postgres did not check them. Prints "orphans: none" or the broken ones.
do $$ declare r record; n int; bad text := ''; begin
for r in select conrelid::regclass tbl, confrelid::regclass ref, conname,
  (select string_agg(format('c.%I', a.attname), ',' order by k.ord) from unnest(conkey) with ordinality k(att, ord) join pg_attribute a on a.attrelid=conrelid and a.attnum=k.att) lc,
  (select string_agg(format('p.%I', a.attname), ',' order by k.ord) from unnest(confkey) with ordinality k(att, ord) join pg_attribute a on a.attrelid=confrelid and a.attnum=k.att) rc
  from pg_constraint where contype='f' and connamespace='public'::regnamespace loop
  execute format('select count(*) from %s c where (%s) is not null and not exists (select 1 from %s p where (%s) = (%s))', r.tbl, replace(r.lc, ',', ') is not null and ('), r.ref, r.rc, r.lc) into n;
  if n > 0 then bad := bad || r.conname || '=' || n || ' '; end if;
end loop; raise warning 'orphans: %', coalesce(nullif(bad,''),'none'); end $$;
