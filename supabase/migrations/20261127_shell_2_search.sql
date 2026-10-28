-- ─── v2 shell: the Ctrl/Cmd+K search, one function per module ──────────────
-- 2026-10-28, docs/SHELL.md. The palette (src/components/layout/SearchPalette.jsx)
-- asks each module the person may open for a few matching records. The
-- browser cannot fold Arabic letter forms in a PostgREST filter, and
-- reading a whole book to search it in the browser does not scale, so each
-- module answers here:
--
--   shell_search_contacts   organisations and people
--   shell_search_crm        opportunities
--   shell_search_hr         employees
--   shell_search_leads      Sales' leads
--   shell_search_tasks      tasks
--   shell_search_requests   requests
--
-- Every one is SECURITY INVOKER: it runs as the person, so the table's own
-- RLS (the section grant, a salesperson's own leads, a request's people)
-- decides what comes back, exactly as on the module's pages. Each also names
-- its company (workspace_id = ws): RLS is membership, not isolation.
--
-- One shape for all: kind, id, title, title_ar, detail, detail_ar, meta
-- (what the browser needs to build the link), rank (0 best). Matching: every
-- word of the query appears somewhere in the record's searchable text, both
-- folded by shell_fold() (20261127_shell_1_pins.sql). Ranking: the name is
-- the query, starts with it, has a word starting with it, or only contains
-- it somewhere; closed, archived and done records after open ones. At most
-- `lim` rows of each kind (1–20).
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

/** Does folded text `hay` hold every word of the folded query `fq`? */
create or replace function public.shell_hits(hay text, fq text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(fq, '') <> ''
     and not exists (select 1 from unnest(string_to_array(fq, ' ')) as w(word)
                      where w.word <> '' and strpos(coalesce(hay, ''), w.word) = 0);
$$;

/** 0 a name is the query, 1 starts with it, 2 has a word starting with it, 3 otherwise. */
create or replace function public.shell_rank(fq text, names text[])
returns integer
language sql
immutable
parallel safe
as $$
  select coalesce(min(case when f.n = fq then 0
                           when left(f.n, length(fq)) = fq then 1
                           when strpos(' ' || f.n, ' ' || fq) > 0 then 2
                           else 3 end), 3)
    from unnest(names) as x(raw)
   cross join lateral (select public.shell_fold(x.raw) as n) f
   where x.raw is not null and f.n <> '';
$$;

create or replace function public.shell_search_contacts(ws uuid, q text, lim integer default 5)
returns table (kind text, id uuid, title text, title_ar text, detail text, detail_ar text, meta jsonb, rank integer)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (select public.shell_fold(q) as fq, least(greatest(coalesce(lim, 5), 1), 20) as n)
  (select 'org'::text, o.id, o.name, o.name_ar,
          concat_ws(' · ', o.contact_no, o.city), concat_ws(' · ', o.contact_no, o.city),
          jsonb_build_object('archived', o.status = 'archived'),
          public.shell_rank(a.fq, array[o.name, o.name_ar, o.contact_no]) + case when o.status = 'archived' then 10 else 0 end as r
     from public.contacts_orgs o, a
    where o.workspace_id = ws
      and public.shell_hits(public.shell_fold(concat_ws(' ', o.name, o.name_ar, o.contact_no, o.vat_number, o.cr_number,
                                                        o.city, o.email, o.phone)), a.fq)
    order by r, o.name, o.id
    limit (select n from a))
  union all
  (select 'person'::text, p.id, p.name, p.name_ar,
          concat_ws(' · ', p.job_title, org.name), concat_ws(' · ', p.job_title, coalesce(org.name_ar, org.name)),
          jsonb_build_object('org_id', p.org_id),
          public.shell_rank(a.fq, array[p.name, p.name_ar]) as r
     from public.contacts_people p
     left join public.contacts_orgs org on org.id = p.org_id and org.workspace_id = ws
    cross join a
    where p.workspace_id = ws
      and public.shell_hits(public.shell_fold(concat_ws(' ', p.name, p.name_ar, p.email, p.phone, p.job_title)), a.fq)
    order by r, p.name, p.id
    limit (select n from a));
$$;

create or replace function public.shell_search_crm(ws uuid, q text, lim integer default 5)
returns table (kind text, id uuid, title text, title_ar text, detail text, detail_ar text, meta jsonb, rank integer)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (select public.shell_fold(q) as fq, least(greatest(coalesce(lim, 5), 1), 20) as n)
  select 'opportunity'::text, l.id, l.title, null::text,
         concat_ws(' · ', l.lead_no, l.organization), concat_ws(' · ', l.lead_no, l.organization),
         jsonb_build_object('status', l.status),
         public.shell_rank(a.fq, array[l.title, l.lead_no, l.organization]) + case when l.status = 'open' then 0 else 10 end as r
    from public.crm_leads l, a
   where l.workspace_id = ws
     and public.shell_hits(public.shell_fold(concat_ws(' ', l.title, l.lead_no, l.contact_name, l.organization, l.email,
                                                       l.phone, l.tender_ref, l.city)), a.fq)
   order by r, l.updated_at desc, l.id
   limit (select n from a);
$$;

create or replace function public.shell_search_hr(ws uuid, q text, lim integer default 5)
returns table (kind text, id uuid, title text, title_ar text, detail text, detail_ar text, meta jsonb, rank integer)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (select public.shell_fold(q) as fq, least(greatest(coalesce(lim, 5), 1), 20) as n)
  select 'employee'::text, e.id, e.name_en, e.name_ar,
         concat_ws(' · ', e.employee_no, e.job_title), concat_ws(' · ', e.employee_no, e.job_title),
         jsonb_build_object('status', e.status),
         public.shell_rank(a.fq, array[e.name_en, e.name_ar, e.employee_no]) + case when e.status = 'active' then 0 else 10 end as r
    from public.hr_employees e, a
   where e.workspace_id = ws
     and public.shell_hits(public.shell_fold(concat_ws(' ', e.name_en, e.name_ar, e.employee_no, e.job_title,
                                                       e.work_email, e.work_phone)), a.fq)
   order by r, e.name_en, e.id
   limit (select n from a);
$$;

create or replace function public.shell_search_leads(ws uuid, q text, lim integer default 5)
returns table (kind text, id uuid, title text, title_ar text, detail text, detail_ar text, meta jsonb, rank integer)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (select public.shell_fold(q) as fq, least(greatest(coalesce(lim, 5), 1), 20) as n)
  select 'lead'::text, l.id,
         coalesce(nullif(btrim(l.company), ''), nullif(btrim(l.name), ''), nullif(btrim(l.email), ''), l.subject), null::text,
         concat_ws(' · ', case when nullif(btrim(l.company), '') is not null then nullif(btrim(l.name), '') end,
                   to_char(l.received_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD')),
         concat_ws(' · ', case when nullif(btrim(l.company), '') is not null then nullif(btrim(l.name), '') end,
                   to_char(l.received_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD')),
         jsonb_build_object('stage', l.stage, 'email', nullif(btrim(l.email), ''), 'company', nullif(btrim(l.company), ''),
                            'name', nullif(btrim(l.name), '')),
         public.shell_rank(a.fq, array[l.company, l.name, l.email]) as r
    from public.leads l, a
   where l.workspace_id = ws
     and public.shell_hits(public.shell_fold(concat_ws(' ', l.company, l.name, l.email, l.subject)), a.fq)
   order by r, l.received_at desc nulls last, l.id
   limit (select n from a);
$$;

create or replace function public.shell_search_tasks(ws uuid, q text, lim integer default 5)
returns table (kind text, id uuid, title text, title_ar text, detail text, detail_ar text, meta jsonb, rank integer)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (select public.shell_fold(q) as fq, least(greatest(coalesce(lim, 5), 1), 20) as n)
  select 'task'::text, t.id, t.title, null::text, null::text, null::text,
         jsonb_build_object('status', t.status, 'due_at', t.due_at),
         public.shell_rank(a.fq, array[t.title]) + case when t.status in ('done', 'cancelled') then 10 else 0 end as r
    from public.tasks t, a
   where t.workspace_id = ws
     and public.shell_hits(public.shell_fold(concat_ws(' ', t.title, t.details)), a.fq)
   order by r, t.due_at nulls last, t.id
   limit (select n from a);
$$;

create or replace function public.shell_search_requests(ws uuid, q text, lim integer default 5)
returns table (kind text, id uuid, title text, title_ar text, detail text, detail_ar text, meta jsonb, rank integer)
language sql
stable
security invoker
set search_path = public
as $$
  with a as (select public.shell_fold(q) as fq, least(greatest(coalesce(lim, 5), 1), 20) as n)
  select 'request'::text, r.id, r.title, null::text, null::text, null::text,
         jsonb_build_object('status', r.status, 'kind', r.kind),
         public.shell_rank(a.fq, array[r.title]) + case when r.status in ('done', 'declined') then 10 else 0 end as rk
    from public.requests r, a
   where r.workspace_id = ws
     and public.shell_hits(public.shell_fold(concat_ws(' ', r.title, r.body)), a.fq)
   order by rk, r.created_at desc, r.id
   limit (select n from a);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.shell_hits(text, text)', 'public.shell_rank(text, text[])',
    'public.shell_search_contacts(uuid, text, integer)', 'public.shell_search_crm(uuid, text, integer)',
    'public.shell_search_hr(uuid, text, integer)', 'public.shell_search_leads(uuid, text, integer)',
    'public.shell_search_tasks(uuid, text, integer)', 'public.shell_search_requests(uuid, text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
