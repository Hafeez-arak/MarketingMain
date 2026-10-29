import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { nameOf, expiringDocs, riyadhToday } from '../../lib/hr/logic'
import { daysLeft, typeName } from '../../lib/documents/logic'
import { fetchDocuments } from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, fmtDate, STATE_TONE } from './useHrBase'
import { ErrorText, Pill } from './parts'

// ─── HR → Expiring papers (v2) ─────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/HR.md; reads from Documents since 2026-10-29.
// Every paper of a person still employed that has expired or is within its
// type's alert days (Documents → Document types), soonest first. Papers are
// personal: the page asks for Manage (lib/modules.js) and the database
// reads them only for those who may.

export function HrDocuments() {
  const { t, lang, dir } = useT(HW)
  const { ws, employees, error } = useHrBase()
  const [docs, setDocs] = useState(null)
  const [typesById, setTypesById] = useState({})
  const [loadError, setLoadError] = useState('')
  const today = riyadhToday()

  useEffect(() => {
    if (!ws) return
    let cancelled = false
    fetchDocuments(ws).then(out => { if (!cancelled) { setDocs(out.rows); setTypesById(Object.fromEntries(out.types.map(x => [x.id, x]))); setLoadError(out.error || '') } })
    return () => { cancelled = true }
  }, [ws])

  const rows = docs && employees ? expiringDocs(docs, employees, typesById, today) : null

  return (
    <div className="max-w-4xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={t.documentsTitle} subtitle={t.documentsSubtitle()} />
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
              const left = daysLeft(d, today)
              return (
                <tr key={d.id}>
                  <td className="px-3 py-2"><Link className="hover:underline" to={`/hr/employee?id=${d.employee_id}`}>{nameOf(employees.find(e => e.id === d.employee_id), lang)}</Link></td>
                  <td className="px-3 py-2"><Link className="hover:underline" to={`/documents/document?id=${d.id}`}>{typeName(typesById[d.type_id], lang) || d.title}</Link></td>
                  <td className="px-3 py-2"><bdi dir="ltr">{d.number}</bdi></td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(d.expiry_date, lang)}</td>
                  <td className="px-3 py-2"><Pill tone={STATE_TONE[left < 0 ? 'expired' : 'soon']}>{left < 0 ? `${t.docStates.expired} ${t.expiredAgo(-left)}` : t.expiresIn(left)}</Pill></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
