import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT, fmtDay } from '../../lib/i18n'
import { FILE_ACCEPT, alertSchedule, canManageDoc, docState, fileProblem, isRestricted, riyadhToday, typeName } from '../../lib/documents/logic'
import {
  fetchDocument, fetchVersions, fetchAlerts, fetchTaskStates, fetchAccessLog, fetchHistory, renewDocument, saveDetails, archiveDocument, fileUrl,
} from '../../lib/documents/client'
import { DW } from './words'
import { useDocumentsBase, field, linkName } from './useDocumentsBase'
import { StateBadge, ConfidentialChip, DaysLeft, DateText, Field, NoAccess } from './parts'

// ─── Documents → one document (v2) ─────────────────────────────────────────
// 2026-10-29, dev/erp-pilot/DOCUMENTS.md. His document page: its data (those
// of the current version), the actions (review and confirm a waiting version,
// renew with a new file, download, archive with a reason), the alert and
// renewal schedule with what has happened, every version (never deleted)
// with where each field came from, who opened it (confidential and employee
// documents) and the history.

function Card({ title, children, className = '' }) {
  return (
    <section className={`bg-white border border-border rounded-lg p-5 ${className}`}>
      <h2 className="text-sm font-semibold text-text mb-3">{title}</h2>
      {children}
    </section>
  )
}

export function DocumentPage() {
  const { sectionLevel } = useAuth()
  const level = sectionLevel('documents')
  const { t: w, lang, dir } = useT(DW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const base = useDocumentsBase()
  const { ws, typesById, peopleById } = base
  const [data, setData] = useState(null)   // { doc, versions, alerts, taskStates, access, history }
  const [missing, setMissing] = useState(false)
  const [msg, setMsg] = useState({ ok: '', error: '' })
  const [busy, setBusy] = useState(false)
  const [details, setDetails] = useState(null)
  const [archiveWhy, setArchiveWhy] = useState('')
  const [renewFile, setRenewFile] = useState(null)
  const [fileError, setFileError] = useState('')
  const today = riyadhToday()

  const load = useCallback(async () => {
    if (!ws || !id) return
    const d = await fetchDocument(ws, id)
    if (d.error || !d.doc) { setMissing(true); return }
    const restricted = isRestricted(d.doc)
    const [v, a, h, log] = await Promise.all([
      fetchVersions(ws, id), fetchAlerts(ws, id), fetchHistory(ws, id), restricted ? fetchAccessLog(ws, id) : Promise.resolve({ rows: null }),
    ])
    const ts = await fetchTaskStates(ws, a.rows.filter(x => x.kind === 'task').map(x => x.task_id))
    setData({ doc: d.doc, versions: v.rows, alerts: a.rows, taskStates: ts.states, history: h.rows, access: log.rows })
    setDetails({ title: d.doc.title, responsible_id: d.doc.responsible_id || '', confidential: d.doc.confidential, notes: d.doc.notes || '' })
  }, [ws, id])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!level) return <NoAccess />
  if (missing) return <p className="text-sm text-text-tertiary p-6" dir={dir}>{w.docNotFound} <Link to="/documents" className="underline">{w.title}</Link></p>
  if (!data || !base.base) return <div className="max-w-5xl"><Skeleton className="h-96" /></div>

  const { doc, versions, alerts, taskStates, access, history } = data
  const type = typesById[doc.type_id]
  const state = docState(doc, type, today)
  const manage = canManageDoc(doc, level) && !doc.archived_at
  const current = versions.find(v => v.status === 'current')
  const pending = versions.find(v => v.status === 'pending')
  const who = linkName(doc, base, lang, w)
  const restricted = isRestricted(doc)
  const schedule = alertSchedule(doc, type, alerts, today)
  const personName = uid => peopleById[uid]?.name || '—'
  const canConfidential = level === 'manage'
  const flash = (ok, error = '') => setMsg({ ok, error })

  async function open(v, download = false) {
    const r = await fileUrl(v.id, { download })
    if (r.error) { flash('', r.error); return }
    window.open(r.url, '_blank', 'noopener')
    if (restricted) await load()   // the opening is in the log now
  }

  async function renew(e) {
    e.preventDefault()
    setBusy(true)
    const out = await renewDocument(ws, doc, renewFile)
    setBusy(false)
    if (out.error) { flash('', out.error); return }
    navigate(`/documents/review?id=${doc.id}`)
  }

  async function saveDet(e) {
    e.preventDefault()
    setBusy(true)
    const out = await saveDetails(ws, doc.id, details)
    setBusy(false)
    if (out.error) { flash('', out.error); return }
    await load(); flash(w.savedDetails)
  }

  async function archive(e) {
    e.preventDefault()
    if (!window.confirm(w.archiveConfirm)) return
    setBusy(true)
    const out = await archiveDocument(ws, doc, pending, archiveWhy)
    setBusy(false)
    if (out.error) { flash('', out.error); return }
    setArchiveWhy(''); await load(); flash('')
  }

  const row = (k, v) => (v || v === 0) ? (
    <div className="flex gap-3 py-1.5 border-b border-border last:border-0 text-sm"><dt className="w-40 shrink-0 text-text-tertiary text-xs pt-0.5">{k}</dt><dd className="min-w-0" dir="auto">{v}</dd></div>
  ) : null

  return (
    <div className="max-w-5xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={<><bdi>{doc.title}</bdi>{doc.confidential && <> <ConfidentialChip /></>}</>} subtitle={<><bdi dir="ltr">{doc.document_no}</bdi> · <bdi>{typeName(type, lang)}</bdi>{doc.issuer ? <> · <bdi>{doc.issuer}</bdi></> : null} · {w.responsibleLine(personName(doc.responsible_id))}</>}>
        <StateBadge state={state} />
        {manage && !doc.confirmed_at && <Button size="sm" onClick={() => navigate(`/documents/review?id=${doc.id}`)}>{w.reviewAndConfirm}</Button>}
        {manage && doc.confirmed_at && pending && <Button size="sm" onClick={() => navigate(`/documents/review?id=${doc.id}`)}>{w.confirmNew}</Button>}
        {current?.file_path && <Button size="sm" variant="secondary" onClick={() => open(current, true)}>{w.downloadFile}</Button>}
      </PageHeader>
      {(msg.ok || msg.error) && <p className={`text-xs ${msg.error ? 'text-red-600' : 'text-emerald-700'}`} dir="auto" role="alert">{msg.error || msg.ok}</p>}

      <Card title={w.title}>
        <dl>
          {row(w.kNumber, doc.number ? <bdi dir="ltr">{doc.number}</bdi> : null)}
          {row(w.kIssue, doc.issue_date ? <DateText date={doc.issue_date} /> : null)}
          {row(w.kExpiry, doc.expiry_date ? <><DateText date={doc.expiry_date} /> · <DaysLeft doc={doc} today={today} state={state} /></> : (doc.confirmed_at ? w.noExpiry : null))}
          {row(w.kFor, <>{w.links[doc.link_kind]}{who && doc.link_kind !== 'company' ? `: ${who}` : ''}</>)}
          {row(w.kNotes, doc.notes)}
          {doc.archived_at && row(w.kArchived, w.archivedOn(fmtDay(doc.archived_at, lang, { day: 'numeric', month: 'short', year: 'numeric' }), doc.archive_reason))}
        </dl>
        {manage && doc.confirmed_at && details && (
          <details className="mt-3">
            <summary className="text-xs underline cursor-pointer">{w.editDetails}</summary>
            <form onSubmit={saveDet} className="grid sm:grid-cols-2 gap-3 mt-3 items-end">
              <Field label={`${w.fTitle} *`}><input value={details.title} onChange={e => setDetails(x => ({ ...x, title: e.target.value }))} maxLength={200} required className={field} dir="auto" /></Field>
              <Field label={w.fResponsible}>
                <select value={details.responsible_id} onChange={e => setDetails(x => ({ ...x, responsible_id: e.target.value }))} className={field}>
                  <option value="">{w.pickPerson}</option>
                  {base.base.people.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label={w.fConfidential}>
                <select value={details.confidential ? '1' : '0'} onChange={e => setDetails(x => ({ ...x, confidential: e.target.value === '1' }))} className={field} disabled={!canConfidential}>
                  <option value="0">{w.ordinary}</option>
                  {(canConfidential || details.confidential) && <option value="1">{w.secret}</option>}
                </select>
              </Field>
              <Field label={w.fNotes}><input value={details.notes} onChange={e => setDetails(x => ({ ...x, notes: e.target.value }))} maxLength={2000} className={field} dir="auto" /></Field>
              <div><Button type="submit" size="sm" disabled={busy}>{w.saveDetails}</Button></div>
            </form>
            <p className="text-[11px] text-text-tertiary mt-2">{w.detailsHint}</p>
          </details>
        )}
        {manage && doc.confirmed_at && !pending && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 items-start">
            <details>
              <summary className="text-xs underline cursor-pointer">{w.renew}</summary>
              <form onSubmit={renew} className="flex flex-wrap items-center gap-2 mt-2">
                <input type="file" accept={FILE_ACCEPT} aria-label={w.fFile} className={field}
                  onChange={e => { const file = e.target.files?.[0] || null; const p = fileProblem(file); if (p) { e.target.value = ''; setRenewFile(null); setFileError(w.errors[p]) } else { setRenewFile(file); setFileError('') } }} />
                <Button type="submit" size="sm" disabled={busy}>{renewFile ? w.renewBtn : w.renewNoFile}</Button>
                {fileError && <span className="text-[11px] text-red-600">{fileError}</span>}
              </form>
            </details>
            <details>
              <summary className="text-xs underline cursor-pointer">{w.archive}</summary>
              <form onSubmit={archive} className="flex flex-wrap items-center gap-2 mt-2">
                <input value={archiveWhy} onChange={e => setArchiveWhy(e.target.value)} required maxLength={500} placeholder={w.archiveReason} aria-label={w.archiveReason} className={field} dir="auto" />
                <Button type="submit" size="sm" variant="danger" disabled={busy || !archiveWhy.trim()}>{w.archiveBtn}</Button>
              </form>
            </details>
          </div>
        )}
        {manage && doc.confirmed_at && pending && (
          <div className="mt-4"><details>
            <summary className="text-xs underline cursor-pointer">{w.archive}</summary>
            <form onSubmit={archive} className="flex flex-wrap items-center gap-2 mt-2">
              <input value={archiveWhy} onChange={e => setArchiveWhy(e.target.value)} required maxLength={500} placeholder={w.archiveReason} aria-label={w.archiveReason} className={field} dir="auto" />
              <Button type="submit" size="sm" variant="danger" disabled={busy || !archiveWhy.trim()}>{w.archiveBtn}</Button>
            </form>
          </details></div>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title={w.alertsTitle}>
          {!doc.expiry_date ? <p className="text-sm text-text-tertiary">{w.alertsNone}</p> : (
            <>
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                  {['when', 'what', 'status'].map(c => <th key={c} className="text-start font-medium py-1.5 pe-2">{w.alertCols[c]}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {schedule.map(r => (
                    <tr key={`${r.kind}-${r.days}`} className="align-top">
                      <td className="py-1.5 pe-2">{w.beforeDays(r.days, r.at)}</td>
                      <td className="py-1.5 pe-2">{r.kind === 'task' ? (r.taskId ? <Link to={`/tasks?id=${r.taskId}`} className="underline">{w.taskWhatOpen}</Link> : w.taskWhat) : w.noticeWhat}</td>
                      <td className="py-1.5">{r.kind === 'task' && r.taskId && taskStates[r.taskId] ? w.taskStates[taskStates[r.taskId]] : w.alertStates[r.status]}</td>
                    </tr>
                  ))}
                  <tr><td className="py-1.5 pe-2">{w.afterExpiry}</td><td className="py-1.5 pe-2">{w.afterExpiryWhat}</td><td className="py-1.5">{state === 'expired' ? '✓' : '—'}</td></tr>
                </tbody>
              </table>
              {!schedule.length && <p className="text-[11px] text-text-tertiary mt-2">{w.alertsNoRule}</p>}
              {!doc.responsible_id && <p className="text-[11px] text-yellow-700 mt-2">{w.alertsNoPerson}</p>}
            </>
          )}
          <p className="text-[11px] text-text-tertiary mt-3">{w.alertsHint}</p>
        </Card>

        <Card title={w.versionsTitle}>
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              {['version', 'period', 'uploaded', 'file'].map(c => <th key={c} className="text-start font-medium py-1.5 pe-2">{w.versionCols[c]}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {versions.map(v => (
                <tr key={v.id} className="align-top">
                  <td className="py-1.5 pe-2 whitespace-nowrap">{v.version_no} <span className="text-text-tertiary text-xs">({w.versionStatus[v.status]})</span></td>
                  <td className="py-1.5 pe-2 whitespace-nowrap tabular-nums"><bdi dir="ltr">{v.issue_date || '—'} ← {v.expiry_date || '—'}</bdi></td>
                  <td className="py-1.5 pe-2">
                    <bdi>{v.uploaded_by ? personName(v.uploaded_by) : '—'}</bdi> · <bdi dir="ltr" className="tabular-nums">{String(v.created_at).slice(0, 10)}</bdi>
                    {v.confirmed_by && <div className="text-[11px] text-text-tertiary">{w.confirmedBy(personName(v.confirmed_by))}</div>}
                    {Object.keys(v.sources || {}).length > 0 && <div className="text-[11px] text-text-tertiary">{Object.entries(v.sources).map(([k, s]) => `${w.fieldNames[k]}: ${w.sources[s]}`).join(' · ')}</div>}
                  </td>
                  <td className="py-1.5">
                    {v.file_path ? <button type="button" className="underline" onClick={() => open(v)}>{v.file_type === 'application/pdf' ? w.pdf : w.picture}</button> : <span className="text-text-tertiary">{w.noFileShort}</span>}
                    {v.file_bucket === 'hr-papers' && <div className="text-[11px] text-text-tertiary">{w.fromHr}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {access && (
        <Card title={w.accessTitle}>
          {!access.length ? <p className="text-sm text-text-tertiary">{w.accessNone}</p> : (
            <ul className="text-sm space-y-1">
              {access.map(a => (
                <li key={a.id}><bdi dir="ltr" className="tabular-nums text-text-tertiary">{fmtDay(a.at, lang, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</bdi> · <bdi>{personName(a.user_id)}</bdi> {a.action === 'download' ? w.downloaded : w.opened} {w.versionN(a.version_no)}</li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-text-tertiary mt-3">{w.accessNote}</p>
        </Card>
      )}

      {level === 'manage' && (
        <Card title={w.historyTitle}>
          {!history.length ? <p className="text-sm text-text-tertiary">{w.historyNone}</p> : (
            <ul className="text-sm space-y-1.5">
              {history.map(h => (
                <li key={h.id}>
                  <bdi dir="ltr" className="tabular-nums text-text-tertiary">{String(h.at).slice(0, 16).replace('T', ' ')}</bdi> · <bdi>{personName(h.actor)}</bdi> · {h.action === 'insert' ? w.created : h.action === 'delete' ? w.deleted : w.changed} <bdi>{h.label}</bdi>
                  {h.action === 'update' && <span className="text-[11px] text-text-tertiary"> — {Object.keys(h.changes).join(', ')}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
