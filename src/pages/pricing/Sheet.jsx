import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton } from '../../components/ui/index'
import { useT, fmtDay } from '../../lib/i18n'
import { marginPct, isLowMargin, fmtMoney, fmtNum, groupIssues, sheetActions, statusPath, chargesKnown, describeAudit, parseNumber } from '../../lib/pricing/logic'
import {
  fetchSheet, fetchLines, fetchLineCosts, fetchTotals, fetchIssues, fetchQuotes, fetchSheetOffers, fetchAudit, savePrices, transition, deleteSheet,
} from '../../lib/pricing/client'
import { PW } from './words'
import { usePricingBase, field, quoteHref } from './usePricing'
import { StatusBadge, StatusBar, Kpi, Facts, Alert, NoAccess } from './parts'

// ─── Pricing → one sheet (v2) ──────────────────────────────────────────────
// 2026-12-01, dev/erp-pilot/PRICING.md. Musa's sheet page: the workflow
// buttons (each shown to the level that may press it; the database checks
// again), the status bar, the figures (landed cost, selling price, margin,
// the minimum), the checks (blocking ones stop submit and approve), the
// lines with their chosen supplier, unit cost, price and margin (prices are
// typed here while the sheet is a draft), the supplier quotes, and the
// history. Cost and margin are shown to everyone who can open Pricing.
// Not here yet, because their modules do not exist: the AI review, the
// technical offers panel (Tech offers) and the financial offer (Quotations).

export function PricingSheetPage() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(PW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const { ws, base, leadsById, suppliersById, itemsById, peopleById, error: baseError } = usePricingBase()
  const [d, setD] = useState(undefined) // undefined loading · null gone
  const [prices, setPrices] = useState({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')

  const rank = canSection('pricing', 'manage') ? 3 : canSection('pricing', 'work') ? 2 : canSection('pricing', 'view') ? 1 : 0

  const load = useCallback(async () => {
    if (!ws || !id) return
    const s = await fetchSheet(ws, id)
    if (!s.sheet) { setD(null); setError(s.error || ''); return }
    const [lines, costs, totals, issues, quotes, audit] = await Promise.all([
      fetchLines(ws, id), fetchLineCosts(ws, id), fetchTotals(ws, id), fetchIssues(id), fetchQuotes(ws, id), fetchAudit(ws, id),
    ])
    // Which offer each line chose, for the supplier's name.
    const chosen = lines.rows.map(l => l.selected_quote_line_id).filter(Boolean)
    const offers = chosen.length ? await fetchSheetOffers(ws, [...new Set(quotes.rows.map(q => q.id))]) : { rows: [] }
    const offersById = Object.fromEntries(offers.rows.map(o => [o.id, o]))
    setD({
      sheet: s.sheet, lines: lines.rows, costs: Object.fromEntries(costs.rows.map(c => [c.pricing_line_id, c])), totals: totals.totals,
      issues: issues.rows, quotes: quotes.rows, audit: audit.rows, offersById,
    })
    setPrices(Object.fromEntries(lines.rows.map(l => [l.id, l.unit_price === null ? '' : fmtNum(l.unit_price)])))
    setError(lines.error || costs.error || totals.error || issues.error || quotes.error || audit.error || '')
  }, [ws, id])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!canSection('pricing', 'view')) return <NoAccess />
  if (d === undefined) return <Skeleton className="h-64 max-w-5xl" />
  if (d === null) return <p className="text-sm text-text-secondary" dir={dir}>{w.gone} <Link className="underline" to="/pricing">{w.back}</Link></p>

  const { sheet, lines, costs, totals, issues, quotes, audit, offersById } = d
  const a = sheetActions(sheet.status, rank)
  const groups = groupIssues(issues)
  const blocking = groups.filter(g => g.blocking)
  const lead = leadsById[sheet.lead_id]
  const min = sheet.min_margin_pct !== null && sheet.min_margin_pct !== undefined ? Number(sheet.min_margin_pct) : base?.minMargin ?? null
  const margin = totals ? marginPct(totals.sell_total, totals.cost_total) : null
  const draftEdit = a.edit
  const day = v => fmtDay(v, lang, { day: 'numeric', month: 'short', year: 'numeric' })
  const stamp = v => fmtDay(v, lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const name = uid => (uid ? peopleById[uid] || w.someone : '')

  const act = async fn => {
    setBusy(true); setError(''); setNotice('')
    const out = await fn()
    setBusy(false)
    if (out?.error) setError(out.error)
    else await load()
    return out
  }
  const move = (action, confirm) => { if (!confirm || window.confirm(confirm)) act(() => transition(sheet.id, action)) }

  const pricesChanged = lines.some(l => String(prices[l.id] ?? '') !== (l.unit_price === null ? '' : fmtNum(l.unit_price)))
  const pricesBad = lines.some(l => String(prices[l.id] ?? '').trim() !== '' && (parseNumber(prices[l.id]) === null || parseNumber(prices[l.id]) < 0))
  const savePricesNow = async () => {
    const payload = {}
    for (const l of lines) {
      const cur = l.unit_price === null ? '' : fmtNum(l.unit_price)
      if (String(prices[l.id] ?? '') !== cur) payload[l.id] = String(prices[l.id] ?? '').trim() === '' ? null : parseNumber(prices[l.id])
    }
    const out = await act(() => savePrices(sheet.id, payload))
    if (!out.error) setNotice(w.pricesSaved)
  }

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <p className="text-xs"><Link to="/pricing" className="text-text-secondary hover:text-text underline">{w.back}</Link></p>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {a.edit && <Link to={`/pricing/edit?id=${sheet.id}`}><Button size="sm" variant="secondary">{w.edit}</Button></Link>}
          {a.edit && <Link to={`/pricing/lines?id=${sheet.id}`}><Button size="sm" variant="secondary">{w.boqLines}</Button></Link>}
          {a.edit && <Link to={`/pricing/quote-new?sheet=${sheet.id}`}><Button size="sm" variant="secondary">{w.requestQuote}</Button></Link>}
          <Link to={`/pricing/compare?id=${sheet.id}`}><Button size="sm" variant="secondary">{a.edit ? w.compare : w.compareView}</Button></Link>
          {a.submit && <Button size="sm" disabled={busy || blocking.length > 0} title={blocking.length ? w.blockedTitle : undefined} onClick={() => move('submit', w.confirmSubmit)}>{w.submit}</Button>}
          {a.approve && <Button size="sm" disabled={busy || blocking.length > 0} title={blocking.length ? w.blockedTitle : undefined} onClick={() => move('approve', w.confirmApprove)}>{w.approve}</Button>}
          {a.return && <Button size="sm" variant="secondary" disabled={busy} onClick={() => move('return')}>{w.returnDraft}</Button>}
          {a.cancel && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancelling(c => !c)}><span className="text-red-700">{w.cancelSheet}</span></Button>}
          {a.remove && (
            <Button size="sm" variant="ghost" disabled={busy}
              onClick={() => window.confirm(w.confirmDelete) && act(async () => { const out = await deleteSheet(ws, sheet.id); if (!out.error) navigate('/pricing'); return out })}>
              <span className="text-red-700">{w.deleteSheet}</span>
            </Button>
          )}
        </div>
        <StatusBar path={statusPath(sheet.status)} current={sheet.status} bad={['cancelled']} />
      </div>

      {cancelling && a.cancel && (
        <form className="bg-white border border-border p-3 space-y-2 max-w-md" onSubmit={async e => {
          e.preventDefault()
          if (!reason.trim()) return
          const out = await act(() => transition(sheet.id, 'cancel', reason.trim()))
          if (!out.error) { setCancelling(false); setReason('') }
        }}>
          <label className="block">
            <span className="text-[11px] text-text-secondary">{w.cancelReason} *</span>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={2000} className={field} dir="auto" required />
          </label>
          <p className="text-[11px] text-text-tertiary">{w.cancelNote}</p>
          <Button type="submit" size="sm" disabled={busy || !reason.trim()}>{w.confirmCancel}</Button>
        </form>
      )}

      <Alert>{error || baseError}</Alert>
      {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}

      <section className="relative bg-white border border-border p-4 space-y-3 overflow-hidden">
        {(sheet.status === 'approved' || sheet.status === 'cancelled') && (
          <span className={`absolute top-3 end-3 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded text-white ${sheet.status === 'approved' ? 'bg-emerald-600' : 'bg-red-600'}`}>
            {sheet.status === 'approved' ? w.ribbonApproved : w.ribbonCancelled}
          </span>
        )}
        <div>
          <h1 className="text-xl font-semibold text-text pe-24"><bdi>{sheet.title}</bdi></h1>
          <p className="text-sm text-text-secondary">
            <bdi dir="ltr">{sheet.sheet_no}</bdi> · {canSection('crm', 'view') && lead
              ? <Link to={`/crm/lead?id=${lead.id}`} className="underline"><bdi dir="ltr">{lead.lead_no}</bdi></Link> : <bdi dir="ltr">{lead?.lead_no}</bdi>}
            {' — '}<bdi>{(lang === 'ar' ? lead?.party_ar : lead?.party) || lead?.title || ''}</bdi>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Kpi label={w.kpiCost} value={fmtMoney(totals?.cost_total)} note={totals && totals.cost_total === null && totals.line_count ? w.kpiNoCost(totals.uncosted_count) : null} />
          <Kpi label={w.kpiSell} value={fmtMoney(totals?.sell_total)} note={totals && totals.sell_total === null && totals.line_count ? w.kpiNoPrice(totals.unpriced_count) : null} />
          <Kpi label={w.kpiMargin} value={margin === null ? '—' : `${margin}%`} tone={margin !== null && isLowMargin(margin, min) ? 'bad' : undefined} />
          <Kpi label={w.kpiMin} value={min === null ? w.kpiUnset : `${fmtNum(min)}%`} />
        </div>
        <Facts rows={[
          [w.preparedBy, name(sheet.created_by)],
          sheet.submitted_at && [w.submittedAt, `${stamp(sheet.submitted_at)} — ${name(sheet.submitted_by)}`],
          sheet.approved_at && [w.approvedAt, <>{stamp(sheet.approved_at)} — {name(sheet.approved_by)}{sheet.approved_by && sheet.approved_by === sheet.submitted_by && <span className="ms-2 text-[11px] border border-border rounded px-1.5 py-0.5 bg-yellow-50 text-yellow-800">{w.selfApproved}</span>}</>],
          sheet.cancelled_at && [w.cancelledAt, `${stamp(sheet.cancelled_at)} — ${name(sheet.cancelled_by)}: ${sheet.cancel_reason}`],
          sheet.margin_note && [w.marginNote, sheet.margin_note],
          sheet.notes && [w.notesLabel, <span className="whitespace-pre-wrap">{sheet.notes}</span>],
        ]} />
      </section>

      {sheet.status !== 'cancelled' && groups.length > 0 && (
        <section className="bg-white border border-border p-4 space-y-2">
          <h2 className="text-sm font-semibold text-text">{w.checks}</h2>
          <ul className="space-y-1">
            {groups.map(g => (
              <li key={g.code} className={`text-sm ${g.blocking ? 'text-red-700' : 'text-yellow-800'}`}>
                <strong className="font-medium">{g.blocking ? '⛔' : '⚠'} {w.issues[g.code] || g.code}</strong>
                {g.lines.length > 0 && <span className="text-text-tertiary"> — {w.lineWord} <bdi dir="ltr">{g.lines.join(', ')}</bdi></span>}
              </li>
            ))}
          </ul>
          {!blocking.length && <p className="text-[11px] text-text-tertiary">{w.noWarningsHint}</p>}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.linesCard}</h2>
        {!lines.length ? (
          <p className="text-xs text-text-tertiary">{w.noLines} {draftEdit && <Link to={`/pricing/lines?id=${sheet.id}`} className="underline">{w.enterBoq}</Link>}</p>
        ) : (
          <>
            <div className="bg-white border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                  {['no', 'ref', 'description', 'qty', 'supplier', 'unitCost', 'price', 'total', 'margin'].map(c =>
                    <th key={c} className={`font-medium px-3 py-2 ${['qty', 'unitCost', 'price', 'total', 'margin'].includes(c) ? 'text-end' : 'text-start'}`}>{w.lcols[c]}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {lines.map(l => {
                    const c = costs[l.id]
                    const offer = l.selected_quote_line_id ? offersById[l.selected_quote_line_id] : null
                    const quote = offer ? quotes.find(q => q.id === offer.quote_id) : null
                    const sup = quote ? suppliersById[quote.supplier_id] : null
                    const item = l.catalog_item_id ? itemsById[l.catalog_item_id] : null
                    const low = c && isLowMargin(c.margin_pct, min)
                    return (
                      <tr key={l.id} className="align-top">
                        <td className="px-3 py-2 tabular-nums text-text-secondary">{l.line_no}</td>
                        <td className="px-3 py-2 text-xs" dir="ltr" style={{ textAlign: 'start' }}>{l.boq_ref || '—'}</td>
                        <td className="px-3 py-2 min-w-[14rem]">
                          <bdi>{l.description}</bdi>
                          {item && <p className="text-[11px] text-text-tertiary"><bdi dir="ltr">{item.code}</bdi> — <bdi>{item.name}</bdi></p>}
                          <p className="text-[11px] text-text-tertiary">{w.categoryLabel}: {l.cost_category ? w.categories[l.cost_category] : w.unclassified}</p>
                        </td>
                        <td className="px-3 py-2 text-end whitespace-nowrap tabular-nums" dir="ltr">{fmtNum(l.quantity)} <bdi>{l.unit}</bdi></td>
                        <td className="px-3 py-2 min-w-[9rem]">
                          {quote ? <><bdi>{(lang === 'ar' ? sup?.name_ar : null) || sup?.name}</bdi> <span className="text-[11px] text-text-tertiary">(<bdi dir="ltr">{quote.quote_no}</bdi>{offer.is_alternative ? ` — ${w.alternative}` : ''})</span></> : <span className="text-text-tertiary">—</span>}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{fmtMoney(c?.unit_cost)}</td>
                        <td className="px-3 py-2 text-end">
                          {draftEdit ? (
                            <input type="text" inputMode="decimal" dir="ltr" value={prices[l.id] ?? ''} onChange={e => setPrices(p => ({ ...p, [l.id]: e.target.value }))}
                              aria-label={`${w.lcols.price} ${l.line_no}`} className={`${field} w-28 text-end`} />
                          ) : <span className="tabular-nums" dir="ltr">{fmtMoney(l.unit_price)}</span>}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{fmtMoney(c?.sell_total)}</td>
                        <td className={`px-3 py-2 text-end tabular-nums ${low ? 'text-red-700' : ''}`} dir="ltr">{c?.margin_pct == null ? '—' : `${c.margin_pct}%`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-text-tertiary">{w.costHint}</p>
            {draftEdit && <Button size="sm" disabled={busy || !pricesChanged || pricesBad} onClick={savePricesNow}>{w.savePrices}</Button>}
          </>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.quotesCard}</h2>
        {!quotes.length ? (
          <p className="text-xs text-text-tertiary">{w.noQuotes} {draftEdit && lines.length > 0 && <Link to={`/pricing/quote-new?sheet=${sheet.id}`} className="underline">{w.askSupplier}</Link>}</p>
        ) : (
          <div className="bg-white border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                {['no', 'supplier', 'currency', 'rate', 'charges', 'valid', 'status'].map(c => <th key={c} className="text-start font-medium px-3 py-2">{w.qcols[c]}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {quotes.map(q => (
                  <tr key={q.id} role="link" tabIndex={0} onClick={() => navigate(quoteHref(q.id))} onKeyDown={e => { if (e.key === 'Enter') navigate(quoteHref(q.id)) }}
                    className="hover:bg-stone-50 cursor-pointer focus:outline-none focus-visible:bg-stone-50">
                    <td className="px-3 py-2 text-xs" dir="ltr" style={{ textAlign: 'start' }}><Link to={quoteHref(q.id)} className="underline" onClick={e => e.stopPropagation()}>{q.quote_no}</Link></td>
                    <td className="px-3 py-2"><bdi>{(lang === 'ar' ? suppliersById[q.supplier_id]?.name_ar : null) || suppliersById[q.supplier_id]?.name}</bdi></td>
                    <td className="px-3 py-2" dir="ltr" style={{ textAlign: 'start' }}>{q.currency}</td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>{q.fx_rate === null ? '—' : fmtNum(q.fx_rate)}</td>
                    <td className="px-3 py-2">{chargesKnown(q) ? w.chargesKnownWord : w.chargesUnknownWord}</td>
                    <td className="px-3 py-2 whitespace-nowrap" dir="ltr" style={{ textAlign: 'start' }}>{q.valid_until ? day(q.valid_until) : '—'}</td>
                    <td className="px-3 py-2"><StatusBadge status={q.status} quote /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.history}</h2>
        {!audit.length ? <p className="text-xs text-text-tertiary">{w.noHistory}</p> : (
          <ol className="bg-white border border-border divide-y divide-border">
            {audit.map(r => {
              const x = describeAudit(r, (f, v) => (v === null || v === undefined ? '—' : f === 'status' ? (w.statuses[v] || v) : f === 'cost_category' ? (w.categories[v] || v) : f === 'selected_quote_line_id' ? '…' : typeof v === 'string' && /T\d\d:\d\d/.test(v) ? stamp(v) : String(v)))
              return (
                <li key={r.id} className="px-3 py-2 text-xs">
                  <p className="flex flex-wrap gap-x-2 text-text">
                    <strong className="font-medium">{r.changed_by ? name(r.changed_by) || w.someone : w.system}</strong>
                    <span>{w.historyActions[x.action]} · {w.historyTables[x.table] || x.table}{x.label && <> <bdi>{x.label}</bdi></>}</span>
                    <time className="text-text-tertiary ms-auto" dateTime={r.changed_at}>{stamp(r.changed_at)}</time>
                  </p>
                  {x.changes.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-text-secondary">
                      {x.changes.map(([f, from, to]) => (
                        <li key={f}>{w.fieldNames[f] || f}: <del className="text-text-tertiary"><bdi>{from}</bdi></del> {dir === 'rtl' ? '←' : '→'} <bdi>{to}</bdi></li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
