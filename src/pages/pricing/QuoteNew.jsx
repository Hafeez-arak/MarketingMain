import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { BASE_CURRENCY } from '../../lib/pricing/logic'
import { riyadhToday } from '../../lib/crm/logic'
import { fetchSheet, fetchLines, requestQuote, errorText } from '../../lib/pricing/client'
import { PW } from './words'
import { usePricingBase, field, sheetHref, quoteHref } from './usePricing'
import { Field, NoAccess, Alert } from './parts'

// ─── Pricing → ask a supplier to quote (v2) ────────────────────────────────
// 2026-12-01, dev/erp-pilot/PRICING.md. A request to one supplier (an active
// organisation with the supplier role in Contacts) for every line of the
// sheet, with the BOQ quantities and empty prices; the prices are typed on
// the quote when it arrives. For a draft sheet that has lines.

export function PricingQuoteNew() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(PW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('sheet') || ''
  const { ws, base, error: baseError } = usePricingBase()
  const [d, setD] = useState(undefined)
  const [f, setF] = useState({ supplier_id: '', currency: BASE_CURRENCY, requested_on: riyadhToday(), notes: '' })
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ws || !id) return
    let alive = true
    Promise.all([fetchSheet(ws, id), fetchLines(ws, id)]).then(([s, l]) => { if (alive) setD(s.sheet ? { sheet: s.sheet, hasLines: l.rows.length > 0 } : null) })
    return () => { alive = false }
  }, [ws, id])

  if (!canSection('pricing', 'work')) return <NoAccess />
  if (d === undefined) return <Skeleton className="h-48 max-w-3xl" />
  if (d === null) return <p className="text-sm text-text-secondary" dir={dir}>{w.gone} <Link className="underline" to="/pricing">{w.back}</Link></p>
  const { sheet, hasLines } = d
  if (sheet.status !== 'draft') return <p className="text-sm text-text-secondary" dir={dir}>{errorText('PRICING_NOT_DRAFT')} <Link className="underline" to={sheetHref(sheet.id)}>{w.back}</Link></p>
  if (!hasLines) return <p className="text-sm text-text-secondary" dir={dir}>{errorText('PRICING_NO_LINES')} <Link className="underline" to={`/pricing/lines?id=${sheet.id}`}>{w.boqLines}</Link></p>

  // The suppliers to choose from: active organisations with the role.
  const suppliers = (base?.suppliers || []).filter(s => s.is_supplier && s.status === 'active')
  const currencies = (base?.currencies || []).filter(c => c.active)
  const missing = !f.supplier_id || !f.requested_on

  const submit = async e => {
    e.preventDefault()
    setTried(true)
    if (missing) return
    setBusy(true); setError('')
    const out = await requestQuote(sheet.id, f)
    setBusy(false)
    if (out.error) { setError(out.error); return }
    navigate(quoteHref(out.id))
  }

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4" dir={dir} lang={lang} noValidate>
      <p className="text-xs"><Link to={sheetHref(sheet.id)} className="text-text-secondary hover:text-text underline">{w.backToSheet}</Link></p>
      <h1 className="text-lg font-semibold text-text">{w.requestTitle} — <bdi dir="ltr">{sheet.sheet_no}</bdi></h1>
      <p className="text-xs text-text-secondary">{w.requestHelp}</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={`${w.supplierLabel} *`} error={tried && !f.supplier_id ? w.errors.required : ''} hint={suppliers.length ? w.supplierHelp : w.noSuppliers}>
          <select value={f.supplier_id} onChange={e => setF(x => ({ ...x, supplier_id: e.target.value }))} className={field}>
            <option value="">{w.leadPick}</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{(lang === 'ar' && s.name_ar) || s.name} ({s.contact_no})</option>)}
          </select>
        </Field>
        <Field label={`${w.currencyLabel} *`}>
          <select value={f.currency} onChange={e => setF(x => ({ ...x, currency: e.target.value }))} className={field}>
            {currencies.map(c => <option key={c.code} value={c.code}>{c.code} — {lang === 'ar' ? c.name_ar : c.name_en}</option>)}
          </select>
        </Field>
        <Field label={`${w.requestedOn} *`} error={tried && !f.requested_on ? w.errors.required : ''}>
          <input type="date" value={f.requested_on} onChange={e => setF(x => ({ ...x, requested_on: e.target.value }))} className={field} dir="ltr" />
        </Field>
      </div>
      <Field label={w.notesLabel}>
        <textarea value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} rows={2} className={field} dir="auto" />
      </Field>
      <Alert>{error || baseError}</Alert>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? w.saving : w.requestSend}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => navigate(sheetHref(sheet.id))}>{w.cancel}</Button>
      </div>
    </form>
  )
}
