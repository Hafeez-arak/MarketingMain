-- ─── v2: Documents in the Ctrl/⌘+K search ───────────────────────────────────
-- 2026-10-29, docs/SHELL.md ("To add a new module to the search"). One SQL
-- function with the same shape as the others: SECURITY INVOKER, so the
-- documents' own RLS decides what comes back (a confidential document or an
-- employee's paper is found only by someone allowed to read it), and it names
-- its company. Matches the document's number, title, type, issuer, the
-- number printed on it and its DOC- number; archived ones come last.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create or replace function public.shell_search_documents(ws uuid, q text, lim integer default 5)
returns table (kind text, id uuid, title text, title_ar text, detail text, detail_ar text, meta jsonb, rank integer)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (select public.shell_fold(q) as fq, least(greatest(coalesce(lim, 5), 1), 20) as n)
  select 'document'::text, d.id, d.title, d.title,
         concat_ws(' · ', d.document_no, coalesce(t.name_en, t.name), d.number),
         concat_ws(' · ', d.document_no, t.name, d.number),
         jsonb_build_object('state', case when d.archived_at is not null then 'archived' when d.confirmed_at is null then 'draft' else 'confirmed' end),
         public.shell_rank(a.fq, array[d.title, d.document_no, d.number]) + case when d.archived_at is null then 0 else 10 end as r
    from public.company_documents d
    join public.document_types t on t.id = d.type_id and t.workspace_id = d.workspace_id, a
   where d.workspace_id = ws
     and public.shell_hits(public.shell_fold(concat_ws(' ', d.document_no, d.title, d.number, d.issuer, t.name, t.name_en)), a.fq)
   order by r, d.title, d.id
   limit (select n from a);
$$;
grant execute on function public.shell_search_documents(uuid, text, integer) to authenticated;
