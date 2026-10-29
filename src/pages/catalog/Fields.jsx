import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { validateField, nextOrder } from '../../lib/catalog/logic'
import { saveField, setFieldActive } from '../../lib/catalog/client'
import { KW } from './words'
import { useCatalog, field } from './useCatalog'

// ─── Catalog → specification fields (v2) ───────────────────────────────────
// 2026-10-30. The specifications the company records for each item. The
// company names them; none are imposed. A field is switched off, never
// deleted: its values stay, new items do not show it. Managing only.

const blank = (order = 10) => ({ name: '', name_en: '', unit: '', sequence: String(order) })

export function CatalogFields() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(KW)
  const { ws, fields, error: loadError, load } = useCatalog()
  const [add, setAdd] = useState(null)
  const [editId, setEditId] = useState('')
  const [draft, setDraft] = useState(blank())
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!canSection('catalog', 'manage')) return <p className="text-sm text-text-secondary" dir={dir}>{canSection('catalog', 'view') ? w.needManage : w.noAccess}</p>

  const form = add ?? draft
  const set = (k, v) => (add ? setAdd(x => ({ ...x, [k]: v })) : setDraft(x => ({ ...x, [k]: v })))
  const errWord = code => (code ? w.errors[code] : '')

  async function submit(e, id) {
    e.preventDefault()
    const bad = validateField(form)
    setErrors(bad)
    if (Object.keys(bad).length) return
    setBusy(true); setError('')
    const out = await saveField(ws, id, form)
    setBusy(false)
    if (out.error) { setError(out.error); return }
    setAdd(null); setEditId(''); setErrors({})
    await load()
  }
  async function toggle(fd) {
    setBusy(true); setError('')
    const out = await setFieldActive(ws, fd.id, !fd.active)
    setBusy(false)
    if (out.error) setError(out.error)
    else await load()
  }

  const inputs = (
    <>
      <label className="block"><span className="text-[11px] text-text-secondary">{w.fieldName} *</span>
        <input value={form.name} onChange={e => set('name', e.target.value)} className={field} dir="auto" required />
        {errors.name && <span className="block text-[11px] text-red-600">{errWord(errors.name)}</span>}</label>
      <label className="block"><span className="text-[11px] text-text-secondary">{w.fieldNameEn}</span>
        <input value={form.name_en} onChange={e => set('name_en', e.target.value)} className={field} dir="ltr" /></label>
      <label className="block"><span className="text-[11px] text-text-secondary">{w.fieldUnit}</span>
        <input value={form.unit} onChange={e => set('unit', e.target.value)} className={field} dir="auto" /></label>
      <label className="block"><span className="text-[11px] text-text-secondary">{w.fieldOrder}</span>
        <input value={form.sequence} onChange={e => set('sequence', e.target.value)} className={field} dir="ltr" inputMode="numeric" />
        {errors.sequence && <span className="block text-[11px] text-red-600">{errWord(errors.sequence)}</span>}</label>
    </>
  )

  return (
    <div className="max-w-5xl space-y-4" dir={dir} lang={lang}>
      <Link to="/catalog" className="text-xs text-text-secondary hover:text-text">{w.fieldsBack}</Link>
      <PageHeader title={w.fieldsTitle} subtitle={w.fieldsIntro}>
        {!add && <Button size="sm" onClick={() => { setEditId(''); setErrors({}); setAdd(blank(nextOrder(fields || []))) }}>{w.newField}</Button>}
      </PageHeader>

      {add && (
        <form onSubmit={e => submit(e, '')} className="bg-white border border-border p-4 space-y-3" noValidate>
          <h2 className="text-sm font-semibold text-text">{w.newField}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{inputs}</div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>{w.add}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdd(null); setErrors({}) }}>{w.cancel}</Button>
          </div>
        </form>
      )}
      {(error || loadError) && <p className="text-xs text-red-600" dir="auto" role="alert">{error || loadError}</p>}

      {fields === null ? <Skeleton className="h-48" /> : !fields.length ? (
        <p className="text-sm text-text-tertiary px-1 py-6">{w.fieldsEmpty}</p>
      ) : (
        <>
          <p className="text-[11px] text-text-tertiary">{w.fieldStopNote}</p>
          <div className="bg-white border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                {['name', 'nameEn', 'unit', 'order', 'status'].map(c => <th key={c} className="text-start font-medium px-3 py-2">{w.fieldCols[c]}</th>)}
                <th className="px-3 py-2" />
              </tr></thead>
              <tbody className="divide-y divide-border">
                {fields.map(fd => editId === fd.id ? (
                  <tr key={fd.id} className="bg-stone-50"><td colSpan={6} className="p-3">
                    <form onSubmit={e => submit(e, fd.id)} className="space-y-3" noValidate>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{inputs}</div>
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={busy}>{w.save}</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditId(''); setErrors({}) }}>{w.cancel}</Button>
                      </div>
                    </form>
                  </td></tr>
                ) : (
                  <tr key={fd.id} className={fd.active ? '' : 'text-text-tertiary'}>
                    <td className="px-3 py-2"><bdi>{fd.name}</bdi></td>
                    <td className="px-3 py-2" dir="ltr" style={{ textAlign: 'start' }}>{fd.name_en || '—'}</td>
                    <td className="px-3 py-2"><bdi>{fd.unit || '—'}</bdi></td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>{fd.sequence}</td>
                    <td className="px-3 py-2">{fd.active ? w.active : w.stopped}</td>
                    <td className="px-3 py-2 text-end whitespace-nowrap">
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setAdd(null); setErrors({}); setDraft({ name: fd.name, name_en: fd.name_en || '', unit: fd.unit || '', sequence: String(fd.sequence) }); setEditId(fd.id) }}>{w.edit}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle(fd)}>{fd.active ? w.stop : w.start}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
