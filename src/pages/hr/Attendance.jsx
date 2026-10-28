import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, PageHeader, Skeleton, Spinner } from '../../components/ui/index'
import { useT, fmtDay } from '../../lib/i18n'
import {
  nameOf, dayBoard, dayCounts, monthSheet, monthDays, hoursWorked, minutesLate, suggestStatus, riyadhToday, addDays, hhmm, ATTENDANCE_STATUSES,
} from '../../lib/hr/logic'
import {
  fetchAttendance, fetchLeaveRequests, fetchSettings, fetchPeople, fetchAttendanceChanges, recordAttendance, updateAttendance, deleteAttendance,
} from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, field, fmtDate, STATE_TONE } from './useHrBase'
import { Dialog, ErrorText, Field, Pill, Tabs, EmployeeSelect, NoAccess } from './parts'

// ─── HR → Attendance (v2) ──────────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/HR.md. Two tabs (?tab=): one day for everyone
// (?d=), and the monthly sheet (?m=), for everyone or one person (?emp=).
// Work records a day and corrects it; a correction goes through
// hr_attendance_update(), which asks for the reason and keeps the before
// and after. People on approved leave show as on leave without a record.

export function HrAttendance() {
  const { t, lang, dir } = useT(HW)
  const base = useHrBase()
  const { ws, level, employees } = base
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'month' ? 'month' : 'day'
  const today = riyadhToday()
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') && params.get('d') <= today ? params.get('d') : today
  const month = /^\d{4}-\d{2}$/.test(params.get('m') || '') ? params.get('m') : today.slice(0, 7)
  const emp = params.get('emp') || ''
  const setParam = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  const from = tab === 'day' ? day : `${month}-01`
  const to = tab === 'day' ? day : monthDays(month).at(-1)
  const [records, setRecords] = useState(null)
  const [requests, setRequests] = useState([])
  const [settings, setSettings] = useState(null)
  const [people, setPeople] = useState([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!ws) return
    const [a, r, s, p] = await Promise.all([fetchAttendance(ws, from, to), fetchLeaveRequests(ws, { from, to }), fetchSettings(ws), fetchPeople(ws)])
    setRecords(a.rows); setRequests(r.rows); setSettings(s.row); setPeople(p.rows)
    setError(a.error || r.error || s.error || '')
  }, [ws, from, to])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!level) return <NoAccess />
  const weekKnown = Boolean(settings?.work_days?.length && settings?.work_start)

  return (
    <div className="max-w-5xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={t.attendanceTitle} subtitle={t.attendanceSubtitle} />
      <Tabs label={t.attendanceTitle} value={tab} onChange={k => setParam('tab', k === 'day' ? '' : k)} tabs={['day', 'month'].map(k => ({ key: k, label: t.attTabs[k] }))} />
      {!weekKnown && <p className="text-[11px] text-text-tertiary">{t.weekNotSet}</p>}
      <ErrorText error={error || base.error} />
      {records === null || employees === null ? <Skeleton className="h-64" /> : tab === 'day' ? (
        <DayView {...{ base, day, today, records, requests, settings, people, onChanged: load }} setDay={d => setParam('d', d === today ? '' : d)} />
      ) : (
        <MonthView {...{ employees, month, emp, today, records, requests, settings }} setMonth={m => setParam('m', m)} setEmp={id => setParam('emp', id)} />
      )}
    </div>
  )
}

// ── One day ──

function DayView({ base, day, today, records, requests, settings, people, setDay, onChanged }) {
  const { t, lang } = useT(HW)
  const { ws, me, can, employees } = base
  const [open, setOpen] = useState(null) // { employee, record }
  const board = useMemo(() => dayBoard({ employees: employees.filter(e => e.status === 'active' || (e.end_date && e.end_date >= day)), records, requests, day })
    .sort((a, b) => nameOf(a.employee, lang).localeCompare(nameOf(b.employee, lang), lang)), [employees, records, requests, day, lang])
  const counts = dayCounts(board)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant="secondary" onClick={() => setDay(addDays(day, -1))} aria-label={t.prev}>{lang === 'ar' ? '→' : '←'}</Button>
        <input type="date" value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} className={`${field} w-auto`} aria-label={t.date} />
        <Button size="xs" variant="secondary" disabled={day >= today} onClick={() => setDay(addDays(day, 1))} aria-label={t.next}>{lang === 'ar' ? '←' : '→'}</Button>
        {day !== today && <Button size="xs" variant="ghost" onClick={() => setDay(today)}>{t.today}</Button>}
        <span className="text-sm text-text-secondary ms-1">{fmtDay(day, lang, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {['present', 'late', 'absent', 'leave', 'none'].map(k => (
          <span key={k} className="inline-flex items-center gap-1.5 text-xs border border-border bg-white px-2 py-1">
            <Pill tone={STATE_TONE[k]}>{t.attStatus[k]}</Pill><span className="tabular-nums font-semibold">{counts[k]}</span>
          </span>
        ))}
      </div>
      <div className="bg-white border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
            <th className="text-start font-medium px-3 py-2">{t.employee}</th>
            <th className="text-start font-medium px-3 py-2">{t.status}</th>
            <th className="text-start font-medium px-3 py-2">{t.checkIn}</th>
            <th className="text-start font-medium px-3 py-2">{t.checkOut}</th>
            <th className="text-end font-medium px-3 py-2">{t.hours}</th>
            <th className="px-3 py-2" />
          </tr></thead>
          <tbody className="divide-y divide-border">{board.map(({ employee: e, record: r, leave, state }) => {
            const late = r?.check_in ? minutesLate(r.check_in, settings) : null
            return (
              <tr key={e.id}>
                <td className="px-3 py-2"><Link to={`/hr/employee?id=${e.id}`} className="hover:underline">{nameOf(e, lang)}</Link></td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={STATE_TONE[state]}>{t.attStatus[state]}</Pill>
                    {r?.corrected_at && <Pill title={t.correctedBy(people.find(p => p.user_id === r.corrected_by)?.name || t.someone, fmtDay(r.corrected_at, lang), r.correction_reason)}>{t.corrected}</Pill>}
                    {!r && leave && <span className="text-[11px] text-text-tertiary">{t.onLeaveNote}</span>}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums" dir="ltr">{hhmm(r?.check_in)}{late > 0 && <span className="text-[11px] text-amber-700 ms-1.5">{t.lateBy(late)}</span>}</td>
                <td className="px-3 py-2 tabular-nums" dir="ltr">{hhmm(r?.check_out)}</td>
                <td className="px-3 py-2 text-end tabular-nums">{hoursWorked(r?.check_in, r?.check_out) ?? ''}</td>
                <td className="px-3 py-2 text-end">
                  {can('work') && <Button size="xs" variant={r ? 'ghost' : 'secondary'} onClick={() => setOpen({ employee: e, record: r, leave })}>{r ? t.correct : t.record}</Button>}
                </td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      {!can('work') && <p className="text-[11px] text-text-tertiary">{t.viewOnly}</p>}
      {open && (
        <Dialog title={t.recordFor(nameOf(open.employee, lang), fmtDate(day, lang))} onClose={() => setOpen(null)}>
          <RecordForm ws={ws} record={open.record} onLeave={Boolean(open.leave)} settings={settings} people={people} canDelete={can('manage')}
            onCancel={() => setOpen(null)}
            onSubmit={async f => {
              const out = open.record
                ? await updateAttendance(ws, open.record.id, f)
                : await recordAttendance(ws, me, { ...f, employeeId: open.employee.id, day })
              if (!out.error) { setOpen(null); onChanged() }
              return out
            }}
            onDelete={async () => {
              const out = await deleteAttendance(ws, open.record.id)
              if (!out.error) { setOpen(null); onChanged() }
              return out
            }} />
        </Dialog>
      )}
    </div>
  )
}

function RecordForm({ ws, record, onLeave, settings, people, canDelete, onSubmit, onCancel, onDelete }) {
  const { t, lang, dir } = useT(HW)
  const [f, setF] = useState({
    status: record?.status || (onLeave ? 'leave' : 'present'),
    checkIn: hhmm(record?.check_in) || (onLeave ? '' : hhmm(settings?.work_start) || '08:00'),
    checkOut: hhmm(record?.check_out), notes: record?.notes || '', reason: '',
  })
  const [statusTouched, setStatusTouched] = useState(Boolean(record))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState(null)
  const timed = f.status === 'present' || f.status === 'late'
  const set = (k, v) => setF(x => {
    const n = { ...x, [k]: v }
    // The arrival suggests present or late until the status is chosen by hand.
    if (k === 'checkIn' && !statusTouched && timed) n.status = suggestStatus(v, settings)
    return n
  })
  // Filling in a missing departure, nothing else changed: no reason needed.
  const departureOnly = record && !record.check_out && f.checkOut && f.status === record.status && f.checkIn === hhmm(record.check_in) && f.notes === (record.notes || '')

  useEffect(() => {
    if (!record) return
    let cancelled = false
    fetchAttendanceChanges(ws, record.id).then(out => { if (!cancelled) setHistory(out.rows) })
    return () => { cancelled = true }
  }, [ws, record])

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const out = await onSubmit({ status: f.status, checkIn: timed ? f.checkIn : null, checkOut: timed ? f.checkOut || null : null, notes: f.notes, reason: f.reason.trim() })
    setBusy(false)
    if (out?.error) setError(out.error)
  }

  return (
    <form onSubmit={submit} className="space-y-3" dir={dir} lang={lang}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.status}>
        {ATTENDANCE_STATUSES.map(s => (
          <button key={s} type="button" aria-pressed={f.status === s} onClick={() => { setStatusTouched(true); setF(x => ({ ...x, status: s })) }}
            className={`rounded-md border px-2.5 py-1 text-xs ${f.status === s ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white border-border text-text-secondary hover:bg-stone-50'}`}>
            {t.attStatus[s]}
          </button>
        ))}
      </div>
      {timed && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={t.checkIn}><input type="time" required value={f.checkIn} onChange={e => set('checkIn', e.target.value)} className={field} /></Field>
          <Field label={`${t.checkOut} ${t.optional}`}><input type="time" min={f.checkIn} value={f.checkOut} onChange={e => set('checkOut', e.target.value)} className={field} /></Field>
        </div>
      )}
      <Field label={`${t.notes} ${t.optional}`}><input value={f.notes} onChange={e => set('notes', e.target.value)} className={field} dir="auto" /></Field>
      {record && (departureOnly
        ? <p className="text-[11px] text-text-tertiary">{t.departureOnly}</p>
        : <Field label={t.correctionReason} hint={t.correctionHelp}><input required value={f.reason} onChange={e => set('reason', e.target.value)} className={field} dir="auto" /></Field>)}
      <ErrorText error={error} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{record ? t.save : t.record}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
        {record && canDelete && <Button size="sm" variant="danger" className="ms-auto" disabled={busy} onClick={async () => {
          if (!window.confirm(t.confirmDelete)) return
          setBusy(true); const out = await onDelete(); setBusy(false); if (out?.error) setError(out.error)
        }}>{t.deleteRecord}</Button>}
      </div>
      {record && history?.length > 0 && (
        <section className="border-t border-border pt-3">
          <h3 className="text-[11px] font-semibold text-text-secondary mb-1.5">{t.history}</h3>
          <ol className="space-y-1.5 text-[11px] text-text-secondary">{history.map(h => (
            <li key={h.id}>
              <span className="font-medium text-text">{t.changeKinds[h.kind]}</span> · {people.find(p => p.user_id === h.changed_by)?.name || t.someone} · {fmtDay(h.changed_at, lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              <span className="block" dir="ltr">{describe(h.before, t)} → {describe(h.after, t)}</span>
              {h.reason && <span className="block" dir="auto">{h.reason}</span>}
            </li>
          ))}</ol>
        </section>
      )}
    </form>
  )
}

const describe = (s, t) => [t.attStatus[s.status] || s.status, hhmm(s.check_in), hhmm(s.check_out)].filter(Boolean).join(' ')

// ── The monthly sheet ──

function MonthView({ employees, month, emp, today, records, requests, settings, setMonth, setEmp }) {
  const { t, lang } = useT(HW)
  const shift = n => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)) }
  const first = `${month}-01`
  const last = monthDays(month).at(-1)
  const people = employees.filter(e => e.hire_date <= last && (!e.end_date || e.end_date >= first))
    .sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))
  const person = employees.find(e => e.id === emp) || null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant="secondary" onClick={() => shift(-1)} aria-label={t.prev}>{lang === 'ar' ? '→' : '←'}</Button>
        <span className="text-sm font-medium text-text min-w-[9rem] text-center">{fmtDay(`${month}-15`, lang, { month: 'long', year: 'numeric' })}</span>
        <Button size="xs" variant="secondary" disabled={month >= today.slice(0, 7)} onClick={() => shift(1)} aria-label={t.next}>{lang === 'ar' ? '←' : '→'}</Button>
        <div className="ms-2 min-w-[14rem]">
          <EmployeeSelect employees={people} includeEnded value={emp} onChange={setEmp} placeholder={t.everyone} aria-label={t.employee} />
        </div>
      </div>
      {person
        ? <PersonSheet {...{ person, month, records, requests, settings, today }} />
        : <Summary {...{ people, month, records, requests, settings, today, setEmp }} />}
    </div>
  )
}

function Summary({ people, month, records, requests, settings, today, setEmp }) {
  const { t, lang } = useT(HW)
  const rows = people.map(e => ({ e, totals: monthSheet({ employee: e, records, requests, month, settings, today }).totals }))
  return (
    <div className="bg-white border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
          <th className="text-start font-medium px-3 py-2">{t.employee}</th>
          {['present', 'late', 'absent', 'leave'].map(k => <th key={k} className="text-end font-medium px-3 py-2">{t.attStatus[k]}</th>)}
          <th className="text-end font-medium px-3 py-2">{t.hours}</th>
          <th className="text-end font-medium px-3 py-2" title={t.missingHelp}>{t.missing}</th>
        </tr></thead>
        <tbody className="divide-y divide-border">{rows.map(({ e, totals }) => (
          <tr key={e.id} className="hover:bg-stone-50">
            <td className="px-3 py-2"><button type="button" className="hover:underline text-start" onClick={() => setEmp(e.id)}>{nameOf(e, lang)}</button></td>
            {['present', 'late', 'absent', 'leave'].map(k => <td key={k} className={`px-3 py-2 text-end tabular-nums ${k === 'absent' && totals[k] ? 'text-red-600' : ''}`}>{totals[k]}</td>)}
            <td className="px-3 py-2 text-end tabular-nums">{totals.hours}</td>
            <td className={`px-3 py-2 text-end tabular-nums ${totals.missing ? 'text-amber-700 font-semibold' : ''}`}>{totals.missing ?? '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function PersonSheet({ person, month, records, requests, settings, today }) {
  const { t, lang } = useT(HW)
  const { days, totals } = monthSheet({ employee: person, records, requests, month, settings, today })
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
        {['present', 'late', 'absent', 'leave'].map(k => (
          <div key={k} className="bg-white border border-border py-2"><p className="text-lg font-semibold tabular-nums">{totals[k]}</p><p className="text-[11px] text-text-tertiary">{t.attStatus[k]}</p></div>
        ))}
        <div className="bg-white border border-border py-2"><p className="text-lg font-semibold tabular-nums">{totals.hours}</p><p className="text-[11px] text-text-tertiary">{t.hours}</p></div>
        <div className="bg-white border border-border py-2" title={t.missingHelp}><p className="text-lg font-semibold tabular-nums">{totals.missing ?? '—'}</p><p className="text-[11px] text-text-tertiary">{t.missing}</p></div>
      </div>
      <div className="bg-white border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
            <th className="text-start font-medium px-3 py-2">{t.date}</th>
            <th className="text-start font-medium px-3 py-2">{t.status}</th>
            <th className="text-start font-medium px-3 py-2">{t.checkIn}</th>
            <th className="text-start font-medium px-3 py-2">{t.checkOut}</th>
            <th className="text-end font-medium px-3 py-2">{t.hours}</th>
            <th className="text-start font-medium px-3 py-2">{t.notes}</th>
          </tr></thead>
          <tbody className="divide-y divide-border">{days.map(d => {
            const r = d.record
            const off = d.work === false
            const future = d.day > today
            return (
              <tr key={d.day} className={off || !d.employed ? 'bg-stone-50 text-text-tertiary' : ''}>
                <td className="px-3 py-1.5 whitespace-nowrap"><span className="inline-block w-12 text-text-tertiary">{t.weekdayShort[d.weekday]}</span>{fmtDay(d.day, lang)}</td>
                <td className="px-3 py-1.5">
                  {!d.employed ? <span className="text-[11px]">{t.notEmployed}</span>
                    : d.state !== 'none' ? <Pill tone={STATE_TONE[d.state]}>{t.attStatus[d.state]}</Pill>
                      : off ? <span className="text-[11px]">{t.offDay}</span>
                        : !future && <Pill>{t.attStatus.none}</Pill>}
                  {r?.corrected_at && <span className="ms-1.5"><Pill title={r.correction_reason}>{t.corrected}</Pill></span>}
                </td>
                <td className="px-3 py-1.5 tabular-nums" dir="ltr">{hhmm(r?.check_in)}</td>
                <td className="px-3 py-1.5 tabular-nums" dir="ltr">{hhmm(r?.check_out)}</td>
                <td className="px-3 py-1.5 text-end tabular-nums">{hoursWorked(r?.check_in, r?.check_out) ?? ''}</td>
                <td className="px-3 py-1.5 text-[11px]" dir="auto">{r?.notes || ''}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </div>
  )
}
