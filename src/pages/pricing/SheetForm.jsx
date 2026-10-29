import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { openLeads } from '../../lib/pricing/logic'
import { fetchSheet, createSheet, updateSheet, errorText } from '../../lib/pricing/client'
import { PW } from './words'
import { usePricingBase, field, sheetHref } from './usePricing'
import { Field, NoAccess, Alert } from './parts'

// ─── Pricing → new / edit a sheet (v2) ─────────────────────────────────────
// 2026-12-01, dev/erp-pilot/PRICING.md. A sheet belongs to one open
// opportunity (chosen here, or arriving from the opportunity's own page with
// ?lead=). Its title starts as the opportunity's title. Editing is for a
// draft: title, notes, and the reason for a margin below the limit.

export function PricingSheetForm({ mode }) {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(PW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const editing = mode === 'edit'
  const id = params.get('id') || ''
  const { ws, base, leadsById, error: baseError } = usePricingBase()
  const [sheet, setSheet] = useState(editing ? undefined : null)
  const [f, setF] = useState({ lead_id: params.get('lead') || '', title: '', notes: '', margin_note: '' })
  const [titleTouched, setTitleTouched] = useState(false)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editing || !ws || !id) return
    let alive = true
    fetchSheet(ws, id).then(r => {
      if (!alive) return
      setSheet(r.sheet)
      if (r.sheet) setF({ lead_id: r.sheet.lead_id, title: r.sheet.title, notes: r.sheet.notes || '', margin_note: r.sheet.margin_note || '' })
      setError(r.error || '')
    })
    return () => { alive = false }
  }, [editing, ws, id])

  const leads = useMemo(() => openLeads(base?.leads || []), [base])
  // The title starts as the chosen opportunity's title, until the person writes their own.
  const title = editing || titleTouched ? f.title : (leadsById[f.lead_id]?.title ?? f.title)

  if (!canSection('pricing', 'work')) return <NoAccess />
  if (editing && sheet === undefined) return <Skeleton className="h-48 max-w-xl" />
  if (editing && (!sheet || sheet.status !== 'draft')) {
    return <p className="text-sm text-text-secondary" dir={dir}>{sheet ? errorText('PRICING_NOT_DRAFT') : w.gone} <Link className="underline" to="/pricing">{w.back}</Link></p>
  }

  const lead = leadsById[f.lead_id]
  const errors = {}
  if (!editing && !f.lead_id) errors.lead_id = w.errors.required
  if (!title.trim()) errors.title = w.errors.required

  const submit = async e => {
    e.preventDefault()
    setTried(true)
    if (Object.keys(errors).length) return
    setBusy(true)
    const out = editing ? await updateSheet(ws, sheet.id, { ...f, title }) : await createSheet(ws, { ...f, title })
    setBusy(false)
    if (out.error) { setError(out.error); return }
    navigate(editing ? sheetHref(sheet.id) : `/pricing/lines?id=${out.sheet.id}`)
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4" dir={dir} lang={lang} noValidate>
      <h1 className="text-lg font-semibold text-text">{editing ? w.editTitle : w.newTitle}</h1>
      {editing || params.get('lead') ? (
        <p className="text-sm text-text-secondary">{w.leadOf}: <bdi dir="ltr">{lead?.lead_no}</bdi> — <bdi>{lead?.title}</bdi> · <bdi>{(lang === 'ar' ? lead?.party_ar : lead?.party) || ''}</bdi></p>
      ) : (
        <Field label={`${w.leadLabel} *`} error={tried ? errors.lead_id : ''} hint={leads.length ? w.leadHelp : w.noOpenLeads}>
          <select value={f.lead_id} onChange={e => setF(x => ({ ...x, lead_id: e.target.value }))} className={field} required>
            <option value="">{w.leadPick}</option>
            {leads.map(l => <option key={l.id} value={l.id}>{l.lead_no} — {l.title} · {(lang === 'ar' ? l.party_ar : l.party) || ''}{l.bid_due_date ? ` · ${String(l.bid_due_date).slice(0, 10)}` : ''}</option>)}
          </select>
        </Field>
      )}
      <Field label={`${w.titleLabel} *`} error={tried ? errors.title : ''}>
        <input value={title} onChange={e => { setTitleTouched(true); setF(x => ({ ...x, title: e.target.value })) }} maxLength={255} className={field} dir="auto" />
      </Field>
      <Field label={w.notesLabel}>
        <textarea value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} rows={3} maxLength={10000} className={field} dir="auto" />
      </Field>
      {editing && (
        <Field label={w.marginNoteLabel} hint={w.marginNoteHelp}>
          <textarea value={f.margin_note} onChange={e => setF(x => ({ ...x, margin_note: e.target.value }))} rows={2} maxLength={2000} className={field} dir="auto" />
        </Field>
      )}
      <Alert>{error || baseError}</Alert>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? w.saving : editing ? w.save : w.create}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => navigate(editing ? sheetHref(sheet.id) : '/pricing')}>{w.cancel}</Button>
      </div>
    </form>
  )
}
