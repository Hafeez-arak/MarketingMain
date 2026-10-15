-- 20261019_db_hardening.sql — clears the Supabase security scan (2026-10-15).
-- Applied by hand through the Supabase MCP, like every migration here.

-- 1. The only ERROR in the scan: a SECURITY DEFINER view on the retired
--    Instagram schedule table. Nothing reads it — no app code, no workflow,
--    no other view (checked with pg_depend) — and it was never in a migration.
drop view if exists public.todays_instagram_schedule;

-- 2. Four functions with a role-mutable search_path. Pinned to public, which is
--    where every table they touch lives.
alter function public.set_updated_at() set search_path = public;
alter function public.update_updated_at_column() set search_path = public;
alter function public.generated_post_is_locked(public.generated_posts) set search_path = public;
alter function public.generated_posts_lock_sent() set search_path = public;

-- 3. SECURITY DEFINER functions a signed-out visitor could call through
--    /rest/v1/rpc. Every one already refuses an unauthorised caller, so this is
--    defence in depth, not a fix for an open hole. Only functions used by NO
--    row-level-security policy are closed: is_workspace_member and
--    is_access_admin sit in policies that anon requests also evaluate, and
--    revoking them would turn "no rows" into a permission error on the
--    sign-in page and the public sign-up form.
do $$
declare f text;
begin
  foreach f in array array[
    'approve_access(uuid)', 'can_approve_leads(uuid)', 'cancel_invite(text)',
    'create_company(text, uuid[])', 'invite_access(text, uuid[], text)',
    'is_sales_access()', 'my_sales_companies()', 'revoke_access(uuid)',
    'sales_team(uuid)', 'set_user_role(uuid, text)', 'set_user_workspaces(uuid, uuid[])',
    'sync_workspace_roster()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
