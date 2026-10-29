import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import {
  BASE_CURRENCY, QUOTE_STATUSES, validateQuote, quoteHeaderPayload, validateOffers, offersPayload, altsPayload, fmtMoney, fmtNum,
} from '../../lib/pricing/logic'
import {
  fetchQuote, fetchSheet, fetchLines, fetchQuoteOffers, saveQuote, deleteQuote, deleteAlternative,
} from '../../lib/pricing/client'
import { PW } from './words'
import { usePricingBase, field, sheetHref } from './usePricing'
import { Field, StatusBadge, StatusBar, NoAccess, Alert } from './parts'

// ─── Pricing → one supplier quote (v2) ─────────────────────────────────────
// 2026-12-01, dev/erp-pilot/PRICING.md. Musa's quote page: status (requested,
// received, declined), dates, currency and exchange rate, the three landed
// charges (empty = unknown, 0 = known to be none), the supplier's price for
// each BOQ line, and alternatives beside the main offers. A quote in SAR has
// rate 1 and the field says so. Exchange-rate suggestions belong to
// accounting, which does not exist yet: the rate is typed. Editable while the
// sheet is a draft, by Work; otherwise a read.

const NEW_ALTS = 2
const emptyAlt = () => ({ pricing_line_id: '', quantity: '', unit_price: '', brand: '', model_no: '', offered_description: '' })

export function PricingQuote() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(PW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const { ws, base, suppliersById, error: baseError } = usePricingBase()
  const [d, setD] = useState(undefined)
  const [h, setH] = useState(null)
  const [offers, setOffers] = useState({})
  const [alts, setAlts] = useState(() => Array.from({ length: NEW_ALTS }, emptyAlt))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!ws || !id) return
    const q = await fetchQuote(ws, id)
    if (!q.quote) { setD(null); setError(q.error || ''); return }
    const [s, lines, o] = await Promise.all([fetchSheet(ws, q.quote.sheet_id), fetchLines(ws, q.quote.sheet_id), fetchQuoteOffers(ws, id)])
    setD({ quote: q.quote, sheet: s.sheet, lines: lines.rows, offers: o.rows })
    const f = q.quote
    setH({
      status: f.status, requested_on: f.requested_on || '', received_on: f.received_on || '', valid_until: f.valid_until || '', supplier_ref: f.supplier_ref || '',
      currency: f.currency, fx_rate: fmtNum(f.fx_rate), freight_amount: fmtNum(f.freight_amount), customs_amount: fmtNum(f.customs_amount),
      other_charges: fmtNum(f.other_charges), notes: f.notes || '',
    })
    setOffers(Object.fromEntries(o.rows.map(r => [r.id, { id: r.id, quantity: fmtNum(r.quantity), unit_price: fmtNum(r.unit_price), brand: r.brand || '', model_no: r.model_no || '', offered_description: r.offered_description || '', lead_time_days: fmtNum(r.lead_time_days) }])))
    setError(s.error || lines.error || o.error || '')
  }, [ws, id])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!canSection('pricing', 'view')) return <NoAccess />
  if (d === undefined || (d && !h)) return <Skeleton className="h-64 max-w-5xl" />
  if (d === null) return <p className="text-sm text-text-secondary" dir={dir}>{w.quoteGone} <Link className="underline" to="/pricing">{w.back}</Link></p>

  const { quote, sheet, lines, offers: rows } = d
  const edit = sheet.status === 'draft' && canSection('pricing', 'work')
  const sup = suppliersById[quote.supplier_id]
  const currencies = (base?.currencies || []).filter(c => c.active || c.code === quote.currency)
  const isBase = h.currency === BASE_CURRENCY
  const hErr = tried ? validateQuote(h) : {}
  const oErr = tried ? validateOffers(Object.values(offers)) : {}
  const setHF = (k, v) => setH(x => ({ ...x, [k]: v }))
  const setOF = (oid, k, v) => setOffers(o => ({ ...o, [oid]: { ...o[oid], [k]: v } }))
  const byLine = {}
  for (const r of rows) (byLine[r.pricing_line_id] ||= []).push(r)
  const msg = code => w.errors[code]

  const save = async () => {
    setTried(true)
    if (Object.keys(validateQuote(h)).length || Object.keys(validateOffers(Object.values(offers))).length) return
    setBusy(true); setError(''); setNotice('')
    const out = await saveQuote(quote.id, quoteHeaderPayload(h), offersPayload(Object.values(offers)), altsPayload(alts))
    setBusy(false)
    if (out.error) { setError(out.error); return }
    setAlts(Array.from({ length: NEW_ALTS }, emptyAlt)); setTried(false); setNotice(w.quoteSaved)
    await load()
  }
  const input = (k, extra = {}) => ({ value: h[k], onChange: e => setHF(k, e.target.value), className: field, ...extra })

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={sheetHref(sheet.id)}><Button size="sm" variant="secondary">{w.quoteSheet}</Button></Link>
        <Link to={`/pricing/compare?id=${sheet.id}`}><Button size="sm" variant="secondary">{w.compareView}</Button></Link>
        {edit && (
          <Button size="sm" variant="ghost" disabled={busy}
            onClick={() => window.confirm(w.confirmQuoteDelete) && (async () => { setBusy(true); const out = await deleteQuote(ws, quote.id); setBusy(false); if (out.error) setError(out.error); else navigate(sheetHref(sheet.id)) })()}>
            <span className="text-red-700">{w.quoteDelete}</span>
          </Button>
        )}
      </div>
      <StatusBar path={quote.status === 'declined' ? ['requested', 'declined'] : ['requested', 'received']} current={quote.status} bad={['declined']} />

      <section className="bg-white border border-border p-4 space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-text"><bdi>{(lang === 'ar' && sup?.name_ar) || sup?.name}</bdi> <StatusBadge status={quote.status} quote /></h1>
          <p className="text-sm text-text-secondary"><bdi dir="ltr">{quote.quote_no}</bdi> · <bdi dir="ltr">{sheet.sheet_no}</bdi> — <bdi>{sheet.title}</bdi></p>
        </div>
        <fieldset disabled={!edit} className="space-y-3 min-w-0">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={`${w.quoteStatus} *`}>
              <select {...input('status')}>{QUOTE_STATUSES.map(s => <option key={s} value={s}>{w.quoteStatuses[s]}</option>)}</select>
            </Field>
            <Field label={`${w.requestedOn} *`} error={msg(hErr.requested_on)}><input type="date" {...input('requested_on', { dir: 'ltr' })} /></Field>
            <Field label={`${w.receivedOn}${h.status === 'received' ? ' *' : ''}`} error={msg(hErr.received_on)}><input type="date" {...input('received_on', { dir: 'ltr' })} /></Field>
            <Field label={w.validUntil} error={msg(hErr.valid_until)} hint={w.validHelp}><input type="date" {...input('valid_until', { dir: 'ltr' })} /></Field>
            <Field label={w.supplierRef}><input {...input('supplier_ref', { dir: 'ltr', maxLength: 120 })} /></Field>
            <Field label={`${w.currencyLabel} *`}>
              <select {...input('currency')}>{currencies.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}</select>
            </Field>
            <Field label={w.fxLabel(BASE_CURRENCY)} error={msg(hErr.fx_rate)} hint={isBase ? w.fxBase : w.fxHelp(BASE_CURRENCY)}>
              <input inputMode="decimal" {...input('fx_rate', { dir: 'ltr', disabled: isBase, value: isBase ? '1' : h.fx_rate })} />
            </Field>
          </div>
          <h2 className="text-sm font-semibold text-text pt-1">{w.chargesTitle}</h2>
          <p className="text-[11px] text-text-tertiary">{w.chargesHelp}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={w.freight} error={msg(hErr.freight_amount)}><input inputMode="decimal" {...input('freight_amount', { dir: 'ltr' })} /></Field>
            <Field label={w.customs} error={msg(hErr.customs_amount)}><input inputMode="decimal" {...input('customs_amount', { dir: 'ltr' })} /></Field>
            <Field label={w.otherCharges} error={msg(hErr.other_charges)}><input inputMode="decimal" {...input('other_charges', { dir: 'ltr' })} /></Field>
          </div>
          <Field label={w.notesLabel}><textarea rows={2} {...input('notes', { dir: 'auto' })} /></Field>
        </fieldset>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.offersTitle}</h2>
        <fieldset disabled={!edit} className="min-w-0">
          <div className="bg-white border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                {['no', 'line', 'qty', 'price', 'brand', 'model', 'desc', 'lead', 'landed'].map(c => <th key={c} className={`font-medium px-2 py-2 ${c === 'landed' ? 'text-end' : 'text-start'}`}>{c === 'price' ? `${w.ocols.price} (${quote.currency})` : w.ocols[c]}</th>)}
                <th />
              </tr></thead>
              <tbody className="divide-y divide-border">
                {lines.flatMap(l => (byLine[l.id] || []).map(r => {
                  const o = offers[r.id]
                  if (!o) return null
                  const e = oErr[r.id] || {}
                  return (
                    <tr key={r.id} className={`align-top ${r.is_alternative ? 'bg-stone-50/70' : ''}`}>
                      <td className="px-2 py-2 tabular-nums text-text-secondary">{r.is_alternative ? '' : l.line_no}</td>
                      <td className="px-2 py-2 min-w-[11rem]">{r.is_alternative ? <span className="border border-border rounded px-1.5 py-0.5 text-[11px]">{w.alt}</span> : <><bdi>{l.description}</bdi> <span className="text-[11px] text-text-tertiary" dir="ltr">({fmtNum(l.quantity)} {l.unit})</span></>}</td>
                      <td className="px-2 py-1.5"><input value={o.quantity} onChange={x => setOF(r.id, 'quantity', x.target.value)} inputMode="decimal" className={`${field} w-20`} dir="ltr" aria-label={w.ocols.qty} aria-invalid={Boolean(e.quantity)} />{e.quantity && <span className="block text-[11px] text-red-600">{msg(e.quantity)}</span>}</td>
                      <td className="px-2 py-1.5"><input value={o.unit_price} onChange={x => setOF(r.id, 'unit_price', x.target.value)} inputMode="decimal" placeholder="—" className={`${field} w-28`} dir="ltr" aria-label={w.ocols.price} aria-invalid={Boolean(e.unit_price)} />{e.unit_price && <span className="block text-[11px] text-red-600">{msg(e.unit_price)}</span>}</td>
                      <td className="px-2 py-1.5"><input value={o.brand} onChange={x => setOF(r.id, 'brand', x.target.value)} maxLength={120} className={`${field} w-28`} dir="auto" aria-label={w.ocols.brand} /></td>
                      <td className="px-2 py-1.5"><input value={o.model_no} onChange={x => setOF(r.id, 'model_no', x.target.value)} maxLength={120} className={`${field} w-28`} dir="ltr" aria-label={w.ocols.model} /></td>
                      <td className="px-2 py-1.5 min-w-[10rem]"><input value={o.offered_description} onChange={x => setOF(r.id, 'offered_description', x.target.value)} maxLength={2000} className={field} dir="auto" aria-label={w.ocols.desc} /></td>
                      <td className="px-2 py-1.5"><input value={o.lead_time_days} onChange={x => setOF(r.id, 'lead_time_days', x.target.value)} inputMode="numeric" className={`${field} w-20`} dir="ltr" aria-label={w.ocols.lead} aria-invalid={Boolean(e.lead_time_days)} />{e.lead_time_days && <span className="block text-[11px] text-red-600">{msg(e.lead_time_days)}</span>}</td>
                      <td className="px-2 py-2 text-end tabular-nums" dir="ltr">{fmtMoney(r.landed_unit_cost)}</td>
                      <td className="px-2 py-1.5">{r.is_alternative && edit && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { setBusy(true); const out = await deleteAlternative(ws, r.id); setBusy(false); if (out.error) setError(out.error); else load() }}><span className="text-red-700">{w.removeAlt}</span></Button>
                      )}</td>
                    </tr>
                  )
                }))}
              </tbody>
            </table>
          </div>
        </fieldset>
        <p className="text-[11px] text-text-tertiary">{w.offersHint}</p>
      </section>

      {edit && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-text">{w.altTitle}</h2>
          <p className="text-[11px] text-text-tertiary">{w.altHelp}</p>
          <div className="bg-white border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                {[w.altLine, w.ocols.qty, w.ocols.price, w.ocols.brand, w.ocols.model, w.ocols.desc].map(c => <th key={c} className="text-start font-medium px-2 py-2">{c}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {alts.map((a, i) => {
                  const set = (k, v) => setAlts(xs => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
                  return (
                    <tr key={i}>
                      <td className="px-2 py-1.5"><select value={a.pricing_line_id} onChange={e => set('pricing_line_id', e.target.value)} className={`${field} max-w-[16rem]`} aria-label={w.altLine}>
                        <option value="">—</option>{lines.map(l => <option key={l.id} value={l.id}>{l.line_no}. {l.description.slice(0, 50)}</option>)}
                      </select></td>
                      <td className="px-2 py-1.5"><input value={a.quantity} onChange={e => set('quantity', e.target.value)} inputMode="decimal" placeholder={w.altQtyPh} className={`${field} w-24`} dir="ltr" aria-label={w.ocols.qty} /></td>
                      <td className="px-2 py-1.5"><input value={a.unit_price} onChange={e => set('unit_price', e.target.value)} inputMode="decimal" className={`${field} w-28`} dir="ltr" aria-label={w.ocols.price} /></td>
                      <td className="px-2 py-1.5"><input value={a.brand} onChange={e => set('brand', e.target.value)} maxLength={120} className={`${field} w-28`} dir="auto" aria-label={w.ocols.brand} /></td>
                      <td className="px-2 py-1.5"><input value={a.model_no} onChange={e => set('model_no', e.target.value)} maxLength={120} className={`${field} w-28`} dir="ltr" aria-label={w.ocols.model} /></td>
                      <td className="px-2 py-1.5 min-w-[10rem]"><input value={a.offered_description} onChange={e => set('offered_description', e.target.value)} maxLength={2000} className={field} dir="auto" aria-label={w.ocols.desc} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Alert>{error || baseError}</Alert>
      {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
      {edit && <div><Button size="sm" disabled={busy} onClick={save}>{busy ? w.saving : w.saveQuote}</Button></div>}
    </div>
  )
}
