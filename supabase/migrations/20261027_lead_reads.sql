-- ─── Read and unread leads (2026-10-19) ───────────────────────────────────
-- The owner: a lead shows as unread (a dot, the name in bold) until the
-- person opens it, for the admin and the sales team alike. Each person has
-- their own: Arif opening a lead does not mark it read for Haitham. A lead
-- assigned to someone becomes unread for them again (api/leads/_assign.js).
-- Everything that arrived before 14 October 2026 counts as read.
--
-- A person marks their own leads read or unread from the page; they can only
-- write their own rows, and only for a lead they can see (the leads policy
-- answers inside the check).

create table if not exists public.lead_reads (
  lead_id      uuid not null references public.leads(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  read_at      timestamptz not null default now(),
  primary key (lead_id, user_id)
);
create index if not exists lead_reads_user on public.lead_reads (user_id, workspace_id);

alter table public.lead_reads enable row level security;

drop policy if exists lead_reads_own on public.lead_reads;
create policy lead_reads_own on public.lead_reads
  for select to authenticated using (user_id = auth.uid());

drop policy if exists lead_reads_mark on public.lead_reads;
create policy lead_reads_mark on public.lead_reads
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.leads l where l.id = lead_reads.lead_id and l.workspace_id = lead_reads.workspace_id)
  );

drop policy if exists lead_reads_unmark on public.lead_reads;
create policy lead_reads_unmark on public.lead_reads
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, delete on public.lead_reads to authenticated;

-- Leads that arrived before this moment count as read for everyone.
alter table public.lead_agent_settings add column if not exists read_before timestamptz;
update public.lead_agent_settings set read_before = '2026-10-14T00:00:00+03:00' where read_before is null;

-- Readable by the team and the admin (the settings row itself is admin only).
create or replace function public.lead_read_before(ws uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select s.read_before from public.lead_agent_settings s
   where s.workspace_id = ws
     and (public.is_sales_member(ws) or public.is_workspace_member(ws));
$$;
grant execute on function public.lead_read_before(uuid) to authenticated;
