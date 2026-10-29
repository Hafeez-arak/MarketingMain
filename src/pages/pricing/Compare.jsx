import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton } from '../../components/ui/index'
import { useT, fmtDay } from '../../lib/i18n'
import { offerGrid, bestCost, fmtMoney, fmtNum } from '../../lib/pricing/logic'
import { fetchSheet, fetchLines, fetchQuotes, fetchSheetOffers, selectOffers } from '../../lib/pricing/client'
import { PW } from './words'
import { usePricingBase, sheetHref } from './usePricing'
import { NoAccess, Alert } from './parts'

// ─── Pricing → compare the suppliers' offers (v2) ──────────────────────────
// 2026-12-01, dev/erp-pilot/PRICING.md. Musa's comparison: per BOQ line, each
// received quote's offers (alternatives beside the main offer) with the
// landed unit cost in SAR; the lowest is marked; the person picks one offer
// per line, or none. Quotes still waiting for an answer are counted, not
// compared. Choosing is for work, on a draft; for everyone else it is a read.

export function PricingCompare() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(PW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const { ws, suppliersById, error: baseError } = usePricingBase()
  const [d, setD] = useState(undefined)
  const [sel, setSel] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!ws || !id) return
    const s = await fetchSheet(ws, id)
    if (!s.sheet) { setD(null); return }
    const [lines, quotes] = await Promise.all([fetchLines(ws, id), fetchQuotes(ws, id)])
    const received = quotes.rows.filter(q => q.status === 'received')
    const offers = await fetchSheetOffers(ws, received.map(q => q.id))
    setD({ sheet: s.sheet, lines: lines.rows, received, pending: quotes.rows.filter(q => q.status === 'requested').length, grid: offerGrid(offers.rows) })
    setSel(Object.fromEntries(lines.rows.map(l => [l.id, l.selected_quote_line_id || ''])))
    setError(lines.error || quotes.error || offers.error || '')
  }, [ws, id])
  useEffect(() => { queueMicrotask(load) }, [load])

  const grid = d?.grid
  const bests = useMemo(() => {
    if (!d) return {}
    return Object.fromEntries(d.lines.map(l => [l.id, bestCost(d.received.flatMap(q => grid[`${l.id}-${q.id}`] || []))]))
  }, [d, grid])

  if (!canSection('pricing', 'view')) return <NoAccess />
  if (d === undefined) return <Skeleton className="h-64 max-w-5xl" />
  if (d === null) return <p className="text-sm text-text-secondary" dir={dir}>{w.gone} <Link className="underline" to="/pricing">{w.back}</Link></p>

  const { sheet, lines, received, pending } = d
  const edit = sheet.status === 'draft' && canSection('pricing', 'work')
  const changed = lines.some(l => (sel[l.id] || '') !== (l.selected_quote_line_id || ''))

  const save = async () => {
    const payload = {}
    for (const l of lines) if ((sel[l.id] || '') !== (l.selected_quote_line_id || '')) payload[l.id] = sel[l.id] || null
    setBusy(true); setError('')
    const out = await selectOffers(sheet.id, payload)
    setBusy(false)
    if (out.error) { setError(out.error); return }
    navigate(sheetHref(sheet.id))
  }

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <p className="text-xs"><Link to={sheetHref(sheet.id)} className="text-text-secondary hover:text-text underline">{w.backToSheet}</Link></p>
      <h1 className="text-lg font-semibold text-text">{w.compareTitle} — <bdi dir="ltr">{sheet.sheet_no}</bdi></h1>
      {pending > 0 && <p className="text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 px-3 py-2">{w.pending(pending)}</p>}
      <Alert>{error || baseError}</Alert>

      {!received.length ? <p className="text-sm text-text-tertiary px-1 py-6">{w.compareEmpty}</p> : (
        <>
          <p className="text-[11px] text-text-tertiary">{w.compareHint}</p>
          <div className="bg-white border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-text-tertiary border-b border-border align-bottom">
                <th className="text-start font-medium px-3 py-2">#</th>
                <th className="text-start font-medium px-3 py-2">{w.lcols.description}</th>
                <th className="text-end font-medium px-3 py-2">{w.clientQty}</th>
                {received.map(q => (
                  <th key={q.id} className="text-start font-medium px-3 py-2 min-w-[11rem]">
                    <bdi className="text-text">{(lang === 'ar' ? suppliersById[q.supplier_id]?.name_ar : null) || suppliersById[q.supplier_id]?.name}</bdi>
                    <span className="block font-normal"><bdi dir="ltr">{q.quote_no}</bdi> · {q.currency}{q.valid_until ? ` · ${w.validUntilShort} ${fmtDay(q.valid_until, lang, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</span>
                  </th>
                ))}
                <th className="text-start font-medium px-3 py-2">{w.noChoice}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {lines.map(l => (
                  <tr key={l.id} className="align-top">
                    <td className="px-3 py-2 tabular-nums text-text-secondary">{l.line_no}</td>
                    <td className="px-3 py-2 min-w-[12rem]"><bdi>{l.description}</bdi>{l.boq_ref && <span className="block text-[11px] text-text-tertiary" dir="ltr" style={{ textAlign: 'start' }}>{l.boq_ref}</span>}</td>
                    <td className="px-3 py-2 text-end whitespace-nowrap tabular-nums" dir="ltr">{fmtNum(l.quantity)} <bdi>{l.unit}</bdi></td>
                    {received.map(q => (
                      <td key={q.id} className="px-3 py-2">
                        {(grid[`${l.id}-${q.id}`] || []).map(o => {
                          const best = o.landed_unit_cost !== null && Number(o.landed_unit_cost) === bests[l.id]
                          return (
                            <label key={o.id} className={`flex items-start gap-2 mb-1.5 rounded border px-2 py-1.5 ${best ? 'border-emerald-300 bg-emerald-50' : 'border-border'} ${o.unit_price === null ? 'opacity-70' : ''}`}>
                              <input type="radio" name={`sel-${l.id}`} value={o.id} checked={sel[l.id] === o.id} disabled={!edit || o.unit_price === null}
                                onChange={() => setSel(s => ({ ...s, [l.id]: o.id }))} className="mt-1" />
                              <span className="text-xs">
                                {o.unit_price === null ? <span className="text-text-tertiary">{w.notPriced}</span> : (
                                  <><span className="text-sm font-medium tabular-nums" dir="ltr">{fmtMoney(o.landed_unit_cost)}</span> <span className="text-text-tertiary" dir="ltr">({fmtNum(o.unit_price)} {q.currency})</span></>
                                )}
                                {o.is_alternative && <span className="ms-1 border border-border rounded px-1 text-[10px]">{w.alternative}</span>}
                                {(o.brand || o.model_no) && <span className="block text-text-tertiary"><bdi>{`${o.brand || ''} ${o.model_no || ''}`.trim()}</bdi></span>}
                                {Number(o.quantity) < Number(l.quantity) && <span className="block text-yellow-800">⚠ {w.supplierQty(fmtNum(o.quantity))}</span>}
                                {o.lead_time_days !== null && <span className="block text-text-tertiary">{w.leadDays(o.lead_time_days)}</span>}
                              </span>
                            </label>
                          )
                        })}
                        {!(grid[`${l.id}-${q.id}`] || []).length && <span className="text-text-tertiary">—</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2"><input type="radio" name={`sel-${l.id}`} value="" checked={!sel[l.id]} disabled={!edit} onChange={() => setSel(s => ({ ...s, [l.id]: '' }))} aria-label={w.noChoice} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {edit && (
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || !changed} onClick={save}>{w.saveChoice}</Button>
              <Button size="sm" variant="secondary" onClick={() => navigate(sheetHref(sheet.id))}>{w.cancel}</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
