-- ─── v2 Catalog, part 3: the Ctrl/Cmd+K search ─────────────────────────────
-- 2026-10-30. Same shape and rules as the other shell_search_* functions
-- (20261127_shell_2_search.sql): SECURITY INVOKER, so the catalog's own RLS
-- decides what comes back; names its company; rows are kind, id, title,
-- title_ar, detail, detail_ar, meta, rank (0 best); at most `lim` rows (1–20).
-- Matches code, name, brand, model number and category; stopped items rank
-- after active ones.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create or replace function public.shell_search_catalog(ws uuid, q text, lim integer default 5)
returns table (kind text, id uuid, title text, title_ar text, detail text, detail_ar text, meta jsonb, rank integer)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (select public.shell_fold(q) as fq, least(greatest(coalesce(lim, 5), 1), 20) as n)
  select 'item'::text, i.id, i.name, null::text,
         concat_ws(' · ', i.code, i.brand, i.model_no), concat_ws(' · ', i.code, i.brand, i.model_no),
         jsonb_build_object('active', i.active),
         public.shell_rank(a.fq, array[i.name, i.code, i.model_no]) + case when i.active then 0 else 10 end as r
    from public.catalog_items i, a
   where i.workspace_id = ws
     and public.shell_hits(public.shell_fold(concat_ws(' ', i.code, i.name, i.brand, i.model_no, i.category)), a.fq)
   order by r, i.name, i.id
   limit (select n from a);
$$;

revoke all on function public.shell_search_catalog(uuid, text, integer) from public, anon;
grant execute on function public.shell_search_catalog(uuid, text, integer) to authenticated;
