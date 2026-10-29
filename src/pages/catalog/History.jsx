import { useEffect, useState } from 'react'
import { Spinner } from '../../components/ui/index'
import { useT, fmtDay } from '../../lib/i18n'
import { describeChange, fieldName } from '../../lib/catalog/logic'
import { fetchAudit, fetchPeople } from '../../lib/catalog/client'
import { KW } from './words'

// ─── Catalog: the history of one item ──────────────────────────────────────
// 2026-10-30. Every change the database kept (catalog_audit) to the item and
// its specifications: what, who, when, and the fields that changed. A spec's
// field is shown by name.

export function History({ ws, itemId, fields = [], refreshKey = 0 }) {
  const { t, lang } = useT(KW)
  const [rows, setRows] = useState(null)
  const [people, setPeople] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ws || !itemId) return
    let cancelled = false
    Promise.all([fetchAudit(ws, itemId), fetchPeople(ws)]).then(([a, p]) => {
      if (cancelled) return
      setRows(a.rows); setPeople(p.rows); setError(a.error || '')
    })
    return () => { cancelled = true }
  }, [ws, itemId, refreshKey])

  const who = id => people.find(p => p.user_id === id)?.name || t.someone
  const show = (key, v) => {
    if (v === null || v === undefined || v === '') return '—'
    if (key === 'field_id') return fieldName(fields.find(f => f.id === v), lang) || '—'
    if (typeof v === 'boolean') return v ? t.yes : t.no
    if (key === 'datasheet_path' || key === 'image_path') return String(v).split('/').pop()
    return String(v)
  }

  if (rows === null) return <Spinner size="sm" />
  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-600" dir="auto" role="alert">{error}</p>}
      {!rows.length ? <p className="text-xs text-text-tertiary">{t.noHistory}</p> : (
        <ul className="divide-y divide-border border border-border bg-white">
          {rows.map(r => {
            const changes = describeChange(r)
            if (r.action === 'update' && !changes.length) return null
            const data = r.new_data || r.old_data || {}
            return (
              <li key={r.id} className="px-3 py-2 text-xs">
                <p className="text-text">
                  <span className="font-medium">{t.historyActions[r.action]}</span> · {t.historyTables[r.table_name] || r.table_name}
                  {r.table_name === 'catalog_item_specs' && <> · <bdi>{fieldName(fields.find(f => f.id === data.field_id), lang)}</bdi></>}
                  <span className="text-text-tertiary"> · {t.changedBy(who(r.changed_by), fmtDay(r.changed_at, lang))}</span>
                </p>
                {changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-text-secondary">
                    {changes.filter(c => !(r.table_name === 'catalog_item_specs' && c.field === 'field_id')).slice(0, 12).map(c => (
                      <li key={c.field} dir="auto">
                        {t.historyFields[c.field] || c.field}:{' '}
                        {r.action === 'update' ? <><span className="line-through text-text-tertiary">{show(c.field, c.from)}</span> → </> : null}
                        <span className="text-text">{show(c.field, c.to)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
