import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Skeleton } from '../../../components/ui/index'
import { Pagination } from '../../../components/ui/Pagination'
import { useT } from '../../../lib/i18n'
import { nameOf, riyadhToday } from '../../../lib/hr/logic'
import { clock, punchRoles, periods, byNumber } from '../../../lib/hr/attendance'
import { fetchPunches, fetchDeviceUsers, fetchFlags } from '../../../lib/hr/attendanceClient'
import { ErrorText, NoAccess, Pill } from '../parts'
import { fieldInline } from '../useHrBase'
import { AttHeader, Chips, GroupBy, Th, Td } from './shared'
import { useAttendanceBase, useChips, chipGroups, useParam, groupRows, fmtD } from './useAttendance'
import { AW } from './words'

// ─── HR → Attendance → Punch log (v2), his punch-log ───────────────────────
// 2026-10-28, dev/erp-pilot/ATTENDANCE.md. Every punch the devices sent for a
// period (today unless chosen), newest day first and, inside it, each
// number's punches in order, so a day reads arrival → departure. What each
// punch counts as follows the pairing's rule (lib/hr/attendance.js
// punchRoles); late and early leave are shown on the punch they came from.

const FILTERS = [{ key: 'unlinked', group: 'link' }, { key: 'linked', group: 'link' }]
const PRESETS = ['today', 'yesterday', 'week', 'month', 'last_month', 'all']
const PAGE = 100
const ROLE_TONE = { in: 'green', out: 'blue', mid: 'grey', dup: 'amber', single: 'red' }

export function AttendancePunchLog() {
  const { t, lang, dir } = useT(AW)
  const a = useAttendanceBase()
  const { ws, level, employees, settings, devices } = a
  const today = riyadhToday()
  const [active, toggle] = useChips()
  const [q, setQ] = useParam('q')
  const [group, setGroup] = useParam('g')
  const [preset, setPreset] = useParam('p', 'today')
  const [fromP, setFrom] = useParam('from')
  const [toP, setTo] = useParam('to')
  const [pageRaw, setPage] = useParam('page', '0')
  const page = Number(pageRaw) || 0
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const range = useMemo(() => {
    if (fromP || toP) return [fromP, toP]
    if (preset === 'all') return ['', '']
    return periods(today)[preset] || periods(today).today
  }, [fromP, toP, preset, today])

  const load = useCallback(async () => {
    if (!ws) return
    const [p, u, f] = await Promise.all([fetchPunches(ws, { from: range[0], to: range[1] }), fetchDeviceUsers(ws), fetchFlags(ws, { from: range[0], to: range[1], all: true })])
    setData({ punches: p.rows, users: u.rows, flags: f.rows })
    setError(p.error || u.error || f.error || '')
  }, [ws, range])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!level) return <NoAccess />
  const byNo = new Map((employees || []).filter(e => e.device_user_no).map(e => [e.device_user_no, e]))
  const names = new Map((data?.users || []).map(u => [u.device_user_no, u.name]))
  const deviceName = id => devices.find(d => d.id === id)?.name || ''
  const repeat = settings?.repeat_punch_minutes ?? null

  let all = data?.punches || []
  const g = chipGroups(FILTERS, active)
  if (g.link?.length === 1) all = all.filter(p => (g.link[0] === 'linked') === byNo.has(p.device_user_no))
  const text = q.trim().toLowerCase()
  if (text) all = all.filter(p => p.device_user_no === text || nameOf(byNo.get(p.device_user_no), 'en').toLowerCase().includes(text)
    || nameOf(byNo.get(p.device_user_no), 'ar').includes(q.trim()) || (names.get(p.device_user_no) || '').toLowerCase().includes(text))
  const roles = punchRoles(all, repeat)
  const unlinked = [...new Set(all.map(p => p.device_user_no))].filter(no => !byNo.has(no)).sort(byNumber)
    .map(no => ({ no, name: names.get(no) || null, punches: all.filter(p => p.device_user_no === no).length }))
  const flagOf = (p, kind) => {
    const e = byNo.get(p.device_user_no)
    return e ? (data?.flags || []).find(f => f.employee_id === e.id && f.work_day === p.work_day && f.kind === kind) : null
  }
  const personOf = p => (byNo.get(p.device_user_no) ? nameOf(byNo.get(p.device_user_no), lang) : names.get(p.device_user_no) || `#${p.device_user_no}`)
  const shown = group ? all.slice(0, 5000) : all.slice(page * PAGE, page * PAGE + PAGE)
  const groups = group ? groupRows(shown, p => (group === 'employee' ? p.device_user_no : p.work_day), p => (group === 'employee' ? personOf(p) : fmtD(p.work_day, lang, true))) : [{ key: '', items: shown }]
  const summary = {
    punches: all.length, employees: new Set(all.filter(p => byNo.has(p.device_user_no)).map(p => p.device_user_no)).size, unlinked: unlinked.length,
    repeats: repeat === null ? null : Object.values(roles).filter(r => r === 'dup').length, singles: Object.values(roles).filter(r => r === 'single').length,
  }

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <AttHeader tab="log" />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.period}>
          {PRESETS.map(k => (
            <button key={k} type="button" aria-pressed={!fromP && !toP && preset === k} onClick={() => { setFrom(''); setTo(''); setPreset(k) }}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${!fromP && !toP && preset === k ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white border-border text-text-secondary hover:bg-stone-50'}`}>
              {k === 'all' ? t.allTime : t.filters[k]}
            </button>
          ))}
        </div>
        <label className="text-[11px] text-text-secondary">{t.from} <input type="date" value={fromP || range[0]} max={today} onChange={e => setFrom(e.target.value)} className={fieldInline} /></label>
        <label className="text-[11px] text-text-secondary">{t.to} <input type="date" value={toP || range[1]} max={today} onChange={e => setTo(e.target.value)} className={fieldInline} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchPerson} aria-label={t.search} className={`${fieldInline} min-w-[14rem]`} dir="auto" />
        <GroupBy value={group} onChange={setGroup} options={['employee', 'day']} />
        <Chips filters={FILTERS} active={active} onToggle={toggle} />
      </div>
      <ErrorText error={error || a.error} />
      {!data ? <Skeleton className="h-64" /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {[[t.summaryPunches, summary.punches], [t.summaryEmployees, summary.employees], [t.summaryUnlinked, summary.unlinked],
              [t.summaryRepeats, summary.repeats ?? t.dash], [t.summarySingles, summary.singles]].map(([label, n]) => (
              <div key={label} className="bg-white border border-border px-3 py-2"><p className="text-[11px] text-text-tertiary">{label}</p><p className="text-lg font-semibold tabular-nums">{n}</p></div>
            ))}
          </div>
          {repeat === null && <p className="text-[11px] text-text-tertiary">{t.repeatUnset}</p>}
          {unlinked.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs">
              <p className="font-medium text-amber-900 mb-1">{t.unlinkedNumbers}</p>
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-amber-900">{unlinked.map(u => (
                <span key={u.no}>{a.can('manage') ? <Link className="underline" to={`/hr/attendance/devices#link-${u.no}`}><bdi dir="ltr">#{u.no}</bdi></Link> : <bdi dir="ltr">#{u.no}</bdi>}{u.name ? ` ${u.name}` : ''} ({u.punches})</span>
              ))}</p>
            </div>
          )}
          {!all.length ? <p className="text-sm text-text-secondary py-6">{t.nothing}</p> : (
            <div className="bg-white border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                  <Th>{t.day}</Th><Th end>{t.time}</Th><Th>{t.person}</Th><Th>{t.number}</Th><Th>{t.role}</Th><Th>{t.device}</Th><Th>{t.codes}</Th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {groups.map(gr => [
                    group && <tr key={`g-${gr.key}`} className="bg-stone-50 text-xs font-medium"><td colSpan={7} className="px-3 py-1.5">{gr.title} <span className="text-text-tertiary font-normal">({gr.items.length})</span></td></tr>,
                    ...gr.items.map(p => {
                      const role = roles[p.id]
                      const late = role === 'in' || role === 'single' ? flagOf(p, 'late') : null
                      const early = role === 'out' ? flagOf(p, 'early') : null
                      return (
                        <tr key={p.id}>
                          <Td className="whitespace-nowrap">{fmtD(p.work_day, lang)}</Td>
                          <Td end>{String(p.local_time).slice(11, 19) || clock(p.punched_at)}</Td>
                          <Td>{byNo.get(p.device_user_no) ? <Link className="hover:underline" to={`/hr/employee?id=${byNo.get(p.device_user_no).id}`}>{personOf(p)}</Link> : <span className="text-text-secondary" dir="auto">{personOf(p)}</span>}</Td>
                          <Td><bdi dir="ltr" className="tabular-nums">#{p.device_user_no}</bdi></Td>
                          <Td><span className="flex flex-wrap gap-1"><Pill tone={ROLE_TONE[role]}>{t.roles[role]}</Pill>
                            {late && <Pill tone={late.excused_at ? 'grey' : 'red'}>{t.lateMin(late.minutes)}</Pill>}
                            {early && <Pill tone={early.excused_at ? 'grey' : 'red'}>{t.earlyMin(early.minutes)}</Pill>}</span></Td>
                          <Td className="text-[11px] text-text-secondary">{deviceName(p.device_id)}</Td>
                          <Td className="text-[11px] text-text-tertiary whitespace-nowrap">{t.verifyInout(p.verify_mode, p.in_out_mode)}</Td>
                        </tr>
                      )
                    }),
                  ])}
                </tbody>
              </table>
              {!group && <Pagination page={page} pageSize={PAGE} count={all.length} onPage={n => setPage(String(n))} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}
