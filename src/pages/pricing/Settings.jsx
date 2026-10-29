import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { fmtNum, parseNumber } from '../../lib/pricing/logic'
import { fetchSettings, saveMinMargin } from '../../lib/pricing/client'
import { PW } from './words'
import { field } from './usePricing'
import { Field, NoAccess, Alert } from './parts'

// ─── Pricing → settings (v2) ───────────────────────────────────────────────
// 2026-12-01, dev/erp-pilot/PRICING.md. The one setting: the company's
// minimum margin. Empty keeps the check off (no rate is assumed). Everyone
// who can open Pricing reads it; Manage (his pricing.approve) changes it.
// His other setting, the days before a consultant's reply is chased, belongs
// to Tech offers and waits for that module.

export function PricingSettings() {
  const { canSection, activeWorkspaceId: ws } = useAuth()
  const { t: w, lang, dir } = useT(PW)
  const [saved, setSaved] = useState(undefined)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!ws) return
    let alive = true
    fetchSettings(ws).then(r => { if (alive) { setSaved(r.minMargin); setValue(fmtNum(r.minMargin)); setError(r.error || '') } })
    return () => { alive = false }
  }, [ws])

  if (!canSection('pricing', 'view')) return <NoAccess />
  if (saved === undefined) return <Skeleton className="h-40 max-w-xl" />
  const can = canSection('pricing', 'manage')
  const parsed = value.trim() === '' ? null : parseNumber(value)
  const invalid = value.trim() !== '' && (parsed === null || parsed < 0 || parsed >= 100)

  const save = async e => {
    e.preventDefault()
    if (invalid) return
    setBusy(true); setError(''); setNotice('')
    const out = await saveMinMargin(ws, parsed)
    setBusy(false)
    if (out.error) { setError(out.error); return }
    setSaved(parsed); setNotice(w.minSaved)
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-4" dir={dir} lang={lang} noValidate>
      <p className="text-xs"><Link to="/pricing" className="text-text-secondary hover:text-text underline">{w.back}</Link></p>
      <h1 className="text-lg font-semibold text-text">{w.settingsTitle}</h1>
      <section className="bg-white border border-border p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text">{w.minTitle}</h2>
        <p className="text-xs text-text-secondary">{w.minHelp}</p>
        <Field label={w.minLabel} error={invalid ? w.errors.nonNegative : ''} hint={saved === null ? w.minStateOff : w.minStateOn(fmtNum(saved))}>
          <input value={value} onChange={e => setValue(e.target.value)} inputMode="decimal" disabled={!can} className={`${field} max-w-[10rem]`} dir="ltr" />
        </Field>
        {can ? <Button type="submit" size="sm" disabled={busy || invalid}>{busy ? w.saving : w.save}</Button> : <p className="text-[11px] text-text-tertiary">{w.minNeedManage}</p>}
      </section>
      <Alert>{error}</Alert>
      {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
    </form>
  )
}
