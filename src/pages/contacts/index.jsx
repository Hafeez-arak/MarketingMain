import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { ROLES, QUICK, GROUPS, filterOrgs, groupOrgs, quickCounts, displayName, otherName, isForeign } from '../../lib/contacts/logic'
import { createOrg } from '../../lib/contacts/client'
import { CW } from './words'
import { useContactsBook, field, fieldInline, categoryName } from './useContactsBook'
import { Dialog, OrgForm, RoleBadges, ImportDialog } from './parts'

// ─── Contacts → Organisations (v2) ─────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CONTACTS.md. Musa's Contacts (جهات الاتصال):
// one list of every organisation and individual the company deals with,
// each with its roles. Quick filters for the usual questions ("our
// suppliers"), then his two lists' filters on one list (role, status,
// company or individual, VAT-registered, outside the Kingdom, category),
// his "group by" (type, city, category) and his two views (a table, or
// cards). The search covers names in both languages, the number, VAT, CR,
// city and phone. Everything lives in the URL, so a filtered list can be
// linked to. Opening a row goes to its page.

const AVATAR = ['#8E5486', '#2A5F7E', '#E8833A', '#1e7a4a', '#5AB2F2', '#b3261e']
const avatarColor = id => AVATAR[[...String(id)].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR.length]

export function ContactsPage() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(CW)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { ws, orgs, people, categories, categoriesById, error, load } = useContactsBook({ people: true })
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)

  const get = (k, allowed, fallback = '') => (allowed.includes(params.get(k)) ? params.get(k) : fallback)
  const q = params.get('q') || ''
  const quick = get('quick', QUICK.map(x => x.key), 'all')
  const role = get('role', ROLES)
  const status = get('status', ['active', 'archived', 'all'], 'active')
  const kind = get('kind', ['company', 'individual'])
  const vat = get('vat', ['yes', 'no'])
  const foreign = params.get('foreign') === '1'
  const category = get('category', categories.map(c => c.id))
  const group = get('group', GROUPS)
  const view = get('v', ['cards'], 'list')
  const setParam = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  const shown = useMemo(() => filterOrgs(orgs || [], { q, quick, role, status, kind, vat, foreign, category }), [orgs, q, quick, role, status, kind, vat, foreign, category])
  const groupTitle = key => (group === 'kind' ? w.kinds[key] : group === 'city' ? key || w.noCity : categoryName(categoriesById[key], lang) || w.noCategory)
  const grouped = useMemo(() => groupOrgs(shown, group, groupTitle), [shown, group, categoriesById, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => quickCounts(orgs || []), [orgs])
  const primaryOf = useMemo(() => {
    const m = {}
    for (const p of people || []) if (p.is_primary && p.org_id) m[p.org_id] = p
    return m
  }, [people])

  if (!canSection('contacts', 'view')) return <p className="text-sm text-text-secondary" dir={dir}>{w.noAccess}</p>

  const open = o => navigate(`/contacts/org?id=${o.id}`)
  const nameCell = o => (
    <>
      <p className="font-medium text-text">
        <bdi>{displayName(o, lang)}</bdi>
        {o.status === 'archived' && <span className="ms-2 text-[10px] uppercase tracking-wide text-text-tertiary font-semibold">{w.archivedTag}</span>}
      </p>
      {otherName(o, lang) && <p className="text-[11px] text-text-tertiary"><bdi>{otherName(o, lang)}</bdi></p>}
    </>
  )

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.title} subtitle={w.subtitle}>
        <Link to="/contacts/categories" className="text-xs text-text-secondary hover:text-text underline self-center">{w.categoriesLink}</Link>
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

      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={e => setParam('kind', e.target.value)} className={fieldInline} aria-label={w.kindFilter}>
          <option value="">{w.anyKind}</option>
          <option value="company">{w.kinds.company}</option>
          <option value="individual">{w.kinds.individual}</option>
        </select>
        <select value={vat} onChange={e => setParam('vat', e.target.value)} className={fieldInline} aria-label={w.vat}>
          {['', 'yes', 'no'].map(v => <option key={v} value={v}>{w.vatFilter[v]}</option>)}
        </select>
        <select value={category} onChange={e => setParam('category', e.target.value)} className={fieldInline} aria-label={w.categoryFilter}>
          <option value="">{w.anyCategory}</option>
          {categories.map(c => <option key={c.id} value={c.id}>{categoryName(c, lang)}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-xs text-text">
          <input type="checkbox" checked={foreign} onChange={e => setParam('foreign', e.target.checked ? '1' : '')} />
          {w.foreignOnly}
        </label>
        <span className="flex-1" />
        <select value={group} onChange={e => setParam('group', e.target.value)} className={fieldInline} aria-label={w.groupBy}>
          {['', ...GROUPS].map(g => <option key={g} value={g}>{g ? `${w.groupBy}: ${w.groups[g]}` : w.groups['']}</option>)}
        </select>
        <div className="inline-flex border border-border rounded-md overflow-hidden" role="group" aria-label={w.views.list}>
          {['list', 'cards'].map(v => (
            <button key={v} type="button" onClick={() => setParam('v', v === 'list' ? '' : v)} aria-pressed={view === v}
              className={`text-xs px-2.5 py-1.5 ${view === v ? 'bg-stone-900 text-white' : 'bg-white text-text hover:bg-stone-50'}`}>{w.views[v]}</button>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

      {orgs === null ? <Skeleton className="h-64" /> : !orgs.length ? (
        <p className="text-sm text-text-tertiary px-1 py-6">{w.emptyAll}</p>
      ) : (
        <>
          <p className="text-[11px] text-text-tertiary">{w.count(shown.length, orgs.length)}</p>
          {!shown.length ? <p className="text-sm text-text-tertiary px-1 py-6">{w.emptyFilter}</p> : view === 'cards' ? (
            <div className="space-y-4">
              {grouped.map(g => (
                <section key={g.key || '-'}>
                  {group && <h3 className="text-xs font-semibold text-text-secondary mb-1.5">{groupTitle(g.key)} <span className="font-normal text-text-tertiary">{g.rows.length}</span></h3>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {g.rows.map(o => (
                      <Link key={o.id} to={`/contacts/org?id=${o.id}`} className="flex gap-3 bg-white border border-border p-3 hover:border-stone-400 focus:outline-none focus-visible:border-stone-900">
                        <span className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-semibold" style={{ background: avatarColor(o.id) }} aria-hidden="true">
                          {displayName(o, lang).slice(0, 1)}
                        </span>
                        <span className="min-w-0 space-y-1">
                          {nameCell(o)}
                          <span className="block text-[11px] text-text-tertiary"><bdi dir="ltr">{o.contact_no}</bdi>{o.city && <> · {o.city}</>}{o.phone && <> · <bdi dir="ltr">{o.phone}</bdi></>}</span>
                          <RoleBadges roles={o.roles} />
                        </span>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                  <th className="text-start font-medium px-3 py-2">{w.cols2.no}</th>
                  <th className="text-start font-medium px-3 py-2">{w.cols.name}</th>
                  <th className="text-start font-medium px-3 py-2">{w.cols.roles}</th>
                  <th className="text-start font-medium px-3 py-2">{w.cols.city}</th>
                  <th className="text-start font-medium px-3 py-2">{w.cols.vat}</th>
                  <th className="text-start font-medium px-3 py-2">{w.cols.contact}</th>
                </tr></thead>
                {grouped.map(g => (
                  <tbody key={g.key || '-'} className="divide-y divide-border">
                    {group && (
                      <tr className="bg-stone-50"><td colSpan={6} className="px-3 py-1.5 text-xs font-semibold text-text-secondary">
                        {groupTitle(g.key)} <span className="font-normal text-text-tertiary">({g.rows.length})</span>
                      </td></tr>
                    )}
                    {g.rows.map(o => {
                      const contact = primaryOf[o.id]
                      const cat = categoriesById[o.category_id]
                      return (
                        <tr key={o.id} role="link" tabIndex={0} onClick={() => open(o)}
                          onKeyDown={e => { if (e.key === 'Enter') open(o) }}
                          className="hover:bg-stone-50 cursor-pointer focus:outline-none focus-visible:bg-stone-50 align-top">
                          <td className="px-3 py-2 text-[11px] text-text-tertiary tabular-nums whitespace-nowrap" dir="ltr" style={{ textAlign: 'start' }}>{o.contact_no}</td>
                          <td className="px-3 py-2 min-w-[14rem]">
                            {nameCell(o)}
                            <p className="text-[11px] text-text-tertiary">
                              {[o.kind === 'individual' && w.kinds.individual, cat && categoryName(cat, lang), isForeign(o) && w.foreign].filter(Boolean).join(' · ')}
                            </p>
                          </td>
                          <td className="px-3 py-2"><RoleBadges roles={o.roles} /></td>
                          <td className="px-3 py-2 text-text-secondary whitespace-nowrap"><bdi>{o.city || '—'}</bdi></td>
                          <td className="px-3 py-2 text-text-secondary tabular-nums whitespace-nowrap" dir="ltr" style={{ textAlign: 'start' }}>{o.vat_number || '—'}</td>
                          <td className="px-3 py-2 text-text-secondary"><bdi>{contact ? displayName(contact, lang) : '—'}</bdi></td>
                        </tr>
                      )
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </>
      )}

      {adding && (
        <Dialog title={w.newOrgTitle} onClose={() => setAdding(false)} wide>
          <OrgForm orgs={orgs || []} categories={categories} onCancel={() => setAdding(false)}
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
