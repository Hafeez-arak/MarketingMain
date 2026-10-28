import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { contractEndingSoon, nameOf, riyadhToday } from '../../lib/hr/logic'
import { fetchContracts, saveContract } from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, fieldInline, fmtDate, empName, contractTone } from './useHrBase'
import { Dialog, ErrorText, Pill, NoAccess } from './parts'
import { ContractForm } from './ContractForm'

// ─── HR → Contracts (v2) ───────────────────────────────────────────────────
// 2026-10-29, parity pass. His contracts list: every contract of the company,
// filtered by status (running, draft, expired, ending soon), searched by
// number or employee, grouped by status or type. Manage only (his
// hr.contracts). No pay columns: salary and allowances are out of scope.
// The filter, search and grouping live in the address.

export function HrContracts() {
  const { t, lang, dir } = useT(HW)
  const base = useHrBase()
  const { ws, me, level, can, employees } = base
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filter = params.get('f') || 'all'
  const q = params.get('q') || ''
  const group = params.get('g') || ''
  const setParam = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const today = riyadhToday()

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!ws) return
    const out = await fetchContracts(ws)
    setRows(out.rows); setError(out.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows || []).filter(c =>
      (filter === 'all' || (filter === 'ending' ? contractEndingSoon(c, today) : c.status === filter))
      && (!needle || c.contract_no.toLowerCase().includes(needle)
        || [nameOf(employees?.find(e => e.id === c.employee_id), 'en'), nameOf(employees?.find(e => e.id === c.employee_id), 'ar')].some(n => n.toLowerCase().includes(needle))))
  }, [rows, filter, q, employees, today])

  const groups = useMemo(() => {
    if (!group) return [{ key: '', title: '', rows: shown }]
    const by = new Map()
    for (const c of shown) {
      const k = group === 'status' ? c.status : c.contract_type
      if (!by.has(k)) by.set(k, [])
      by.get(k).push(c)
    }
    return [...by].map(([key, list]) => ({ key, title: group === 'status' ? t.contractStatuses[key] : t.contractTypes[key], rows: list }))
  }, [shown, group, t])

  if (!level) return <NoAccess />
  if (!can('manage')) return <div className="max-w-5xl space-y-3" dir={dir}><PageHeader title={t.contractsTitle} /><p className="text-sm text-text-secondary">{t.contractsHidden}</p></div>

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={t.contractsTitle} subtitle={t.contractsSubtitle}>
        <Button size="sm" onClick={() => setCreating(true)}>{t.newContract}</Button>
      </PageHeader>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.status}>
          {['all', 'running', 'draft', 'expired', 'ending'].map(f => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setParam('f', f === 'all' ? '' : f)}
              className={`rounded-md border px-2.5 py-1 text-xs ${filter === f ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white border-border text-text-secondary hover:bg-stone-50'}`}>
              {t.contractFilters[f]}
            </button>
          ))}
        </div>
        <input type="search" value={q} onChange={e => setParam('q', e.target.value)} placeholder={t.contractSearch} aria-label={t.search} className={`${fieldInline} w-full max-w-[14rem]`} dir="auto" />
        <select value={group} onChange={e => setParam('g', e.target.value)} className={fieldInline} aria-label={t.contractGroups['']}>
          {Object.entries(t.contractGroups).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      <ErrorText error={error || base.error} />

      {rows === null || employees === null ? <Skeleton className="h-48" /> : !shown.length ? <p className="text-sm text-text-tertiary py-4">{rows.length ? t.noContractsMatch : t.noContracts}</p> : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              <th className="text-start font-medium px-3 py-2">{t.contractNo}</th>
              <th className="text-start font-medium px-3 py-2">{t.employee}</th>
              <th className="text-start font-medium px-3 py-2">{t.contractType}</th>
              <th className="text-start font-medium px-3 py-2">{t.start}</th>
              <th className="text-start font-medium px-3 py-2">{t.end}</th>
              <th className="text-end font-medium px-3 py-2 hidden md:table-cell">{t.weeklyHours}</th>
              <th className="text-start font-medium px-3 py-2">{t.status}</th>
            </tr></thead>
            {groups.map(g => (
              <tbody key={g.key || 'all'} className="divide-y divide-border">
                {group && <tr className="bg-stone-50"><td colSpan={7} className="px-3 py-1.5 text-xs font-semibold text-text-secondary">{g.title} <span className="font-normal text-text-tertiary">({g.rows.length})</span></td></tr>}
                {g.rows.map(c => (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className="px-3 py-2"><Link to={`/hr/contract?id=${c.id}`} className="font-medium hover:underline"><bdi dir="ltr">{c.contract_no}</bdi></Link></td>
                    <td className="px-3 py-2"><Link to={`/hr/employee?id=${c.employee_id}`} className="hover:underline" dir="auto">{empName(employees, c.employee_id, lang, '—')}</Link></td>
                    <td className="px-3 py-2 text-text-secondary">{t.contractTypes[c.contract_type]}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(c.start_date, lang)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.end_date ? fmtDate(c.end_date, lang) : '—'}</td>
                    <td className="px-3 py-2 text-end tabular-nums hidden md:table-cell">{c.weekly_hours ?? '—'}</td>
                    <td className="px-3 py-2"><span className="inline-flex flex-wrap gap-1"><Pill tone={contractTone(c.status)}>{t.contractStatuses[c.status]}</Pill>{contractEndingSoon(c, today) && <Pill tone="amber">{t.endingSoon}</Pill>}</span></td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {creating && (
        <Dialog title={t.newContract.replace('+ ', '')} onClose={() => setCreating(false)}>
          <ContractForm employees={(employees || []).filter(e => e.status === 'active')} onCancel={() => setCreating(false)}
            onSubmit={async f => {
              const out = await saveContract(ws, me, f.employeeId, null, f)
              if (!out.error) { setCreating(false); navigate(`/hr/contract?id=${out.row.id}`) }
              return out
            }} />
        </Dialog>
      )}
    </div>
  )
}
