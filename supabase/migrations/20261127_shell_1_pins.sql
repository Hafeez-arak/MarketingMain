-- ─── v2 shell: the sections each person pins to the left bar ───────────────
-- 2026-10-28, docs/SHELL.md. The owner: "not everyone will have all
-- modules"; the left bar keeps the ones a person uses most, and the grid
-- button at its top opens every module they may open.
--
--   shell_pins   one row per person per company: the section keys they
--                pinned, in no particular order (the rail draws them in
--                the registry's order, src/lib/modules.js). No row = never
--                chosen, and the app pins the sections they work in or
--                manage (src/lib/shell/pins.js).
--
-- A pin is a preference, not access: a pinned section the person loses is
-- simply not drawn (the app filters by section_access), and the key stays
-- so it comes back if the grant does. The database never trusts a pin for
-- anything.
--
-- Each person reads and writes only their own row, and only in a company
-- they belong to.
--
-- Also here: shell_fold(), the one text folding the search functions in
-- 20261127_shell_2_search.sql use, the same as Contacts' search in the
-- browser (src/lib/contacts/logic.js normalizeSearch): lower case, Arabic
-- diacritics and tatweel out, أ إ آ → ا, ة → ه, ى → ي.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create table if not exists public.shell_pins (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Section keys ('marketing', 'crm' …): short lower-case words, at most 50.
  sections     text[] not null default '{}'
               check (cardinality(sections) <= 50
                      and array_to_string(sections, ',') ~ '^([a-z_]{1,32}(,[a-z_]{1,32})*)?$'),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.shell_pins enable row level security;

revoke all on public.shell_pins from anon, authenticated;
grant select, insert, update, delete on public.shell_pins to authenticated;

drop policy if exists shell_pins_own_read on public.shell_pins;
create policy shell_pins_own_read on public.shell_pins
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists shell_pins_own_add on public.shell_pins;
create policy shell_pins_own_add on public.shell_pins
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));

drop policy if exists shell_pins_own_change on public.shell_pins;
create policy shell_pins_own_change on public.shell_pins
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));

drop policy if exists shell_pins_own_remove on public.shell_pins;
create policy shell_pins_own_remove on public.shell_pins
  for delete to authenticated
  using (user_id = auth.uid());

/** Text as the search compares it: see the header. */
create or replace function public.shell_fold(s text)
returns text
language sql
immutable
parallel safe
as $$
  select btrim(regexp_replace(
           translate(regexp_replace(lower(coalesce(s, '')), '[ً-ْـ]', '', 'g'), 'أإآةى', 'اااهي'),
           '\s+', ' ', 'g'));
$$;

grant execute on function public.shell_fold(text) to authenticated;
