-- ─── The sales team reads the research (2026-10-19) ──────────────────────
-- The sales app has a Research page beside Leads: the weekly research in its
-- "Sales" view (top priorities, leads and tenders, competitor moves, events,
-- smart poles), so the people who sell know what the research found. It is
-- the same research the marketing team reads, not a second brief written for
-- sales: no extra model call.
--
-- Read only. A sales seat is not a member of the company (20261013), so the
-- member policies below each of these tables let nothing through; these add
-- SELECT by seat and nothing else. Statuses, event decisions and the watchlist
-- stay the marketing team's to change.
--
-- The page hides the marketing sections, but research_runs.report is the
-- whole report: a sales seat could read every section by asking the database
-- directly. That is accepted; nothing in it is secret from the sales team.
-- research_signals (competitors' social posts) is left out because the sales
-- view does not show it.

drop policy if exists research_runs_sales_read on public.research_runs;
create policy research_runs_sales_read on public.research_runs
  for select to authenticated using (public.is_sales_member(workspace_id));

-- Per-lens progress, for the "research is running" strip.
drop policy if exists research_lens_results_sales_read on public.research_lens_results;
create policy research_lens_results_sales_read on public.research_lens_results
  for select to authenticated using (public.is_sales_member(workspace_id));

-- The lead and tender tracker, and the events.
drop policy if exists research_opportunities_sales_read on public.research_opportunities;
create policy research_opportunities_sales_read on public.research_opportunities
  for select to authenticated using (public.is_sales_member(workspace_id));
drop policy if exists research_events_sales_read on public.research_events;
create policy research_events_sales_read on public.research_events
  for select to authenticated using (public.is_sales_member(workspace_id));

-- The watchlist: competitor moves only show rivals still being watched.
drop policy if exists research_agenda_sales_read on public.research_agenda;
create policy research_agenda_sales_read on public.research_agenda
  for select to authenticated using (public.is_sales_member(workspace_id));
