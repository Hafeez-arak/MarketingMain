import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { specLines, fieldName } from '../../lib/catalog/logic'
import { fetchItem, fetchFields, fetchSpecs, setItemActive, fileUrl } from '../../lib/catalog/client'
import { KW } from './words'
import { History } from './History'

// ─── Catalog → one item (v2) ───────────────────────────────────────────────
// 2026-10-30. The item's details, its technical specifications (each with
// its field name and unit), the datasheet link and picture, and the history.
// Managing: Edit, and Stop / Start (an item is never deleted).

export function CatalogItem() {
  const { activeWorkspaceId: ws, canSection } = useAuth()
  const { t: w, lang, dir } = useT(KW)
  const navigate = useNavigate()
  const id = useSearchParams()[0].get('id') || ''
  const [item, setItem] = useState(undefined)
  const [fields, setFields] = useState([])
  const [specs, setSpecs] = useState([])
  const [urls, setUrls] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [rev, setRev] = useState(0)

  useEffect(() => {
    if (!ws || !id) return
    let cancelled = false
    Promise.all([fetchItem(ws, id), fetchFields(ws), fetchSpecs(ws, id)]).then(([i, f, s]) => {
      if (cancelled) return
      setItem(i.item); setFields(f.rows); setSpecs(s.rows); setError(i.error || f.error || s.error || '')
    })
    return () => { cancelled = true }
  }, [ws, id])

  const imagePath = item?.image_path
  const sheetPath = item?.datasheet_path
  useEffect(() => {
    let cancelled = false
    for (const path of [imagePath, sheetPath]) {
      if (path) fileUrl(path).then(r => { if (!cancelled && r.url) setUrls(u => ({ ...u, [path]: r.url })) })
    }
    return () => { cancelled = true }
  }, [imagePath, sheetPath])

  if (!canSection('catalog', 'view')) return <p className="text-sm text-text-secondary" dir={dir}>{w.noAccess}</p>
  if (item === undefined && id) return <Skeleton className="h-64 max-w-4xl" />
  if (!item) {
    return (
      <div className="space-y-3" dir={dir} lang={lang}>
        <Link to="/catalog" className="text-xs text-text-secondary hover:text-text">{w.back}</Link>
        <p className="text-sm text-text-secondary">{error || w.itemGone}</p>
      </div>
    )
  }

  const canManage = canSection('catalog', 'manage')
  const lines = specLines(fields, specs)
  const toggle = async () => {
    if (item.active && !window.confirm(w.confirmStop(item.name))) return
    setBusy(true); setError('')
    const out = await setItemActive(ws, item.id, !item.active)
    setBusy(false)
    if (out.error) setError(out.error)
    else { setItem(out.item); setRev(r => r + 1) }
  }
  const detail = (label, value, ltr = false) => (
    <div>
      <dt className="text-[11px] text-text-secondary">{label}</dt>
      <dd className="text-sm text-text" dir={ltr ? 'ltr' : 'auto'} style={ltr ? { textAlign: 'start' } : undefined}>{value || w.notGiven}</dd>
    </div>
  )

  return (
    <div className="max-w-4xl space-y-5" dir={dir} lang={lang}>
      <Link to="/catalog" className="text-xs text-text-secondary hover:text-text">{w.back}</Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text"><bdi>{item.name}</bdi></h1>
          <p className="mt-1 text-xs text-text-tertiary"><bdi dir="ltr">{item.code}</bdi>
            {!item.active && <span className="ms-2 inline-flex rounded border border-border bg-stone-50 px-1.5 py-0.5 text-[10px] text-text-secondary">{w.stopped}</span>}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigate(`/catalog/edit?id=${item.id}`)}>{w.edit}</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={toggle}>{item.active ? w.stop : w.start}</Button>
          </div>
        )}
      </header>
      {error && <p className="text-xs text-red-600" dir="auto" role="alert">{error}</p>}
      {!item.active && <p className="text-xs text-text-secondary border border-border bg-stone-50 px-3 py-2">{w.stoppedNote}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.details}</h2>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 bg-white border border-border p-4">
          {detail(w.code, item.code, true)}
          {detail(w.name, item.name)}
          {detail(w.brand, item.brand)}
          {detail(w.modelNo, item.model_no, true)}
          {detail(w.category, item.category)}
          {detail(w.unit, item.unit)}
          {detail(w.stocked, item.stocked ? w.yes : w.no)}
        </dl>
        {item.description && <p className="text-sm text-text whitespace-pre-line bg-white border border-border p-4" dir="auto">{item.description}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.specs}</h2>
        {!lines.length ? <p className="text-sm text-text-tertiary">{w.noSpecs}</p> : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 bg-white border border-border divide-y sm:divide-y-0 divide-border">
            {lines.map(l => (
              <div key={l.field.id} className="flex justify-between gap-3 px-4 py-2 border-b border-border/60 text-sm">
                <dt className="text-text-secondary"><bdi>{fieldName(l.field, lang)}</bdi>{l.field.unit && <span className="text-text-tertiary"> ({l.field.unit})</span>}</dt>
                <dd className="text-text text-end" dir="auto"><bdi>{l.value}</bdi></dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.files}</h2>
        <div className="bg-white border border-border p-4 space-y-3">
          <p className="text-sm">
            {sheetPath
              ? (urls[sheetPath] ? <a href={urls[sheetPath]} target="_blank" rel="noreferrer" className="text-sky-800 underline">{w.openDatasheet}</a> : <span className="text-text-tertiary">…</span>)
              : <span className="text-text-tertiary">{w.datasheet}: {w.noFile}</span>}
          </p>
          {imagePath && (urls[imagePath]
            ? <img src={urls[imagePath]} alt={item.name} className="max-h-64 max-w-full border border-border" />
            : <Skeleton className="h-32 w-48" />)}
          {!imagePath && <p className="text-sm text-text-tertiary">{w.picture}: {w.noFile}</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.history}</h2>
        <History ws={ws} itemId={item.id} fields={fields} refreshKey={rev} />
      </section>
    </div>
  )
}
