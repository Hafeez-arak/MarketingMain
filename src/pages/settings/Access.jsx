import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../store/auth'
import { Card, Button, PageHeader } from '../../components/ui/index'
import {
  fetchAllAccess, approveAccess, revokeAccess,
  fetchInvites, inviteAccess, cancelInvite,
} from '../../lib/access'

// ─── Team & Access ─────────────────────────────────────────────────────────
// Replaces the old Team page, which invited people into a localStorage array
// — a form that looked like it did something and never did. This one drives
// the real gate: public.user_access plus the approve/revoke functions.
//
// There is exactly one privilege in this application, and this page is it.
// Everything else — creating companies, deleting them, generating, posting —
// is identical for every approved person. So the page shows two lists and
// four buttons, and that is the whole permission model.

function StatusTag({ status }) {
  const style = {
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending:  'bg-amber-50 text-amber-700 border-amber-200',
    revoked:  'bg-stone-100 text-stone-500 border-stone-200',
  }[status] || 'bg-stone-100 text-stone-500 border-stone-200'
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 border ${style}`}>
      {status}
    </span>
  )
}

function PersonRow({ row, busy, onApprove, onRevoke, isSelf }) {
  const isAdmin = row.role === 'admin'
  return (
    <li className="flex items-center gap-4 px-6 py-4 hover:bg-surface-muted transition-colors">
      <div className="w-8 h-8 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 bg-stone-500">
        {(row.full_name || row.email || '?').charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text truncate">
          {row.full_name || row.email}
          {isSelf && <span className="text-text-tertiary font-normal"> (you)</span>}
        </p>
        {row.full_name && <p className="text-xs text-text-tertiary truncate">{row.email}</p>}
      </div>
      {isAdmin && (
        <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 border bg-stone-800 text-white border-stone-800">
          Admin
        </span>
      )}
      <StatusTag status={row.status} />
      <div className="flex items-center gap-1.5 flex-shrink-0 w-[132px] justify-end">
        {row.status !== 'approved' && (
          <Button size="xs" disabled={busy} onClick={() => onApprove(row)}>
            {row.status === 'revoked' ? 'Restore' : 'Approve'}
          </Button>
        )}
        {row.status === 'pending' && (
          <Button size="xs" variant="secondary" disabled={busy} onClick={() => onRevoke(row)}>Deny</Button>
        )}
        {row.status === 'approved' && !isAdmin && (
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => onRevoke(row)}>Remove</Button>
        )}
      </div>
    </li>
  )
}

export function Access() {
  const { user, isAccessAdmin, workspaces, refreshWorkspaces } = useAuth()
  const [rows, setRows]   = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId]   = useState(null)
  const [error, setError]     = useState('')
  const [notice, setNotice]   = useState('')
  const [confirm, setConfirm] = useState(null)  // person pending a remove/deny confirmation
  const [newEmail, setNewEmail] = useState('')
  const [adding, setAdding]     = useState(false)

  // Refresh after a decision. Deliberately does not flip `loading` — the
  // list is already on screen and blanking it to a spinner for 200ms makes
  // an approval feel like a page reload rather than a row changing state.
  const load = useCallback(async () => {
    const [{ rows: data, error: e }, { invites: inv }] = await Promise.all([
      fetchAllAccess(), fetchInvites(),
    ])
    setRows(data)
    setInvites(inv)
    setError(e || '')
  }, [])

  // Initial fetch. Kept separate from `load` so the effect body has no
  // synchronous setState in it; `loading` starts true and is cleared once.
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchAllAccess(), fetchInvites()]).then(([{ rows: data, error: e }, { invites: inv }]) => {
      if (cancelled) return
      setRows(data)
      setInvites(inv)
      setError(e || '')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  async function handleAdd(e) {
    e?.preventDefault()
    const email = newEmail.trim()
    if (!email) return
    setAdding(true); setError(''); setNotice('')
    const { outcome, error: err } = await inviteAccess(email)
    if (err) { setError(err); setAdding(false); return }
    // Say which of the three things happened. "Done" would leave the admin
    // unsure whether that person can log in right now or still has to sign up.
    setNotice({
      approved: `${email} now has access to every company.`,
      invited:  `${email} is cleared. They'll be let straight in when they sign up — tell them to create an account.`,
      already:  `${email} already has access.`,
    }[outcome] || 'Done.')
    setNewEmail('')
    await load()
    await refreshWorkspaces()
    setAdding(false)
  }

  async function handleCancelInvite(email) {
    setBusyId(email); setError(''); setNotice('')
    const err = await cancelInvite(email)
    if (err) setError(err)
    await load()
    setBusyId(null)
  }

  async function handleApprove(row) {
    setBusyId(row.user_id); setError('')
    const e = await approveAccess(row.user_id)
    if (e) setError(e)
    await load()
    // Approving can change the caller's own view when they are also the one
    // being restored, and always changes the roster count — cheap to resync.
    await refreshWorkspaces()
    setBusyId(null)
  }

  async function handleRevoke(row) {
    setBusyId(row.user_id); setError('')
    const e = await revokeAccess(row.user_id)
    if (e) setError(e)
    await load()
    setBusyId(null)
    setConfirm(null)
  }

  // Non-admins get the roster as a plain read — RLS already limits them to
  // their own row, so rather than render a one-row "team" list that looks
  // broken, tell them where the control actually lives.
  if (!isAccessAdmin) {
    return (
      <div className="max-w-3xl space-y-4">
        <PageHeader title="Team & Access" subtitle="Who can use this application." />
        <Card className="p-6">
          <p className="text-sm text-text-secondary leading-relaxed">
            You have full access to every company here — creating, editing,
            generating, scheduling, and publishing all work the same for
            everyone on the team.
          </p>
          <p className="text-sm text-text-secondary leading-relaxed mt-3">
            Adding or removing people is the one action reserved for the
            administrator. Ask them and it takes about ten seconds.
          </p>
        </Card>
      </div>
    )
  }

  const pending  = rows.filter(r => r.status === 'pending')
  const approved = rows.filter(r => r.status === 'approved')
  const removed  = rows.filter(r => r.status === 'revoked')

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Team & Access"
        subtitle={`Approved people get all ${workspaces.length} ${workspaces.length === 1 ? 'company' : 'companies'} with identical rights.`}
      />

      {error && (
        <div className="border border-red-200 bg-red-50/60 px-5 py-3">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}
      {notice && (
        <div className="border border-emerald-200 bg-emerald-50/60 px-5 py-3">
          <p className="text-xs text-emerald-700">{notice}</p>
        </div>
      )}

      {/* Add by email. The reactive half of this page (approving requests)
          only works once someone has signed up and is waiting; teams
          normally grow the other way round — the person is hired, and access
          is arranged before they ever open the app. */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-text text-sm">Add someone</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Works whether or not they have an account yet. Nothing is emailed — you'll still need to tell them to sign up.
          </p>
        </div>
        <form onSubmit={handleAdd} className="px-5 py-4 flex gap-2">
          <input
            type="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            placeholder="name@company.com"
            className="flex-1 border border-border bg-white text-text text-sm px-3.5 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <Button type="submit" size="sm" disabled={!newEmail.trim() || adding}>
            {adding ? 'Adding…' : 'Add'}
          </Button>
        </form>
      </Card>

      {/* People cleared but not yet signed up. Shown separately from the
          roster because they hold no access today — an invite is a promise,
          not a membership, and merging the two lists would overstate it. */}
      {invites.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-semibold text-text text-sm">Cleared, waiting to sign up</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              No account yet. They get in automatically the moment they create one.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {invites.map(inv => (
              <li key={inv.email} className="flex items-center gap-4 px-6 py-3.5 hover:bg-surface-muted transition-colors">
                <div className="w-8 h-8 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 bg-stone-400">
                  {inv.email.charAt(0).toUpperCase()}
                </div>
                <p className="flex-1 min-w-0 text-sm text-text truncate">{inv.email}</p>
                <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 border bg-sky-50 text-sky-700 border-sky-200">
                  Invited
                </span>
                <Button size="xs" variant="ghost" disabled={busyId === inv.email}
                  onClick={() => handleCancelInvite(inv.email)}>
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Requests waiting on a decision. Kept at the top and given the amber
          treatment because this is the only thing on the page that is
          waiting on the reader. */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-text text-sm">Access requests</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              Anyone who signs up lands here first. They can't see a single row of data until you approve.
            </p>
          </div>
          {pending.length > 0 && (
            <span className="text-[11px] font-bold px-2 py-1 bg-amber-100 text-amber-800 border border-amber-200">
              {pending.length}
            </span>
          )}
        </div>
        {loading ? (
          <div className="px-6 py-8 text-center text-xs text-text-tertiary">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-text-secondary">No requests waiting.</div>
        ) : (
          <ul className="divide-y divide-border bg-amber-50/30">
            {pending.map(row => (
              <PersonRow key={row.user_id} row={row} busy={busyId === row.user_id}
                onApprove={handleApprove} onRevoke={p => setConfirm({ ...p, action: 'deny' })} />
            ))}
          </ul>
        )}
      </Card>

      {/* Everyone with access */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-text text-sm">People with access</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Everyone below can do everything in every company. Only the admin can change this list.
          </p>
        </div>
        {loading ? (
          <div className="px-6 py-8 text-center text-xs text-text-tertiary">Loading…</div>
        ) : (
          <ul className="divide-y divide-border">
            {approved.map(row => (
              <PersonRow key={row.user_id} row={row} busy={busyId === row.user_id}
                isSelf={row.user_id === user?.id}
                onApprove={handleApprove} onRevoke={p => setConfirm({ ...p, action: 'remove' })} />
            ))}
          </ul>
        )}
      </Card>

      {/* Previously removed / denied — kept visible so restoring someone is a
          click rather than asking them to sign up again. */}
      {removed.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-semibold text-text text-sm">No access</h3>
            <p className="text-xs text-text-tertiary mt-0.5">Denied or removed. Their account still exists — restoring is one click.</p>
          </div>
          <ul className="divide-y divide-border">
            {removed.map(row => (
              <PersonRow key={row.user_id} row={row} busy={busyId === row.user_id}
                onApprove={handleApprove} onRevoke={() => {}} />
            ))}
          </ul>
        </Card>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(28,35,33,0.45)' }}>
          <div className="bg-white shadow-dropdown w-full max-w-sm border border-border animate-fade-scale p-6 space-y-4">
            <h3 className="font-semibold text-text text-sm">
              {confirm.action === 'deny' ? 'Deny' : 'Remove'} {confirm.full_name || confirm.email}?
            </h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              {confirm.action === 'deny'
                ? 'They stay signed up but see nothing. You can approve them later without them re-requesting.'
                : 'They lose access to every company immediately. Nothing they created is deleted, and you can restore them at any time.'}
            </p>
            <div className="flex gap-3 pt-1">
              <Button variant="secondary" className="flex-1 justify-center" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="danger" className="flex-1 justify-center"
                disabled={busyId === confirm.user_id}
                onClick={() => handleRevoke(confirm)}>
                {busyId === confirm.user_id ? 'Working…' : (confirm.action === 'deny' ? 'Deny' : 'Remove')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
