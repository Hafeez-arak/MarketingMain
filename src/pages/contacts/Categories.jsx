import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { saveCategory } from '../../lib/contacts/client'
import { CW } from './words'
import { useContactsBook, field } from './useContactsBook'

// ─── Contacts → Supplier categories (v2) ───────────────────────────────────
// 2026-10-28, dev/erp-pilot/CONTACTS.md. Musa's "تصنيفات الموردين": the
// company names its own categories, in Arabic and English, to filter and
// group suppliers; they touch nothing in the accounts. One in use is
// switched off, never deleted: its suppliers keep it, a new one cannot pick
// it (the database refuses that too). Everyone with Contacts reads the
// list; naming them is managing.

function Row({ ws, c, count, canManage, onSaved }) {
  const { t: w } = useT(CW)
  const [f, setF] = useState({ name: c.name, name_en: c.name_en || '', is_active: c.is_active })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const changed = f.name !== c.name || f.name_en !== (c.name_en || '') || f.is_active !== c.is_active
  async function save() {
    setBusy(true)
    const out = await saveCategory(ws, c.id, f)
    setBusy(false)
    setNote(out.error || w.catSaved)
    if (!out.error) onSaved()
  }
  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        {canManage ? <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={field} dir="auto" aria-label={w.catName} /> : <bdi>{c.name}</bdi>}
      </td>
      <td className="px-3 py-2">
        {canManage ? <input value={f.name_en} onChange={e => setF({ ...f, name_en: e.target.value })} className={field} dir="ltr" aria-label={w.catNameEn} /> : <bdi>{c.name_en || '—'}</bdi>}
      </td>
      <td className="px-3 py-2 tabular-nums">
        <Link to={`/contacts?category=${c.id}&quick=suppliers`} className="underline">{count}</Link>
      </td>
      <td className="px-3 py-2">
        <label className="inline-flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={f.is_active} disabled={!canManage} onChange={e => setF({ ...f, is_active: e.target.checked })} />
          {w.catActive}
        </label>
      </td>
      <td className="px-3 py-2 text-end whitespace-nowrap">
        {canManage && <Button size="xs" variant="secondary" disabled={busy || !changed || !f.name.trim()} onClick={save}>{w.save}</Button>}
        {note && <p className="text-[11px] text-text-tertiary mt-1" dir="auto">{note}</p>}
      </td>
    </tr>
  )
}

export function ContactsCategoriesPage() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(CW)
  const { ws, orgs, categories, error, load } = useContactsBook()
  const [f, setF] = useState({ name: '', name_en: '' })
  const [busy, setBusy] = useState(false)
  const [addError, setAddError] = useState('')
  const counts = useMemo(() => {
    const m = {}
    for (const o of orgs || []) if (o.category_id) m[o.category_id] = (m[o.category_id] || 0) + 1
    return m
  }, [orgs])

  if (!canSection('contacts', 'view')) return <p className="text-sm text-text-secondary" dir={dir}>{w.noAccess}</p>
  const canManage = canSection('contacts', 'manage')

  async function add(e) {
    e.preventDefault()
    if (!f.name.trim()) return
    setBusy(true); setAddError('')
    const out = await saveCategory(ws, null, { ...f, is_active: true })
    setBusy(false)
    if (out.error) { setAddError(out.error); return }
    setF({ name: '', name_en: '' })
    load()
  }

  return (
    <div className="max-w-4xl space-y-4" dir={dir} lang={lang}>
      <Link to="/contacts" className="text-xs text-text-secondary hover:text-text">{w.back}</Link>
      <PageHeader title={w.categoriesTitle} subtitle={w.categoriesSubtitle} />
      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

      {orgs === null ? <Skeleton className="h-40" /> : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              <th className="text-start font-medium px-3 py-2">{w.catName}</th>
              <th className="text-start font-medium px-3 py-2">{w.catNameEn}</th>
              <th className="text-start font-medium px-3 py-2">{w.catSuppliers}</th>
              <th className="text-start font-medium px-3 py-2">{w.statusFilter}</th>
              <th className="px-3 py-2"><span className="sr-only">{w.save}</span></th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {categories.map(c => <Row key={`${c.id}:${c.name}:${c.name_en}:${c.is_active}`} ws={ws} c={c} count={counts[c.id] || 0} canManage={canManage} onSaved={load} />)}
              {!categories.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-text-tertiary">{w.noCategories}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <form onSubmit={add} className="flex flex-wrap gap-2 items-start">
          <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={w.catNamePlaceholder} aria-label={w.catName} className={`${field} flex-1 min-w-[12rem]`} dir="auto" />
          <input value={f.name_en} onChange={e => setF({ ...f, name_en: e.target.value })} placeholder={w.catNameEn} aria-label={w.catNameEn} className={`${field} flex-1 min-w-[12rem]`} dir="ltr" />
          <Button type="submit" size="sm" disabled={busy || !f.name.trim()}>{w.addCategory}</Button>
          {addError && <p className="basis-full text-xs text-red-600" dir="auto">{addError}</p>}
        </form>
      )}
      <p className="text-[11px] text-text-tertiary">{w.catNote}</p>
    </div>
  )
}
