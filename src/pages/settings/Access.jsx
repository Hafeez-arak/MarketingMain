import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../store/auth'
import { Button, Modal, Avatar, Skeleton, Spinner } from '../../components/ui/index'
import {
  fetchAllAccess, approveAccess, revokeAccess,
  fetchInvites, inviteAccess, cancelInvite,
  fetchAllCompanies, fetchCompanyAssignments, setUserCompanies, setUserRole,
} from '../../lib/access'
import { fetchCompanySections, setSection, GRANTABLE } from '../../lib/sectionAccess'
import { SECTIONS } from '../../lib/modules'
import { buildPeople, filterPeople, companyChips, sameSet, ACCESS_KINDS } from '../../lib/team'
import { useT, labelOf, ago } from '../../lib/i18n'
import { TEAM } from './accessWords'
import { ACCESS_CHANGED } from '../../components/layout/useNavBadges'

// ─── Admin → Team & Access (v2, redesigned 2026-10-25) ─────────────────────
// The owner: "make it easy and UI/UX friendly". It was five stacked boxes
// with a row of buttons on every person, and a person's sections lived on a
// second page. Now:
//
//   · requests waiting for a decision sit on top, only when there are any;
//   · one list of people, in three tabs (active, invited, no access), with
//     search;
//   · a person opens in a side panel holding everything about them: what they
//     use, their companies, their sections in each company, and remove or
//     restore;
//   · Add person is a short dialog.
//
// The access model and every call are unchanged (lib/access.js,
// lib/sectionAccess.js, lib/team.js): approve/revoke, invite, companies by
// whole set, role, and section grants per company. Nothing is handed out
// automatically, so approving asks for the companies in the same step.

const NOTICE_MS = 7000

/** A row of mutually exclusive choices, for levels and short options. */
function Segmented({ options, value, onChange, disabled = false, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border bg-surface-subtle p-0.5">
      {options.map(o => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} disabled={disabled} title={o.hint}
            onClick={() => !on && onChange(o.value)}
            className={`px-2.5 py-1 text-xs rounded transition-colors disabled:opacity-50 ${on ? 'bg-white text-text font-medium shadow-sm border border-border' : 'text-text-secondary hover:text-text border border-transparent'}`}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** The three kinds of access as cards: what each gives, said once. */
function AccessChoice({ value, onChange, disabled = false, t }) {
  return (
    <div role="radiogroup" aria-label={t.usesTitle} className="grid gap-2">
      {ACCESS_KINDS.map(k => {
        const on = value === k
        return (
          <button key={k} type="button" role="radio" aria-checked={on} disabled={disabled}
            onClick={() => !on && onChange(k)}
            className={`text-start rounded-lg border px-3 py-2.5 transition-colors disabled:opacity-60 ${on ? 'border-text bg-surface-subtle' : 'border-border bg-white hover:bg-surface-subtle'}`}>
            <span className="flex items-center gap-2">
              <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${on ? 'border-text' : 'border-stone-300'}`}>
                {on && <span className="w-1.5 h-1.5 rounded-full bg-text" />}
              </span>
              <span className="text-sm font-medium text-text">{t.access[k]}</span>
            </span>
            <span className="block text-xs text-text-secondary mt-0.5" style={{ paddingInlineStart: '1.375rem' }}>{t.accessHint[k]}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Companies as toggle pills. */
function CompanyPills({ companies, selected, onToggle, disabled = false }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {companies.map(c => {
        const on = selected.includes(c.id)
        return (
          <button key={c.id} type="button" aria-pressed={on} disabled={disabled} onClick={() => onToggle(c.id)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${on ? 'border-text bg-text text-white' : 'border-border bg-white text-text-secondary hover:text-text hover:border-stone-300'}`}>
            {on
              ? <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>
              : <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>}
            {c.name}
          </button>
        )
      })}
    </div>
  )
}

const DOT = { approved: 'bg-green-500', pending: 'bg-yellow-500', invited: 'bg-sky-500', revoked: 'bg-stone-300' }
function StatusDot({ status, t }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap">
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[status] || 'bg-stone-300'}`} aria-hidden="true" />
      {t.status[status] || status}
    </span>
  )
}

function Companies({ person, companies, t }) {
  const c = companyChips(person, companies)
  if (c.all) return <span className="text-xs text-text-secondary">{t.allCompanies}</span>
  if (!c.shown.length) return <span className="text-xs text-text-tertiary">{t.noCompanies}</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      {c.shown.map(n => <span key={n} className="rounded border border-border bg-surface-subtle px-1.5 py-0.5 text-[11px] text-text-secondary">{n}</span>)}
      {c.more > 0 && <span className="text-[11px] text-text-tertiary">{t.more(c.more)}</span>}
    </span>
  )
}

/** A block of the side panel. */
function Block({ title, hint, children, aside }) {
  return (
    <section className="px-5 py-4 border-b border-border space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {hint && <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

// ─── A person's sections in one company ────────────────────────────────────
function SectionLevels({ person, companies, me, t, lang, activeWorkspaceId }) {
  const theirs = companies.filter(c => person.companyIds.includes(c.id))
  const [ws, setWs] = useState(() => (person.companyIds.includes(activeWorkspaceId) ? activeWorkspaceId : theirs[0]?.id) || null)
  const [levels, setLevels] = useState(null)
  const [state, setState] = useState({}) // section → 'busy' | 'done' | error text
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ws) return
    let off = false
    queueMicrotask(() => { if (!off) setLevels(null) })
    fetchCompanySections(ws).then(({ rows, error: e }) => {
      if (off) return
      setError(e || '')
      setLevels(Object.fromEntries(rows.filter(r => r.user_id === person.id).map(r => [r.section, r.level])))
    })
    return () => { off = true }
  }, [ws, person.id])

  if (!theirs.length) return <p className="text-xs text-text-tertiary">{t.sectionsNoCompany}</p>
  const pick = async (section, level) => {
    setState(s => ({ ...s, [section]: 'busy' }))
    const out = await setSection(ws, person.id, section, level || null, me)
    if (out.error) { setState(s => ({ ...s, [section]: out.error })); return }
    setLevels(l => ({ ...l, [section]: level || undefined }))
    setState(s => ({ ...s, [section]: 'done' }))
  }
  const options = ['', 'view', 'work', 'manage'].map(v => ({ value: v, label: t.levels[v], hint: t.levelHint[v] }))
  return (
    <div className="space-y-3">
      {theirs.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span>{t.sectionsIn}</span>
          <Segmented label={t.companiesTitle} value={ws} onChange={setWs}
            options={theirs.map(c => ({ value: c.id, label: c.name }))} />
        </div>
      )}
      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}
      {levels === null ? <Skeleton className="h-32" /> : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {GRANTABLE.map(s => {
            const st = state[s]
            return (
              <li key={s} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="text-sm text-text">{labelOf(SECTIONS.find(x => x.key === s), lang) || s}</span>
                <span className="flex items-center gap-2">
                  {st === 'busy' && <Spinner size="sm" />}
                  {st === 'done' && <span className="text-[11px] text-green-700" aria-live="polite">{t.saved}</span>}
                  {st && st !== 'busy' && st !== 'done' && <span className="text-[11px] text-red-600 max-w-[8rem] truncate" title={st}>{st}</span>}
                  <Segmented label={s} value={levels[s] || ''} options={options} disabled={st === 'busy'} onChange={v => pick(s, v)} />
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── The side panel: everything about one person ───────────────────────────
function PersonPanel({ person, companies, me, activeWorkspaceId, onClose, act, t, lang, dir }) {
  const [draft, setDraft] = useState(person.companyIds)
  const [access, setAccess] = useState(person.access === 'admin' ? 'member' : person.access)
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState(null) // 'remove' | 'deny'
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    const esc = e => { if (e.key === 'Escape' && !confirm) onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose, confirm])

  const run = async (key, fn) => { setBusy(key); try { await fn() } finally { setBusy('') } }
  const toggle = id => setDraft(d => (d.includes(id) ? d.filter(x => x !== id) : [...d, id]))
  const isAdmin = person.access === 'admin'
  const dirty = !sameSet(draft, person.companyIds)

  return createPortal(
    <div className="fixed inset-0 z-50 flex" dir={dir} lang={lang}>
      <button type="button" aria-label={t.close} onClick={onClose} className="flex-1" style={{ background: 'rgba(9,9,11,0.32)' }} />
      <aside role="dialog" aria-modal="true" aria-label={person.name}
        className="w-full max-w-md h-full bg-white border-s border-border shadow-dropdown flex flex-col">
        <header className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <Avatar name={person.name} size="lg" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text truncate">{person.name}{person.isMe && <span className="font-normal text-text-tertiary"> · {t.you}</span>}</p>
            <p className="text-xs text-text-tertiary truncate" dir="ltr">{person.email}</p>
            <div className="mt-1.5 flex items-center gap-3">
              <StatusDot status={person.status} t={t} />
              <span className="text-xs text-text-secondary">{t.access[person.access]}</span>
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t.close}
            className="w-8 h-8 flex items-center justify-center rounded-md text-text-tertiary hover:text-text hover:bg-surface-subtle">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* ── Waiting for a decision: choose, then approve in one step ── */}
          {person.status === 'pending' && (
            <>
              <div className="px-5 pt-4">
                <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">{t.pendingNote}</p>
              </div>
              <Block title={t.usesTitle}><AccessChoice value={access} onChange={setAccess} t={t} disabled={!!busy} /></Block>
              <Block title={t.companiesTitle} hint={t.companiesLater}>
                <CompanyPills companies={companies} selected={draft} onToggle={toggle} disabled={!!busy} />
              </Block>
            </>
          )}

          {/* ── Invited by email, no account yet ── */}
          {person.status === 'invited' && (
            <Block title={t.companiesTitle} hint={t.invitedNote}>
              <Companies person={person} companies={companies} t={t} />
            </Block>
          )}

          {/* ── No access ── */}
          {person.status === 'revoked' && <Block title={t.status.revoked} hint={t.removedNote} />}

          {/* ── Active ── */}
          {person.status === 'approved' && (
            <>
              <Block title={t.usesTitle} hint={isAdmin ? t.adminNote : null}>
                {isAdmin
                  ? <p className="text-sm text-text">{t.access.admin} · <span className="text-text-secondary">{t.accessHint.admin}</span></p>
                  : <AccessChoice value={person.access} t={t} disabled={!!busy}
                      onChange={k => run('role', () => act.setRole(person, k))} />}
              </Block>
              {!isAdmin && (
                <Block title={t.companiesTitle} hint={t.companiesHint}
                  aside={<span className="text-[11px] text-text-tertiary whitespace-nowrap">{t.selected(draft.length, companies.length)}</span>}>
                  <CompanyPills companies={companies} selected={draft} onToggle={toggle} disabled={busy === 'companies'} />
                  {dirty && (
                    <div className="flex items-center gap-2">
                      <Button size="xs" disabled={!!busy} onClick={() => run('companies', () => act.saveCompanies(person, draft))}>
                        {busy === 'companies' ? t.saving : t.save}
                      </Button>
                      <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => setDraft(person.companyIds)}>{t.cancel}</Button>
                    </div>
                  )}
                </Block>
              )}
              <Block title={t.sectionsTitle} hint={person.access === 'member' && person.companyIds.length ? t.sectionsHint : null}>
                {isAdmin ? <p className="text-xs text-text-secondary">{t.sectionsAdmin}</p>
                  : person.access !== 'member' ? <p className="text-xs text-text-secondary">{t.sectionsSales}</p>
                  : <SectionLevels key={person.companyIds.join(',')} person={person} companies={companies} me={me} t={t} lang={lang} activeWorkspaceId={activeWorkspaceId} />}
              </Block>
              {!isAdmin && !person.isMe && (
                <Block title={t.dangerTitle} hint={t.dangerBody}>
                  <Button size="sm" variant="danger" disabled={!!busy} onClick={() => setConfirm('remove')}>{t.remove}</Button>
                </Block>
              )}
            </>
          )}
        </div>

        {/* ── The panel's main action, where it is the point of opening it ── */}
        {(person.status === 'pending' || person.status === 'invited' || person.status === 'revoked') && (
          <footer className="flex items-center gap-2 px-5 py-3 border-t border-border bg-white">
            {person.status === 'pending' && (
              <>
                <Button className="flex-1 justify-center" disabled={!!busy} onClick={() => run('approve', () => act.approve(person, access, draft))}>
                  {busy === 'approve' ? <Spinner size="sm" /> : null}{t.approveWith}
                </Button>
                <Button variant="secondary" disabled={!!busy} onClick={() => setConfirm('deny')}>{t.deny}</Button>
              </>
            )}
            {person.status === 'invited' && (
              <Button variant="secondary" className="flex-1 justify-center" disabled={!!busy}
                onClick={() => run('cancel', () => act.cancelInvite(person))}>{t.cancelInvite}</Button>
            )}
            {person.status === 'revoked' && (
              <Button className="flex-1 justify-center" disabled={!!busy} onClick={() => run('restore', () => act.restore(person))}>
                {busy === 'restore' ? <Spinner size="sm" /> : null}{t.restore}
              </Button>
            )}
          </footer>
        )}
      </aside>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} width="max-w-sm"
        title={confirm === 'deny' ? t.denyQ(person.name) : t.removeQ(person.name)}>
        <div className="p-5 space-y-4" dir={dir}>
          <p className="text-sm text-text-secondary leading-relaxed">{confirm === 'deny' ? t.denyBody : t.dangerBody}</p>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setConfirm(null)}>{t.cancel}</Button>
            <Button variant="danger" disabled={!!busy}
              onClick={() => run('revoke', async () => { await act.revoke(person, confirm); setConfirm(null) })}>
              {busy === 'revoke' ? <Spinner size="sm" /> : null}{confirm === 'deny' ? t.deny : t.remove}
            </Button>
          </div>
        </div>
      </Modal>
    </div>,
    document.body,
  )
}

// ─── Add person ────────────────────────────────────────────────────────────
function AddPerson({ open, onClose, companies, onAdd, t, dir }) {
  const [email, setEmail] = useState('')
  const [access, setAccess] = useState('member')
  const [ids, setIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reset = () => { setEmail(''); setAccess('member'); setIds([]); setError('') }
  const submit = async e => {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true); setError('')
    const err = await onAdd(email.trim(), access, ids)
    setBusy(false)
    if (err) setError(err)
    else { reset(); onClose() }
  }
  return (
    <Modal open={open} onClose={() => { if (!busy) { reset(); onClose() } }} title={t.addTitle} width="max-w-md">
      <form onSubmit={submit} className="p-5 space-y-4" dir={dir}>
        <label className="block">
          <span className="text-xs font-medium text-text">{t.email}</span>
          <input type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder={t.emailPh} dir="ltr"
            className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200" />
          <span className="block text-[11px] text-text-tertiary mt-1">{t.addHint}</span>
        </label>
        <div>
          <p className="text-xs font-medium text-text mb-1.5">{t.usesTitle}</p>
          <AccessChoice value={access} onChange={setAccess} t={t} disabled={busy} />
        </div>
        {companies.length > 0 && (
          <div>
            <p className="text-xs font-medium text-text">{t.companiesTitle}</p>
            <p className="text-[11px] text-text-tertiary mb-1.5">{t.companiesLater}</p>
            <CompanyPills companies={companies} selected={ids} disabled={busy}
              onToggle={id => setIds(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))} />
          </div>
        )}
        {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" disabled={busy} onClick={() => { reset(); onClose() }}>{t.cancel}</Button>
          <Button type="submit" disabled={busy || !email.trim()}>{busy ? t.adding : t.add}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── The page ──────────────────────────────────────────────────────────────
export function Access() {
  const { user, isAccessAdmin, refreshWorkspaces, activeWorkspaceId } = useAuth()
  const { t, lang, dir } = useT(TEAM)
  const [data, setData] = useState(null) // { rows, invites, companies, assignments }
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState('active')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const [acc, inv, comp, asg] = await Promise.all([fetchAllAccess(), fetchInvites(), fetchAllCompanies(), fetchCompanyAssignments()])
      setError(acc.error || comp.error || asg.error || inv.error || '')
      setData({ rows: acc.rows, invites: inv.invites, companies: comp.companies, assignments: asg.assignments })
    } catch (err) {
      setError(String(err?.message || err))
      setData(d => d || { rows: [], invites: [], companies: [], assignments: {} })
    }
  }, [])
  useEffect(() => { if (isAccessAdmin) queueMicrotask(load) }, [load, isAccessAdmin])

  // A notice says what just happened, then goes.
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(''), NOTICE_MS)
    return () => clearTimeout(id)
  }, [notice])

  const companies = useMemo(() => data?.companies || [], [data])
  const people = useMemo(() => (data ? buildPeople({ ...data, me: user?.id }) : null), [data, user?.id])
  const all = people ? [...people.pending, ...people.active, ...people.invited, ...people.removed] : []
  const open = all.find(p => p.id === openId) || null
  const names = ids => companies.filter(c => ids.includes(c.id)).map(c => c.name).join(', ')

  // Every action: do it, say what happened (or why not), reload the list.
  // Your own company list (the switcher) is re-read only when the change was
  // to you: re-reading it puts the whole app into loading, which unmounted
  // this page and lost the open panel and the notice.
  const after = async (err, ok, p = null) => {
    if (err) { setError(err); return false }
    setError(''); setNotice(ok)
    window.dispatchEvent(new Event(ACCESS_CHANGED))
    await load()
    if (p?.isMe) await refreshWorkspaces?.()
    return true
  }
  const act = {
    async approve(p, access, ids) {
      let err = await approveAccess(p.id)
      if (!err && access !== 'member') err = await setUserRole(p.id, access)
      if (!err) err = await setUserCompanies(p.id, ids)
      await after(err, t.done.approvedNow(p.name) + (ids.length ? ` ${t.done.companies(p.name, names(ids))}` : ''), p)
    },
    async revoke(p, why) {
      const ok = await after(await revokeAccess(p.id), why === 'deny' ? t.done.denied(p.name) : t.done.removed(p.name), p)
      if (ok) setOpenId(null)
    },
    async restore(p) { await after(await approveAccess(p.id), t.done.restored(p.name), p) },
    async setRole(p, access) { await after(await setUserRole(p.id, access), t.done.role(p.name, t.access[access]), p) },
    async saveCompanies(p, ids) { await after(await setUserCompanies(p.id, ids), t.done.companies(p.name, names(ids)), p) },
    async cancelInvite(p) {
      const ok = await after(await cancelInvite(p.email), t.done.inviteCancelled(p.email))
      if (ok) setOpenId(null)
    },
  }
  const add = async (email, access, ids) => {
    const { outcome, error: err } = await inviteAccess(email, ids, access)
    if (err) return err
    const c = names(ids)
    await after(null, outcome === 'already' ? t.done.already(email) : outcome === 'invited' ? t.done.invited(email, c) : t.done.approved(email, c))
    setTab(outcome === 'invited' ? 'invited' : 'active')
    return null
  }

  if (!isAccessAdmin) {
    return (
      <div className="max-w-2xl" dir={dir} lang={lang}>
        <h1 className="text-lg font-semibold text-text">{t.notAdminTitle}</h1>
        <p className="mt-2 text-sm text-text-secondary leading-relaxed">{t.notAdminBody}</p>
      </div>
    )
  }

  const list = people ? filterPeople(people[tab], query, companies) : []

  return (
    <div className="max-w-5xl space-y-5" dir={dir} lang={lang}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text">{t.title}</h1>
          <p className="text-sm text-text-secondary mt-0.5">{t.subtitle}</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          {t.add}
        </Button>
      </div>

      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          <span dir="auto">{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label={t.close} className="text-green-700 hover:text-green-900">×</button>
        </div>
      )}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700" dir="auto">{people ? error : t.loadFailed(error)}</div>}

      {/* ── Waiting for you ── */}
      {people?.pending.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50">
          <div className="px-4 pt-3 pb-2">
            <h2 className="text-sm font-semibold text-text">{t.waitingTitle(people.pending.length)}</h2>
            <p className="text-xs text-text-secondary">{t.waitingBody}</p>
          </div>
          <ul className="divide-y divide-amber-100">
            {people.pending.map(p => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={p.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text truncate">{p.name}</p>
                  <p className="text-xs text-text-tertiary truncate"><span dir="ltr">{p.email}</span>{p.at ? ` · ${t.asked(ago(p.at, lang))}` : ''}</p>
                </div>
                <Button size="xs" onClick={() => setOpenId(p.id)}>{t.review}</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Everyone else ── */}
      <section className="rounded-xl border border-border bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div role="tablist" className="flex gap-1">
            {['active', 'invited', 'removed'].map(k => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${tab === k ? 'bg-surface-subtle text-text font-medium' : 'text-text-secondary hover:text-text'}`}>
                {t.tabs[k]}{people ? <span className="ms-1.5 text-xs text-text-tertiary">{people[k].length}</span> : null}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <svg className="absolute top-1/2 -translate-y-1/2 start-2.5 w-4 h-4 text-text-tertiary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search}
              className="w-full rounded-md border border-border bg-white py-1.5 pe-3 ps-8 text-sm text-text focus:outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200" />
          </div>
        </div>

        <div className="hidden sm:grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)_7rem_1rem] gap-4 px-4 py-2 text-[11px] font-medium text-text-tertiary border-b border-border">
          <span>{t.cols.person}</span><span>{t.cols.uses}</span><span>{t.cols.companies}</span><span>{t.cols.status}</span><span />
        </div>

        {people === null ? (
          <div className="p-4 space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-11" />)}</div>
        ) : list.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-text-secondary">{query.trim() ? t.noMatch(query.trim()) : t.empty[tab]}</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => setOpenId(p.id)}
                  className="w-full text-start grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)_7rem_1rem] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-subtle focus:outline-none focus-visible:bg-surface-subtle transition-colors">
                  <span className="flex items-center gap-3 min-w-0">
                    <Avatar name={p.name} size="md" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text truncate">{p.name}{p.isMe && <span className="font-normal text-text-tertiary"> · {t.you}</span>}</span>
                      <span className="block text-xs text-text-tertiary truncate" dir="ltr">{p.email}</span>
                    </span>
                  </span>
                  <span className="hidden sm:block text-sm text-text-secondary truncate">{t.access[p.access]}</span>
                  <span className="hidden sm:block min-w-0"><Companies person={p} companies={companies} t={t} /></span>
                  <span className="sm:block"><StatusDot status={p.status} t={t} /></span>
                  <svg className="hidden sm:block w-4 h-4 text-text-tertiary rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && (
        <PersonPanel key={`${open.id}:${open.status}:${open.access}:${open.companyIds.join(',')}`} person={open} companies={companies}
          me={user?.id} activeWorkspaceId={activeWorkspaceId} onClose={() => setOpenId(null)} act={act} t={t} lang={lang} dir={dir} />
      )}
      <AddPerson open={adding} onClose={() => setAdding(false)} companies={companies} onAdd={add} t={t} dir={dir} />
    </div>
  )
}
