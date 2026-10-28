import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton } from '../../components/ui/index'
import { useT, fmtDay } from '../../lib/i18n'
import { displayName, otherName } from '../../lib/contacts/logic'
import {
  fetchOrg, fetchOrgs, fetchPeople, updateOrg, setOrgStatus, deleteOrg,
  createPerson, updatePerson, deletePerson,
} from '../../lib/contacts/client'
import { CW } from './words'
import { Dialog, OrgForm, PersonForm, RoleBadges } from './parts'

// ─── Contacts → one organisation (v2) ──────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CONTACTS.md. Everything about one organisation
// or individual: roles, registration (VAT, CR), national address, how to
// reach it, notes, and its contact persons. Work edits it and its people;
// manage archives, restores and deletes. Archived = locked: the page says
// so and offers only Restore (the database refuses the rest anyway).

function Facts({ title, rows }) {
  return (
    <section className="bg-white border border-border p-4">
      <h2 className="text-xs font-semibold text-text-secondary mb-2">{title}</h2>
      <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([label, value, ltr]) => (
          <div key={label} className="contents">
            <dt className="text-text-tertiary text-xs pt-0.5">{label}</dt>
            <dd className="text-text break-words" dir={ltr ? 'ltr' : 'auto'} style={ltr ? { textAlign: 'start' } : undefined}>{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function ContactsOrgPage() {
  const { canSection } = useAuth()
  const { activeWorkspaceId: ws } = useAuth()
  const { t: w, lang, dir } = useT(CW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const [org, setOrg] = useState(undefined) // undefined loading · null gone
  const [people, setPeople] = useState([])
  const [allOrgs, setAllOrgs] = useState([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [person, setPerson] = useState(null) // null | {} new | row
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!ws || !id) return
    const [o, p] = await Promise.all([fetchOrg(ws, id), fetchPeople(ws, { orgId: id })])
    setOrg(o.org || null)
    setPeople(p.rows)
    setError(o.error || p.error || '')
  }, [ws, id])
  useEffect(() => { queueMicrotask(load) }, [load])

  // The company's other organisations, for the duplicate guard while editing.
  async function startEdit() {
    setEditing(true)
    const all = await fetchOrgs(ws)
    setAllOrgs(all.rows)
  }

  async function act(fn) {
    setBusy(true); setError('')
    const out = await fn()
    setBusy(false)
    if (out?.error) setError(out.error)
    return out
  }

  if (!canSection('contacts', 'view')) return <p className="text-sm text-text-secondary" dir={dir}>{w.noAccess}</p>
  if (org === undefined) return <Skeleton className="h-64 max-w-5xl" />
  if (!org) {
    return (
      <div className="space-y-3" dir={dir} lang={lang}>
        <Link to="/contacts" className="text-xs text-text-secondary hover:text-text">{w.back}</Link>
        <p className="text-sm text-text-secondary">{error || w.orgGone}</p>
      </div>
    )
  }

  const archived = org.status === 'archived'
  const canWork = canSection('contacts', 'work') && !archived
  const canManage = canSection('contacts', 'manage')
  const name = displayName(org, lang)

  return (
    <div className="max-w-5xl space-y-4" dir={dir} lang={lang}>
      <Link to="/contacts" className="text-xs text-text-secondary hover:text-text">{w.back}</Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text"><bdi>{name}</bdi></h1>
          {otherName(org, lang) && <p className="text-sm text-text-secondary"><bdi>{otherName(org, lang)}</bdi></p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
            <span>{w.kinds[org.kind]}</span>
            <RoleBadges roles={org.roles} />
            {archived && <span className="text-[10px] uppercase tracking-wide font-semibold text-red-700">{w.archivedTag}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWork && <Button size="sm" variant="secondary" onClick={startEdit}>{w.edit}</Button>}
          {canManage && !archived && (
            <Button size="sm" variant="secondary" disabled={busy}
              onClick={() => window.confirm(w.confirmArchive(name)) && act(async () => { const out = await setOrgStatus(ws, org.id, 'archived'); if (out.org) setOrg(out.org); return out })}>
              {w.archive}
            </Button>
          )}
          {canManage && archived && (
            <Button size="sm" disabled={busy} onClick={() => act(async () => { const out = await setOrgStatus(ws, org.id, 'active'); if (out.org) setOrg(out.org); return out })}>
              {w.restore}
            </Button>
          )}
          {canManage && !people.length && (
            <Button size="sm" variant="danger" disabled={busy}
              onClick={() => window.confirm(w.confirmDelete(name)) && act(async () => { const out = await deleteOrg(ws, org.id); if (!out.error) navigate('/contacts'); return out })}>
              {w.delete}
            </Button>
          )}
        </div>
      </header>

      {archived && (
        <p className="text-xs border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">
          {w.archivedNote}{org.archived_at && <> · {w.archivedOn(fmtDay(org.archived_at, lang, { day: 'numeric', month: 'short', year: 'numeric' }))}</>}
        </p>
      )}
      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Facts title={w.registration} rows={[
          [w.vat, org.vat_number, true],
          [w.cr, org.cr_number, true],
          [w.country, org.country, true],
        ]} />
        <Facts title={w.reach} rows={[
          [w.phone, org.phone, true],
          [w.email, org.email && <a href={`mailto:${org.email}`} className="underline">{org.email}</a>, true],
          [w.website, org.website, true],
        ]} />
        <Facts title={w.nationalAddress} rows={[
          [w.building, org.nat_building_no, true],
          [w.street, org.nat_street],
          [w.district, org.nat_district],
          [w.city, org.city],
          [w.postal, org.nat_postal_code, true],
          [w.additional, org.nat_additional_no, true],
        ]} />
        <section className="bg-white border border-border p-4">
          <h2 className="text-xs font-semibold text-text-secondary mb-2">{w.notes}</h2>
          <p className="text-sm text-text whitespace-pre-wrap" dir="auto">{org.notes || <span className="text-text-tertiary">{w.noNotes}</span>}</p>
        </section>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">{w.people} <span className="font-normal text-text-tertiary">{people.length}</span></h2>
          {canWork && <Button size="sm" variant="secondary" onClick={() => setPerson({ org_id: org.id, is_primary: !people.length })}>{w.addPerson}</Button>}
        </div>
        {!people.length ? <p className="text-xs text-text-tertiary">{w.noPeopleHere}</p> : (
          <ul className="bg-white border border-border divide-y divide-border">
            {people.map(p => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">
                    <bdi>{displayName(p, lang)}</bdi>
                    {p.is_primary && <span className="ms-2 text-[10px] uppercase tracking-wide font-semibold text-emerald-700">{w.primary}</span>}
                  </p>
                  {otherName(p, lang) && <p className="text-[11px] text-text-tertiary"><bdi>{otherName(p, lang)}</bdi></p>}
                  <p className="text-xs text-text-secondary flex flex-wrap gap-x-3 mt-0.5">
                    {p.job_title && <span dir="auto">{p.job_title}</span>}
                    {p.phone && <span dir="ltr">{p.phone}</span>}
                    {p.email && <a href={`mailto:${p.email}`} className="underline" dir="ltr">{p.email}</a>}
                  </p>
                </div>
                <div className="flex gap-1">
                  {canWork && <Button size="xs" variant="ghost" onClick={() => setPerson(p)}>{w.edit}</Button>}
                  {canManage && !archived && (
                    <Button size="xs" variant="ghost" disabled={busy}
                      onClick={() => window.confirm(w.confirmDeletePerson(displayName(p, lang))) && act(async () => { const out = await deletePerson(ws, p.id); if (!out.error) await load(); return out })}>
                      {w.delete}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <Dialog title={w.editOrgTitle} onClose={() => setEditing(false)} wide>
          <OrgForm initial={org} orgs={allOrgs} selfId={org.id} onCancel={() => setEditing(false)}
            onSubmit={async f => {
              const out = await updateOrg(ws, org.id, f)
              if (out.error) return out
              setOrg(out.org)
              setEditing(false)
              return out
            }} />
        </Dialog>
      )}

      {person && (
        <Dialog title={person.id ? w.editPersonTitle : w.newPersonTitle} onClose={() => setPerson(null)}>
          <PersonForm initial={person} orgs={[org]} lockOrg onCancel={() => setPerson(null)}
            onSubmit={async p => {
              const out = person.id ? await updatePerson(ws, person.id, p) : await createPerson(ws, p)
              if (out.error) return out
              setPerson(null)
              await load()
              return out
            }} />
        </Dialog>
      )}
    </div>
  )
}
