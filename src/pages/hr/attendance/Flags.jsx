import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Skeleton, Spinner } from '../../../components/ui/index'
import { Pagination } from '../../../components/ui/Pagination'
import { useT, fmtDay } from '../../../lib/i18n'
import { nameOf, riyadhToday, monthDays } from '../../../lib/hr/logic'
import { clock, periods } from '../../../lib/hr/attendance'
import { fetchFlags, excuseFlag } from '../../../lib/hr/attendanceClient'
import { Dialog, ErrorText, Field, NoAccess, Pill } from '../parts'
import { field, fieldInline } from '../useHrBase'
import { AttHeader, Chips, GroupBy, EmailPill, Th, Td, Flash } from './shared'
import { useAttendanceBase, useChips, chipGroups, useParam, groupRows, fmtD, useFlash } from './useAttendance'
import { AW } from './words'

// ─── HR → Attendance → Late and early (v2), his flags page ────────────────
// 2026-10-28, dev/erp-pilot/ATTENDANCE.md. Every late arrival and early
// leave found in the device punches, with what was compared, its email, and
// any excuse (Manage records one, with its reason, once). Above: the month
// per employee, excused ones apart.

const FILTERS = [
  { key: 'late', group: 'kind' }, { key: 'early', group: 'kind' },
  { key: 'this_month', group: 'date' }, { key: 'last_month', group: 'date' },
  { key: 'not_excused', group: 'ex' }, { key: 'excused', group: 'ex' },
  { key: 'email_failed', group: 'mail' }, { key: 'no_email', group: 'mail' },
]
const PAGE = 50

export function AttendanceFlags() {
  const { t, lang, dir } = useT(AW)
  const a = useAttendanceBase()
  const { ws, level, can, employees } = a
  const today = riyadhToday()
  const [active, toggle] = useChips()
  const [q, setQ] = useParam('q')
  const [group, setGroup] = useParam('g')
  const [month, setMonth] = useParam('m', today.slice(0, 7))
  const [pageRaw, setPage] = useParam('page', '0')
  const page = Number(pageRaw) || 0
  const [rows, setRows] = useState(null)
  const [count, setCount] = useState(null)
  const [monthRows, setMonthRows] = useState(null)
  const [error, setError] = useState('')
  const [excusing, setExcusing] = useState(null)
  const [flash, setFlash] = useFlash()

  const query = useMemo(() => {
    const g = chipGroups(FILTERS, active)
    const p = periods(today)
    const ranges = (g.date || []).map(k => (k === 'this_month' ? p.month : p.last_month))
    const text = q.trim().toLowerCase()
    return {
      kinds: g.kind || [],
      from: ranges.length ? ranges.map(r => r[0]).sort()[0] : '', to: ranges.length ? ranges.map(r => r[1]).sort().at(-1) : '',
      excused: g.ex?.length === 1 ? g.ex[0] === 'excused' : null,
      emails: (g.mail || []).map(k => (k === 'email_failed' ? 'failed' : 'no_email')),
      employeeIds: text ? (employees || []).filter(e => `${e.name_en} ${e.name_ar}`.toLowerCase().includes(text)).map(e => e.id) : null,
    }
  }, [active, q, today, employees])

  const load = useCallback(async () => {
    if (!ws || employees === null) return
    const [r, m] = await Promise.all([
      fetchFlags(ws, { ...query, page, pageSize: PAGE, all: Boolean(group) }),
      fetchFlags(ws, { from: `${month}-01`, to: monthDays(month).at(-1), all: true }),
    ])
    setRows(r.rows); setCount(r.count); setMonthRows(m.rows); setError(r.error || m.error || '')
  }, [ws, employees, query, page, group, month])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!level) return <NoAccess />
  const emp = id => (employees || []).find(e => e.id === id)
  const summary = monthRows ? [...new Set(monthRows.map(f => f.employee_id))].map(id => {
    const fs = monthRows.filter(f => f.employee_id === id)
    const open = k => fs.filter(f => f.kind === k && !f.excused_at)
    return { employee: emp(id), late: open('late').length, lateMinutes: open('late').reduce((n, f) => n + f.minutes, 0),
      early: open('early').length, earlyMinutes: open('early').reduce((n, f) => n + f.minutes, 0), excused: fs.filter(f => f.excused_at).length }
  }).filter(r => r.employee).sort((x, y) => nameOf(x.employee, lang).localeCompare(nameOf(y.employee, lang), lang)) : null
  const groups = group && rows ? groupRows(rows, f => (group === 'employee' ? f.employee_id : f.work_day.slice(0, 7)),
    f => (group === 'employee' ? nameOf(emp(f.employee_id), lang) : fmtDay(`${f.work_day.slice(0, 7)}-15`, lang, { month: 'long', year: 'numeric' }))) : null

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <AttHeader tab="flags" />
      <Flash msg={flash} />
      <ErrorText error={error || a.error} />
      <section className="bg-white border border-border rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text">{t.flagsMonth}</h2>
          <input type="month" value={month} max={today.slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} className={fieldInline} aria-label={t.month} />
        </div>
        {!summary ? <Skeleton className="h-24 m-3" /> : !summary.length ? <p className="text-xs text-text-tertiary px-4 py-4">{t.nothing}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                <Th>{t.employee}</Th><Th end>{t.lateCount}</Th><Th end>{t.lateMinutes}</Th><Th end>{t.earlyCount}</Th><Th end>{t.earlyMinutes}</Th><Th end>{t.excusedCount}</Th>
              </tr></thead>
              <tbody className="divide-y divide-border">{summary.map(r => (
                <tr key={r.employee.id}>
                  <Td><Link className="hover:underline" to={`/hr/attendance/monthly?employee=${r.employee.id}&m=${month}`}>{nameOf(r.employee, lang)}</Link> <span className="text-[11px] text-text-tertiary" dir="ltr">{r.employee.employee_no}</span></Td>
                  <Td end>{r.late}</Td><Td end>{r.lateMinutes}</Td><Td end>{r.early}</Td><Td end>{r.earlyMinutes}</Td><Td end>{r.excused}</Td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchName} aria-label={t.search} className={`${fieldInline} min-w-[14rem]`} dir="auto" />
        <GroupBy value={group} onChange={setGroup} options={['employee', 'month']} />
      </div>
      <Chips filters={FILTERS} active={active} onToggle={toggle} />

      {rows === null ? <Skeleton className="h-48" /> : !rows.length ? <p className="text-sm text-text-secondary py-6">{t.nothing}</p> : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              <Th>{t.day}</Th><Th>{t.employee}</Th><Th>{t.kind}</Th><Th end>{t.scheduled}</Th><Th end>{t.actual}</Th><Th end>{t.minutesCol}</Th><Th end>{t.graceCol}</Th><Th>{t.email}</Th><Th>{t.excuse}</Th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(groups || [{ key: '', items: rows }]).map(g => [
                groups && <tr key={`g-${g.key}`} className="bg-stone-50 text-xs font-medium"><td colSpan={9} className="px-3 py-1.5">{g.title} <span className="text-text-tertiary font-normal">({g.items.length})</span></td></tr>,
                ...g.items.map(f => (
                  <tr key={f.id}>
                    <Td className="whitespace-nowrap">{fmtD(f.work_day, lang)}</Td>
                    <Td><Link className="hover:underline" to={`/hr/employee?id=${f.employee_id}`}>{nameOf(emp(f.employee_id), lang)}</Link></Td>
                    <Td><Pill tone={f.kind === 'late' ? 'amber' : 'blue'}>{t.kinds[f.kind]}</Pill></Td>
                    <Td end>{clock(f.scheduled_at)}</Td>
                    <Td end>{clock(f.actual_at)}</Td>
                    <Td end>{f.minutes}</Td>
                    <Td end>{f.kind === 'late' ? f.grace_minutes : t.dash}</Td>
                    <Td><EmailPill status={f.email_status} />{f.email_error && <span className="block text-[11px] text-red-600" dir="ltr">{f.email_error}</span>}</Td>
                    <Td className="text-[11px]">{f.excused_at
                      ? <span><Pill>{t.excused}</Pill> <span dir="auto">{f.excuse_reason}</span><span className="block text-text-tertiary">{t.excuseBy(a.personName(f.excused_by) || t.someone, fmtDay(f.excused_at, lang, { day: 'numeric', month: 'short' }))}</span></span>
                      : can('manage') && <Button size="xs" variant="ghost" onClick={() => setExcusing(f)}>{t.addExcuse}</Button>}</Td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
          {!group && <Pagination page={page} pageSize={PAGE} count={count} onPage={n => setPage(String(n))} words={t.pager} />}
        </div>
      )}

      {excusing && (
        <Dialog title={`${t.kinds[excusing.kind]} · ${nameOf(emp(excusing.employee_id), lang)} · ${fmtD(excusing.work_day, lang)}`} onClose={() => setExcusing(null)}>
          <ExcuseForm onCancel={() => setExcusing(null)} onSubmit={async reason => {
            const out = await excuseFlag(ws, excusing.id, reason)
            if (!out.error) { setExcusing(null); setFlash(t.excuseSaved); load() }
            return out
          }} />
        </Dialog>
      )}
    </div>
  )
}

function ExcuseForm({ onSubmit, onCancel }) {
  const { t, dir } = useT(AW)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <form dir={dir} className="space-y-3" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('')
      const out = await onSubmit(reason); setBusy(false); if (out?.error) setError(out.error)
    }}>
      <Field label={t.excuseReason}><textarea required rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} className={field} dir="auto" /></Field>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{t.save}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}
