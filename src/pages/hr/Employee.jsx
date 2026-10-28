import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, PageHeader, Skeleton, Spinner } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import {
  nameOf, docState, contractEndingSoon, ledgerBalance, riyadhToday, matchLogin, paperFileProblem, paperPath, formatBytes, DOC_TYPES,
} from '../../lib/hr/logic'
import { buildDays, sheetTotals, hm } from '../../lib/hr/attendance'
import { fetchRecordsBetween, fetchPunchDays, fetchFlags, fetchAttendanceSettings } from '../../lib/hr/attendanceClient'
import { AW } from './attendance/words'
import {
  saveEmployee, savePrivate, fetchPrivate, deleteEmployee, fetchDocuments, saveDocument, deleteDocument, fetchContracts, saveContract,
  fetchLeaveTypes, fetchAllocations, fetchLeaveRequests, fetchLogins, uploadPaperFile, removePaperFiles, paperFileUrl,
} from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, field, fmtDate, empName, STATE_TONE, contractTone } from './useHrBase'
import { Dialog, ErrorText, Field, Pill, NoAccess } from './parts'
import { EmployeeForm } from './EmployeeForm'
import { ContractForm } from './ContractForm'
import { History } from './History'

// ─── HR → one employee (v2) ────────────────────────────────────────────────
// 2026-10-28, parity pass 2026-10-29. /hr/employee?id=. The profile, their
// team, their leave balances today and attendance this month; for HR
// managers (his hr.manage) or the person themselves, their papers (each with
// an optional scan) and contracts; for HR managers also the personal file
// and the history of every change. Manage edits, ends employment, links a
// login (matched by the work email), and deletes a person who was never used.

export function HrEmployee() {
  const { t, lang, dir } = useT(HW)
  const { t: at } = useT(AW)
  const base = useHrBase()
  const { ws, me, can, employees, departments, jobs, error, reload } = base
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const today = riyadhToday()
  const month = today.slice(0, 7)
  const e = (employees || []).find(x => x.id === id) || null
  const own = Boolean(e && e.user_id && e.user_id === me)
  const manage = can('manage')
  const seesPapers = manage || own

  const [docs, setDocs] = useState(null)
  const [contracts, setContracts] = useState(null)
  const [types, setTypes] = useState([])
  const [allocations, setAllocations] = useState([])
  const [requests, setRequests] = useState([])
  const [attendance, setAttendance] = useState(null)
  const [settings, setSettings] = useState(null)
  const [logins, setLogins] = useState([])
  const [personal, setPersonal] = useState(null)
  const [dialog, setDialog] = useState(null) // 'edit' | 'end' | 'rehire' | 'login' | {doc} | 'contract'
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    if (!ws || !id) return
    const [d, c, ty, al, r, a, p, f, s, l, pr] = await Promise.all([
      fetchDocuments(ws, id), fetchContracts(ws, id), fetchLeaveTypes(ws), fetchAllocations(ws, id),
      fetchLeaveRequests(ws, { employeeId: id }), fetchRecordsBetween(ws, `${month}-01`, today, [id]),
      fetchPunchDays(ws, { from: `${month}-01`, to: today, employeeIds: [id], all: true }), fetchFlags(ws, { from: `${month}-01`, to: today, employeeIds: [id], all: true }),
      fetchAttendanceSettings(ws), manage ? fetchLogins(ws) : Promise.resolve({ rows: [] }), manage ? fetchPrivate(ws, id) : Promise.resolve({ row: null }),
    ])
    setDocs(d.rows); setContracts(c.rows); setTypes(ty.rows); setAllocations(al.rows); setRequests(r.rows)
    setAttendance({ records: a.rows, punchDays: p.rows, flags: f.rows }); setSettings(s.row); setLogins(l.rows); setPersonal(pr.row)
    setLoadError(d.error || c.error || ty.error || al.error || r.error || a.error || p.error || f.error || pr.error || '')
    setTick(x => x + 1)
  }, [ws, id, month, today, manage])
  useEffect(() => { queueMicrotask(load) }, [load])

  // This month so far, as the monthly sheet counts it (lib/hr/attendance.js).
  const sheet = useMemo(() => (e && attendance ? sheetTotals(Object.values(buildDays({
    employees: [e], from: `${month}-01`, to: today, settings, ...attendance, leaves: requests.filter(r => r.status === 'approved'), leaveTypes: types, lang,
  })[e.id])) : null), [e, attendance, requests, types, month, settings, today, lang])

  if (!base.level) return <NoAccess />
  if (employees === null) return <Skeleton className="h-64 max-w-5xl" />
  if (!e) return <div className="max-w-5xl space-y-3" dir={dir}><p className="text-sm text-text-secondary">{t.errors.HR_NOT_FOUND}</p><Link to="/hr" className="text-xs underline">{t.back}</Link></div>

  const dept = departments.find(d => d.id === e.department_id)
  const team = employees.filter(x => x.manager_id === e.id && x.status === 'active')
  const login = e.user_id ? logins.find(l => l.user_id === e.user_id) : null
  const balanceTypes = types.filter(ty => ty.needs_balance && ty.active)
  const close = () => setDialog(null)
  const saved = async out => { if (!out.error) { close(); await reload(); await load() } return out }

  /** A paper and its optional file: upload first, save the row, then drop the replaced file. */
  async function savePaper(doc, fields, file, dropFile) {
    let extra = {}
    if (file) {
      const path = paperPath(ws, e.id, file)
      const up = await uploadPaperFile(path, file)
      if (up.error) return up
      extra = { file_path: path, file_name: file.name, file_size: file.size, file_type: file.type }
    } else if (dropFile) extra = { file_path: null, file_name: null, file_size: null, file_type: null }
    const out = await saveDocument(ws, me, e.id, doc.id, { ...fields, ...extra })
    if (out.error) { if (file) await removePaperFiles([extra.file_path]); return out }
    if ((file || dropFile) && doc.file_path) await removePaperFiles([doc.file_path])
    return out
  }

  async function openFile(path) {
    const out = await paperFileUrl(path)
    if (out.error) setActionError(out.error); else window.open(out.url, '_blank', 'noopener')
  }

  async function removePerson() {
    if (!window.confirm(t.confirmDeleteEmployee)) return
    setActionError('')
    const out = await deleteEmployee(ws, e.id)
    if (out.error) { setActionError(out.error); return }
    await reload()
    navigate('/hr')
  }

  return (
    <div className="max-w-5xl space-y-5" dir={dir} lang={lang}>
      <PageHeader title={nameOf(e, lang)} subtitle={[e.job_title, nameOf(dept, lang)].filter(Boolean).join(' · ')}>
        <Link to="/hr" className="text-xs text-text-secondary hover:text-text">{dir === 'rtl' ? '→' : '←'} {t.employeesTitle}</Link>
        {manage && <Button size="sm" variant="secondary" onClick={() => setDialog('edit')}>{t.edit}</Button>}
        {manage && (e.status === 'active'
          ? <Button size="sm" variant="danger" onClick={() => setDialog('end')}>{t.endEmployment}</Button>
          : <Button size="sm" variant="secondary" onClick={() => setDialog('rehire')}>{t.rehire}</Button>)}
      </PageHeader>
      <ErrorText error={error || loadError || actionError} />

      {/* Profile */}
      <section className="bg-white border border-border p-4">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 text-sm">
          <Item label={t.status}>{e.status === 'active' ? <Pill tone="green">{t.statuses.active}</Pill> : <Pill>{t.leftOn(fmtDate(e.end_date, lang))}</Pill>}</Item>
          <Item label={t.employeeNo}><bdi dir="ltr">{e.employee_no || '—'}</bdi></Item>
          <Item label={t.hireDate}>{fmtDate(e.hire_date, lang)}</Item>
          <Item label={t.manager}>{e.manager_id ? <Link className="hover:underline" to={`/hr/employee?id=${e.manager_id}`}>{empName(employees, e.manager_id, lang)}</Link> : '—'}</Item>
          <Item label={t.jobPosition}>{e.job_title || '—'}</Item>
          <Item label={t.trade}><span dir="auto">{e.trade || '—'}</span></Item>
          <Item label={t.employmentType}>{e.employment_type ? t.employmentTypes[e.employment_type] : '—'}</Item>
          <Item label={t.labourKind}>{t.labourKinds[String(e.is_direct_labor)]}</Item>
          <Item label={t.workEmail}><bdi dir="ltr">{e.work_email || '—'}</bdi></Item>
          <Item label={t.workPhone}><bdi dir="ltr">{e.work_phone || '—'}</bdi></Item>
          <Item label={lang === 'ar' ? t.nameEn : t.nameAr}>
            <span dir={lang === 'ar' ? 'ltr' : 'rtl'}>{(lang === 'ar' ? e.name_en : e.name_ar) || '—'}</span>
          </Item>
          <Item label={t.login}>
            {e.user_id ? <span className="text-text"><bdi dir="ltr">{login?.email || (own ? t.yes : '✓')}</bdi></span> : <span className="text-text-tertiary">{t.noLogin}</span>}
            {manage && <button type="button" className="ms-2 text-[11px] underline text-text-secondary" onClick={() => setDialog('login')}>{e.user_id ? t.edit : t.linkLogin}</button>}
          </Item>
        </dl>
        {e.status === 'ended' && e.end_reason && <p className="text-xs text-text-secondary mt-3" dir="auto">{t.endReason}: {e.end_reason}</p>}
        {team.length > 0 && (
          <p className="text-xs text-text-secondary mt-3">{t.team}: {team.map((m, i) => (
            <span key={m.id}>{i > 0 && (lang === 'ar' ? '، ' : ', ')}<Link className="hover:underline text-text" to={`/hr/employee?id=${m.id}`}>{nameOf(m, lang)}</Link></span>
          ))}</p>
        )}
      </section>

      {/* The personal file: Manage only */}
      {manage && (
        <section className="bg-white border border-border p-4 space-y-2">
          <h2 className="text-sm font-semibold text-text">{t.personalFile}</h2>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 text-sm">
            <Item label={t.nationality}><span dir="auto">{personal?.nationality || '—'}</span></Item>
            <Item label={t.idType}>{personal?.id_type ? t.idTypes[personal.id_type] : '—'} <bdi dir="ltr">{personal?.id_number || ''}</bdi></Item>
            <Item label={t.birthDate}>{personal?.birth_date ? fmtDate(personal.birth_date, lang) : '—'}</Item>
            <Item label={t.gender}>{personal?.gender ? t.genders[personal.gender] : '—'}</Item>
            <Item label={t.mobile}><bdi dir="ltr">{personal?.mobile || '—'}</bdi></Item>
            <Item label={t.emergencyContact}><span dir="auto">{personal?.emergency_contact || '—'}</span></Item>
            <Item label={t.emergencyPhone}><bdi dir="ltr">{personal?.emergency_phone || '—'}</bdi></Item>
            <Item label={t.address}><span dir="auto">{personal?.address || '—'}</span></Item>
          </dl>
          {personal?.notes && <p className="text-xs text-text-secondary whitespace-pre-wrap" dir="auto">{personal.notes}</p>}
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Leave today */}
        <section className="bg-white border border-border p-4 space-y-3">
          <h2 className="text-sm font-semibold text-text">{t.leaveNow}</h2>
          {balanceTypes.length === 0 ? <p className="text-xs text-text-tertiary">{t.noBalanceTypes}</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-text-tertiary"><th className="text-start font-medium py-1">{t.leaveType}</th><th className="text-end font-medium">{t.granted}</th><th className="text-end font-medium">{t.used}</th><th className="text-end font-medium">{t.pending}</th><th className="text-end font-medium">{t.remaining}</th></tr></thead>
              <tbody>{balanceTypes.map(ty => {
                const b = ledgerBalance({ allocations, requests, employeeId: e.id, typeId: ty.id, on: today })
                return (
                  <tr key={ty.id} className="border-t border-border">
                    <td className="py-1.5">{nameOf(ty, lang)}{b.until && <span className="block text-[11px] text-text-tertiary">{t.validUntil(fmtDate(b.until, lang))}</span>}</td>
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
                  <span>{nameOf(types.find(ty => ty.id === r.leave_type_id), lang)} · {fmtDate(r.date_from, lang)}{r.date_to !== r.date_from && ` – ${fmtDate(r.date_to, lang)}`} · {t.nDays(r.days)}</span>
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
              {[[at.present, sheet.present], [at.absent, sheet.absent], [at.leave, sheet.leave],
                [at.late, at.lateTotals(sheet.late, sheet.lateMinutes)], [at.early, at.lateTotals(sheet.early, sheet.earlyMinutes)], [at.hours, hm(sheet.hours)]].map(([label, v]) => (
                <div key={label} className="border border-border py-2"><p className="text-lg font-semibold tabular-nums">{v}</p><p className="text-[11px] text-text-tertiary">{label}</p></div>
              ))}
            </div>
          )}
          <Link to={`/hr/attendance/monthly?employee=${e.id}&m=${month}`} className="inline-block text-[11px] underline text-text-secondary">{t.openSheet}</Link>
        </section>
      </div>

      {/* Papers */}
      <section className="bg-white border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">{t.papers}</h2>
          {manage && <Button size="xs" variant="secondary" onClick={() => setDialog({ doc: {} })}>{t.addPaper}</Button>}
        </div>
        {!seesPapers ? <p className="text-xs text-text-tertiary">{t.papersHidden}</p> : docs === null ? <Spinner size="sm" /> : docs.length === 0 ? <p className="text-xs text-text-tertiary">{t.noPapers}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-text-tertiary"><th className="text-start font-medium py-1">{t.docType}</th><th className="text-start font-medium">{t.docNumber}</th><th className="text-start font-medium">{t.issueDate}</th><th className="text-start font-medium">{t.expiryDate}</th><th className="text-start font-medium">{t.currentFile}</th><th /></tr></thead>
              <tbody>{docs.map(d => {
                const st = docState(d, today)
                return (
                  <tr key={d.id} className="border-t border-border">
                    <td className="py-1.5">{t.docTypes[d.doc_type]}{d.notes && <span className="block text-text-tertiary" dir="auto">{d.notes}</span>}</td>
                    <td><bdi dir="ltr">{d.doc_number}</bdi></td>
                    <td>{fmtDate(d.issue_date, lang)}</td>
                    <td>{d.expiry_date ? <span className="flex flex-wrap items-center gap-1.5">{fmtDate(d.expiry_date, lang)} {st.state !== 'ok' && <Pill tone={STATE_TONE[st.state]}>{st.days < 0 ? `${t.docStates.expired} ${t.expiredAgo(-st.days)}` : t.expiresIn(st.days)}</Pill>}</span> : '—'}</td>
                    <td>{d.file_path ? <button type="button" className="underline text-text-secondary" onClick={() => openFile(d.file_path)} title={d.file_name}>{t.openFile}{d.file_size ? ` (${formatBytes(d.file_size)})` : ''}</button> : <span className="text-text-tertiary">—</span>}</td>
                    <td className="text-end">{manage && <button type="button" className="underline text-text-secondary" onClick={() => setDialog({ doc: d })}>{t.edit}</button>}</td>
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
          {manage && e.status === 'active' && <Button size="xs" variant="secondary" onClick={() => setDialog('contract')}>{t.addContract}</Button>}
        </div>
        {!seesPapers ? <p className="text-xs text-text-tertiary">{t.contractsHidden}</p> : contracts === null ? <Spinner size="sm" /> : contracts.length === 0 ? <p className="text-xs text-text-tertiary">{t.noContracts}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-text-tertiary"><th className="text-start font-medium py-1">{t.contractNo}</th><th className="text-start font-medium">{t.contractType}</th><th className="text-start font-medium">{t.start}</th><th className="text-start font-medium">{t.end}</th><th className="text-end font-medium">{t.weeklyHours}</th><th className="text-start font-medium ps-3">{t.status}</th></tr></thead>
              <tbody>{contracts.map(c => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-1.5">{manage ? <Link to={`/hr/contract?id=${c.id}`} className="font-medium hover:underline"><bdi dir="ltr">{c.contract_no}</bdi></Link> : <bdi dir="ltr">{c.contract_no}</bdi>}{c.notes && <span className="block text-text-tertiary" dir="auto">{c.notes}</span>}</td>
                  <td>{t.contractTypes[c.contract_type]}</td>
                  <td>{fmtDate(c.start_date, lang)}</td>
                  <td>{c.end_date ? fmtDate(c.end_date, lang) : '—'}</td>
                  <td className="text-end tabular-nums">{c.weekly_hours ?? '—'}</td>
                  <td className="ps-3"><span className="inline-flex flex-wrap gap-1"><Pill tone={contractTone(c.status)}>{t.contractStatuses[c.status]}</Pill>{contractEndingSoon(c, today) && <Pill tone="amber">{t.endingSoon}</Pill>}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-text-tertiary">{t.noPay}</p>
      </section>

      {/* History: Manage */}
      {manage && (
        <section className="bg-white border border-border p-4 space-y-2">
          <h2 className="text-sm font-semibold text-text">{t.history}</h2>
          <History ws={ws} employeeId={e.id} employees={employees} departments={departments} jobs={jobs} refreshKey={tick} />
        </section>
      )}

      {manage && (
        <section className="border border-border p-4 space-y-2 bg-white">
          <h2 className="text-sm font-semibold text-text">{t.deleteEmployee}</h2>
          <p className="text-[11px] text-text-tertiary">{t.deleteEmployeeHelp}</p>
          <Button size="xs" variant="danger" onClick={removePerson}>{t.deleteEmployee}</Button>
        </section>
      )}

      {dialog === 'edit' && (
        <Dialog title={t.edit} onClose={close}>
          <EmployeeForm initial={e} personal={personal || {}} employees={employees} departments={departments} jobs={jobs} onCancel={close}
            onSubmit={async ({ employee, personal: priv }) => {
              const out = await saveEmployee(ws, me, e.id, employee)
              if (out.error) return out
              const p = await savePrivate(ws, e.id, priv)
              if (p.error) return p
              return saved(out)
            }} />
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
            onSubmit={(fields, file, dropFile) => savePaper(dialog.doc, fields, file, dropFile).then(saved)}
            onDelete={dialog.doc.id ? () => deleteDocument(ws, dialog.doc.id, dialog.doc.file_path).then(saved) : null} />
        </Dialog>
      )}
      {dialog === 'contract' && (
        <Dialog title={t.addContract.replace('+ ', '')} onClose={close}>
          <ContractForm onCancel={close} onSubmit={fields => saveContract(ws, me, e.id, null, fields).then(saved)} />
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
  const [file, setFile] = useState(null)
  const [dropFile, setDropFile] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const s = useSubmit(onSubmit)
  const problem = paperFileProblem(file)
  return (
    <form dir={dir} className="space-y-3" onSubmit={ev => {
      ev.preventDefault()
      if (problem) { s.setError(t.errors[problem]); return }
      s.run(f, file, dropFile)
    }}>
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
      <Field label={initial.file_path && !dropFile ? t.replaceFile : t.attachFile} hint={t.fileHelp}>
        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={ev => { setFile(ev.target.files?.[0] || null); setDropFile(false) }} className="block w-full text-xs mt-1" />
      </Field>
      {initial.file_path && !file && (
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={dropFile} onChange={ev => setDropFile(ev.target.checked)} />{t.removeFile}: <span dir="auto">{initial.file_name}</span>
        </label>
      )}
      {s.busy && file && <p className="text-[11px] text-text-tertiary">{t.uploading}</p>}
      <FormFoot busy={s.busy} error={s.error} onCancel={onCancel} onDelete={onDelete} />
    </form>
  )
}
