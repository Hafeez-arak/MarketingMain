import { useState } from 'react'
import { Button, Spinner, Toggle } from '../../components/ui/index'
import { leadsApi } from '../../lib/leads/client'

// ─── The sales team, on Agent settings (2026-10-13) ────────────────────────
// Everyone with a sales seat in this company: the people leads are assigned
// to. Per person: whether they also see every website enquiry (the owner's
// choice for Faisal; everyone else sees only their own), and who they are in
// Odoo, so a lead goes in with them as its salesperson. Odoo is asked by
// their email unless an Odoo login is set here. Who is on the team is
// decided in Team & Access, not here.

function OdooLogin({ member, workspaceId, onChange, onError }) {
  const [value, setValue] = useState(null)
  const [busy, setBusy] = useState(false)
  const saved = member.odoo_login || ''
  const typed = value ?? saved

  async function save() {
    setBusy(true)
    const r = await leadsApi('team_save', workspaceId, { user_id: member.user_id, odoo_login: typed })
    setBusy(false)
    if (r.error) return onError(r.error)
    setValue(null)
    onChange(r.team)
  }

  return (
    <div className="flex gap-2 items-center">
      <label htmlFor={`odoo-login-${member.user_id}`} className="text-[11px] text-text-tertiary whitespace-nowrap">Odoo login</label>
      <input id={`odoo-login-${member.user_id}`} type="text" value={typed} onChange={(e) => setValue(e.target.value)} placeholder={member.email}
        className="flex-1 min-w-0 px-2 py-1 border border-border text-[11px] focus:outline-none focus:border-amber-700" />
      {value !== null && value !== saved && <Button size="xs" onClick={save} disabled={busy}>{busy ? <Spinner size="sm" /> : 'Save'}</Button>}
    </div>
  )
}

export default function TeamCard({ workspaceId, team, loading, odooConnected, onChange, onError }) {
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  async function setWebsite(member, on) {
    setBusy(`web:${member.user_id}`)
    const r = await leadsApi('team_save', workspaceId, { user_id: member.user_id, all_website_leads: on })
    setBusy('')
    if (r.error) return onError(r.error)
    onChange(r.team)
  }

  async function checkOdoo() {
    setBusy('odoo'); setNote('')
    const r = await leadsApi('team_odoo', workspaceId)
    setBusy('')
    if (r.error) return onError(r.error)
    onChange(r.team)
    setNote(r.missing.length ? `Not found in Odoo: ${r.missing.join(', ')}. Add them in Odoo, or set the Odoo login they use.` : 'Everyone was found in Odoo.')
  }

  return (
    <div className="bg-white border border-border p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-text">Sales team</p>
        <p className="text-[11px] text-text-tertiary mt-0.5">
          Who leads are assigned to. Each person sees only the leads assigned to them; sales admins see all. People are added in Team &amp; Access.
        </p>
      </div>

      {loading ? <Spinner size="sm" /> : !team.length ? (
        <p className="text-[11px] text-text-tertiary">No one has a sales seat in this company yet.</p>
      ) : (
        <ul className="space-y-2">
          {team.map((m) => (
            <li key={m.user_id} className="border border-border px-2.5 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-text truncate">
                  {m.full_name || m.email}
                  {m.full_name && <span className="font-normal text-text-tertiary"> · {m.email}</span>}
                </p>
                {m.approver && <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-amber-100 text-amber-800 whitespace-nowrap">Sales admin</span>}
              </div>
              {m.approver ? (
                <p className="text-[11px] text-text-tertiary">Sees every lead, and assigns them.</p>
              ) : (
                <div className={busy === `web:${m.user_id}` ? 'opacity-50 pointer-events-none' : ''}>
                  <Toggle checked={m.all_website_leads} onChange={(on) => setWebsite(m, on)}
                    label={<span className="text-[11px] text-text-secondary">Also sees every website enquiry</span>} />
                </div>
              )}
              <OdooLogin member={m} workspaceId={workspaceId} onChange={onChange} onError={onError} />
              <p className={`text-[10px] ${m.odoo_user_id ? 'text-sage-700' : 'text-text-tertiary'}`}>
                {m.odoo_user_id ? `Found in Odoo (user ${m.odoo_user_id}).` : odooConnected ? 'Not looked up in Odoo yet.' : 'Looked up in Odoo once it is connected.'}
              </p>
            </li>
          ))}
        </ul>
      )}

      {odooConnected && team.length > 0 && (
        <Button size="xs" variant="secondary" onClick={checkOdoo} disabled={busy === 'odoo'}>
          {busy === 'odoo' ? <Spinner size="sm" /> : null}Find them in Odoo
        </Button>
      )}
      {note && <p className="text-[11px] text-text-secondary">{note}</p>}
    </div>
  )
}
