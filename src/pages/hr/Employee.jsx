import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, PageHeader, Skeleton, Spinner } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import {
  nameOf, docState, contractState, balanceOf, monthSheet, monthDays, riyadhToday, matchLogin, DOC_TYPES,
} from '../../lib/hr/logic'
import {
  saveEmployee, fetchDocuments, saveDocument, deleteDocument, fetchContracts, saveContract, deleteContract,
  fetchLeaveTypes, fetchBalances, fetchLeaveRequests, fetchAttendance, fetchSettings, fetchLogins,
} from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, field, fmtDate, empName, STATE_TONE } from './useHrBase'
import { Dialog, ErrorText, Field, Pill, NoAccess } from './parts'
import { EmployeeForm } from './EmployeeForm'

// ─── HR → one employee (v2) ────────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/HR.md. /hr/employee?id=. The profile, their
// team, their leave this year and attendance this month, and, for HR (Work
// and up) or the person themselves, their papers and contracts. Work edits
// and ends employment; Manage links a login (matched by the work email).

export function HrEmployee() {
  const { t, lang, dir } = useT(HW)
  const base = useHrBase()
  const { ws, me, can, employees, departments, error, reload } = base
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const today = riyadhToday()
  const year = Number(today.slice(0, 4))
  const month = today.slice(0, 7)
  const e = (employees || []).find(x => x.id === id) || null
  const own = Boolean(e && e.user_id && e.user_id === me)
  const seesPapers = can('work') || own

  const [docs, setDocs] = useState(null)
  const [contracts, setContracts] = useState(null)
  const [types, setTypes] = useState([])
  const [balances, setBalances] = useState([])
  const [requests, setRequests] = useState([])
  const [attendance, setAttendance] = useState([])
  const [settings, setSettings] = useState(null)
  const [logins, setLogins] = useState([])
  const [dialog, setDialog] = useState(null) // 'edit' | 'end' | 'rehire' | 'login' | {doc} | {contract}
  const [loadError, setLoadError] = useState('')

  const manage = can('manage')
  const load = useCallback(async () => {
    if (!ws || !id) return
    const [d, c, ty, b, r, a, s, l] = await Promise.all([
      fetchDocuments(ws, id), fetchContracts(ws, id), fetchLeaveTypes(ws), fetchBalances(ws, year),
      fetchLeaveRequests(ws, { employeeId: id }), fetchAttendance(ws, `${month}-01`, monthDays(month).at(-1), id), fetchSettings(ws),
      manage ? fetchLogins(ws) : Promise.resolve({ rows: [] }),
    ])
    setDocs(d.rows); setContracts(c.rows); setTypes(ty.rows); setBalances(b.rows); setRequests(r.rows)
    setAttendance(a.rows); setSettings(s.row); setLogins(l.rows)
    setLoadError(d.error || c.error || ty.error || b.error || r.error || a.error || '')
  }, [ws, id, year, month, manage])
  useEffect(() => { queueMicrotask(load) }, [load])

  const sheet = useMemo(() => (e ? monthSheet({ employee: e, records: attendance, requests, month, settings, today }) : null), [e, attendance, requests, month, settings, today])

  if (!base.level) return <NoAccess />
  if (employees === null) return <Skeleton className="h-64 max-w-5xl" />
  if (!e) return <div className="max-w-5xl space-y-3" dir={dir}><p className="text-sm text-text-secondary">{t.errors.HR_NOT_FOUND}</p><Link to="/hr" className="text-xs underline">{t.back}</Link></div>

  const dept = departments.find(d => d.id === e.department_id)
  const team = employees.filter(x => x.manager_id === e.id && x.status === 'active')
  const login = e.user_id ? logins.find(l => l.user_id === e.user_id) : null
  const balanceTypes = types.filter(ty => ty.needs_balance && ty.active)
  const close = () => setDialog(null)
  const saved = async out => { if (!out.error) { close(); await reload(); await load() } return out }

  return (
    <div className="max-w-5xl space-y-5" dir={dir} lang={lang}>
      <PageHeader title={nameOf(e, lang)} subtitle={[e.job_title, nameOf(dept, lang)].filter(Boolean).join(' · ')}>
        <Link to="/hr" className="text-xs text-text-secondary hover:text-text">{dir === 'rtl' ? '→' : '←'} {t.employeesTitle}</Link>
        {can('work') && <Button size="sm" variant="secondary" onClick={() => setDialog('edit')}>{t.edit}</Button>}
        {can('work') && (e.status === 'active'
          ? <Button size="sm" variant="danger" onClick={() => setDialog('end')}>{t.endEmployment}</Button>
          : <Button size="sm" variant="secondary" onClick={() => setDialog('rehire')}>{t.rehire}</Button>)}
      </PageHeader>
      <ErrorText error={error || loadError} />

      {/* Profile */}
      <section className="bg-white border border-border p-4">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 text-sm">
          <Item label={t.status}>{e.status === 'active' ? <Pill tone="green">{t.statuses.active}</Pill> : <Pill>{t.leftOn(fmtDate(e.end_date, lang))}</Pill>}</Item>
          <Item label={t.employeeNo}><bdi dir="ltr">{e.employee_no || '—'}</bdi></Item>
          <Item label={t.hireDate}>{fmtDate(e.hire_date, lang)}</Item>
          <Item label={t.manager}>{e.manager_id ? <Link className="hover:underline" to={`/hr/employee?id=${e.manager_id}`}>{empName(employees, e.manager_id, lang)}</Link> : '—'}</Item>
          <Item label={t.workEmail}><bdi dir="ltr">{e.work_email || '—'}</bdi></Item>
          <Item label={t.workPhone}><bdi dir="ltr">{e.work_phone || '—'}</bdi></Item>
          <Item label={lang === 'ar' ? t.nameEn : t.nameAr}>
            <span dir={lang === 'ar' ? 'ltr' : 'rtl'}>{(lang === 'ar' ? e.name_en : e.name_ar) || '—'}</span>
          </Item>
          <Item label={t.login}>
            {e.user_id ? <span className="text-text"><bdi dir="ltr">{login?.email || (own ? t.yes : '✓')}</bdi></span> : <span className="text-text-tertiary">{t.noLogin}</span>}
            {can('manage') && <button type="button" className="ms-2 text-[11px] underline text-text-secondary" onClick={() => setDialog('login')}>{e.user_id ? t.edit : t.linkLogin}</button>}
          </Item>
        </dl>
        {e.status === 'ended' && e.end_reason && <p className="text-xs text-text-secondary mt-3" dir="auto">{t.endReason}: {e.end_reason}</p>}
        {e.notes && <p className="text-xs text-text-secondary mt-3 whitespace-pre-wrap" dir="auto">{e.notes}</p>}
        {team.length > 0 && (
          <p className="text-xs text-text-secondary mt-3">{t.team}: {team.map((m, i) => (
            <span key={m.id}>{i > 0 && (lang === 'ar' ? '، ' : ', ')}<Link className="hover:underline text-text" to={`/hr/employee?id=${m.id}`}>{nameOf(m, lang)}</Link></span>
          ))}</p>
        )}
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Leave this year */}
        <section className="bg-white border border-border p-4 space-y-3">
          <h2 className="text-sm font-semibold text-text">{t.leaveThisYear(year)}</h2>
          {balanceTypes.length === 0 ? <p className="text-xs text-text-tertiary">{t.noBalanceTypes}</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-text-tertiary"><th className="text-start font-medium py-1">{t.leaveType}</th><th className="text-end font-medium">{t.granted}</th><th className="text-end font-medium">{t.used}</th><th className="text-end font-medium">{t.pending}</th><th className="text-end font-medium">{t.remaining}</th></tr></thead>
              <tbody>{balanceTypes.map(ty => {
                const b = balanceOf({ balances, requests, employeeId: e.id, typeId: ty.id, year })
                return (
                  <tr key={ty.id} className="border-t border-border">
                    <td className="py-1.5">{nameOf(ty, lang)}</td>
                    <td className="text-end tabular-nums">{b.granted ?? '—'}</td>
                    <td className="text-end tabular-nums">{b.used}</td>
                    <td className="text-end tabular-nums">{b.pending || ''}</td>
                    <td className={`text-end tabular-nums font-semibold ${b.remaining < 0 ? 'text-red-600' : ''}`}>{b.granted === null ? '—' : b.remaining}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          )}
          <div>
            <h3 className="text-[11px] font-semibold text-text-secondary mb-1">{t.recentRequests}</h3>
            {requests.length === 0 ? <p className="text-xs text-text-tertiary">{t.noRequests}</p> : (
              <ul className="space-y-1">{requests.slice(0, 8).map(r => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                  <span>{nameOf(types.find(ty => ty.id === r.leave_type_id), lang)} · {fmtDate(r.date_from, lang)}{r.date_to !== r.date_from && ` – ${fmtDate(r.date_to, lang)}`} · {Number(r.days)} {t.days}</span>
                  <Pill tone={STATE_TONE[r.status]}>{t.leaveStatus[r.status]}</Pill>
                </li>
              ))}</ul>
            )}
            <Link to="/hr/leave" className="inline-block mt-2 text-[11px] underline text-text-secondary">{t.leaveTitle}</Link>
          </div>
        </section>

        {/* Attendance this month */}
        <section className="bg-white border border-border p-4 space-y-3">
          <h2 className="text-sm font-semibold text-text">{t.attendanceThisMonth}</h2>
          {sheet && (
            <div className="grid grid-cols-3 gap-2 text-center">
              {['present', 'late', 'absent', 'leave'].map(k => (
                <div key={k} className="border border-border py-2"><p className="text-lg font-semibold tabular-nums">{sheet.totals[k]}</p><p className="text-[11px] text-text-tertiary">{t.attStatus[k]}</p></div>
              ))}
              <div className="border border-border py-2"><p className="text-lg font-semibold tabular-nums">{sheet.totals.hours}</p><p className="text-[11px] text-text-tertiary">{t.hours}</p></div>
              <div className="border border-border py-2"><p className="text-lg font-semibold tabular-nums">{sheet.totals.missing ?? '—'}</p><p className="text-[11px] text-text-tertiary">{t.missing}</p></div>
            </div>
          )}
          <Link to={`/hr/attendance?tab=month&emp=${e.id}&m=${month}`} className="inline-block text-[11px] underline text-text-secondary">{t.openSheet}</Link>
        </section>
      </div>

      {/* Papers */}
      <section className="bg-white border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">{t.papers}</h2>
          {can('work') && <Button size="xs" variant="secondary" onClick={() => setDialog({ doc: {} })}>{t.addPaper}</Button>}
        </div>
        {!seesPapers ? <p className="text-xs text-text-tertiary">{t.papersHidden}</p> : docs === null ? <Spinner size="sm" /> : docs.length === 0 ? <p className="text-xs text-text-tertiary">{t.noPapers}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-text-tertiary"><th className="text-start font-medium py-1">{t.docType}</th><th className="text-start font-medium">{t.docNumber}</th><th className="text-start font-medium">{t.issueDate}</th><th className="text-start font-medium">{t.expiryDate}</th><th /></tr></thead>
              <tbody>{docs.map(d => {
                const st = docState(d, today)
                return (
                  <tr key={d.id} className="border-t border-border">
                    <td className="py-1.5">{t.docTypes[d.doc_type]}{d.notes && <span className="block text-text-tertiary" dir="auto">{d.notes}</span>}</td>
                    <td><bdi dir="ltr">{d.doc_number}</bdi></td>
                    <td>{fmtDate(d.issue_date, lang)}</td>
                    <td>{d.expiry_date ? <span className="flex flex-wrap items-center gap-1.5">{fmtDate(d.expiry_date, lang)} {st.state !== 'ok' && <Pill tone={STATE_TONE[st.state]}>{st.days < 0 ? `${t.docStates.expired} ${t.expiredAgo(-st.days)}` : t.expiresIn(st.days)}</Pill>}</span> : '—'}</td>
                    <td className="text-end">{can('work') && <button type="button" className="underline text-text-secondary" onClick={() => setDialog({ doc: d })}>{t.edit}</button>}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </section>

      {/* Contracts */}
      <section className="bg-white border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">{t.contracts}</h2>
          {can('work') && <Button size="xs" variant="secondary" onClick={() => setDialog({ contract: {} })}>{t.addContract}</Button>}
        </div>
        {!seesPapers ? <p className="text-xs text-text-tertiary">{t.contractsHidden}</p> : contracts === null ? <Spinner size="sm" /> : contracts.length === 0 ? <p className="text-xs text-text-tertiary">{t.noContracts}</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-text-tertiary"><th className="text-start font-medium py-1">{t.contractType}</th><th className="text-start font-medium">{t.start}</th><th className="text-start font-medium">{t.end}</th><th className="text-start font-medium">{t.status}</th><th /></tr></thead>
            <tbody>{contracts.map(c => {
              const st = contractState(c, today)
              return (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-1.5">{t.contractTypes[c.contract_type]}{c.notes && <span className="block text-text-tertiary" dir="auto">{c.notes}</span>}</td>
                  <td>{fmtDate(c.start_date, lang)}</td>
                  <td>{c.end_date ? fmtDate(c.end_date, lang) : '—'}</td>
                  <td><Pill tone={STATE_TONE[st]}>{t.contractStates[st]}</Pill></td>
                  <td className="text-end">{can('work') && <button type="button" className="underline text-text-secondary" onClick={() => setDialog({ contract: c })}>{t.edit}</button>}</td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
        <p className="text-[11px] text-text-tertiary">{t.noPay}</p>
      </section>

      {dialog === 'edit' && (
        <Dialog title={t.edit} onClose={close}>
          <EmployeeForm initial={e} employees={employees} departments={departments} onCancel={close}
            onSubmit={fields => saveEmployee(ws, me, e.id, fields).then(saved)} />
        </Dialog>
      )}
      {(dialog === 'end' || dialog === 'rehire') && (
        <Dialog title={dialog === 'end' ? t.endEmployment : t.rehire} onClose={close}>
          <EmploymentForm ending={dialog === 'end'} employee={e} onCancel={close} onSubmit={fields => saveEmployee(ws, me, e.id, fields).then(saved)} />
        </Dialog>
      )}
      {dialog === 'login' && (
        <Dialog title={t.login} onClose={close}>
          <LoginForm employee={e} logins={logins} employees={employees} onCancel={close} onSubmit={userId => saveEmployee(ws, me, e.id, { user_id: userId }).then(saved)} />
        </Dialog>
      )}
      {dialog?.doc && (
        <Dialog title={dialog.doc.id ? t.edit : t.addPaper.replace('+ ', '')} onClose={close}>
          <DocForm initial={dialog.doc} onCancel={close}
            onSubmit={fields => saveDocument(ws, me, e.id, dialog.doc.id, fields).then(saved)}
            onDelete={dialog.doc.id ? () => deleteDocument(ws, dialog.doc.id).then(saved) : null} />
        </Dialog>
      )}
      {dialog?.contract && (
        <Dialog title={dialog.contract.id ? t.edit : t.addContract.replace('+ ', '')} onClose={close}>
          <ContractForm initial={dialog.contract} onCancel={close}
            onSubmit={fields => saveContract(ws, me, e.id, dialog.contract.id, fields).then(saved)}
            onDelete={dialog.contract.id ? () => deleteContract(ws, dialog.contract.id).then(saved) : null} />
        </Dialog>
      )}
    </div>
  )
}

function Item({ label, children }) {
  return <div><dt className="text-[11px] text-text-tertiary">{label}</dt><dd className="text-text mt-0.5">{children}</dd></div>
}

/** The buttons under each small form, with the database's refusal above them. */
function FormFoot({ busy, error, onCancel, onDelete, submitLabel }) {
  const { t } = useT(HW)
  return (
    <>
      <ErrorText error={error} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{submitLabel || t.save}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
        {onDelete && <Button size="sm" variant="danger" className="ms-auto" disabled={busy} onClick={() => { if (window.confirm(t.confirmDelete)) onDelete() }}>{t.delete}</Button>}
      </div>
    </>
  )
}

/** Run a save, holding the button and showing the refusal. */
function useSubmit(onSubmit) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (...args) => {
    setBusy(true); setError('')
    const out = await onSubmit(...args)
    setBusy(false)
    if (out?.error) setError(out.error)
  }
  return { busy, error, setError, run }
}

function EmploymentForm({ ending, employee, onSubmit, onCancel }) {
  const { t, dir } = useT(HW)
  const [date, setDate] = useState(riyadhToday())
  const [reason, setReason] = useState('')
  const s = useSubmit(onSubmit)
  return (
    <form dir={dir} className="space-y-3" onSubmit={ev => {
      ev.preventDefault()
      if (ending) s.run({ status: 'ended', end_date: date, end_reason: reason })
      else s.run({ status: 'active', hire_date: date, end_date: null, end_reason: null })
    }}>
      <p className="text-xs text-text-secondary">{ending ? t.endHelp : t.rehireHelp}</p>
      <Field label={ending ? t.endDate : t.hireDate}><input type="date" required value={date} min={ending ? employee.hire_date : undefined} onChange={ev => setDate(ev.target.value)} className={field} /></Field>
      {ending && <Field label={t.endReason}><input required value={reason} onChange={ev => setReason(ev.target.value)} className={field} dir="auto" /></Field>}
      <FormFoot busy={s.busy} error={s.error} onCancel={onCancel} submitLabel={ending ? t.endEmployment : t.rehire} />
    </form>
  )
}

function LoginForm({ employee, logins, employees, onSubmit, onCancel }) {
  const { t, dir } = useT(HW)
  const match = matchLogin(employee.work_email, logins)
  const [userId, setUserId] = useState(employee.user_id || match?.user_id || '')
  const s = useSubmit(onSubmit)
  const taken = new Set(employees.filter(x => x.user_id && x.id !== employee.id).map(x => x.user_id))
  return (
    <form dir={dir} className="space-y-3" onSubmit={ev => { ev.preventDefault(); s.run(userId || null) }}>
      <p className="text-xs text-text-secondary">{t.loginHelp}</p>
      {employee.work_email && <p className="text-[11px] text-text-tertiary">{match ? t.loginMatch(match.email) : t.loginNone}</p>}
      <Field label={t.loginPick}>
        <select value={userId} onChange={ev => setUserId(ev.target.value)} className={field}>
          <option value="">{t.noLogin}</option>
          {logins.map(l => <option key={l.user_id} value={l.user_id} disabled={taken.has(l.user_id)}>{l.name} · {l.email}</option>)}
        </select>
      </Field>
      <FormFoot busy={s.busy} error={s.error} onCancel={onCancel} />
    </form>
  )
}

function DocForm({ initial, onSubmit, onCancel, onDelete }) {
  const { t, dir } = useT(HW)
  const [f, setF] = useState({ doc_type: initial.doc_type || 'iqama', doc_number: initial.doc_number || '', issue_date: initial.issue_date || '', expiry_date: initial.expiry_date || '', notes: initial.notes || '' })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const s = useSubmit(onSubmit)
  return (
    <form dir={dir} className="space-y-3" onSubmit={ev => { ev.preventDefault(); s.run(f) }}>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t.docType}>
          <select value={f.doc_type} onChange={ev => set('doc_type', ev.target.value)} className={field}>
            {DOC_TYPES.map(k => <option key={k} value={k}>{t.docTypes[k]}</option>)}
          </select>
        </Field>
        <Field label={t.docNumber}><input value={f.doc_number} onChange={ev => set('doc_number', ev.target.value)} className={field} dir="ltr" /></Field>
        <Field label={t.issueDate}><input type="date" value={f.issue_date} onChange={ev => set('issue_date', ev.target.value)} className={field} /></Field>
        <Field label={t.expiryDate}><input type="date" value={f.expiry_date} min={f.issue_date || undefined} onChange={ev => set('expiry_date', ev.target.value)} className={field} /></Field>
      </div>
      <Field label={t.notes} hint={f.doc_type === 'other' ? t.otherHelp : null}>
        <input value={f.notes} required={f.doc_type === 'other'} onChange={ev => set('notes', ev.target.value)} className={field} dir="auto" />
      </Field>
      <FormFoot busy={s.busy} error={s.error} onCancel={onCancel} onDelete={onDelete} />
    </form>
  )
}

function ContractForm({ initial, onSubmit, onCancel, onDelete }) {
  const { t, dir } = useT(HW)
  const [f, setF] = useState({ contract_type: initial.contract_type || 'fixed', start_date: initial.start_date || riyadhToday(), end_date: initial.end_date || '', notes: initial.notes || '' })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const s = useSubmit(onSubmit)
  return (
    <form dir={dir} className="space-y-3" onSubmit={ev => { ev.preventDefault(); s.run(f) }}>
      <div className="grid grid-cols-3 gap-2">
        <Field label={t.contractType}>
          <select value={f.contract_type} onChange={ev => set('contract_type', ev.target.value)} className={field}>
            {['fixed', 'open'].map(k => <option key={k} value={k}>{t.contractTypes[k]}</option>)}
          </select>
        </Field>
        <Field label={t.start}><input type="date" required value={f.start_date} onChange={ev => set('start_date', ev.target.value)} className={field} /></Field>
        <Field label={f.contract_type === 'fixed' ? t.end : `${t.end} ${t.optional}`}>
          <input type="date" required={f.contract_type === 'fixed'} min={f.start_date} value={f.end_date} onChange={ev => set('end_date', ev.target.value)} className={field} />
        </Field>
      </div>
      <Field label={t.notes}><input value={f.notes} onChange={ev => set('notes', ev.target.value)} className={field} dir="auto" /></Field>
      <p className="text-[11px] text-text-tertiary">{t.noPay}</p>
      <FormFoot busy={s.busy} error={s.error} onCancel={onCancel} onDelete={onDelete} />
    </form>
  )
}
