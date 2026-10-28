import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Skeleton, Spinner } from '../../../components/ui/index'
import { useT } from '../../../lib/i18n'
import { nameOf, riyadhToday } from '../../../lib/hr/logic'
import { buildDays, clock, hm, scheduleLabel } from '../../../lib/hr/attendance'
import { fetchLeaveRequests } from '../../../lib/hr/client'
import { fetchRecordsBetween, fetchOpenRecords, fetchPunchDays, fetchFlags, fetchDeviceUsers, toggleAttendance } from '../../../lib/hr/attendanceClient'
import { ErrorText, NoAccess, Pill } from '../parts'
import { AttHeader, StatusPill, Flash } from './shared'
import { useAttendanceBase, useFlash } from './useAttendance'
import { AW } from './words'

// ─── HR → Attendance → Today (v2), his board ───────────────────────────────
// 2026-10-28, dev/erp-pilot/ATTENDANCE.md. A card per active employee: the
// planned hours, arrival, departure and hours, where the day came from.
// Without a device, Work checks people in and out with a button. With a
// running device the punches decide: no buttons (his team's decision), and
// people the device knows but nobody linked show from their punches.

export function AttendanceToday() {
  const { t, lang, dir } = useT(AW)
  const a = useAttendanceBase()
  const { ws, level, can, employees, settings, deviceMode, leaveTypes } = a
  const today = riyadhToday()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [flash, setFlash] = useFlash()

  const load = useCallback(async () => {
    if (!ws) return
    const [r, o, l, p, f, u] = await Promise.all([
      fetchRecordsBetween(ws, today, today), fetchOpenRecords(ws), fetchLeaveRequests(ws, { from: today, to: today }),
      fetchPunchDays(ws, { from: today, to: today, all: true }), fetchFlags(ws, { from: today, to: today, kinds: ['late'], all: true }), fetchDeviceUsers(ws),
    ])
    setData({ records: r.rows, open: o.rows, leaves: l.rows.filter(x => x.status === 'approved'), punchDays: p.rows, flags: f.rows, deviceUsers: u.rows })
    setError(r.error || o.error || l.error || p.error || f.error || u.error || '')
  }, [ws, today])
  useEffect(() => { queueMicrotask(load) }, [load])

  const active = useMemo(() => (employees || []).filter(e => e.status === 'active').sort((x, y) => nameOf(x, lang).localeCompare(nameOf(y, lang), lang)), [employees, lang])
  const days = useMemo(() => (data && settings !== undefined
    ? buildDays({ employees: active, from: today, to: today, settings, records: data.records, punchDays: data.punchDays, flags: data.flags, leaves: data.leaves, leaveTypes, lang })
    : null), [data, active, today, settings, leaveTypes, lang])

  if (!level) return <NoAccess />
  if (!a.ready || !days) return <div className="max-w-6xl space-y-4" dir={dir}><AttHeader tab="today" /><Skeleton className="h-64" /></div>

  const onLeave = new Set(data.leaves.map(l => l.employee_id))
  const openBy = new Map(data.open.map(r => [r.employee_id, r]))
  const punchedBy = new Map(data.punchDays.filter(p => p.employee_id).map(p => [p.employee_id, p]))
  const todayRecs = new Set(data.records.map(r => r.employee_id))
  // Everyone on the device not linked to an employee (his team's request, 2026-10-27).
  const linkedNos = new Set((employees || []).filter(e => e.device_user_no).map(e => e.device_user_no))
  const unlinked = deviceMode ? [...new Set([...data.deviceUsers.map(u => u.device_user_no), ...data.punchDays.filter(p => !p.employee_id).map(p => p.device_user_no)])]
    .filter(no => !linkedNos.has(no))
    .map(no => ({ no, name: data.deviceUsers.find(u => u.device_user_no === no)?.name || null, day: data.punchDays.find(p => !p.employee_id && p.device_user_no === no) || null }))
    .sort((x, y) => (x.day ? 0 : 1) - (y.day ? 0 : 1) || (x.name || `~${x.no}`).localeCompare(y.name || `~${y.no}`)) : []
  let present = deviceMode ? punchedBy.size : data.open.length
  let none = active.filter(e => !onLeave.has(e.id) && (deviceMode ? !punchedBy.has(e.id) : !todayRecs.has(e.id) && !openBy.has(e.id))).length
  present += unlinked.filter(u => u.day).length
  none += unlinked.filter(u => !u.day).length

  async function press(e) {
    setBusy(e.id); setError('')
    const out = await toggleAttendance(ws, e.id)
    setBusy('')
    if (out.error) { setError(out.error); return }
    setFlash(out.row === 'in' ? t.checkedIn(nameOf(e, lang)) : t.checkedOut(nameOf(e, lang)))
    load()
  }

  const stat = (label, n) => (
    <div className="bg-white border border-border px-4 py-3"><p className="text-[11px] text-text-tertiary">{label}</p><p className="text-2xl font-semibold tabular-nums mt-1">{n}</p></div>
  )

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <AttHeader tab="today" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {stat(deviceMode ? t.statPunched : t.statPresent, present)}
        {stat(t.statLeave, onLeave.size)}
        {stat(deviceMode ? t.statNotPunched : t.statNone, none)}
        {stat(t.statLate, data.flags.length)}
      </div>
      {deviceMode && <p className="text-[11px] text-text-tertiary">{t.deviceHint}</p>}
      <Flash msg={flash} />
      <ErrorText error={error || a.error || a.attError} />
      {!active.length && !unlinked.length ? <p className="text-sm text-text-secondary py-6">{t.noEmployees}</p> : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {active.map(e => {
            const d = days[e.id][today]
            const open = openBy.get(e.id)
            const leave = onLeave.has(e.id)
            const late = data.flags.find(f => f.employee_id === e.id)
            return (
              <li key={e.id} className="bg-white border border-border rounded-xl p-3 flex flex-col gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-full bg-stone-100 text-text font-semibold text-sm flex items-center justify-center flex-shrink-0">{nameOf(e, lang).slice(0, 1)}</span>
                  <div className="min-w-0">
                    <Link to={`/hr/employee?id=${e.id}`} className="block text-sm font-medium text-text truncate hover:underline">{nameOf(e, lang)}</Link>
                    <p className="text-[11px] text-text-tertiary truncate">{e.device_user_no && <bdi dir="ltr">#{e.device_user_no}</bdi>}{e.device_user_no && e.job_title ? ' · ' : ''}{e.job_title}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {leave ? <Pill tone="blue">{t.statuses.leave}{typeof d.leave === 'string' && d.leave ? ` — ${d.leave}` : ''}</Pill>
                    : deviceMode && !e.device_user_no && !d.source ? <Pill>{t.notLinked}</Pill>
                      : open ? <StatusPill status="present" />
                        : d.status === 'left' || d.status === 'present' ? <StatusPill status={d.status} />
                          : <Pill>{deviceMode ? t.statNotPunched : t.statuses.not_yet}</Pill>}
                  {late && <Pill tone="red">{t.lateMin(late.minutes)}</Pill>}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <Time label={t.schedule} value={d.scheduled || t.dash} />
                  <Time label={t.arrival} value={clock(d.arrival)} warn={d.late && !d.lateExcuse} />
                  <Time label={t.departure} value={clock(d.departure)} warn={d.early && !d.earlyExcuse} />
                  <Time label={open ? t.soFar : t.duration} value={hm(d.hours)} />
                </dl>
                {d.source && <p className="text-[11px] text-text-tertiary">{t.sourceIs(t.sources[d.source])}{d.device ? ` «${d.device}»` : ''}{d.punches ? ` · ${t.punchesToday(d.punches)}` : ''}</p>}
                {!deviceMode && !leave && can('work') && (
                  <Button size="sm" variant={open ? 'danger' : 'primary'} className="self-start" disabled={busy === e.id} onClick={() => press(e)}>
                    {busy === e.id && <Spinner size="sm" />}{open ? t.checkOut : t.checkIn}
                  </Button>
                )}
              </li>
            )
          })}
          {unlinked.map(u => (
            <li key={`no-${u.no}`} className="bg-stone-50 border border-dashed border-border rounded-xl p-3 flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-8 h-8 rounded-full bg-white border border-border text-text-tertiary text-sm flex items-center justify-center flex-shrink-0">{(u.name || '#').slice(0, 1)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text truncate" dir="auto">{u.name || t.dash}</p>
                  <p className="text-[11px] text-text-tertiary"><bdi dir="ltr">#{u.no}</bdi> · {t.notLinkedYet}</p>
                </div>
                {can('manage') && <Link to={`/hr/attendance/devices#link-${u.no}`} className="text-[11px] underline text-text-secondary">{t.link}</Link>}
              </div>
              <div>{u.day ? <Pill tone="green">{u.day.punches > 1 ? t.statuses.left : t.statuses.present}</Pill> : <Pill>{t.statNotPunched}</Pill>}</div>
              {u.day && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <Time label={t.schedule} value={scheduleLabel(settings) || t.dash} />
                  <Time label={t.arrival} value={clock(u.day.first_at)} />
                  <Time label={t.departure} value={u.day.punches > 1 ? clock(u.day.last_at) : t.dash} />
                  <Time label={t.duration} value={u.day.punches > 1 ? hm((Date.parse(u.day.last_at) - Date.parse(u.day.first_at)) / 3_600_000) : t.dash} />
                </dl>
              )}
              {u.day && <p className="text-[11px] text-text-tertiary">{t.punchesToday(u.day.punches)}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Time({ label, value, warn = false }) {
  return (
    <div className={warn ? 'text-red-700' : ''}>
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="font-medium tabular-nums"><bdi>{value}</bdi></dd>
    </div>
  )
}
