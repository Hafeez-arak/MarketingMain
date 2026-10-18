import { useEffect, useState } from 'react'
import { useAuth } from '../../store/auth'
import { supabase } from '../../lib/supabaseClient'
import { createCompany, fetchAllAccess } from '../../lib/access'
import { Card, Button, PageHeader, Skeleton } from '../../components/ui/index'
import { fetchSpend, setCap, projectedMonth } from '../../lib/aiSpend'

// ─── Settings ──────────────────────────────────────────────────────────────
// A "company" == a Supabase workspace. This section reads/writes the REAL
// workspaces + workspace_members tables (via useAuth), not the legacy
// localStorage appStore — so creating a company here makes a real, isolated
// tenant that shows up in the sidebar switcher and gets its own brain/plans.
export function Settings() {
  const { user, isAccessAdmin, workspaces, activeWorkspaceId, switchWorkspace, refreshWorkspaces } = useAuth()
  const [showCreate, setShowCreate] = useState(false)
  const [newWsName, setNewWsName]   = useState('')
  // Who else gets the company being created. A new company reaches the
  // administrators and its creator and nobody else, so the form asks rather
  // than leaving the admin to go and find Team & Access afterwards.
  // `people` is null until the list has loaded, and stays null if it could
  // not be read — the form then says so instead of showing an empty list
  // that would read as "there is nobody to add".
  const [people, setPeople]         = useState(null)
  const [peopleError, setPeopleError] = useState('')
  const [picked, setPicked]         = useState(() => new Set())
  const [editingId, setEditingId]   = useState(null)
  const [editName, setEditName]     = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  const activeId = activeWorkspaceId

  async function openCreate() {
    setShowCreate(true); setNewWsName(''); setError(''); setPicked(new Set())
    // Choosing who gets a company is the admin's call (the database refuses
    // anyone else), so only the admin is shown the list.
    if (!isAccessAdmin) return
    setPeople(null); setPeopleError('')
    const { rows, error: e } = await fetchAllAccess()
    if (e) { setPeopleError(e); return }
    // Administrators are joined to every company already, and the person
    // creating it is joined too — listing them would be a tick that does nothing.
    setPeople(rows.filter(r => r.status === 'approved' && r.role !== 'admin' && r.user_id !== user?.id))
  }

  function togglePerson(id) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleCreate() {
    const name = newWsName.trim()
    if (!name || !user) return
    setBusy(true); setError('')
    // create_company() (SECURITY DEFINER) makes the company; its roster
    // trigger joins the administrators and the caller, and the ids passed
    // here are joined on top. Then we refresh and drop into the new one.
    const { id: newId, error: createError } = await createCompany(name, [...picked])
    if (createError) { setError(createError); setBusy(false); return }
    await refreshWorkspaces()
    if (newId) switchWorkspace(newId)
    setNewWsName(''); setShowCreate(false); setBusy(false)
  }

  async function handleRename(id) {
    const name = editName.trim()
    if (!name) return
    setBusy(true); setError('')
    const { error: e } = await supabase.from('workspaces').update({ name }).eq('id', id)
    if (e) { setError(e.message); setBusy(false); return }
    await refreshWorkspaces()
    setEditingId(null); setBusy(false)
  }

  async function handleDelete(id) {
    setBusy(true); setError('')
    // FK on delete cascade wipes members + all workspace-scoped data.
    const { error: e } = await supabase.from('workspaces').delete().eq('id', id)
    if (e) { setError(e.message); setBusy(false); setConfirmDelete(null); return }
    if (id === activeId) {
      const next = workspaces.find(w => w.id !== id)
      if (next) switchWorkspace(next.id)
    }
    await refreshWorkspaces()
    setConfirmDelete(null); setBusy(false)
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Settings" subtitle="Companies, workspace preferences, and account details." />

      <AccountCard email={user?.email} />

      {isAccessAdmin && activeId && <SpendCard workspaceId={activeId} key={activeId} />}

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-text text-sm">Companies</h3>
            <p className="text-xs text-text-tertiary mt-0.5">Each company keeps its own brand brain, content, plans, and posts. A company is only seen by the people it has been given to — change who that is under Team &amp; Access.</p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            Add company
          </Button>
        </div>

        {error && (
          <div className="px-6 py-3 border-b border-border bg-red-50/60">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Create inline form */}
        {showCreate && (
          <div className="px-6 py-4 border-b border-border bg-amber-50/40">
            <p className="text-xs font-semibold text-text-secondary mb-2">Company name</p>
            <div className="flex gap-2">
              <input
                autoFocus
                value={newWsName}
                onChange={e => setNewWsName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false) }}
                placeholder="e.g. Nour Interiors"
                className="flex-1 rounded-xl border border-border bg-white text-text text-sm px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all"
              />
              <Button size="sm" onClick={handleCreate} disabled={!newWsName.trim() || busy}>{busy ? 'Creating…' : 'Create'}</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>

            {/* Who gets it. Nothing is ticked to begin with: a new company
                going to nobody is the safe default, and a tick is a decision. */}
            <p className="text-xs font-semibold text-text-secondary mt-4 mb-1">Who should have access?</p>
            {!isAccessAdmin ? (
              <p className="text-xs text-text-tertiary leading-relaxed">
                You and the administrator. The administrator can add other people afterwards under Team &amp; Access.
              </p>
            ) : peopleError ? (
              <p className="text-xs text-red-600 leading-relaxed">
                The list of people could not be loaded ({peopleError}). You can still create the company — only
                administrators will get it — and add people afterwards under Team &amp; Access.
              </p>
            ) : people === null ? (
              <p className="text-xs text-text-tertiary">Loading people…</p>
            ) : (
              <>
                <p className="text-xs text-text-tertiary leading-relaxed mb-2">
                  Administrators always have it. Tick anyone else who should see this company, or leave everyone
                  unticked and add them later under Team &amp; Access.
                </p>
                {people.length === 0 ? (
                  <p className="text-xs text-text-tertiary">Nobody else has been approved yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {people.map(p => (
                      <label key={p.user_id} className="flex items-center gap-2 text-sm text-text cursor-pointer py-0.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={picked.has(p.user_id)}
                          onChange={() => togglePerson(p.user_id)}
                          className="accent-amber-500 flex-shrink-0"
                        />
                        <span className="truncate">{p.full_name || p.email}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Company list */}
        <ul className="divide-y divide-border">
          {workspaces.map(ws => {
            const isActive  = ws.id === activeId
            const isEditing = editingId === ws.id
            return (
              <li key={ws.id}
                className={`flex items-center gap-3 px-6 py-3.5 transition-colors ${isActive ? 'bg-amber-50/40' : 'hover:bg-surface-muted'}`}>
                {/* Avatar */}
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                  style={{ background: isActive ? '#96acb2' : '#929ca7' }}>
                  {ws.name.charAt(0).toUpperCase()}
                </div>

                {/* Name / edit */}
                {isEditing ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(ws.id); if (e.key === 'Escape') setEditingId(null) }}
                    className="flex-1 rounded-lg border border-amber-300 bg-white text-text text-sm px-3 py-1 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text truncate">{ws.name}</p>
                    {isActive && <p className="text-[10px] text-amber-600 font-semibold">Active</p>}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <Button size="xs" onClick={() => handleRename(ws.id)} disabled={!editName.trim() || busy}>Save</Button>
                      <Button size="xs" variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      {!isActive && (
                        <Button size="xs" variant="outline"
                          onClick={() => switchWorkspace(ws.id)}>
                          Switch
                        </Button>
                      )}
                      <button
                        onClick={() => { setEditingId(ws.id); setEditName(ws.name) }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text hover:bg-surface-subtle transition-colors"
                        title="Rename">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
                      </button>
                      {workspaces.length > 1 && (
                        <button
                          onClick={() => setConfirmDelete(ws)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Delete">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      {/* Danger Zone */}
      <Card className="p-6 border-red-200">
        <h3 className="font-semibold text-red-600 mb-2">Danger Zone</h3>
        <p className="text-xs text-text-secondary mb-4">Delete the active company. This permanently removes its brand brain, content, plans, and posts.</p>
        <Button variant="danger" size="sm"
          disabled={workspaces.length <= 1}
          onClick={() => setConfirmDelete(workspaces.find(w => w.id === activeId))}>
          Delete company
        </Button>
        {workspaces.length <= 1 && (
          <p className="text-[11px] text-text-tertiary mt-2">Create a second company before you can delete this one.</p>
        )}
      </Card>

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(28,35,33,0.45)' }}>
          <div className="bg-white rounded-2xl shadow-dropdown w-full max-w-sm border border-border animate-fade-scale p-6 space-y-4">
            <h3 className="font-semibold text-text text-sm">Delete "{confirmDelete.name}"?</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              All content, posts, campaigns, brand brain, and settings for this company will be permanently removed.
            </p>
            <div className="flex gap-3 pt-1">
              <Button variant="secondary" className="flex-1 justify-center" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" className="flex-1 justify-center" onClick={() => handleDelete(confirmDelete.id)} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Your account ──────────────────────────────────────────────────────────
// Changing the password of whoever is signed in. Added 2026-10-18 when a
// login that more than one person had been using was handed back to its
// owner: the app had no way to change a password, so "change it" meant a
// trip to the Supabase dashboard.
function AccountCard({ email }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function reset() { setPassword(''); setConfirm(''); setError('') }

  async function save() {
    setError(''); setDone(false)
    if (password.length < 8) { setError('Use at least 8 characters.'); return }
    if (password !== confirm) { setError('The two passwords do not match.'); return }
    setBusy(true)
    const { error: e } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (e) { setError(e.message); return }
    reset(); setOpen(false); setDone(true)
  }

  const input = 'w-full rounded-xl border border-border bg-white text-text text-sm px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all'

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-text text-sm">Your account</h3>
          <p className="text-xs text-text-tertiary mt-0.5 truncate">Signed in as {email || '…'}</p>
          {done && <p className="text-xs text-green-700 mt-1">Password changed. Use the new one next time you sign in.</p>}
        </div>
        {!open && (
          <Button size="sm" variant="secondary" onClick={() => { reset(); setDone(false); setOpen(true) }}>Change password</Button>
        )}
      </div>
      {open && (
        <div className="px-5 py-4 border-t border-border bg-amber-50/40 space-y-2">
          <input type="password" autoComplete="new-password" autoFocus value={password}
            onChange={e => setPassword(e.target.value)} placeholder="New password (at least 8 characters)" className={input} />
          <input type="password" autoComplete="new-password" value={confirm}
            onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setOpen(false) }}
            placeholder="Type it again" className={input} />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={save} disabled={busy || !password}>{busy ? 'Saving…' : 'Save password'}</Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── AI spending ───────────────────────────────────────────────────────────
// 2026-10-18. The monthly AI limit could only be changed in the database.
// Admins only: set_agent_cap() refuses anyone else and tells the other
// admins, and a trigger warns every admin at 80% and 100%.
function SpendCard({ workspaceId }) {
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchSpend(workspaceId).then(d => { if (!cancelled) setData(d) })
    return () => { cancelled = true }
  }, [workspaceId])

  async function save() {
    setBusy(true); setError('')
    const out = await setCap(workspaceId, value)
    setBusy(false)
    if (out.error) { setError(out.error); return }
    setData(d => ({ ...d, cap: out.cap }))
    setEditing(false)
  }

  const money = n => `$${Number(n || 0).toFixed(2)}`
  const pct = data && data.cap ? Math.min(100, Math.round((data.total / data.cap) * 100)) : 0
  const projected = data ? projectedMonth(data.total) : 0
  const tone = pct >= 100 ? 'bg-red-600' : pct >= 80 ? 'bg-amber-600' : 'bg-amber-700/70'

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-text text-sm">AI spending this month</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            The assistant, research runs and the lead agent share one monthly limit. When it is reached they stop until the 1st.
          </p>
        </div>
        {data && !data.error && !editing && (
          <Button size="sm" variant="secondary" onClick={() => { setValue(String(data.cap ?? '')); setError(''); setEditing(true) }}>
            Change limit
          </Button>
        )}
      </div>

      <div className="px-5 pb-5 space-y-3">
        {data === null ? <Skeleton className="h-16" /> : data.error ? (
          <p className="text-xs text-red-600">Spending could not be loaded: {data.error}</p>
        ) : (
          <>
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold text-text tabular-nums">{money(data.total)} <span className="font-normal text-text-tertiary">of {data.cap == null ? 'no limit' : money(data.cap)}</span></span>
                <span className="text-xs text-text-tertiary tabular-nums">At this rate, about {money(projected)} by month end · last month {money(data.lastTotal)}</span>
              </div>
              {data.cap != null && (
                <div className="h-1.5 bg-surface-subtle mt-2 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>

            {data.bySurface.length > 0 && (
              <ul className="text-xs divide-y divide-border border-t border-border">
                {data.bySurface.map(s => (
                  <li key={s.surface} className="flex justify-between py-1.5">
                    <span className="text-text-secondary">{s.label}</span>
                    <span className="tabular-nums text-text">{money(s.cost)}</span>
                  </li>
                ))}
              </ul>
            )}

            {editing && (
              <div className="border-t border-border pt-3 space-y-2">
                <label className="block text-xs font-semibold text-text-secondary">Monthly limit in US dollars</label>
                <div className="flex gap-2">
                  <input type="number" min="1" max="5000" step="1" autoFocus value={value}
                    onChange={e => setValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
                    className="w-32 rounded-xl border border-border bg-white text-text text-sm px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  <Button size="sm" onClick={save} disabled={busy || !value}>{busy ? 'Saving…' : 'Save'}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
                <p className="text-[11px] text-text-tertiary">The other administrators are told when the limit changes.</p>
                {error && <p className="text-xs text-red-600">{error}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
