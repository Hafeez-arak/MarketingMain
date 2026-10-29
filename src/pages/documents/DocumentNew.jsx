import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { FILE_ACCEPT, LINK_KINDS, LINK_READY, canCreateKind, defaultTitle, fileProblem, typeName } from '../../lib/documents/logic'
import { createDocument } from '../../lib/documents/client'
import { DW } from './words'
import { useDocumentsBase, field, linkName } from './useDocumentsBase'
import { Field, NoAccess } from './parts'

// ─── Documents → Upload (v2) ───────────────────────────────────────────────
// 2026-10-29, dev/erp-pilot/DOCUMENTS.md. His upload step: the type, who the
// document is for, an optional name and the file. The document is made as a
// draft with its first version waiting; the next screen checks the data and
// confirms. A link from an employee's page brings ?employee=…; from a
// supplier's, ?supplier=….

export function DocumentNew() {
  const { sectionLevel } = useAuth()
  const level = sectionLevel('documents')
  const { t: w, lang, dir } = useT(DW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const base = useDocumentsBase()
  const { ws } = base
  const fromEmployee = params.get('employee') || ''
  const fromSupplier = params.get('supplier') || ''
  const [f, setF] = useState({ type_id: '', link_kind: '', employee_id: fromEmployee, supplier_id: fromSupplier, title: '', file: null })
  const [errors, setErrors] = useState({})
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); setMsg('') }

  if (!level) return <NoAccess />
  const types = (base.base?.types || []).filter(t => t.is_active && t.link_kinds.some(k => canCreateKind(k, level) && LINK_READY[k]))
  const type = types.find(t => t.id === f.type_id)
  // The kinds this type allows, that the person may create and that exist yet.
  const kinds = type ? LINK_KINDS.filter(k => type.link_kinds.includes(k) && canCreateKind(k, level)) : []
  const kind = f.link_kind && kinds.includes(f.link_kind) ? f.link_kind : (fromEmployee && kinds.includes('employee') ? 'employee' : fromSupplier && kinds.includes('supplier') ? 'supplier' : (kinds.find(k => LINK_READY[k]) || ''))
  const employees = base.base?.employees || []
  const suppliers = base.base?.suppliers || []

  function pickFile(e) {
    const file = e.target.files?.[0] || null
    const problem = fileProblem(file)
    if (problem) { e.target.value = ''; setErrors(x => ({ ...x, file: w.errors[problem] })); set('file', null); return }
    set('file', file)
  }

  async function submit(e) {
    e.preventDefault()
    const errs = {}
    if (!type) errs.type_id = w.errors.chooseType
    if (type && kind === 'employee' && !f.employee_id) errs.employee_id = w.errors.chooseLink
    if (type && kind === 'supplier' && !f.supplier_id) errs.supplier_id = w.errors.chooseLink
    if (Object.keys(errs).length) { setErrors(errs); return }
    const who = linkName({ link_kind: kind, employee_id: f.employee_id, supplier_id: f.supplier_id }, base, lang, w)
    const title = f.title.trim() || defaultTitle(type, kind === 'company' ? '' : who, lang)
    setBusy(true)
    const out = await createDocument(ws, {
      type_id: type.id, link_kind: kind, employee_id: f.employee_id, supplier_id: f.supplier_id, title,
      confidential: type.confidential_default && level === 'manage', file: f.file,
    })
    setBusy(false)
    if (out.error) { setMsg(out.error); return }
    navigate(`/documents/review?id=${out.doc.id}`)
  }

  return (
    <div className="max-w-3xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.newTitle} subtitle={w.newSubtitle} />
      {base.base && !types.length ? <p className="text-sm text-text-tertiary">{w.noTypes}</p> : (
        <form onSubmit={submit} className="bg-white border border-border rounded-lg p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={`${w.fType} *`} error={errors.type_id} hint={w.fTypeHint}>
              <select value={f.type_id} onChange={e => set('type_id', e.target.value)} className={field} required>
                <option value="">{w.fTypePh}</option>
                {types.map(t => <option key={t.id} value={t.id}>{typeName(t, lang)}</option>)}
              </select>
            </Field>
            <Field label={w.fFile} error={errors.file} hint={w.fFileHint}>
              <input type="file" accept={FILE_ACCEPT} onChange={pickFile} className={field} />
            </Field>
          </div>

          {type && (
            <div className="space-y-3">
              <div>
                <span className="text-[11px] text-text-secondary">{w.fFor}</span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                  {LINK_KINDS.filter(k => type.link_kinds.includes(k)).map(k => {
                    const allowed = canCreateKind(k, level) && LINK_READY[k]
                    return (
                      <label key={k} className={`text-sm inline-flex items-center gap-1.5 ${allowed ? '' : 'text-text-tertiary'}`}>
                        <input type="radio" name="link" checked={kind === k} disabled={!allowed} onChange={() => set('link_kind', k)} />
                        {w.links[k]}{!LINK_READY[k] && <span className="text-[11px]"> · {w.assetWaits}</span>}
                      </label>
                    )
                  })}
                </div>
                {!kinds.some(k => LINK_READY[k]) && <p className="text-[11px] text-red-600 mt-1">{w.noKindForType}</p>}
              </div>
              {kind === 'employee' && (
                <Field label={`${w.fEmployee} *`} error={errors.employee_id}>
                  <select value={f.employee_id} onChange={e => set('employee_id', e.target.value)} className={field}>
                    <option value="">{w.fPick}</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{[e.employee_no, (lang === 'ar' && e.name_ar) || e.name_en].filter(Boolean).join(' · ')}</option>)}
                  </select>
                </Field>
              )}
              {kind === 'supplier' && (
                <Field label={`${w.fSupplier} *`} error={errors.supplier_id}>
                  <select value={f.supplier_id} onChange={e => set('supplier_id', e.target.value)} className={field}>
                    <option value="">{w.fPick}</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{(lang === 'ar' && s.name_ar) || s.name}</option>)}
                  </select>
                </Field>
              )}
            </div>
          )}

          <Field label={w.fTitle} hint={w.fTitleHint}>
            <input value={f.title} onChange={e => set('title', e.target.value)} maxLength={200} className={field} dir="auto" />
          </Field>
          {(msg || base.error) && <p className="text-xs text-red-600" dir="auto" role="alert">{msg || base.error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !kind}>{busy ? w.uploading : w.uploadBtn}</Button>
            <Button type="button" variant="ghost" onClick={() => navigate(-1)}>{w.cancel}</Button>
          </div>
        </form>
      )}
    </div>
  )
}
