import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, PageHeader, Skeleton, Spinner } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { contractActions, contractEndingSoon, closeProblem, riyadhToday } from '../../lib/hr/logic'
import { fetchContracts, saveContract, moveContract } from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, field, fmtDate, empName, contractTone } from './useHrBase'
import { Dialog, ErrorText, Field, Pill, NoAccess } from './parts'
import { ContractForm } from './ContractForm'
import { History } from './History'

// ─── HR → one contract (v2) ────────────────────────────────────────────────
// 2026-10-29, parity pass. /hr/contract?id=. His contract page without the pay:
// the path Draft → Running → Expired (or Cancelled), the facts, the actions
// the status allows (edit a draft, start, close with its last day, cancel),
// and the history. Terms are fixed once it has started; one contract runs
// per employee (the database holds both).

export function HrContract() {
  const { t, lang, dir } = useT(HW)
  const base = useHrBase()
  const { ws, me, level, can, employees, departments, jobs } = base
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const today = riyadhToday()
  const [c, setC] = useState(undefined) // undefined = loading, null = not found
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [dialog, setDialog] = useState(null) // 'edit' | 'close'
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    if (!ws || !id) return
    const out = await fetchContracts(ws)
    setC(out.rows.find(x => x.id === id) || null)
    setError(out.error || '')
  }, [ws, id])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!level) return <NoAccess />
  if (!can('manage')) return <div className="max-w-3xl space-y-3" dir={dir}><PageHeader title={t.contractsTitle} /><p className="text-sm text-text-secondary">{t.contractsHidden}</p></div>
  if (c === undefined || employees === null) return <Skeleton className="h-64 max-w-3xl" />
  if (c === null) return <div className="max-w-3xl space-y-3" dir={dir}><p className="text-sm text-text-secondary">{t.errors.HR_NOT_FOUND}</p><Link to="/hr/contracts" className="text-xs underline">{t.contractBack}</Link></div>

  const acts = contractActions(c, level)
  const path = c.status === 'cancelled' ? [['draft', t.contractStatuses.draft], ['cancelled', t.contractStatuses.cancelled]]
    : [['draft', t.contractStatuses.draft], ['running', t.contractStatuses.running], ['expired', t.contractStatuses.expired]]
  const after = async () => { setDialog(null); setTick(x => x + 1); await load() }

  async function move(action, endDate) {
    setBusy(action); setError('')
    const out = await moveContract(ws, c.id, action, endDate)
    setBusy('')
    if (out.error) { setError(out.error); return out }
    await after()
    return out
  }

  return (
    <div className="max-w-3xl space-y-5" dir={dir} lang={lang}>
      <PageHeader title={c.contract_no} subtitle={empName(employees, c.employee_id, lang)}>
        <Link to="/hr/contracts" className="text-xs text-text-secondary hover:text-text">{dir === 'rtl' ? '→' : '←'} {t.contractBack}</Link>
        {acts.edit && <Button size="sm" variant="secondary" onClick={() => setDialog('edit')}>{t.editDraft}</Button>}
        {acts.start && <Button size="sm" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t.startConfirm)) move('start') }}>{busy === 'start' && <Spinner size="sm" />}{t.startContract}</Button>}
        {acts.close && <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => setDialog('close')}>{t.closeContract}</Button>}
        {acts.cancel && <Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm(t.cancelConfirm)) move('cancel') }}>{busy === 'cancel' && <Spinner size="sm" />}{t.cancelContract}</Button>}
      </PageHeader>
      <ErrorText error={error || base.error} />

      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label={t.status}>
        {path.map(([key, label], i) => (
          <li key={key} className="flex items-center gap-2">
            {i > 0 && <span className="text-text-tertiary">{dir === 'rtl' ? '←' : '→'}</span>}
            <span className={`rounded border px-2 py-1 ${c.status === key ? 'bg-stone-900 border-stone-900 text-white font-medium' : 'border-border text-text-tertiary'}`} aria-current={c.status === key ? 'step' : undefined}>{label}</span>
          </li>
        ))}
      </ol>

      <section className="bg-white border border-border p-4">
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 text-sm">
          <Item label={t.contractOf}><Link className="hover:underline" to={`/hr/employee?id=${c.employee_id}`} dir="auto">{empName(employees, c.employee_id, lang)}</Link></Item>
          <Item label={t.contractType}>{t.contractTypes[c.contract_type]}</Item>
          <Item label={t.status}><span className="inline-flex flex-wrap gap-1"><Pill tone={contractTone(c.status)}>{t.contractStatuses[c.status]}</Pill>{contractEndingSoon(c, today) && <Pill tone="amber">{t.endingSoon}</Pill>}</span></Item>
          <Item label={t.start}>{fmtDate(c.start_date, lang)}</Item>
          <Item label={t.end}>{c.end_date ? fmtDate(c.end_date, lang) : '—'}</Item>
          <Item label={t.weeklyHours}>{c.weekly_hours ?? '—'}</Item>
        </dl>
        {c.notes && <p className="text-xs text-text-secondary mt-3 whitespace-pre-wrap" dir="auto">{c.notes}</p>}
        <p className="text-[11px] text-text-tertiary mt-3">{t.contractWaits}</p>
      </section>

      <section className="bg-white border border-border p-4 space-y-2">
        <h2 className="text-sm font-semibold text-text">{t.contractHistory}</h2>
        <History ws={ws} rowId={c.id} employees={employees} departments={departments} jobs={jobs} refreshKey={tick} />
      </section>

      {dialog === 'edit' && (
        <Dialog title={t.editDraft} onClose={() => setDialog(null)}>
          <ContractForm initial={c} onCancel={() => setDialog(null)}
            onSubmit={async f => { const out = await saveContract(ws, me, c.employee_id, c.id, f); if (!out.error) await after(); return out }} />
        </Dialog>
      )}
      {dialog === 'close' && (
        <Dialog title={t.closeContract} onClose={() => setDialog(null)}>
          <CloseForm contract={c} onCancel={() => setDialog(null)} onSubmit={date => move('close', date)} />
        </Dialog>
      )}
    </div>
  )
}

function Item({ label, children }) {
  return <div><dt className="text-[11px] text-text-tertiary">{label}</dt><dd className="text-text mt-0.5">{children}</dd></div>
}

function CloseForm({ contract, onSubmit, onCancel }) {
  const { t, dir } = useT(HW)
  const [date, setDate] = useState(contract.end_date && contract.end_date >= contract.start_date ? contract.end_date : riyadhToday())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form dir={dir} className="space-y-3" onSubmit={async e => {
      e.preventDefault()
      if (closeProblem(contract, date)) { setError(t.errors.DATES); return }
      setBusy(true); setError('')
      const out = await onSubmit(date); setBusy(false)
      if (out?.error) setError(out.error)
    }}>
      <p className="text-xs text-text-secondary">{t.closeHelp}</p>
      <Field label={t.closeDate}><input type="date" required min={contract.start_date} value={date} onChange={e => setDate(e.target.value)} className={field} /></Field>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{t.closeContract}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}
