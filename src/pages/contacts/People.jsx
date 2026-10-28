import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { filterPeople, displayName, otherName } from '../../lib/contacts/logic'
import { createPerson, updatePerson } from '../../lib/contacts/client'
import { CW } from './words'
import { useContactsBook, field, fieldInline } from './useContactsBook'
import { Dialog, PersonForm } from './parts'

// ─── Contacts → People (v2) ────────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CONTACTS.md. Every contact person in the
// company: under an organisation, or on their own (a freelance designer, a
// homeowner's architect). A person is put only under an active
// organisation; one under an archived organisation is shown but locked.

const SCOPES = ['all', 'with', 'alone']

export function ContactsPeoplePage() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(CW)
  const [params, setParams] = useSearchParams()
  const { ws, orgs, people, orgsById, error, load } = useContactsBook({ people: true })
  const [editing, setEditing] = useState(null) // null | {} new | row

  const q = params.get('q') || ''
  const scope = SCOPES.includes(params.get('scope')) ? params.get('scope') : 'all'
  const setParam = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const shown = useMemo(() => filterPeople(people || [], orgsById, { q, scope }), [people, orgsById, q, scope])
  const activeOrgs = useMemo(() => (orgs || []).filter(o => o.status === 'active'), [orgs])

  if (!canSection('contacts', 'view')) return <p className="text-sm text-text-secondary" dir={dir}>{w.noAccess}</p>

  const canWork = canSection('contacts', 'work')
  const locked = p => p.org_id && orgsById[p.org_id]?.status === 'archived'
  // The person's own organisation stays in the picker even when it is the
  // only thing that would keep them there.
  const choicesFor = p => (p?.org_id && !activeOrgs.some(o => o.id === p.org_id) && orgsById[p.org_id] ? [...activeOrgs, orgsById[p.org_id]] : activeOrgs)

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.peopleTitle} subtitle={w.peopleSubtitle}>
        {canWork && <Button size="sm" onClick={() => setEditing({})}>{w.newPerson}</Button>}
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        <input type="search" value={q} onChange={e => setParam('q', e.target.value)} placeholder={w.searchPeople} aria-label={w.searchPeople} className={`${field} flex-1 min-w-[14rem]`} dir="auto" />
        <select value={scope} onChange={e => setParam('scope', e.target.value === 'all' ? '' : e.target.value)} className={fieldInline} aria-label={w.cols.org}>
          {SCOPES.map(s => <option key={s} value={s}>{w.scopes[s]}</option>)}
        </select>
      </div>

      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

      {people === null ? <Skeleton className="h-64" /> : !shown.length ? (
        <p className="text-sm text-text-tertiary px-1 py-6">{people.length ? w.emptyFilter : w.emptyPeople}</p>
      ) : (
        <>
          <p className="text-[11px] text-text-tertiary">{w.peopleCount(shown.length)}</p>
          <div className="bg-white border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                <th className="text-start font-medium px-3 py-2">{w.cols.person}</th>
                <th className="text-start font-medium px-3 py-2">{w.cols.title}</th>
                <th className="text-start font-medium px-3 py-2">{w.cols.org}</th>
                <th className="text-start font-medium px-3 py-2">{w.cols.phone}</th>
                <th className="text-start font-medium px-3 py-2">{w.cols.email}</th>
                <th className="px-3 py-2"><span className="sr-only">{w.edit}</span></th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {shown.map(p => {
                  const o = orgsById[p.org_id]
                  return (
                    <tr key={p.id} className="align-top">
                      <td className="px-3 py-2 min-w-[12rem]">
                        <p className="font-medium text-text">
                          <bdi>{displayName(p, lang)}</bdi>
                          {p.is_primary && <span className="ms-2 text-[10px] uppercase tracking-wide font-semibold text-emerald-700">{w.primary}</span>}
                        </p>
                        {otherName(p, lang) && <p className="text-[11px] text-text-tertiary"><bdi>{otherName(p, lang)}</bdi></p>}
                      </td>
                      <td className="px-3 py-2 text-text-secondary" dir="auto">{p.job_title || '—'}</td>
                      <td className="px-3 py-2">
                        {o ? <Link to={`/contacts/org?id=${o.id}`} className="text-text hover:underline" dir="auto">{displayName(o, lang)}</Link>
                          : <span className="text-text-tertiary">{w.onTheirOwn}</span>}
                        {o?.status === 'archived' && <span className="ms-2 text-[10px] uppercase tracking-wide text-text-tertiary font-semibold">{w.archivedTag}</span>}
                      </td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap" dir="ltr" style={{ textAlign: 'start' }}>{p.phone || '—'}</td>
                      <td className="px-3 py-2 text-text-secondary" dir="ltr" style={{ textAlign: 'start' }}>{p.email ? <a href={`mailto:${p.email}`} className="hover:underline">{p.email}</a> : '—'}</td>
                      <td className="px-3 py-2 text-end">
                        {canWork && !locked(p) && <Button size="xs" variant="ghost" onClick={() => setEditing(p)}>{w.edit}</Button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <Dialog title={editing.id ? w.editPersonTitle : w.newPersonTitle} onClose={() => setEditing(null)}>
          <PersonForm initial={editing} orgs={choicesFor(editing)} onCancel={() => setEditing(null)}
            onSubmit={async p => {
              const out = editing.id ? await updatePerson(ws, editing.id, p) : await createPerson(ws, p)
              if (out.error) return out
              setEditing(null)
              await load()
              return out
            }} />
        </Dialog>
      )}
    </div>
  )
}
