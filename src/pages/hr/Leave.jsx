import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, PageHeader, Skeleton, Spinner } from '../../components/ui/index'
import { useT, fmtDay } from '../../lib/i18n'
import {
  nameOf, balanceOf, leaveActions, leaveProblem, offOn, workingDays, spanDays, monthDays, riyadhToday, weekday,
} from '../../lib/hr/logic'
import {
  fetchLeaveTypes, fetchLeaveRequests, fetchBalances, fetchSettings, fetchPeople, askLeave, decideLeave, saveBalance,
} from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, field, fmtDate, empName, STATE_TONE } from './useHrBase'
import { Dialog, ErrorText, Field, Pill, Tabs, EmployeeSelect, NoAccess } from './parts'

// ─── HR → Leave (v2) ───────────────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/HR.md. Three tabs (?tab=): the requests with
// their decisions, who is off (a month grid), and the balances. Work asks
// for anyone; a View person for themselves once their login is linked. A
// decision goes through hr_leave_decide(), which checks who may decide and
// the balance again; the buttons shown here follow the same rules
// (leaveActions) so nobody is offered what the database would refuse.

const TABS = ['requests', 'off', 'balances']

export function HrLeave() {
  const { t, lang, dir } = useT(HW)
  const base = useHrBase()
  const { ws, me, level, can, employees, myEmployee, managerOf } = base
  const [params, setParams] = useSearchParams()
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'requests'
  const setParam = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const today = riyadhToday()
  const year = Number(params.get('y')) || Number(today.slice(0, 4))

  const [types, setTypes] = useState([])
  const [requests, setRequests] = useState(null)
  const [balances, setBalances] = useState([])
  const [settings, setSettings] = useState(null)
  const [people, setPeople] = useState([])
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(false)

  const load = useCallback(async () => {
    if (!ws) return
    const [ty, r, b, s, p] = await Promise.all([fetchLeaveTypes(ws), fetchLeaveRequests(ws), fetchBalances(ws, year), fetchSettings(ws), fetchPeople(ws)])
    setTypes(ty.rows); setRequests(r.rows); setBalances(b.rows); setSettings(s.row); setPeople(p.rows)
    setError(ty.error || r.error || b.error || '')
  }, [ws, year])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!level) return <NoAccess />
  const canAsk = can('work') || Boolean(myEmployee)

  return (
    <div className="max-w-5xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={t.leaveTitle} subtitle={t.leaveSubtitle}>
        {canAsk && <Button size="sm" onClick={() => setAsking(true)}>{t.newRequest}</Button>}
      </PageHeader>
      {!canAsk && <p className="text-[11px] text-text-tertiary">{t.askOwnOnly}</p>}
      <Tabs label={t.leaveTitle} value={tab} onChange={k => setParam('tab', k === 'requests' ? '' : k)} tabs={TABS.map(k => ({ key: k, label: t.tabs[k] }))} />
      <ErrorText error={error || base.error} />

      {requests === null || employees === null ? <Skeleton className="h-48" /> : tab === 'requests' ? (
        <Requests {...{ requests, types, balances, employees, people, me, level, myEmployee, managerOf, ws, onChanged: load }}
          filter={params.get('f') || (can('manage') ? 'pending' : 'mine')} setFilter={f => setParam('f', f)} />
      ) : tab === 'off' ? (
        <WhoIsOff requests={requests} employees={employees} types={types} workDays={settings?.work_days || []} month={params.get('m') || today.slice(0, 7)} setMonth={m => setParam('m', m)} today={today} />
      ) : (
        <Balances {...{ ws, me, year, types, balances, requests, employees, canEdit: can('manage'), onChanged: load }} setYear={y => setParam('y', String(y))} />
      )}

      {asking && (
        <Dialog title={t.newRequest.replace('+ ', '')} onClose={() => setAsking(false)}>
          <AskForm {...{ employees, types, balances, requests, settings, myEmployee, anyone: can('work') }} onCancel={() => setAsking(false)}
            onSubmit={async f => {
              const out = await askLeave(ws, me, f)
              if (!out.error) { setAsking(false); load() }
              return out
            }} />
        </Dialog>
      )}
    </div>
  )
}

// ── Requests ──

function Requests({ requests, types, balances, employees, people, me, level, myEmployee, managerOf, ws, onChanged, filter, setFilter }) {
  const { t, lang } = useT(HW)
  const [deciding, setDeciding] = useState(null) // { request, action }
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const who = id => people.find(p => p.user_id === id)?.name || t.someone
  const typeOf = id => types.find(ty => ty.id === id)

  const shown = requests.filter(r =>
    filter === 'all' ? true
      : filter === 'pending' ? r.status === 'pending'
        : (myEmployee && r.employee_id === myEmployee.id) || managerOf(r.employee_id) || r.created_by === me)

  async function act(r, action, note = '') {
    setBusyId(r.id); setError('')
    const out = await decideLeave(ws, r.id, action, note)
    setBusyId('')
    if (out.error) { setError(out.error); return out }
    setDeciding(null)
    onChanged()
    return out
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5" role="group" aria-label={t.status}>
        {['pending', 'mine', 'all'].map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={`rounded-md border px-2.5 py-1 text-xs ${filter === f ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white border-border text-text-secondary hover:bg-stone-50'}`}>
            {t.filters[f]}{f === 'pending' && ` (${requests.filter(r => r.status === 'pending').length})`}
          </button>
        ))}
      </div>
      <ErrorText error={error} />
      {!shown.length ? <p className="text-sm text-text-tertiary py-4">{t.noRequests}</p> : (
        <ul className="bg-white border border-border divide-y divide-border">
          {shown.map(r => {
            const ty = typeOf(r.leave_type_id)
            const acts = leaveActions(r, { level, myEmployeeId: myEmployee?.id || '', managerOf })
            const year = Number(r.date_from.slice(0, 4))
            const bal = ty?.needs_balance ? balanceOf({ balances, requests, employeeId: r.employee_id, typeId: r.leave_type_id, year }) : null
            return (
              <li key={r.id} className="px-3 py-2.5 flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-[14rem]">
                  <p className="text-sm text-text">
                    <span className="font-medium">{empName(employees, r.employee_id, lang, t.someone)}</span>
                    <span className="text-text-secondary"> · {nameOf(ty, lang)}</span>
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {fmtDate(r.date_from, lang)}{r.date_to !== r.date_from && ` – ${fmtDate(r.date_to, lang)}`} · {t.nDays(r.days)}
                    {bal && bal.granted !== null && year === Number(riyadhToday().slice(0, 4)) && (
                      <span className={`ms-2 ${r.status === 'pending' && bal.remaining - r.days < 0 ? 'text-red-600 font-medium' : 'text-text-tertiary'}`}>
                        {r.status === 'pending' ? t.afterThis(bal.remaining - Number(r.days)) : t.leftNow(bal.remaining)}
                      </span>
                    )}
                  </p>
                  {r.reason && <p className="text-xs text-text-tertiary mt-0.5" dir="auto">{r.reason}</p>}
                  {(r.status === 'approved' || r.status === 'rejected') && r.decided_at && (
                    <p className="text-[11px] text-text-tertiary mt-0.5">{t.leaveStatus[r.status]} {t.decidedBy(who(r.decided_by), fmtDay(r.decided_at, lang))}{r.decision_note && <span dir="auto">: {r.decision_note}</span>}</p>
                  )}
                  {r.status === 'cancelled' && r.cancelled_at && (
                    <p className="text-[11px] text-text-tertiary mt-0.5">{t.cancelledBy(who(r.cancelled_by), fmtDay(r.cancelled_at, lang))}{r.decision_note && <span dir="auto">: {r.decision_note}</span>}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={STATE_TONE[r.status]}>{t.leaveStatus[r.status]}</Pill>
                  {acts.approve && <Button size="xs" disabled={busyId === r.id} onClick={() => act(r, 'approve')}>{busyId === r.id && <Spinner size="sm" />}{t.approve}</Button>}
                  {acts.reject && <Button size="xs" variant="danger" disabled={busyId === r.id} onClick={() => setDeciding({ request: r, action: 'reject' })}>{t.reject}</Button>}
                  {acts.cancel && <Button size="xs" variant="ghost" disabled={busyId === r.id} onClick={() => setDeciding({ request: r, action: 'cancel' })}>{t.cancelRequest}</Button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {deciding && (
        <Dialog title={deciding.action === 'reject' ? t.reject : t.cancelRequest} onClose={() => setDeciding(null)}>
          <NoteForm required={deciding.action === 'reject'} label={deciding.action === 'reject' ? t.rejectWhy : t.cancelWhy}
            submitLabel={deciding.action === 'reject' ? t.reject : t.cancelRequest}
            onCancel={() => setDeciding(null)} onSubmit={note => act(deciding.request, deciding.action, note)} />
        </Dialog>
      )}
    </div>
  )
}

function NoteForm({ label, required, submitLabel, onSubmit, onCancel }) {
  const { t, dir } = useT(HW)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <form dir={dir} className="space-y-3" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('')
      const out = await onSubmit(note.trim()); setBusy(false)
      if (out?.error) setError(out.error)
    }}>
      <Field label={label}><textarea autoFocus required={required} rows={3} value={note} onChange={e => setNote(e.target.value)} className={field} dir="auto" /></Field>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant={required ? 'danger' : 'primary'} disabled={busy}>{busy && <Spinner size="sm" />}{submitLabel}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}

// ── Asking ──

function AskForm({ employees, types, balances, requests, settings, myEmployee, anyone, onSubmit, onCancel }) {
  const { t, lang, dir } = useT(HW)
  const today = riyadhToday()
  const active = types.filter(ty => ty.active)
  const [f, setF] = useState({ employeeId: anyone ? '' : myEmployee?.id || '', typeId: active[0]?.id || '', from: today, to: today, days: '1', reason: '' })
  const [touchedDays, setTouchedDays] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setF(x => {
    const n = { ...x, [k]: v }
    if (k === 'from' && n.to < v) n.to = v
    // Days follow the dates (the work week's days) until typed by hand.
    if ((k === 'from' || k === 'to') && !touchedDays) n.days = String(workingDays(n.from, n.to, settings?.work_days) || spanDays(n.from, n.to))
    return n
  })
  const ty = active.find(x => x.id === f.typeId)
  const year = Number(f.from.slice(0, 4))
  const bal = ty?.needs_balance && f.employeeId ? balanceOf({ balances, requests, employeeId: f.employeeId, typeId: ty.id, year }) : null
  const problem = f.employeeId ? leaveProblem({ from: f.from, to: f.to, days: f.days }, requests, f.employeeId) : null
  const thisYear = year === Number(today.slice(0, 4))

  async function submit(e) {
    e.preventDefault()
    if (problem) { setError(t.problems[problem]); return }
    setBusy(true); setError('')
    const out = await onSubmit({ ...f, days: Number(f.days) })
    setBusy(false)
    if (out?.error) setError(out.error)
  }

  return (
    <form onSubmit={submit} className="space-y-3" dir={dir} lang={lang}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label={t.forWhom}>
          {anyone
            ? <EmployeeSelect employees={employees} value={f.employeeId} onChange={v => set('employeeId', v)} placeholder={t.pickEmployee} required />
            : <input disabled value={nameOf(myEmployee, lang)} className={field} />}
        </Field>
        <Field label={t.leaveType}>
          <select value={f.typeId} onChange={e => set('typeId', e.target.value)} className={field} required>
            {active.map(x => <option key={x.id} value={x.id}>{nameOf(x, lang)}</option>)}
          </select>
        </Field>
        <Field label={t.from}><input type="date" required value={f.from} onChange={e => set('from', e.target.value)} className={field} /></Field>
        <Field label={t.to}><input type="date" required min={f.from} value={f.to} onChange={e => set('to', e.target.value)} className={field} /></Field>
        <Field label={t.days} hint={t.daysHelp(spanDays(f.from, f.to))}>
          <input type="number" min="0.5" step="0.5" required value={f.days} onChange={e => { setTouchedDays(true); setF(x => ({ ...x, days: e.target.value })) }} className={field} />
        </Field>
        <div className="text-xs text-text-secondary self-center">
          {ty && !ty.needs_balance && t.noBalance}
          {bal && (bal.granted === null && thisYear ? t.notGranted : (
            <span className={bal.remaining - Number(f.days || 0) < 0 ? 'text-red-600 font-medium' : ''}>
              {t.leftNow(bal.remaining)} · {t.afterThis(bal.remaining - Number(f.days || 0))}
            </span>
          ))}
        </div>
      </div>
      <Field label={`${t.reason} ${t.optional}`}><textarea rows={2} value={f.reason} onChange={e => set('reason', e.target.value)} className={field} dir="auto" /></Field>
      {problem && <p className="text-xs text-amber-700">{t.problems[problem]}</p>}
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !f.employeeId || !f.typeId}>{busy && <Spinner size="sm" />}{t.newRequest.replace('+ ', '')}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}

// ── Who is off: a month grid ──

function WhoIsOff({ requests, employees, types, workDays, month, setMonth, today }) {
  const { t, lang } = useT(HW)
  const days = monthDays(month)
  const approved = requests.filter(r => r.status === 'approved' && r.date_from <= days.at(-1) && r.date_to >= days[0])
  const people = [...new Set(approved.map(r => r.employee_id))]
    .map(id => employees.find(e => e.id === id)).filter(Boolean)
    .sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang))
  const offToday = offOn(requests, today)
  const shift = n => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)) }

  return (
    <div className="space-y-4">
      <section className="bg-white border border-border p-3">
        <h3 className="text-xs font-semibold text-text-secondary mb-1.5">{t.offOnDay} {fmtDate(today, lang)}</h3>
        {offToday.length === 0 ? <p className="text-xs text-text-tertiary">{t.nobodyOff}</p> : (
          <ul className="flex flex-wrap gap-2">{offToday.map(r => (
            <li key={r.id} className="text-xs border border-sky-200 bg-sky-50 text-sky-900 px-2 py-1">
              {empName(employees, r.employee_id, lang)} · {nameOf(types.find(x => x.id === r.leave_type_id), lang)} · {t.to} {fmtDate(r.date_to, lang)}
            </li>
          ))}</ul>
        )}
      </section>

      <div className="flex items-center gap-2">
        <Button size="xs" variant="secondary" onClick={() => shift(-1)} aria-label={t.prev}>{lang === 'ar' ? '→' : '←'}</Button>
        <span className="text-sm font-medium text-text min-w-[9rem] text-center">{fmtDay(`${month}-15`, lang, { month: 'long', year: 'numeric' })}</span>
        <Button size="xs" variant="secondary" onClick={() => shift(1)} aria-label={t.next}>{lang === 'ar' ? '←' : '→'}</Button>
        <span className="text-[11px] text-text-tertiary ms-2">{t.offThisMonth}</span>
      </div>

      {!people.length ? <p className="text-sm text-text-tertiary">{t.nobodyOff}</p> : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="text-[11px] border-collapse">
            <thead><tr>
              <th className="sticky start-0 bg-white text-start font-medium px-2 py-1.5 min-w-[10rem]">{t.employee}</th>
              {days.map(d => <th key={d} className={`w-6 text-center font-normal ${d === today ? 'text-text font-semibold' : 'text-text-tertiary'}`} title={fmtDate(d, lang)}>{Number(d.slice(8))}</th>)}
            </tr></thead>
            <tbody>{people.map(e => (
              <tr key={e.id} className="border-t border-border">
                <td className="sticky start-0 bg-white px-2 py-1 whitespace-nowrap">{nameOf(e, lang)}</td>
                {days.map(d => {
                  const r = approved.find(x => x.employee_id === e.id && x.date_from <= d && x.date_to >= d)
                  const weekend = workDays.length > 0 && !workDays.includes(weekday(d))
                  return <td key={d} title={r ? `${nameOf(types.find(x => x.id === r.leave_type_id), lang)}: ${fmtDate(r.date_from, lang)} – ${fmtDate(r.date_to, lang)}` : ''}
                    className={`h-6 border-s border-border ${r ? 'bg-sky-400' : weekend ? 'bg-stone-50' : ''}`} />
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Balances ──

function Balances({ ws, me, year, types, balances, requests, employees, canEdit, onChanged, setYear }) {
  const { t, lang } = useT(HW)
  const [editing, setEditing] = useState(null) // { employee, type, current }
  const balanceTypes = types.filter(ty => ty.needs_balance && ty.active)
  const people = useMemo(() => employees.filter(e => e.status === 'active').sort((a, b) => nameOf(a, lang).localeCompare(nameOf(b, lang), lang)), [employees, lang])
  if (!balanceTypes.length) return <p className="text-sm text-text-tertiary">{t.noBalanceTypes}</p>
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="xs" variant="secondary" onClick={() => setYear(year - 1)} aria-label={t.prev}>{lang === 'ar' ? '→' : '←'}</Button>
        <span className="text-sm font-medium tabular-nums">{year}</span>
        <Button size="xs" variant="secondary" onClick={() => setYear(year + 1)} aria-label={t.next}>{lang === 'ar' ? '←' : '→'}</Button>
        <span className="text-[11px] text-text-tertiary ms-2">{t.balancesHelp}</span>
      </div>
      <div className="bg-white border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-tertiary border-b border-border">
              <th className="text-start font-medium px-3 py-2" rowSpan={2}>{t.employee}</th>
              {balanceTypes.map(ty => <th key={ty.id} colSpan={3} className="text-center font-medium px-2 pt-2 border-s border-border">{nameOf(ty, lang)}</th>)}
            </tr>
            <tr className="text-text-tertiary border-b border-border">
              {balanceTypes.map(ty => ['granted', 'used', 'remaining'].map(k => <th key={ty.id + k} className={`text-end font-normal px-2 pb-1.5 ${k === 'granted' ? 'border-s border-border' : ''}`}>{t[k]}</th>))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">{people.map(e => (
            <tr key={e.id}>
              <td className="px-3 py-1.5 whitespace-nowrap">{nameOf(e, lang)}</td>
              {balanceTypes.map(ty => {
                const b = balanceOf({ balances, requests, employeeId: e.id, typeId: ty.id, year })
                return [
                  <td key={ty.id + 'g'} className="text-end px-2 border-s border-border tabular-nums">
                    {canEdit ? <button type="button" className="underline decoration-dotted hover:text-text" onClick={() => setEditing({ employee: e, type: ty, current: b.granted })}>{b.granted ?? '—'}</button> : (b.granted ?? '—')}
                  </td>,
                  <td key={ty.id + 'u'} className="text-end px-2 tabular-nums">{b.used}{b.pending ? <span className="text-amber-700"> +{b.pending}</span> : ''}</td>,
                  <td key={ty.id + 'r'} className={`text-end px-2 tabular-nums font-semibold ${b.remaining < 0 ? 'text-red-600' : ''}`}>{b.granted === null && !b.used ? '—' : b.remaining}</td>,
                ]
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {editing && (
        <Dialog title={t.setBalance} onClose={() => setEditing(null)}>
          <BalanceForm label={t.balanceFor(nameOf(editing.employee, lang), nameOf(editing.type, lang), year)} current={editing.current}
            onCancel={() => setEditing(null)}
            onSubmit={async (days, note) => {
              const out = await saveBalance(ws, me, { employeeId: editing.employee.id, typeId: editing.type.id, year, days, note })
              if (!out.error) { setEditing(null); onChanged() }
              return out
            }} />
        </Dialog>
      )}
    </div>
  )
}

function BalanceForm({ label, current, onSubmit, onCancel }) {
  const { t, dir } = useT(HW)
  const [days, setDays] = useState(current ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <form dir={dir} className="space-y-3" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('')
      const out = await onSubmit(Number(days), note.trim()); setBusy(false)
      if (out?.error) setError(out.error)
    }}>
      <p className="text-sm text-text">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        <Field label={t.granted}><input type="number" min="0" max="366" step="0.5" required autoFocus value={days} onChange={e => setDays(e.target.value)} className={field} /></Field>
        <Field label={t.balanceNote} className="col-span-2"><input value={note} onChange={e => setNote(e.target.value)} className={field} dir="auto" /></Field>
      </div>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{t.save}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}
