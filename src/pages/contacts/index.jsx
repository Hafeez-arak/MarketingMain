import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { ROLES, QUICK, filterOrgs, quickCounts, displayName, otherName } from '../../lib/contacts/logic'
import { createOrg } from '../../lib/contacts/client'
import { CW } from './words'
import { useContactsBook, field, fieldInline } from './useContactsBook'
import { Dialog, OrgForm, RoleBadges, ImportDialog } from './parts'

// ─── Contacts → Organisations (v2) ─────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CONTACTS.md. Musa's Contacts (جهات الاتصال):
// one list of every organisation and individual the company deals with,
// each with its roles. Quick filters for the usual questions ("our
// suppliers"), a role and a status, and a search over names in both
// languages, numbers, city and phone. The filters live in the URL, so a
// filtered list can be linked to. Opening a row goes to its page.

export function ContactsPage() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(CW)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { ws, orgs, people, error, load } = useContactsBook({ people: true })
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)

  const q = params.get('q') || ''
  const quick = QUICK.some(x => x.key === params.get('quick')) ? params.get('quick') : 'all'
  const role = ROLES.includes(params.get('role')) ? params.get('role') : ''
  const status = ['active', 'archived', 'all'].includes(params.get('status')) ? params.get('status') : 'active'
  const setParam = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  const shown = useMemo(() => filterOrgs(orgs || [], { q, quick, role, status }), [orgs, q, quick, role, status])
  const counts = useMemo(() => quickCounts(orgs || []), [orgs])
  const primaryOf = useMemo(() => {
    const m = {}
    for (const p of people || []) if (p.is_primary && p.org_id) m[p.org_id] = p
    return m
  }, [people])

  if (!canSection('contacts', 'view')) return <p className="text-sm text-text-secondary" dir={dir}>{w.noAccess}</p>

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.title} subtitle={w.subtitle}>
        {canSection('contacts', 'manage') && <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>{w.importCsv}</Button>}
        {canSection('contacts', 'work') && <Button size="sm" onClick={() => setAdding(true)}>{w.newOrg}</Button>}
      </PageHeader>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={w.roleFilter}>
        {QUICK.map(x => (
          <button key={x.key} type="button" onClick={() => setParam('quick', x.key === 'all' ? '' : x.key)} aria-pressed={quick === x.key}
            className={`text-xs px-2.5 py-1 rounded-full border ${quick === x.key ? 'border-stone-900 bg-stone-900 text-white' : 'border-border bg-white text-text hover:border-stone-400'}`}>
            {w.quick[x.key]} <span className={quick === x.key ? 'text-white/70' : 'text-text-tertiary'}>{orgs ? counts[x.key] : ''}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input type="search" value={q} onChange={e => setParam('q', e.target.value)} placeholder={w.search} aria-label={w.search} className={`${field} flex-1 min-w-[14rem]`} dir="auto" />
        <select value={role} onChange={e => setParam('role', e.target.value)} className={fieldInline} aria-label={w.roleFilter}>
          <option value="">{w.anyRole}</option>
          {ROLES.map(r => <option key={r} value={r}>{w.roles[r]}</option>)}
        </select>
        <select value={status} onChange={e => setParam('status', e.target.value === 'active' ? '' : e.target.value)} className={fieldInline} aria-label={w.statusFilter}>
          {['active', 'archived', 'all'].map(s => <option key={s} value={s}>{w.statuses[s]}</option>)}
        </select>
      </div>

      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

      {orgs === null ? <Skeleton className="h-64" /> : !orgs.length ? (
        <p className="text-sm text-text-tertiary px-1 py-6">{w.emptyAll}</p>
      ) : (
        <>
          <p className="text-[11px] text-text-tertiary">{w.count(shown.length, orgs.length)}</p>
          {!shown.length ? <p className="text-sm text-text-tertiary px-1 py-6">{w.emptyFilter}</p> : (
            <div className="bg-white border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                  <th className="text-start font-medium px-3 py-2">{w.cols.name}</th>
                  <th className="text-start font-medium px-3 py-2">{w.cols.roles}</th>
                  <th className="text-start font-medium px-3 py-2">{w.cols.city}</th>
                  <th className="text-start font-medium px-3 py-2">{w.cols.vat}</th>
                  <th className="text-start font-medium px-3 py-2">{w.cols.contact}</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {shown.map(o => {
                    const contact = primaryOf[o.id]
                    const open = () => navigate(`/contacts/org?id=${o.id}`)
                    return (
                      <tr key={o.id} role="link" tabIndex={0} onClick={open}
                        onKeyDown={e => { if (e.key === 'Enter') open() }}
                        className="hover:bg-stone-50 cursor-pointer focus:outline-none focus-visible:bg-stone-50 align-top">
                        <td className="px-3 py-2 min-w-[14rem]">
                          <p className="font-medium text-text">
                            <bdi>{displayName(o, lang)}</bdi>
                            {o.status === 'archived' && <span className="ms-2 text-[10px] uppercase tracking-wide text-text-tertiary font-semibold">{w.archivedTag}</span>}
                          </p>
                          {otherName(o, lang) && <p className="text-[11px] text-text-tertiary"><bdi>{otherName(o, lang)}</bdi></p>}
                          {o.kind === 'individual' && <p className="text-[11px] text-text-tertiary">{w.kinds.individual}</p>}
                        </td>
                        <td className="px-3 py-2"><RoleBadges roles={o.roles} /></td>
                        <td className="px-3 py-2 text-text-secondary whitespace-nowrap" dir="auto">{o.city || '—'}</td>
                        <td className="px-3 py-2 text-text-secondary tabular-nums whitespace-nowrap" dir="ltr">{o.vat_number || '—'}</td>
                        <td className="px-3 py-2 text-text-secondary" dir="auto">{contact ? displayName(contact, lang) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {adding && (
        <Dialog title={w.newOrgTitle} onClose={() => setAdding(false)} wide>
          <OrgForm orgs={orgs || []} onCancel={() => setAdding(false)}
            onSubmit={async f => {
              const out = await createOrg(ws, f)
              if (out.error) return out
              setAdding(false)
              navigate(`/contacts/org?id=${out.org.id}`)
              return out
            }} />
        </Dialog>
      )}

      {importing && <ImportDialog ws={ws} orgs={orgs || []} onClose={() => setImporting(false)} onDone={load} />}
    </div>
  )
}
