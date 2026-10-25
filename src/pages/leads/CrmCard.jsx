import { useState } from 'react'
import { Button, Spinner, Input } from '../../components/ui/index'
import { leadsApi } from '../../lib/leads/client'
import { when } from '../../lib/leads/view'

// ─── The CRM (Odoo), on Agent settings ─────────────────────────────────────
// Where Approve sends a lead (2026-10-12). The admin pastes the Odoo address,
// the login of the Odoo user the agent writes as, and that user's API key;
// Save tests it at once (read only) and, when it works, sends every lead
// approved while Odoo was not connected. The key is never shown again.
// How to make the key is in docs/LEADS-SETUP.md, not here.

const ODOO_DEFAULT = 'https://arak-co.odoo.com'

/**
 * The battle card in Odoo (2026-10-20): the team our leads go into (its
 * leads carry the card as fields), and the read back from Odoo, which runs
 * by itself at 07:50 and 13:00 and can be run now.
 */
function CardSync({ workspaceId, crm, onChange, onError }) {
  const [teams, setTeams] = useState(null)
  // Changing team takes the deals already sent along (one step to the real
  // team, the owner, 2026-10-20); untick to leave them where they are.
  const [moveSent, setMoveSent] = useState(true)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  async function loadTeams() {
    setBusy('teams')
    const r = await leadsApi('crm_teams', workspaceId)
    setBusy('')
    if (r.error) return onError(r.error)
    setTeams(r.teams)
  }

  async function chooseTeam(e) {
    const id = Number(e.target.value)
    if (!id) return
    setBusy('team'); setNote('')
    const r = await leadsApi('crm_set_team', workspaceId, { team_id: id, move_sent: moveSent && crm.sentCount > 0 })
    setBusy('')
    if (r.error) return onError(r.error)
    onChange(r.crm)
    setTeams(null)
    setNote([
      r.fieldsAdded ? 'The battle-card fields were added to that team.' : 'That team already had the battle-card fields.',
      r.moved ? `${r.moved} deal${r.moved === 1 ? '' : 's'} already sent moved there too.` : '',
    ].filter(Boolean).join(' '))
  }

  async function pullNow() {
    setBusy('pull'); setNote('')
    const r = await leadsApi('crm_pull', workspaceId)
    setBusy('')
    if (r.error) return onError(r.error)
    onChange(r.crm)
    setNote(`Read ${r.pulled.read} lead${r.pulled.read === 1 ? '' : 's'} from Odoo; ${r.pulled.updated} card${r.pulled.updated === 1 ? '' : 's'} changed here.`)
  }

  const counts = crm.lastPullCounts
  return (
    <div className="border-t border-border pt-3 space-y-2">
      <p className="text-xs text-text">
        <span className="text-text-tertiary">Battle card in Odoo: </span>
        {crm.teamId ? <>leads go into <b>{crm.teamName || `team ${crm.teamId}`}</b>, with the card as fields.</> : <span className="text-amber-800 font-semibold">no team chosen, so leads go without the card.</span>}
      </p>
      {teams && crm.sentCount > 0 && (
        <label className="flex items-center gap-2 text-[11px] text-text-secondary">
          <input type="checkbox" checked={moveSent} onChange={(e) => setMoveSent(e.target.checked)} />
          Also move the {crm.sentCount} deal{crm.sentCount === 1 ? '' : 's'} already sent to the new team (their battle cards come along)
        </label>
      )}
      {teams ? (
        <select aria-label="Sales team in Odoo" defaultValue="" onChange={chooseTeam} disabled={busy === 'team'}
          className="w-full text-xs bg-white border border-border px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400">
          <option value="" disabled>Choose the team our leads go into…</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.leader ? ` (${t.leader})` : ''}{t.id === crm.teamId ? ' · now' : ''}</option>)}
        </select>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="secondary" onClick={loadTeams} disabled={Boolean(busy)}>{busy === 'teams' ? <Spinner size="sm" /> : null}{crm.teamId ? 'Change team' : 'Choose team'}</Button>
          {crm.teamId && <Button size="xs" variant="ghost" onClick={pullNow} disabled={Boolean(busy)}>{busy === 'pull' ? <Spinner size="sm" /> : null}Read from Odoo now</Button>}
        </div>
      )}
      {crm.teamId && (
        <p className="text-[11px] text-text-tertiary">
          A card saved here goes to Odoo at once. Odoo is the master: what is changed there comes back here at 07:50 and 13:00.
          {crm.lastPullAt ? ` Last read ${when(crm.lastPullAt)}${counts ? `: ${counts.read} read, ${counts.updated} changed` : ''}.` : ' Not read yet.'}
        </p>
      )}
      {crm.lastPullError && <p className="text-[11px] text-red-600">The last read from Odoo failed: {crm.lastPullError}</p>}
      {crm.cardsNotSynced > 0 && <p className="text-[11px] text-amber-800 font-semibold">{crm.cardsNotSynced} card{crm.cardsNotSynced === 1 ? '' : 's'} not in Odoo yet; tried again at the next read.</p>}
      {note && <p className="text-[11px] text-sage-700">{note}</p>}
    </div>
  )
}

export default function CrmCard({ workspaceId, crm, loading, onChange, onError }) {
  const [form, setForm] = useState(null) // the open form's values
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  const openForm = () => {
    setNote('')
    setForm({ url: crm?.url || ODOO_DEFAULT, db: crm?.db || '', login: crm?.login || '', api_key: '' })
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    setBusy('save'); setNote('')
    const r = await leadsApi('crm_save', workspaceId, form)
    setBusy('')
    if (r.error) return onError(r.error)
    onChange(r.crm)
    if (r.crm.connected) {
      setForm(null)
      setNote(r.sent ? `Connected. Sent ${r.sent.sent} waiting lead${r.sent.sent === 1 ? '' : 's'}${r.sent.failed ? `, ${r.sent.failed} refused` : ''}.` : 'Connected.')
    }
  }

  async function sendWaiting() {
    setBusy('send'); setNote('')
    const r = await leadsApi('crm_send', workspaceId)
    setBusy('')
    if (r.error) return onError(r.error)
    onChange(r.crm)
    setNote(`Sent ${r.sent.sent}${r.sent.failed ? `, ${r.sent.failed} refused (see the leads)` : ''}${r.sent.left ? `, ${r.sent.left} more to go: send again` : ''}.`)
  }

  async function disconnect() {
    setBusy('off'); setNote('')
    const r = await leadsApi('crm_disconnect', workspaceId)
    setBusy('')
    if (r.error) return onError(r.error)
    onChange(r.crm)
  }

  const waiting = (crm?.queued || 0) + (crm?.failed || 0)
  return (
    <div className="bg-white border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text">CRM (Odoo)</p>
          <p className="text-[11px] text-text-tertiary mt-0.5">Where Approve sends a lead. Leads approved before it is connected wait here and go when it is.</p>
        </div>
        {loading ? <Spinner size="sm" /> : (
          <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 border whitespace-nowrap ${crm?.connected ? 'bg-sage-50 text-sage-700 border-sage-200' : 'bg-stone-100 text-stone-600 border-stone-200'}`}>
            {crm?.connected ? 'Connected' : 'Not connected'}
          </span>
        )}
      </div>

      {!loading && crm?.connected && (
        <p className="text-xs text-text-secondary">
          {crm.url.replace('https://', '')} · {crm.login}{crm.version ? ` · Odoo ${crm.version}` : ''}
          {crm.lastCheckedAt ? <span className="text-text-tertiary"> · checked {when(crm.lastCheckedAt)}</span> : null}
        </p>
      )}
      {!loading && crm?.lastError && <p className="text-xs text-red-600">Odoo said: {crm.lastError}</p>}
      {!loading && waiting > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-amber-800 font-semibold">
            {crm.queued ? `${crm.queued} approved lead${crm.queued === 1 ? '' : 's'} waiting` : ''}
            {crm.queued && crm.failed ? ' · ' : ''}
            {crm.failed ? `${crm.failed} refused by Odoo` : ''}
          </p>
          {crm.connected && (
            <Button size="xs" variant="secondary" onClick={sendWaiting} disabled={Boolean(busy)}>
              {busy === 'send' ? <Spinner size="sm" /> : null}Send them now
            </Button>
          )}
        </div>
      )}
      {!loading && crm?.connected && <CardSync workspaceId={workspaceId} crm={crm} onChange={onChange} onError={onError} />}
      {note && <p className="text-xs text-sage-700">{note}</p>}

      {form ? (
        <form onSubmit={save} className="space-y-2.5 border-t border-border pt-3">
          <Input id="crm-url" label="Odoo address" value={form.url} onChange={set('url')} placeholder={ODOO_DEFAULT} />
          <Input id="crm-db" label="Database" value={form.db} onChange={set('db')} placeholder="Leave empty: asked of Odoo itself" />
          <Input id="crm-login" label="Odoo user (email)" value={form.login} onChange={set('login')} placeholder="The user the agent writes as" />
          <Input id="crm-key" label="API key" type="password" autoComplete="off" value={form.api_key} onChange={set('api_key')}
            placeholder={crm?.hasKey ? 'Saved: leave empty to keep it' : 'Paste the key from Odoo'} />
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" type="submit" disabled={Boolean(busy) || !form.url.trim() || !form.login.trim() || (!form.api_key.trim() && !crm?.hasKey)}>
              {busy === 'save' ? <Spinner size="sm" /> : null}Save and test
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setForm(null)} disabled={Boolean(busy)}>Cancel</Button>
          </div>
          <p className="text-[10px] text-text-tertiary">The test only reads: it signs in, checks the user may create CRM leads, and counts them.</p>
        </form>
      ) : !loading && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant={crm?.connected ? 'secondary' : 'primary'} onClick={openForm}>{crm?.url ? 'Change' : 'Connect Odoo'}</Button>
          {crm?.url && <Button size="sm" variant="ghost" onClick={disconnect} disabled={Boolean(busy)}>Disconnect</Button>}
        </div>
      )}
    </div>
  )
}
