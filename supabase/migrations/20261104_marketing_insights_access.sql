-- ─── v2: Marketing and Insights data locked to their sections ──────────────
-- 2026-10-19. 20261101_section_access put Sales and CEO data behind
-- has_section(). Marketing and Insights data stayed readable and writable by
-- every member of the company, as in v1. This file closes that:
--
--   read    a member granted one of the table's READ sections (view or more)
--   change  a member granted one of the table's WRITE sections at work or more
--
-- The access admin passes every check (has_section). Sales seats are not
-- company members: the policies they had (*_sales_read on research tables)
-- are left exactly as they were, as are the anon policies on the legacy
-- workspace's retired Instagram tables. Only the member-wide policies on the
-- tables below are replaced.
--
-- Some tables are read by more than one section's screens, and say so:
--   · Insights' Analytics reads posts, social accounts and post analytics;
--   · Research sends ideas to a content plan (plan_ideas, idea_events);
--   · the planner reads research runs and the research digest;
--   · Sales' Target accounts reads and marks research opportunities and
--     events, and Email offers opportunities as outreach.
--
-- Left as they were, because they belong to no single section: the
-- assistant's threads (research_chats, research_messages), AI spending
-- (agent_usage, agent_cap_log, agent_edit_log), webhooks, subscriptions,
-- requests, notifications, tasks and meetings.
--
-- Not covered by RLS: the server routes that use the service key. The Email
-- and Zernio routes ask has_section(…, 'marketing', 'work') themselves
-- (api/leads/_sectionAccess.js → sectionGate). The assistant reads with the
-- service key after a membership check, as before.
--
-- v2 ONLY. Applied to the local v2 database (dev/v2db). Safe to re-run.

/** has_section() for any of several sections. */
create or replace function public.has_any_section(ws uuid, secs text[], min_level text default 'view')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_workspace_member(ws) and (
    public.is_access_admin()
    or exists (
      select 1 from public.section_access a
       where a.workspace_id = ws
         and a.user_id = auth.uid()
         and a.section = any(secs)
         and public.section_rank(a.level) >= public.section_rank(min_level)
    )
  );
$$;
grant execute on function public.has_any_section(uuid, text[], text) to authenticated;

do $$
declare
  -- table, read sections, write sections, what may be written:
  --   all = insert/update/delete · update · insert · none (read only)
  spec constant text[][] := array[
    -- ── Marketing: Brand Brain ──
    ['brand_profile',            'marketing',                 'marketing',           'all'],
    ['brand_fields',             'marketing',                 'marketing',           'all'],
    ['brand_sections',           'marketing',                 'marketing',           'all'],
    ['brand_products',           'marketing',                 'marketing',           'all'],
    ['brand_suppliers',          'marketing',                 'marketing',           'all'],
    ['brand_assets',             'marketing',                 'marketing',           'all'],
    ['brand_memory',             'marketing',                 'marketing',           'all'],
    ['brand_message_templates',  'marketing',                 'marketing',           'all'],
    ['brand_directory_rows',     'marketing',                 'marketing',           'all'],
    ['brand_directory_columns',  'marketing',                 'marketing',           'all'],
    ['brand_edit_feedback',      'marketing',                 'marketing',           'all'],
    -- ── Marketing: planning, studio, publishing ──
    ['content_plans',            'marketing',                 'marketing',           'all'],
    ['plan_ideas',               'marketing,insights',        'marketing,insights',  'all'],
    ['idea_events',              'marketing,insights',        'marketing,insights',  'insert'],
    ['generated_posts',          'marketing,insights',        'marketing',           'all'],
    ['creative_sessions',        'marketing',                 'marketing',           'all'],
    ['creative_versions',        'marketing',                 'marketing',           'all'],
    ['media_library',            'marketing',                 'marketing',           'all'],
    ['social_accounts',          'marketing,insights',        'marketing',           'all'],
    ['social_connections',       'marketing',                 'marketing',           'all'],
    ['post_analytics',           'marketing,insights',        'marketing,insights',  'all'],
    ['account_analytics',        'marketing,insights',        'marketing,insights',  'all'],
    ['instagram_generated_posts','marketing',                 'marketing',           'all'],
    ['instagram_manual_posts',   'marketing',                 'marketing',           'all'],
    ['instagram_reels',          'marketing',                 'marketing',           'all'],
    ['instagram_schedule',       'marketing',                 'marketing',           'all'],
    -- ── Marketing: email ──
    ['email_campaigns',          'marketing',                 'marketing',           'all'],
    ['email_contacts',           'marketing',                 'marketing',           'all'],
    ['email_groups',             'marketing',                 'marketing',           'all'],
    ['email_group_members',      'marketing',                 'marketing',           'all'],
    ['email_settings',           'marketing',                 'marketing',           'all'],
    ['email_ai_drafts',          'marketing',                 'marketing',           'update'],
    ['email_group_exclusions',   'marketing',                 '',                    'none'],
    ['email_events',             'marketing',                 '',                    'none'],
    ['email_sends',              'marketing',                 '',                    'none'],
    ['email_mailboxes',          'marketing',                 '',                    'none'],
    -- ── Insights: research and competitors ──
    ['research_runs',            'insights,marketing,sales',  'insights',            'all'],
    ['research_opportunities',   'insights,marketing,sales',  'insights,marketing,sales', 'all'],
    ['research_events',          'insights,sales',            'insights,sales',      'all'],
    ['research_agenda',          'insights',                  'insights',            'all'],
    ['research_signals',         'insights',                  'insights',            'all'],
    ['research_lens_results',    'insights',                  'insights',            'all'],
    ['research_findings',        'insights',                  '',                    'none'],
    ['research_source_checks',   'insights',                  '',                    'none'],
    ['competitor_brands',        'insights',                  'insights',            'all'],
    ['competitor_snapshots',     'insights',                  '',                    'none'],
    ['brand_competitors',        'insights,marketing',        'insights',            'all'],
    ['deal_outcomes',            'insights',                  'insights',            'all'],
    ['agent_notes',              'insights',                  'insights',            'all'],
    ['agent_digest',             'insights,marketing',        'insights',            'all']
  ];
  r text[];
  t text; rd text; wr text; how text;
  p record;
begin
  foreach r slice 1 in array spec loop
    t := r[1]; rd := r[2]; wr := r[3]; how := r[4];
    if to_regclass('public.' || t) is null then
      raise notice 'skipped %: no such table', t;
      continue;
    end if;

    -- Drop the member-wide policies: those for signed-in people that test
    -- company membership. The sales seats' and the anon legacy policies do
    -- not, and stay.
    for p in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t
         and ('authenticated' = any(roles) or 'public' = any(roles))
         and policyname not like '%\_section\_%'
         and policyname not like '%sales%'
         and coalesce(qual, with_check, '') ~ '(is_workspace_member|workspace_members)'
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;

    execute format('drop policy if exists %I on public.%I', t || '_section_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_any_section(workspace_id, %L::text[], ''view''))',
      t || '_section_read', t, '{' || rd || '}');

    foreach how in array array['insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_section_' || how, t);
    end loop;
    if r[4] = 'none' then continue; end if;

    if r[4] in ('all', 'insert') then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.has_any_section(workspace_id, %L::text[], ''work''))',
        t || '_section_insert', t, '{' || wr || '}');
    end if;
    if r[4] in ('all', 'update') then
      execute format(
        'create policy %I on public.%I for update to authenticated using (public.has_any_section(workspace_id, %L::text[], ''work'')) with check (public.has_any_section(workspace_id, %L::text[], ''work''))',
        t || '_section_update', t, '{' || wr || '}', '{' || wr || '}');
    end if;
    if r[4] = 'all' then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (public.has_any_section(workspace_id, %L::text[], ''work''))',
        t || '_section_delete', t, '{' || wr || '}');
    end if;
  end loop;
end;
$$;
