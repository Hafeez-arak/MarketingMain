import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Skeleton } from '../../../components/ui/index'
import { useT, fmtDay } from '../../../lib/i18n'
import { nameOf, riyadhToday, monthDays, addDays } from '../../../lib/hr/logic'
import { buildDays, sheetTotals, clock, hm, DAY_STATUSES } from '../../../lib/hr/attendance'
import { buildXlsx, download } from '../../../lib/xlsx'
import { fetchLeaveRequests } from '../../../lib/hr/client'
import { fetchRecordsBetween, fetchPunchDays, fetchFlags } from '../../../lib/hr/attendanceClient'
import { ErrorText, NoAccess, EmployeeSelect } from '../parts'
import { fieldInline } from '../useHrBase'
import { AttHeader, StatusPill, SourcePill, Th, Td } from './shared'
import { useAttendanceBase, useParam, fmtD } from './useAttendance'
import { AW } from './words'

// ─── HR → Attendance → Daily report and Monthly sheet (v2) ─────────────────
// 2026-10-28, dev/erp-pilot/ATTENDANCE.md. His two attendance reports, read
// from what is recorded (lib/hr/attendance.js buildDays):
//   daily    every active employee on one day; a department, late only;
//            print and Excel
//   monthly  one employee's month day by day with the totals above; print
// Printing uses the app's print rules (index.css @media print): the shell
// and the controls hide, the report stays.

/** Everything the day builder needs for a span, for some employees. */
function useDays(ws, employees, from, to, settings, leaveTypes, lang) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const ids = useMemo(() => (employees || []).map(e => e.id), [employees])
  const load = useCallback(async () => {
    if (!ws || !employees || !from || !to) return
    const [r, p, f, l] = await Promise.all([
      fetchRecordsBetween(ws, from, to, ids), fetchPunchDays(ws, { from, to, linked: true, all: true }),
      fetchFlags(ws, { from, to, all: true }), fetchLeaveRequests(ws, { from, to }),
    ])
    setData({ key: `${from}|${to}|${ids.join(',')}`, records: r.rows, punchDays: p.rows, flags: f.rows, leaves: l.rows.filter(x => x.status === 'approved') })
    setError(r.error || p.error || f.error || l.error || '')
  }, [ws, employees, ids, from, to])
  useEffect(() => { queueMicrotask(load) }, [load])
  const days = useMemo(() => (data && data.key === `${from}|${to}|${ids.join(',')}` && settings !== undefined
    ? buildDays({ employees, from, to, settings, records: data.records, punchDays: data.punchDays, flags: data.flags, leaves: data.leaves, leaveTypes, lang })
    : null), [data, employees, ids, from, to, settings, leaveTypes, lang])
  return { days, error }
}

const Back = () => {
  const { t, lang } = useT(AW)
  return <Link to="/hr/attendance/records" className="text-xs text-text-secondary hover:text-text" data-print-hide>{lang === 'ar' ? '→' : '←'} {t.backToRecords}</Link>
}

// ── The daily report ──

export function AttendanceDaily() {
  const { t, lang, dir } = useT(AW)
  const a = useAttendanceBase()
  const { ws, level, employees, departments, settings, leaveTypes } = a
  const today = riyadhToday()
  const [dayP, setDay] = useParam('d', today)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayP) && dayP <= today ? dayP : today
  const [dept, setDept] = useParam('dept')
  const [lateOnly, setLateOnly] = useParam('late')
  const people = useMemo(() => (employees || []).filter(e => e.status === 'active' && (!dept || e.department_id === dept))
    .sort((x, y) => nameOf(x, lang).localeCompare(nameOf(y, lang), lang)), [employees, dept, lang])
  const { days, error } = useDays(ws, employees ? people : null, day, day, settings, leaveTypes, lang)

  if (!level) return <NoAccess />
  const rows = days ? people.map(e => ({ e, d: days[e.id][day] })).filter(r => r.d.status !== 'not_employed')
    .filter(r => !lateOnly || r.d.late || r.d.early) : []
  const totals = DAY_STATUSES.map(s => [s, rows.filter(r => r.d.status === s).length]).filter(([, n]) => n)
  const deptName = id => { const d = departments.find(x => x.id === id); return d ? nameOf(d, lang) : '' }

  function excel() {
    const head = [t.employee, t.employeeNo, t.schedule, t.firstPunch, t.lateCol, t.lastPunch, t.earlyCol, t.hours, t.punchCount, t.status, t.source]
    const x = [[{ v: t.dailyReport, s: 'title' }], [day], [], head.map(v => ({ v, s: 'head' }))]
    for (const { e, d } of rows) {
      x.push([nameOf(e, lang), e.employee_no || '', d.scheduled || '—', d.arrival ? clock(d.arrival) : '—', d.late ?? '', d.departure ? clock(d.departure) : '—', d.early ?? '',
        hm(d.hours), d.punches, `${t.statuses[d.status]}${typeof d.leave === 'string' && d.leave ? ` — ${d.leave}` : ''}`, d.source ? t.sources[d.source] : '—'])
    }
    download(buildXlsx({ sheet: t.dailyFile, rows: x, widths: [26, 10, 14, 14, 12, 14, 14, 10, 10, 22, 16], rtl: lang === 'ar' }), `attendance-${day.replaceAll('-', '')}.xlsx`)
  }

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <div data-print-hide><AttHeader tab="records" sub="daily" /></div>
      <Back />
      <div className="flex flex-wrap items-center gap-2" data-print-hide>
        <Button size="xs" variant="secondary" onClick={() => setDay(addDays(day, -1))} aria-label={t.from}>{lang === 'ar' ? '→' : '←'}</Button>
        <input type="date" value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} className={fieldInline} aria-label={t.day} />
        <Button size="xs" variant="secondary" disabled={day >= today} onClick={() => setDay(addDays(day, 1))} aria-label={t.to}>{lang === 'ar' ? '←' : '→'}</Button>
        <select value={dept} onChange={e => setDept(e.target.value)} className={fieldInline} aria-label={t.deptAll}>
          <option value="">{t.deptAll}</option>
          {departments.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{nameOf(d, lang)}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={Boolean(lateOnly)} onChange={e => setLateOnly(e.target.checked ? '1' : '')} />{t.lateOnly}</label>
        <span className="flex-1" />
        <Button size="xs" variant="secondary" onClick={() => window.print()}>{t.print}</Button>
        <Button size="xs" variant="secondary" disabled={!rows.length} onClick={excel}>{t.excel}</Button>
      </div>
      <h2 className="text-sm font-semibold text-text">{t.dailyReport} · {fmtDay(day, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}{dept ? ` · ${deptName(dept)}` : ''}</h2>
      <ErrorText error={error || a.error} />
      {!days ? <Skeleton className="h-64" /> : (
        <>
          <div className="flex flex-wrap gap-2">{totals.map(([s, n]) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-xs border border-border bg-white px-2 py-1"><StatusPill status={s} /><span className="tabular-nums font-semibold">{n}</span></span>
          ))}</div>
          <DailyTable rows={rows} />
        </>
      )}
    </div>
  )
}

function DailyTable({ rows }) {
  const { t, lang } = useT(AW)
  if (!rows.length) return <p className="text-sm text-text-secondary py-6">{t.nothing}</p>
  return (
    <div className="bg-white border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
          <Th>{t.employee}</Th><Th>{t.employeeNo}</Th><Th>{t.schedule}</Th><Th end>{t.firstPunch}</Th><Th end>{t.lateCol}</Th><Th end>{t.lastPunch}</Th><Th end>{t.earlyCol}</Th>
          <Th end>{t.hours}</Th><Th end>{t.punchCount}</Th><Th>{t.status}</Th><Th>{t.source}</Th>
        </tr></thead>
        <tbody className="divide-y divide-border">{rows.map(({ e, d }) => (
          <tr key={e.id}>
            <Td><Link className="hover:underline" to={`/hr/attendance/monthly?employee=${e.id}&m=${d.date.slice(0, 7)}`}>{nameOf(e, lang)}</Link></Td>
            <Td className="text-[11px] text-text-tertiary"><bdi dir="ltr">{e.employee_no}</bdi></Td>
            <Td className="tabular-nums whitespace-nowrap"><bdi>{d.scheduled || t.dash}</bdi></Td>
            <Td end>{clock(d.arrival)}</Td>
            <Td end className={d.late && !d.lateExcuse ? 'text-red-700 font-medium' : 'text-text-tertiary'}>{d.late ?? ''}</Td>
            <Td end>{clock(d.departure)}</Td>
            <Td end className={d.early && !d.earlyExcuse ? 'text-red-700 font-medium' : 'text-text-tertiary'}>{d.early ?? ''}</Td>
            <Td end>{hm(d.hours)}</Td>
            <Td end>{d.punches || ''}</Td>
            <Td><StatusPill status={d.status} />{typeof d.leave === 'string' && d.leave && <span className="text-[11px] text-text-tertiary ms-1">{d.leave}</span>}</Td>
            <Td><SourcePill source={d.source} /></Td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

// ── The monthly sheet ──

export function AttendanceMonthly() {
  const { t, lang, dir } = useT(AW)
  const a = useAttendanceBase()
  const { ws, level, employees, departments, settings, leaveTypes } = a
  const today = riyadhToday()
  const [month, setMonth] = useParam('m', today.slice(0, 7))
  const [empP, setEmp] = useParam('employee')
  const sorted = useMemo(() => (employees || []).slice().sort((x, y) => nameOf(x, lang).localeCompare(nameOf(y, lang), lang)), [employees, lang])
  const person = sorted.find(e => e.id === empP) || sorted.find(e => e.status === 'active') || null
  const from = `${month}-01`
  const last = monthDays(month).at(-1)
  const to = last < today ? last : today
  const one = useMemo(() => (person ? [person] : null), [person])
  const { days, error } = useDays(ws, from <= to ? one : null, from, to, settings, leaveTypes, lang)

  if (!level) return <NoAccess />
  const list = days && person ? Object.values(days[person.id]) : []
  const s = sheetTotals(list)
  const dept = person ? departments.find(d => d.id === person.department_id) : null
  const tile = (label, value) => <div className="bg-white border border-border py-2 px-2 text-center"><p className="text-lg font-semibold tabular-nums">{value}</p><p className="text-[11px] text-text-tertiary">{label}</p></div>

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <div data-print-hide><AttHeader tab="records" sub="monthly" /></div>
      <Back />
      <div className="flex flex-wrap items-center gap-2" data-print-hide>
        <div className="min-w-[16rem]"><EmployeeSelect employees={sorted} includeEnded value={person?.id || ''} onChange={setEmp} aria-label={t.pickEmployee} /></div>
        <input type="month" value={month} max={today.slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} className={fieldInline} aria-label={t.month} />
        <span className="flex-1" />
        <Button size="xs" variant="secondary" disabled={!person} onClick={() => window.print()}>{t.print}</Button>
      </div>
      {!person ? <p className="text-sm text-text-secondary py-6">{t.noEmployee}</p> : (
        <>
          <header>
            <h2 className="text-base font-semibold text-text">{t.monthlySheet} · {nameOf(person, lang)} <span className="text-xs text-text-tertiary font-normal" dir="ltr">{person.employee_no}</span></h2>
            <p className="text-xs text-text-secondary">{fmtDay(`${month}-15`, lang, { month: 'long', year: 'numeric' })}{person.job_title || dept ? ` · ${t.jobDept(person.job_title, dept ? nameOf(dept, lang) : '')}` : ''}</p>
          </header>
          <ErrorText error={error || a.error} />
          {!days && from <= to ? <Skeleton className="h-64" /> : (
            <>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {tile(t.present, s.present)}{tile(t.absent, s.absent)}{tile(t.leave, s.leave)}
                {tile(t.late, t.lateTotals(s.late, s.lateMinutes))}{tile(t.early, t.lateTotals(s.early, s.earlyMinutes))}{tile(t.hours, hm(s.hours))}
              </div>
              <div className="bg-white border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                    <Th>{t.day}</Th><Th>{t.schedule}</Th><Th end>{t.arrival}</Th><Th end>{t.lateCol}</Th><Th end>{t.departure}</Th><Th end>{t.earlyCol}</Th>
                    <Th end>{t.hours}</Th><Th end>{t.punchCount}</Th><Th>{t.status}</Th><Th>{t.source}</Th><Th>{t.notes}</Th>
                  </tr></thead>
                  <tbody className="divide-y divide-border">{list.map(d => (
                    <tr key={d.date} className={['off', 'not_employed'].includes(d.status) ? 'bg-stone-50 text-text-tertiary' : ''}>
                      <Td className="whitespace-nowrap">{fmtD(d.date, lang, true)}</Td>
                      <Td className="tabular-nums whitespace-nowrap"><bdi>{d.scheduled || t.dash}</bdi></Td>
                      <Td end>{clock(d.arrival)}</Td>
                      <Td end className={d.late && !d.lateExcuse ? 'text-red-700 font-medium' : ''}>{d.late ?? ''}</Td>
                      <Td end>{clock(d.departure)}</Td>
                      <Td end className={d.early && !d.earlyExcuse ? 'text-red-700 font-medium' : ''}>{d.early ?? ''}</Td>
                      <Td end>{hm(d.hours)}</Td>
                      <Td end>{d.punches || ''}</Td>
                      <Td><StatusPill status={d.status} /></Td>
                      <Td><SourcePill source={d.source} /></Td>
                      <Td className="text-[11px]" dir="auto">{[typeof d.leave === 'string' ? d.leave : '', d.lateExcuse, d.earlyExcuse].filter(Boolean).join(' · ')}</Td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
