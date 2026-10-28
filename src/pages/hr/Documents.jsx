import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { nameOf, docState, expiringDocs, riyadhToday, DOC_WARN_DAYS } from '../../lib/hr/logic'
import { fetchDocuments } from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, fmtDate, STATE_TONE } from './useHrBase'
import { ErrorText, Pill } from './parts'

// ─── HR → Expiring papers (v2) ─────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/HR.md. Every paper of a person still employed
// that has expired or expires within DOC_WARN_DAYS (his 60), soonest first.
// Papers are personal: the page asks for Work (lib/modules.js) and the
// database reads them only for Work and up.

export function HrDocuments() {
  const { t, lang, dir } = useT(HW)
  const { ws, employees, error } = useHrBase()
  const [docs, setDocs] = useState(null)
  const [loadError, setLoadError] = useState('')
  const today = riyadhToday()

  useEffect(() => {
    if (!ws) return
    let cancelled = false
    fetchDocuments(ws).then(out => { if (!cancelled) { setDocs(out.rows); setLoadError(out.error || '') } })
    return () => { cancelled = true }
  }, [ws])

  const rows = docs && employees ? expiringDocs(docs, employees, today) : null

  return (
    <div className="max-w-4xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={t.documentsTitle} subtitle={t.documentsSubtitle(DOC_WARN_DAYS)} />
      <ErrorText error={error || loadError} />
      {rows === null ? <Skeleton className="h-40" /> : !rows.length ? <p className="text-sm text-text-tertiary">{t.nothingYet}</p> : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              <th className="text-start font-medium px-3 py-2">{t.employee}</th>
              <th className="text-start font-medium px-3 py-2">{t.docType}</th>
              <th className="text-start font-medium px-3 py-2">{t.docNumber}</th>
              <th className="text-start font-medium px-3 py-2">{t.expiryDate}</th>
              <th className="text-start font-medium px-3 py-2">{t.status}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">{rows.map(d => {
              const st = docState(d, today)
              return (
                <tr key={d.id}>
                  <td className="px-3 py-2"><Link className="hover:underline" to={`/hr/employee?id=${d.employee_id}`}>{nameOf(employees.find(e => e.id === d.employee_id), lang)}</Link></td>
                  <td className="px-3 py-2">{t.docTypes[d.doc_type]}{d.notes && <span className="block text-[11px] text-text-tertiary" dir="auto">{d.notes}</span>}</td>
                  <td className="px-3 py-2"><bdi dir="ltr">{d.doc_number}</bdi></td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(d.expiry_date, lang)}</td>
                  <td className="px-3 py-2"><Pill tone={STATE_TONE[st.state]}>{st.days < 0 ? `${t.docStates.expired} ${t.expiredAgo(-st.days)}` : t.expiresIn(st.days)}</Pill></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
