import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton, Spinner } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { emptyItem, validateItem, formFields, specValues, usedValues, fieldName, fileProblem, MIME } from '../../lib/catalog/logic'
import { fetchItems, fetchItem, fetchFields, fetchSpecs, saveItem, uploadItemFile } from '../../lib/catalog/client'
import { KW } from './words'
import { field } from './useCatalog'

// ─── Catalog → new or edit an item (v2) ────────────────────────────────────
// 2026-10-30. Code*, name*, brand, model no., category, unit*, description
// and "Stocked item"; one input per active specification field (and any
// stopped field the item already has a value for), in the fields' order;
// a datasheet and a picture. Unit and category offer the values already
// used. A blank spec means no value (the row is deleted): none is assumed.

function Labelled({ label, error, hint, children }) {
  return (
    <label className="block">
      <span className="text-[11px] text-text-secondary">{label}</span>
      {children}
      {error && <span className="block text-[11px] text-red-600">{error}</span>}
      {hint && <span className="block text-[11px] text-text-tertiary mt-0.5">{hint}</span>}
    </label>
  )
}

export function CatalogItemForm() {
  const { activeWorkspaceId: ws, canSection } = useAuth()
  const { t: w, lang, dir } = useT(KW)
  const navigate = useNavigate()
  const id = useSearchParams()[0].get('id') || ''
  const [ready, setReady] = useState(false)
  const [items, setItems] = useState([])
  const [fields, setFields] = useState([])
  const [item, setItem] = useState(null)
  const [existing, setExisting] = useState([])
  const [f, setF] = useState(emptyItem())
  const [values, setValues] = useState({})
  const [files, setFiles] = useState({ datasheet: null, image: null })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // After a first save that could not finish (a file, say), the item exists: save again updates it.
  const [savedId, setSavedId] = useState('')

  useEffect(() => {
    if (!ws) return
    let cancelled = false
    Promise.all([fetchItems(ws), fetchFields(ws), id ? fetchItem(ws, id) : { item: null }, id ? fetchSpecs(ws, id) : { rows: [] }]).then(([i, fl, it, sp]) => {
      if (cancelled) return
      setItems(i.rows); setFields(fl.rows); setItem(it.item); setExisting(sp.rows)
      if (it.item) {
        const x = it.item
        setF({ code: x.code, name: x.name, brand: x.brand || '', model_no: x.model_no || '', category: x.category || '', unit: x.unit, description: x.description || '', stocked: x.stocked })
        setValues(specValues(sp.rows))
      }
      setError(i.error || fl.error || it.error || sp.error || '')
      setReady(true)
    })
    return () => { cancelled = true }
  }, [ws, id])

  if (!canSection('catalog', 'manage')) return <p className="text-sm text-text-secondary" dir={dir}>{w.noAccess}</p>
  if (!ready) return <Skeleton className="h-64 max-w-3xl" />
  if (id && !item) {
    return (
      <div className="space-y-3" dir={dir} lang={lang}>
        <Link to="/catalog" className="text-xs text-text-secondary hover:text-text">{w.back}</Link>
        <p className="text-sm text-text-secondary">{error || w.itemGone}</p>
      </div>
    )
  }

  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const inputs = formFields(fields, values)
  const editingId = id || savedId
  const errWord = code => (code ? w.errors[code] : '')

  async function submit(e) {
    e.preventDefault()
    const bad = validateItem(f)
    setErrors(bad)
    if (Object.keys(bad).length) { setError(w.fixFields); return }
    for (const kind of ['datasheet', 'image']) {
      const problem = files[kind] ? fileProblem(kind, files[kind]) : ''
      if (problem) { setError(w.fileProblems[problem]); return }
    }
    setBusy(true); setError('')
    const out = await saveItem(ws, editingId, f, values, editingId === id ? existing : (await fetchSpecs(ws, editingId || 'none')).rows)
    if (out.item) setSavedId(out.item.id)
    if (out.error) { setError(out.item ? `${w.savedButSpecs} ${out.error}` : out.error); setBusy(false); return }
    for (const kind of ['datasheet', 'image']) {
      if (!files[kind]) continue
      const up = await uploadItemFile(ws, out.item.id, kind, files[kind])
      if (up.error) { setError(up.error); setBusy(false); return }
    }
    setBusy(false)
    navigate(`/catalog/item?id=${out.item.id}`)
  }

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-5" dir={dir} lang={lang} noValidate>
      <Link to={item ? `/catalog/item?id=${item.id}` : '/catalog'} className="text-xs text-text-secondary hover:text-text">{item ? item.name : w.back}</Link>
      <h1 className="text-xl font-semibold text-text">{item ? w.editItemTitle : w.newItemTitle}</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white border border-border p-4">
        <Labelled label={`${w.codeLabel} *`} error={errWord(errors.code)}>
          <input value={f.code} onChange={e => set('code', e.target.value)} className={field} dir="ltr" required />
        </Labelled>
        <Labelled label={`${w.nameLabel} *`} error={errWord(errors.name)}>
          <input value={f.name} onChange={e => set('name', e.target.value)} className={field} dir="auto" required />
        </Labelled>
        <Labelled label={w.brandLabel}><input value={f.brand} onChange={e => set('brand', e.target.value)} className={field} dir="auto" /></Labelled>
        <Labelled label={w.modelLabel}><input value={f.model_no} onChange={e => set('model_no', e.target.value)} className={field} dir="ltr" /></Labelled>
        <Labelled label={w.categoryLabel}>
          <input value={f.category} onChange={e => set('category', e.target.value)} className={field} dir="auto" list="catalog-categories" />
          <datalist id="catalog-categories">{usedValues(items, 'category').map(v => <option key={v} value={v} />)}</datalist>
        </Labelled>
        <Labelled label={`${w.unitLabel} *`} error={errWord(errors.unit)}>
          <input value={f.unit} onChange={e => set('unit', e.target.value)} className={field} dir="auto" list="catalog-units" required />
          <datalist id="catalog-units">{usedValues(items, 'unit').map(v => <option key={v} value={v} />)}</datalist>
        </Labelled>
        <div className="sm:col-span-2">
          <Labelled label={w.descriptionLabel}><textarea value={f.description} onChange={e => set('description', e.target.value)} rows={3} className={field} dir="auto" /></Labelled>
        </div>
        <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={f.stocked} onChange={e => set('stocked', e.target.checked)} />
          {w.stockedLabel} <span className="text-[11px] text-text-tertiary">{w.stockedHelp}</span>
        </label>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.specs}</h2>
        <p className="text-[11px] text-text-tertiary">{w.specsHelp}</p>
        {!inputs.length ? <p className="text-sm text-text-tertiary">{w.noFields}</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white border border-border p-4">
            {inputs.map(fd => (
              <Labelled key={fd.id} label={`${fieldName(fd, lang)}${fd.unit ? ` (${fd.unit})` : ''}${fd.active ? '' : ` — ${w.stoppedField}`}`}>
                <input value={values[fd.id] || ''} onChange={e => setValues(v => ({ ...v, [fd.id]: e.target.value }))} className={field} dir="auto" />
              </Labelled>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.files}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white border border-border p-4">
          {[['datasheet', w.datasheetLabel, item?.datasheet_path], ['image', w.pictureLabel, item?.image_path]].map(([kind, label, current]) => (
            <Labelled key={kind} label={label} hint={current ? `${w.currentFile}: ${current.split('/').pop()}` : ''}>
              <input type="file" accept={MIME[kind].join(',')} onChange={e => setFiles(x => ({ ...x, [kind]: e.target.files?.[0] || null }))} className="block w-full text-xs text-text" />
            </Labelled>
          ))}
          {item && <p className="sm:col-span-2 text-[11px] text-text-tertiary">{w.replaceNote}</p>}
        </div>
      </section>

      {error && <p className="text-xs text-red-600" dir="auto" role="alert">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{busy ? w.saving : w.save}</Button>
        <Button size="sm" variant="ghost" onClick={() => navigate(item ? `/catalog/item?id=${item.id}` : '/catalog')}>{w.cancel}</Button>
      </div>
    </form>
  )
}
