import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { LINK_KINDS, LINK_READY, canCreateKind, canManageDoc, dateFromInputs, gregorianToHijri, isRestricted, reviewProblems, sourcesFor, typeName } from '../../lib/documents/logic'
import { fetchDocument, fetchVersions, saveReview, discardPending, fileUrl } from '../../lib/documents/client'
import { DW } from './words'
import { useDocumentsBase, field, docHref } from './useDocumentsBase'
import { Field, NoAccess } from './parts'

// ─── Documents → Review and confirm (v2) ───────────────────────────────────
// 2026-10-29, dev/erp-pilot/DOCUMENTS.md. His review screen: the pending
// version's data beside the file's preview. Number, issuer, issue and expiry
// dates (Gregorian, or Hijri from which the Gregorian is worked out), the
// document's name, who is responsible, confidentiality and notes. A draft
// can also change its type and link. "Confirm and save" makes the version
// current (the type's required fields must be filled); "Save draft" keeps the
// work. The data is typed in: reading it from the file waits on the owner.

const hijriText = iso => { try { const h = gregorianToHijri(iso); return `${h.y}/${String(h.m).padStart(2, '0')}/${String(h.d).padStart(2, '0')}` } catch { return '' } }

export function DocumentReview() {
  const { sectionLevel } = useAuth()
  const level = sectionLevel('documents')
  const { t: w, lang, dir } = useT(DW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const base = useDocumentsBase()
  const { ws, typesById } = base
  const [doc, setDoc] = useState(null)
  const [ver, setVer] = useState(null)
  const [missing, setMissing] = useState(false)
  const [f, setF] = useState(null)
  const [errors, setErrors] = useState({})
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState({ state: 'idle', url: '' })

  const load = useCallback(async () => {
    if (!ws || !id) return
    const [d, v] = await Promise.all([fetchDocument(ws, id), fetchVersions(ws, id)])
    if (d.error || !d.doc) { setMissing(true); return }
    const pending = v.rows.find(x => x.status === 'pending')
    if (!pending) { setMissing(true); return }
    setDoc(d.doc); setVer(pending)
    setF({
      title: d.doc.title, type_id: d.doc.type_id, link_kind: d.doc.link_kind, employee_id: d.doc.employee_id || '', supplier_id: d.doc.supplier_id || '',
      responsible_id: d.doc.responsible_id || '', confidential: d.doc.confidential, notes: d.doc.notes || '',
      number: pending.number || '', issuer: pending.issuer || '', issue_date: pending.issue_date || '', expiry_date: pending.expiry_date || '',
      issue_hijri: '', expiry_hijri: '',
    })
  }, [ws, id])
  useEffect(() => { queueMicrotask(load) }, [load])

  // The file's preview (opening a confirmed restricted document logs it).
  const versionId = ver?.id
  const hasFile = Boolean(ver?.file_path)
  useEffect(() => {
    if (!versionId || !hasFile) return undefined
    let alive = true
    queueMicrotask(() => alive && setPreview({ state: 'loading', url: '' }))
    fileUrl(versionId).then(r => { if (alive) setPreview(r.url ? { state: 'ready', url: r.url } : { state: 'failed', url: '' }) })
    return () => { alive = false }
  }, [versionId, hasFile])

  if (!level) return <NoAccess />
  if (missing) return <p className="text-sm text-text-tertiary p-6" dir={dir}>{w.docNotFound} <Link to="/documents" className="underline">{w.title}</Link></p>
  if (!doc || !f || !base.base) return <div className="max-w-6xl"><Skeleton className="h-96" /></div>
  if (!canManageDoc(doc, level)) return <NoAccess />

  const draft = !doc.confirmed_at
  const type = typesById[f.type_id] || typesById[doc.type_id]
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); setMsg('') }
  const types = base.base.types.filter(t => t.is_active || t.id === doc.type_id)
  const kinds = type ? LINK_KINDS.filter(k => type.link_kinds.includes(k) && canCreateKind(k, level)) : []
  const restricted = isRestricted({ confidential: f.confidential, link_kind: f.link_kind })
  const canConfidential = level === 'manage'

  async function save(confirm) {
    const iss = dateFromInputs(f.issue_date, f.issue_hijri)
    const exp = dateFromInputs(f.expiry_date, f.expiry_hijri)
    const values = { number: f.number.trim(), issuer: f.issuer.trim(), issue_date: iss.value || null, expiry_date: exp.value || null }
    const problems = reviewProblems(type, { ...f, ...values }, { confirm })
    const errs = {}
    for (const [k, c] of Object.entries(problems)) errs[k] = w.errors[c]
    if (iss.error) errs.issue_date = w.errors[iss.error]
    if (exp.error) errs.expiry_date = w.errors[exp.error]
    if (draft && f.link_kind === 'employee' && !f.employee_id) errs.employee_id = w.errors.chooseLink
    if (draft && f.link_kind === 'supplier' && !f.supplier_id) errs.supplier_id = w.errors.chooseLink
    if (Object.keys(errs).length) { setErrors(errs); return }
    setBusy(true); setMsg('')
    const docFields = { title: f.title.trim(), responsible_id: f.responsible_id || '', notes: f.notes, confidential: f.confidential }
    if (draft) Object.assign(docFields, { type_id: f.type_id, link_kind: f.link_kind, employee_id: f.link_kind === 'employee' ? f.employee_id : '', supplier_id: f.link_kind === 'supplier' ? f.supplier_id : '', asset_id: '' })
    const out = await saveReview(ws, doc.id, docFields, values, sourcesFor(values, ver.suggestions), confirm)
    setBusy(false)
    if (out.error) { setMsg(out.error); return }
    if (confirm) navigate(docHref(doc.id))
    else { setMsg(''); await load(); setErrors({}); setMsg(w.savedDraft) }
  }

  async function discard() {
    if (!window.confirm(draft ? w.confirmDiscard : w.confirmDiscardRenewal)) return
    setBusy(true)
    const out = await discardPending(ws, doc, ver)
    setBusy(false)
    if (out.error) { setMsg(out.error); return }
    navigate(draft ? '/documents' : docHref(doc.id))
  }

  const dateBlock = (name, label, req) => {
    const hijriKey = name === 'issue_date' ? 'issue_hijri' : 'expiry_hijri'
    const shown = f[name] && !f[hijriKey] ? hijriText(f[name]) : ''
    return (
      <Field label={`${label}${req ? ' *' : ''}`} error={errors[name]} hint={shown ? w.hijriShown(shown) : ''}>
        <div className="flex gap-2">
          <input type="date" value={f[name]} onChange={e => { set(name, e.target.value); set(hijriKey, '') }} className={`${field} flex-1`} aria-label={`${label} (${w.fGregorian})`} />
          <input value={f[hijriKey]} onChange={e => set(hijriKey, e.target.value)} placeholder={w.hijriPh} className={`${field} flex-1`} dir="ltr" aria-label={`${label} (${w.fHijri})`} />
        </div>
      </Field>
    )
  }

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={draft ? w.reviewTitle : w.reviewTitleRenew(ver.version_no)} subtitle={`${doc.document_no} · ${typeName(typesById[doc.type_id], lang)}`} />
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <form onSubmit={e => e.preventDefault()} className="bg-white border border-border rounded-lg p-5 space-y-4">
          <p className="text-xs text-text-secondary bg-stone-50 border border-border rounded p-2.5">{ver.file_path ? w.fileNote : w.noFileNote}</p>
          {restricted && <p className="text-[11px] text-text-tertiary">{w.restrictedNote}</p>}

          {draft && (
            <Field label={`${w.fType} *`}>
              <select value={f.type_id} onChange={e => set('type_id', e.target.value)} className={field}>
                {types.map(t => <option key={t.id} value={t.id}>{typeName(t, lang)}</option>)}
              </select>
            </Field>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={`${w.fNumber}${type?.number_required ? ' *' : ''}`} error={errors.number}>
              <input value={f.number} onChange={e => set('number', e.target.value)} maxLength={60} className={field} dir="ltr" />
            </Field>
            <Field label={`${w.fIssuer}${type?.issuer_required ? ' *' : ''}`} error={errors.issuer}>
              <input value={f.issuer} onChange={e => set('issuer', e.target.value)} maxLength={200} className={field} dir="auto" />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {dateBlock('issue_date', w.fIssue, type?.issue_date_required)}
            {dateBlock('expiry_date', w.fExpiry, type?.expiry_required)}
          </div>
          <p className="text-[11px] text-text-tertiary -mt-2">{w.hijriHint}</p>

          <Field label={`${w.fTitle} *`} error={errors.title}>
            <input value={f.title} onChange={e => set('title', e.target.value)} maxLength={200} className={field} dir="auto" />
          </Field>

          {draft && (
            <div className="space-y-3">
              <div>
                <span className="text-[11px] text-text-secondary">{w.fFor}</span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                  {LINK_KINDS.filter(k => type?.link_kinds.includes(k)).map(k => {
                    const allowed = canCreateKind(k, level) && LINK_READY[k]
                    return (
                      <label key={k} className={`text-sm inline-flex items-center gap-1.5 ${allowed ? '' : 'text-text-tertiary'}`}>
                        <input type="radio" name="link" checked={f.link_kind === k} disabled={!allowed} onChange={() => set('link_kind', k)} />
                        {w.links[k]}{!LINK_READY[k] && <span className="text-[11px]"> · {w.assetWaits}</span>}
                      </label>
                    )
                  })}
                </div>
                {type && !kinds.includes(f.link_kind) && <p className="text-[11px] text-red-600 mt-1">{w.noKindForType}</p>}
              </div>
              {f.link_kind === 'employee' && (
                <Field label={`${w.fEmployee} *`} error={errors.employee_id}>
                  <select value={f.employee_id} onChange={e => set('employee_id', e.target.value)} className={field}>
                    <option value="">{w.fPick}</option>
                    {base.base.employees.map(e => <option key={e.id} value={e.id}>{[e.employee_no, (lang === 'ar' && e.name_ar) || e.name_en].filter(Boolean).join(' · ')}</option>)}
                  </select>
                </Field>
              )}
              {f.link_kind === 'supplier' && (
                <Field label={`${w.fSupplier} *`} error={errors.supplier_id}>
                  <select value={f.supplier_id} onChange={e => set('supplier_id', e.target.value)} className={field}>
                    <option value="">{w.fPick}</option>
                    {base.base.suppliers.map(s => <option key={s.id} value={s.id}>{(lang === 'ar' && s.name_ar) || s.name}</option>)}
                  </select>
                </Field>
              )}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={`${w.fResponsible} *`} error={errors.responsible_id} hint={w.fResponsibleHint}>
              <select value={f.responsible_id} onChange={e => set('responsible_id', e.target.value)} className={field}>
                <option value="">{w.pickPerson}</option>
                {base.base.people.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label={w.fConfidential}>
              <select value={f.confidential ? '1' : '0'} onChange={e => set('confidential', e.target.value === '1')} className={field} disabled={!canConfidential}>
                <option value="0">{w.ordinary}</option>
                {(canConfidential || f.confidential) && <option value="1">{w.secret}</option>}
              </select>
            </Field>
          </div>
          <Field label={w.fNotes}>
            <textarea value={f.notes} onChange={e => set('notes', e.target.value)} maxLength={2000} rows={2} className={field} dir="auto" />
          </Field>

          {msg && <p className={`text-xs ${msg === w.savedDraft ? 'text-emerald-700' : 'text-red-600'}`} dir="auto" role="alert">{msg}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save(true)} disabled={busy}>{w.confirmBtn}</Button>
            <Button variant="secondary" onClick={() => save(false)} disabled={busy}>{w.draftBtn}</Button>
          </div>
        </form>

        <div className="bg-white border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border text-xs">
            <span className="truncate" dir="auto">{ver.file_name || w.noFileShort}</span>
            {preview.url && <a href={preview.url} target="_blank" rel="noreferrer" className="underline shrink-0">{w.openFile}</a>}
          </div>
          {!ver.file_path ? <p className="text-sm text-text-tertiary p-6">{w.noFile}</p>
            : preview.state === 'loading' ? <p className="text-sm text-text-tertiary p-6">{w.previewing}</p>
            : preview.state === 'failed' ? <p className="text-sm text-red-600 p-6">{w.previewFailed}</p>
            : ver.file_type === 'application/pdf' ? <iframe src={preview.url} title={w.preview} className="w-full h-[70vh]" />
            : <img src={preview.url} alt={w.preview} className="w-full max-h-[70vh] object-contain" />}
          <div className="px-3 py-2 border-t border-border">
            <Button size="xs" variant="danger" onClick={discard} disabled={busy}>{draft ? w.discardDraft : w.discardRenewal}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
