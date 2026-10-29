import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { buildXlsx, download } from '../../lib/xlsx'
import {
  COST_CATEGORIES, BOQ_TEMPLATE_HEAD, parseDelimited, parseBoq, validateLines, linesPayload, fmtNum,
} from '../../lib/pricing/logic'
import { fetchSheet, fetchLines, fetchQuotes, fetchSheetOffers, saveLines, importLines, errorText } from '../../lib/pricing/client'
import { PW } from './words'
import { usePricingBase, field, fieldInline, sheetHref } from './usePricing'
import { NoAccess, Alert } from './parts'
import { importMessage } from './importMessage'

// ─── Pricing → the BOQ of a draft sheet (v2) ───────────────────────────────
// 2026-12-01, dev/erp-pilot/PRICING.md. Musa's lines editor: add, edit and
// remove the client's lines (a line with supplier offers takes them with it),
// link a catalog item, classify, and import a BOQ. One difference from his:
// his import takes an Excel or CSV file and needs the data.import permission;
// ours takes a CSV file or rows pasted from Excel (tab-separated) with the
// same columns, for anyone who can work in Pricing, and the template is an
// .xlsx made by our own writer.

let seq = 0
const blankLine = () => ({ key: `n${++seq}`, id: null, boq_ref: '', description: '', quantity: '', unit: '', catalog_item_id: '', cost_category: '', offers: 0 })
const fromRow = (l, offers) => ({ key: l.id, id: l.id, boq_ref: l.boq_ref || '', description: l.description, quantity: fmtNum(l.quantity), unit: l.unit, catalog_item_id: l.catalog_item_id || '', cost_category: l.cost_category || '', offers: offers[l.id] || 0 })

export function PricingLines() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(PW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const { ws, base, error: baseError } = usePricingBase()
  const [sheet, setSheet] = useState(undefined)
  const [rows, setRows] = useState([])
  const [saved, setSaved] = useState('[]')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [paste, setPaste] = useState('')
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    if (!ws || !id) return
    const s = await fetchSheet(ws, id)
    setSheet(s.sheet)
    if (!s.sheet) { setError(s.error || ''); return }
    const [l, q] = await Promise.all([fetchLines(ws, id), fetchQuotes(ws, id)])
    const o = await fetchSheetOffers(ws, q.rows.map(x => x.id))
    const count = {}
    for (const x of o.rows) count[x.pricing_line_id] = (count[x.pricing_line_id] || 0) + 1
    const next = l.rows.map(r => fromRow(r, count))
    setRows(next.length ? next : [blankLine()])
    setSaved(JSON.stringify(next.map(r => [r.id, r.boq_ref, r.description, r.quantity, r.unit, r.catalog_item_id, r.cost_category])))
    setError(l.error || q.error || o.error || '')
  }, [ws, id])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!canSection('pricing', 'work')) return <NoAccess />
  if (sheet === undefined) return <Skeleton className="h-64 max-w-5xl" />
  if (!sheet) return <p className="text-sm text-text-secondary" dir={dir}>{w.gone} <Link className="underline" to="/pricing">{w.back}</Link></p>
  if (sheet.status !== 'draft') return <p className="text-sm text-text-secondary" dir={dir}>{errorText('PRICING_NOT_DRAFT')} <Link className="underline" to={sheetHref(sheet.id)}>{w.back}</Link></p>

  const dirty = JSON.stringify(rows.filter(r => r.id).map(r => [r.id, r.boq_ref, r.description, r.quantity, r.unit, r.catalog_item_id, r.cost_category])) !== JSON.stringify(JSON.parse(saved).filter(r => r[0]))
    || rows.some(r => !r.id && (r.description || r.quantity || r.unit))
  const errors = tried ? validateLines(rows) : {}
  const set = (key, patch) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)))
  const remove = r => {
    if (rows.length < 2) return
    if (r.offers > 0 && !window.confirm(w.confirmRemoveOffers)) return
    setRows(rs => rs.filter(x => x.key !== r.key))
  }
  const items = (base?.items || []).filter(i => i.active || rows.some(r => r.catalog_item_id === i.id))

  const save = async () => {
    setTried(true)
    if (Object.keys(validateLines(rows)).length) return
    setBusy(true); setError(''); setNotice('')
    const out = await saveLines(sheet.id, linesPayload(rows))
    setBusy(false)
    if (out.error) { setError(out.error); return }
    navigate(sheetHref(sheet.id))
  }

  const runImport = async () => {
    setError(''); setNotice('')
    let text = paste
    const file = fileRef.current?.files?.[0]
    if (file) {
      if (!/\.(csv|tsv|txt)$/i.test(file.name)) { setError(w.importErrors.unreadable); return }
      try { text = await file.text() } catch { setError(w.importErrors.unreadable); return }
    }
    const parsed = parseBoq(parseDelimited(text))
    if (parsed.errors) { setError(importMessage(w, parsed.errors)); return }
    if (dirty && !window.confirm(w.importDirty)) return
    setBusy(true)
    const out = await importLines(sheet.id, parsed.rows)
    setBusy(false)
    if (out.error) { setError(out.error); return }
    setPaste(''); if (fileRef.current) fileRef.current.value = ''
    setNotice(w.importedN(out.data))
    await load()
  }

  const template = () => {
    const head = BOQ_TEMPLATE_HEAD[lang] || BOQ_TEMPLATE_HEAD.en
    download(buildXlsx({ sheet: 'BOQ', rows: [head.map(v => ({ v, s: 'head' }))], widths: [14, 60, 12, 12, 16], rtl: lang === 'ar' }), 'boq-template.xlsx')
  }

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <p className="text-xs"><Link to={sheetHref(sheet.id)} className="text-text-secondary hover:text-text underline">{w.backToSheet}</Link></p>
      <h1 className="text-lg font-semibold text-text">{w.linesTitle} — <bdi dir="ltr">{sheet.sheet_no}</bdi></h1>

      <section className="bg-white border border-border p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text">{w.importTitle}</h2>
        <p className="text-xs text-text-secondary">{w.importHelp}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-[11px] text-text-secondary">{w.importFile}</span>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className={field} />
          </label>
          <label className="block">
            <span className="text-[11px] text-text-secondary">{w.importPaste}</span>
            <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={3} placeholder={w.importPastePh} className={`${field} font-mono text-xs`} dir="auto" spellCheck={false} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={runImport}>{busy ? w.importing : w.importRun}</Button>
          <Button size="sm" variant="secondary" onClick={template}>{w.downloadTemplate}</Button>
        </div>
      </section>

      <Alert>{error || baseError}</Alert>
      {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.linesCardTitle}</h2>
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              {['no', 'ref', 'description', 'qty', 'unit', 'item', 'category'].map(c => <th key={c} className="text-start font-medium px-2 py-2">{w.lineCols[c]}{['description', 'qty', 'unit'].includes(c) ? ' *' : ''}</th>)}
              <th />
            </tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => {
                const e = errors[i] || {}
                return (
                  <tr key={r.key} className="align-top">
                    <td className="px-2 py-2 tabular-nums text-text-secondary">{i + 1}</td>
                    <td className="px-2 py-1.5"><input value={r.boq_ref} onChange={x => set(r.key, { boq_ref: x.target.value })} maxLength={60} className={`${fieldInline} w-24`} dir="ltr" aria-label={w.lineCols.ref} /></td>
                    <td className="px-2 py-1.5 min-w-[16rem]">
                      <input value={r.description} onChange={x => set(r.key, { description: x.target.value })} maxLength={2000} className={field} dir="auto" aria-label={w.lineCols.description} aria-invalid={Boolean(e.description)} />
                      {e.description && <span className="block text-[11px] text-red-600">{w.errors[e.description]}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={r.quantity} onChange={x => set(r.key, { quantity: x.target.value })} inputMode="decimal" className={`${fieldInline} w-24`} dir="ltr" aria-label={w.lineCols.qty} aria-invalid={Boolean(e.quantity)} />
                      {e.quantity && <span className="block text-[11px] text-red-600">{w.errors[e.quantity]}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={r.unit} onChange={x => set(r.key, { unit: x.target.value })} maxLength={30} className={`${fieldInline} w-24`} dir="auto" aria-label={w.lineCols.unit} aria-invalid={Boolean(e.unit)} />
                      {e.unit && <span className="block text-[11px] text-red-600">{w.errors[e.unit]}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={r.catalog_item_id} onChange={x => set(r.key, { catalog_item_id: x.target.value })} className={`${fieldInline} max-w-[14rem]`} aria-label={w.lineCols.item}>
                        <option value="">{w.noItem}</option>
                        {items.map(it => <option key={it.id} value={it.id}>{it.code} — {it.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={r.cost_category} onChange={x => set(r.key, { cost_category: x.target.value })} className={field} aria-label={w.lineCols.category}>
                        <option value="">{w.unclassified}</option>
                        {COST_CATEGORIES.map(c => <option key={c} value={c}>{w.categories[c]}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5"><Button size="sm" variant="ghost" disabled={rows.length < 2} onClick={() => remove(r)}><span className="text-red-700">{w.removeLine}</span></Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {errors._ && <Alert>{w.errors[errors._.rows]}</Alert>}
        <Button size="sm" variant="secondary" onClick={() => setRows(rs => [...rs, blankLine()])}>{w.addLine}</Button>
        <p className="text-[11px] text-text-tertiary">{w.linesNote} {w.categoryHelp}</p>
      </section>

      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={save}>{busy ? w.saving : w.saveLines}</Button>
        <Button size="sm" variant="secondary" onClick={() => navigate(sheetHref(sheet.id))}>{w.cancel}</Button>
      </div>
    </div>
  )
}
