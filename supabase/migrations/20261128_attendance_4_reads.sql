-- ─── v2 HR attendance, part 4: what the devices screen counts ──────────────
-- 2026-10-28, dev/erp-pilot/ATTENDANCE.md. His devices screen shows, per
-- device, its punches and the last one; per number the devices know, its
-- punches and last day; and which employees' numbers are locked (the device
-- already made records under them). The browser cannot group through the
-- API, so this counts in the database, as the person (SECURITY INVOKER: the
-- tables' own RLS applies), for one company.
--
-- v2 ONLY: the local v2 database (dev/v2db). Safe to re-run.

create or replace function public.hr_device_overview(ws uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'devices', coalesce((select jsonb_agg(jsonb_build_object('device_id', x.device_id, 'punches', x.n, 'last_punch', x.last_punch,
                                                             'last_sync', x.last_sync, 'users', x.users))
                           from (select d.id as device_id,
                                        (select count(*) from public.hr_punches p where p.device_id = d.id) as n,
                                        (select max(p.local_time) from public.hr_punches p where p.device_id = d.id) as last_punch,
                                        (select to_jsonb(s) - 'workspace_id' from (select id, source, received, inserted, rejected, users_reported, device_serial,
                                                device_model, device_firmware, device_time, created_at from public.hr_device_syncs s2
                                               where s2.device_id = d.id order by created_at desc limit 1) s) as last_sync,
                                        (select count(*) from public.hr_device_users u where u.device_id = d.id) as users
                                   from public.hr_devices d where d.workspace_id = ws) x), '[]'),
    'numbers', coalesce((select jsonb_agg(jsonb_build_object('no', p.device_user_no, 'punches', p.n, 'last_day', p.last_day))
                           from (select device_user_no, count(*) as n, max(work_day) as last_day
                                   from public.hr_punches where workspace_id = ws group by device_user_no) p), '[]'),
    'locked', coalesce((select jsonb_agg(distinct a.employee_id) from public.hr_attendance a
                         where a.workspace_id = ws and a.device_day is not null), '[]')
  );
$$;
revoke all on function public.hr_device_overview(uuid) from public, anon;
grant execute on function public.hr_device_overview(uuid) to authenticated;
