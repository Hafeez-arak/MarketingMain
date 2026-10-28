import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Skeleton, Spinner } from '../../../components/ui/index'
import { Pagination } from '../../../components/ui/Pagination'
import { useT, fmtDay } from '../../../lib/i18n'
import { nameOf, riyadhToday, monthDays } from '../../../lib/hr/logic'
import { clock, riyadh, fromRiyadh, toRiyadhLocal, monthSummary, periods } from '../../../lib/hr/attendance'
import { fetchLeaveRequests } from '../../../lib/hr/client'
import {
  fetchRecords, fetchRecordsBetween, fetchAttendanceChanges, recordAttendance, updateAttendance, saveAttendanceSettings, fetchMailboxReady, fetchPunchDayCounts,
} from '../../../lib/hr/attendanceClient'
import { NEEDS_ACTION } from '../../../lib/hr/attendance'
import { Dialog, ErrorText, Field, NoAccess, EmployeeSelect, Pill } from '../parts'
import { field, fieldInline } from '../useHrBase'
import { HW } from '../words'
import { AttHeader, Chips, GroupBy, SourcePill, Th, Td, Flash } from './shared'
import { useAttendanceBase, useChips, chipGroups, useParam, groupRows, fmtD, useFlash } from './useAttendance'
import { AW } from './words'

// ─── HR → Attendance → Records (v2), his records page ─────────────────────
// 2026-10-28, dev/erp-pilot/ATTENDANCE.md. Every session, newest first, with
// his filters and grouping; a record by hand (Work); corrections with a
// reason (Work); the working days and hours (Manage); the month for each
// employee; and the links to the daily report, the monthly sheet, the device
// review and the devices.

const FILTERS = [
  { key: 'open', group: 'st' },
  { key: 'today', group: 'date' }, { key: 'this_month', group: 'date' }, { key: 'last_month', group: 'date' },
  { key: 'device', group: 'src' }, { key: 'corrected', group: 'src' }, { key: 'manual', group: 'src' },
]
const PAGE = 50

export function AttendanceRecords() {
  const { t, lang, dir } = useT(AW)
  const a = useAttendanceBase()
  const { ws, me, level, can, employees, settings, hasDevice } = a
  const today = riyadhToday()
  const [active, toggle] = useChips()
  const [q, setQ] = useParam('q')
  const [group, setGroup] = useParam('g')
  const [pageRaw, setPage] = useParam('page', '0')
  const page = Number(pageRaw) || 0
  const [rows, setRows] = useState(null)
  const [count, setCount] = useState(null)
  const [needsAction, setNeedsAction] = useState(0)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [flash, setFlash] = useFlash()

  const query = useMemo(() => {
    const g = chipGroups(FILTERS, active)
    const p = periods(today)
    const ranges = (g.date || []).map(k => (k === 'today' ? p.today : k === 'this_month' ? p.month : p.last_month))
    const from = ranges.length ? ranges.map(r => r[0]).sort()[0] : ''
    const to = ranges.length ? ranges.map(r => r[1]).sort().at(-1) : ''
    const text = q.trim().toLowerCase()
    const employeeIds = text ? (employees || []).filter(e => `${e.name_en} ${e.name_ar}`.toLowerCase().includes(text)).map(e => e.id) : null
    return { from, to, open: (g.st || []).includes('open'), sources: g.src || [], employeeIds }
  }, [active, q, today, employees])

  const load = useCallback(async () => {
    if (!ws || employees === null) return
    const [r, c] = await Promise.all([
      fetchRecords(ws, { ...query, page, pageSize: PAGE, all: Boolean(group) }),
      hasDevice ? fetchPunchDayCounts(ws) : Promise.resolve({ row: {} }),
    ])
    setRows(r.rows); setCount(r.count); setError(r.error || c.error || '')
    setNeedsAction(NEEDS_ACTION.reduce((n, s) => n + (c.row?.[s] || 0), 0))
  }, [ws, employees, query, page, group, hasDevice])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!level) return <NoAccess />
  const emp = id => (employees || []).find(e => e.id === id)
  const groups = group && rows ? groupRows(rows,
    r => (group === 'employee' ? r.employee_id : r.day),
    r => (group === 'employee' ? nameOf(emp(r.employee_id), lang) : fmtD(r.day, lang, true))) : null

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <AttHeader tab="records" />
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs" role="group">
          <span className="px-3 py-1.5 bg-stone-900 text-white" aria-current="page">{t.employeeRecords}</span>
          {hasDevice && <Link to="/hr/attendance/everyone" className="px-3 py-1.5 bg-white text-text-secondary hover:bg-stone-50">{t.everyoneOnDevice}</Link>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link to="/hr/attendance/daily" className="text-xs border border-border rounded-md px-2.5 py-1.5 bg-white hover:bg-stone-50">{t.dailyReport}</Link>
          <Link to="/hr/attendance/monthly" className="text-xs border border-border rounded-md px-2.5 py-1.5 bg-white hover:bg-stone-50">{t.monthlySheet}</Link>
          {hasDevice && <Link to="/hr/attendance/review" className={`text-xs border rounded-md px-2.5 py-1.5 ${needsAction ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white border-border hover:bg-stone-50'}`}>{t.needAttention(needsAction)}</Link>}
          {can('manage') && <Link to="/hr/attendance/devices" className="text-xs border border-border rounded-md px-2.5 py-1.5 bg-white hover:bg-stone-50">{t.devicesLink}</Link>}
        </div>
      </div>
      <Flash msg={flash} />
      <ErrorText error={error || a.error || a.attError} />

      {can('work') && employees && <ManualPanel ws={ws} me={me} employees={employees} onDone={() => { setFlash(t.recorded); load() }} />}
      {can('manage') && settings !== undefined && <SettingsPanel ws={ws} me={me} settings={settings} people={a.people}
        onSaved={() => { setFlash(t.settingsSaved); a.reloadAttendance() }} />}
      {employees && settings !== undefined && <MonthPanel ws={ws} employees={employees} settings={settings} today={today} />}

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchName} aria-label={t.search} className={`${fieldInline} min-w-[14rem]`} dir="auto" />
        <GroupBy value={group} onChange={setGroup} options={['employee', 'day']} />
      </div>
      <Chips filters={FILTERS} active={active} onToggle={toggle} />

      {rows === null ? <Skeleton className="h-64" /> : !rows.length ? (
        <div className="bg-white border border-border px-4 py-8 text-center"><p className="text-sm font-medium text-text">{t.noRecords}</p><p className="text-xs text-text-tertiary mt-1">{t.noRecordsHelp}</p></div>
      ) : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              <Th>{t.day}</Th><Th>{t.employee}</Th><Th end>{t.arrival}</Th><Th end>{t.departure}</Th><Th end>{t.hours}</Th><Th>{t.source}</Th><Th>{t.notes}</Th><Th />
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(groups || [{ key: '', items: rows }]).map(g => [
                groups && (
                  <tr key={`g-${g.key}`} className="bg-stone-50 text-xs font-medium">
                    <td colSpan={4} className="px-3 py-1.5">{g.title} <span className="text-text-tertiary font-normal">({g.items.length})</span></td>
                    <td className="px-3 py-1.5 text-end tabular-nums">{g.items.reduce((n, r) => n + (Number(r.worked_hours) || 0), 0).toFixed(2)}</td>
                    <td colSpan={3} />
                  </tr>
                ),
                ...g.items.map(r => {
                  const inR = riyadh(r.check_in)
                  const outR = riyadh(r.check_out)
                  return (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap tabular-nums">{fmtD(inR.day, lang)}</Td>
                      <Td><Link to={`/hr/employee?id=${r.employee_id}`} className="hover:underline">{nameOf(emp(r.employee_id), lang)}</Link></Td>
                      <Td end>{inR.time}</Td>
                      <Td end className="whitespace-nowrap">{outR ? (outR.day === inR.day ? outR.time : `${fmtD(outR.day, lang)} ${outR.time}`) : <Pill tone="green">{t.in}</Pill>}</Td>
                      <Td end>{r.worked_hours !== null ? Number(r.worked_hours).toFixed(2) : t.dash}</Td>
                      <Td><SourcePill source={r.source} /></Td>
                      <Td className="text-[11px] text-text-secondary max-w-[16rem]" dir="auto">{r.notes}</Td>
                      <Td end>{can('work') && <Button size="xs" variant="ghost" onClick={() => setEditing(r)}>{t.correct}</Button>}</Td>
                    </tr>
                  )
                }),
              ])}
            </tbody>
          </table>
          {!group && <Pagination page={page} pageSize={PAGE} count={count} onPage={n => setPage(String(n))} words={t.pager} />}
        </div>
      )}
      <p className="text-[11px] text-text-tertiary">{t.auditHint}</p>

      {editing && (
        <Dialog title={t.correctTitle(nameOf(emp(editing.employee_id), lang), fmtD(editing.day, lang))} onClose={() => setEditing(null)}>
          <CorrectForm ws={ws} record={editing} people={a.people} onCancel={() => setEditing(null)}
            onDone={() => { setEditing(null); setFlash(t.corrected); load() }} />
        </Dialog>
      )}
    </div>
  )
}

/** Record by hand (Work): his "تسجيل يدوي أو تصحيح" panel. */
function ManualPanel({ ws, me, employees, onDone }) {
  const { t } = useT(AW)
  const [f, setF] = useState({ employeeId: '', checkIn: '', checkOut: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const out = await recordAttendance(ws, me, { employeeId: f.employeeId, checkIn: fromRiyadh(f.checkIn), checkOut: fromRiyadh(f.checkOut), notes: f.notes })
    setBusy(false)
    if (out.error) { setError(out.error); return }
    setF({ employeeId: '', checkIn: '', checkOut: '', notes: '' })
    onDone()
  }
  return (
    <details className="bg-white border border-border rounded-lg px-4 py-3">
      <summary className="text-sm font-semibold text-text cursor-pointer">{t.manualTitle}</summary>
      <form onSubmit={submit} className="mt-3 grid gap-2 md:grid-cols-[1.4fr_1fr_1fr_1.6fr_auto] items-end">
        <Field label={t.employee}><EmployeeSelect employees={employees} value={f.employeeId} onChange={v => setF(x => ({ ...x, employeeId: v }))} placeholder={t.employee} required /></Field>
        <Field label={t.arrival}><input type="datetime-local" required value={f.checkIn} onChange={e => setF(x => ({ ...x, checkIn: e.target.value }))} className={field} /></Field>
        <Field label={t.departure}><input type="datetime-local" min={f.checkIn} value={f.checkOut} onChange={e => setF(x => ({ ...x, checkOut: e.target.value }))} className={field} /></Field>
        <Field label={t.notes}><input value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} placeholder={t.notesReason} className={field} dir="auto" /></Field>
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{t.record}</Button>
      </form>
      <p className="text-[11px] text-text-tertiary mt-2">{t.manualHelp}</p>
      <ErrorText error={error} />
    </details>
  )
}

/** The working days and hours (Manage): his settings panel. */
function SettingsPanel({ ws, me, settings, people, onSaved }) {
  const { t, lang } = useT(AW)
  const { t: h } = useT(HW)
  const s = settings || {}
  const [f, setF] = useState({
    work_days: s.work_days || [], daily_hours: s.daily_hours ?? '', work_start: String(s.work_start || '').slice(0, 5), work_end: String(s.work_end || '').slice(0, 5),
    grace_minutes: s.grace_minutes ?? '', schedule_from: s.schedule_from || '', repeat_punch_minutes: s.repeat_punch_minutes ?? '', employee_emails: Boolean(s.employee_emails),
  })
  const [mailbox, setMailbox] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { fetchMailboxReady(ws).then(r => setMailbox(Boolean(r.row))) }, [ws])
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const known = Boolean(s.work_days?.length)
  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const out = await saveAttendanceSettings(ws, me, {
      ...f, daily_hours: Number(f.daily_hours), grace_minutes: f.grace_minutes === '' ? null : Number(f.grace_minutes),
      repeat_punch_minutes: f.repeat_punch_minutes === '' ? null : Number(f.repeat_punch_minutes),
    })
    setBusy(false)
    if (out.error) { setError(out.error); return }
    onSaved()
  }
  return (
    <details className="bg-white border border-border rounded-lg px-4 py-3" open={!known || undefined}>
      <summary className="text-sm font-semibold text-text cursor-pointer">
        {t.weekTitle} <span className="font-normal text-xs text-text-tertiary ms-1">{s.work_start ? `${String(s.work_start).slice(0, 5)}–${String(s.work_end).slice(0, 5)}` : t.weekNotSet} · {mailbox ? t.mailboxOn : t.mailboxOff}</span>
      </summary>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <fieldset>
          <legend className="text-[11px] text-text-secondary mb-1">{t.workDays}</legend>
          <div className="flex flex-wrap gap-1.5">
            {h.weekdays.map((label, d) => (
              <label key={d} className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs cursor-pointer ${f.work_days.includes(d) ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white border-border text-text-secondary'}`}>
                <input type="checkbox" className="sr-only" checked={f.work_days.includes(d)}
                  onChange={() => set('work_days', f.work_days.includes(d) ? f.work_days.filter(x => x !== d) : [...f.work_days, d].sort())} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-2 grid-cols-2 md:grid-cols-6">
          <Field label={t.dailyHours}><input type="number" required step="0.25" min="0.25" max="24" value={f.daily_hours} onChange={e => set('daily_hours', e.target.value)} className={field} dir="ltr" /></Field>
          <Field label={t.workStart}><input type="time" value={f.work_start} onChange={e => set('work_start', e.target.value)} className={field} /></Field>
          <Field label={t.workEnd}><input type="time" value={f.work_end} required={Boolean(f.work_start)} onChange={e => set('work_end', e.target.value)} className={field} /></Field>
          <Field label={t.grace}><input type="number" min="0" max="240" value={f.grace_minutes} required={Boolean(f.work_start)} onChange={e => set('grace_minutes', e.target.value)} className={field} dir="ltr" /></Field>
          <Field label={t.scheduleFrom}><input type="date" value={f.schedule_from} required={Boolean(f.work_start)} onChange={e => set('schedule_from', e.target.value)} className={field} /></Field>
          <Field label={t.repeatMinutes}><input type="number" min="1" max="720" value={f.repeat_punch_minutes} placeholder={t.dash} onChange={e => set('repeat_punch_minutes', e.target.value)} className={field} dir="ltr" /></Field>
        </div>
        <p className="text-[11px] text-text-tertiary">{t.scheduleHelp}</p>
        <p className="text-[11px] text-text-tertiary">{t.repeatHelp}</p>
        <div className="border-t border-border pt-3 space-y-1.5">
          <p className="text-xs font-semibold text-text">{t.mailbox} <Pill tone={mailbox ? 'green' : 'grey'}>{mailbox ? t.mailboxOn : t.mailboxOff}</Pill></p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={f.employee_emails} disabled={!mailbox && !f.employee_emails} onChange={e => set('employee_emails', e.target.checked)} />
            {t.emailsSwitch}
            {s.employee_emails_changed_at && <span className="text-text-tertiary">· {t.emailsChanged(`${fmtDay(s.employee_emails_changed_at, lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${people.find(p => p.user_id === s.employee_emails_changed_by)?.name ? ` · ${people.find(p => p.user_id === s.employee_emails_changed_by).name}` : ''}`)}</span>}
          </label>
          <p className="text-[11px] text-text-tertiary">{mailbox ? t.emailsHelp : t.mailboxOffHelp}</p>
        </div>
        <ErrorText error={error} />
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{t.save}</Button>
      </form>
    </details>
  )
}

/** The month for each employee (his monthly() summary on the records page). */
function MonthPanel({ ws, employees, settings, today }) {
  const { t, lang } = useT(AW)
  const [month, setMonth] = useParam('m', today.slice(0, 7))
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return
    const from = `${month}-01`
    const to = monthDays(month).at(-1)
    let cancelled = false
    Promise.all([fetchRecordsBetween(ws, from, to), fetchLeaveRequests(ws, { from, to })]).then(([r, l]) => {
      if (!cancelled) setData({ month, records: r.rows, leaves: l.rows })
    })
    return () => { cancelled = true }
  }, [ws, month])
  const rows = data?.month === month ? monthSummary({ employees, month, today, records: data.records, leaves: data.leaves, settings })
    .sort((a, b) => nameOf(a.employee, lang).localeCompare(nameOf(b.employee, lang), lang)) : null
  const until = monthDays(month).at(-1) < today ? monthDays(month).at(-1) : today
  return (
    <section className="bg-white border border-border rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text">{t.summaryTitle}</h2>
        <input type="month" value={month} max={today.slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} className={fieldInline} aria-label={t.month} />
      </div>
      {!rows ? <Skeleton className="h-32 m-3" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              <Th>{t.employee}</Th><Th end>{t.daysPresent}</Th><Th end>{t.totalHours}</Th><Th end>{t.leaveDays}</Th><Th end>{t.missingDays}</Th>
            </tr></thead>
            <tbody className="divide-y divide-border">{rows.map(r => (
              <tr key={r.employee.id}>
                <Td><Link to={`/hr/attendance/monthly?employee=${r.employee.id}&m=${month}`} className="hover:underline">{nameOf(r.employee, lang)}</Link> <span className="text-[11px] text-text-tertiary" dir="ltr">{r.employee.employee_no}</span></Td>
                <Td end>{r.days}</Td><Td end>{r.hours.toFixed(2)}</Td><Td end>{r.leave}</Td>
                <Td end>{r.missing === null ? t.dash : r.missing > 0 ? <Pill tone="amber">{r.missing}</Pill> : 0}</Td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-text-tertiary px-4 py-2 border-t border-border">{t.summaryHelp(fmtD(until, lang))}</p>
    </section>
  )
}

/** Correct a record (Work): his inline form, with the reason and the history. */
function CorrectForm({ ws, record, people, onCancel, onDone }) {
  const { t, lang, dir } = useT(AW)
  const [f, setF] = useState({ checkIn: toRiyadhLocal(record.check_in), checkOut: toRiyadhLocal(record.check_out), notes: record.notes || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchAttendanceChanges(ws, record.id).then(out => { if (!cancelled) setHistory(out.rows) })
    return () => { cancelled = true }
  }, [ws, record])
  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const out = await updateAttendance(ws, record.id, { checkIn: fromRiyadh(f.checkIn), checkOut: fromRiyadh(f.checkOut), notes: f.notes })
    setBusy(false)
    if (out.error) { setError(out.error); return }
    onDone()
  }
  const show = s => `${clock(s.check_in)}–${s.check_out ? clock(s.check_out) : t.in} · ${t.sources[s.source] || ''}`
  return (
    <form onSubmit={submit} className="space-y-3" dir={dir} lang={lang}>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t.arrival}><input type="datetime-local" required value={f.checkIn} onChange={e => setF(x => ({ ...x, checkIn: e.target.value }))} className={field} /></Field>
        <Field label={t.departure}><input type="datetime-local" min={f.checkIn} value={f.checkOut} onChange={e => setF(x => ({ ...x, checkOut: e.target.value }))} className={field} /></Field>
      </div>
      <Field label={t.correctionReason}><input required value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} className={field} dir="auto" /></Field>
      <p className="text-[11px] text-text-tertiary"><SourcePill source={record.source} /></p>
      <ErrorText error={error} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{t.save}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
      {history?.length > 0 && (
        <section className="border-t border-border pt-3">
          <h3 className="text-[11px] font-semibold text-text-secondary mb-1.5">{t.history}</h3>
          <ol className="space-y-1.5 text-[11px] text-text-secondary">{history.map(x => (
            <li key={x.id}>
              {people.find(p => p.user_id === x.changed_by)?.name || t.someone} · {fmtDay(x.changed_at, lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              <span className="block" dir="ltr">{show(x.before)} → {show(x.after)}</span>
              {x.reason && <span className="block" dir="auto">{x.reason}</span>}
            </li>
          ))}</ol>
        </section>
      )}
    </form>
  )
}
