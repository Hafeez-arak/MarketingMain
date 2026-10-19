import { useState } from 'react'
import { Button, Select, Spinner } from '../../components/ui/index'
import { assignable, shortName, forwardWords, leadLabels } from '../../lib/leads/view'
import { useT } from '../../lib/i18n'
import { LW } from './words'

// ─── Assign, or reassign, one lead ─────────────────────────────────────────
// Shared by the Inbox, the Pipeline and the Lead tab (2026-10-19: "it would
// be better as reassign"). Reassigning works at any stage, and the lead
// keeps it: its stage, battle card, next step and notes move with it to the
// new person, and the old one no longer sees it. The dialog says so, and
// what is sent, before anything happens.

const stop = (e) => e.stopPropagation()

/** The salespeople as choices. A sales admin assigns leads and is not one of them. */
export function PersonOptions({ team }) {
  return assignable(team).map((m) => (
    <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>
  ))
}

export default function AssignDialog({ lead, team, busy, error, onCancel, onConfirm }) {
  const { t, lang, dir } = useT(LW)
  const STAGE = leadLabels(lang).stage
  const [to, setTo] = useState(lead.assigned_to || '')
  const person = team.find((m) => m.user_id === to)
  const current = team.find((m) => m.user_id === lead.assigned_to)
  const same = to && to === lead.assigned_to
  const moving = lead.assigned_to && to && !same
  const canClear = lead.assigned_to && !lead.approved_at && !lead.crm_status && !lead.stage?.match(/^(won|lost)$/)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(28,35,33,0.45)' }} onClick={busy ? undefined : onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="assign-title" onClick={stop} dir={dir} lang={lang}
        className="bg-white shadow-dropdown w-full max-w-md border border-border animate-fade-scale p-6 space-y-4">
        <h3 id="assign-title" className="font-semibold text-text text-sm">{lead.assigned_to ? t.reassignQ : t.whoWorksQ}</h3>
        <p className="text-xs text-text" dir="auto">{lead.company || lead.name || lead.email}: {lead.summary || lead.subject}</p>
        {lead.assigned_to && (
          <p className="text-xs text-text-secondary">{t.nowWith}<span className="font-semibold text-text">{current ? (current.full_name || current.email) : t.someoneLeft}</span>{lead.stage ? <> · {STAGE[lead.stage]}</> : null}</p>
        )}
        <Select label={lead.assigned_to ? t.moveTo : t.assignTo} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">{t.choosePerson}</option>
          <PersonOptions team={team} />
        </Select>
        {!assignable(team).length && <p className="text-xs text-red-600">{t.noSalesperson}</p>}
        {to && (
          <div className="text-xs text-text-secondary leading-relaxed space-y-1">
            {same
              ? <p>{t.hasAlready(shortName(person))}</p>
              : <p>{forwardWords(lead, person, lang)}</p>}
            {moving && lead.stage && <p>{t.staysAt}<span className="font-semibold text-text">{STAGE[lead.stage]}</span>{t.staysWith}{current && !current.approver ? t.noLongerSees(shortName(current)) : ''}</p>}
            {!lead.assigned_to && <p>{t.intoPipeline}</p>}
            {lead.crm_status === 'sent' && !same && <p>{t.odooToo}</p>}
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1 justify-center" disabled={busy} onClick={onCancel}>{t.cancel}</Button>
          <Button className="flex-1 justify-center" disabled={busy || !to} onClick={() => onConfirm(to)}>
            {busy ? <Spinner size="sm" /> : null}{busy ? t.moving : same ? t.sendAgain : lead.assigned_to ? t.reassign : t.assign}
          </Button>
        </div>
        {canClear && (
          <button type="button" disabled={busy} onClick={() => onConfirm(null)} className="text-[11px] text-text-tertiary hover:text-text underline">
            {t.takeOff(shortName(current) || t.them)}
          </button>
        )}
      </div>
    </div>
  )
}
