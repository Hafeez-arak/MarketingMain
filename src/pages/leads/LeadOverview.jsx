import { useState } from 'react'
import { Button, Spinner } from '../../components/ui/index'
import { leadsApi } from '../../lib/leads/client'
import {
  SENDER_LABEL, PROJECT_LABEL, REQUEST_LABEL, FOLDER_LABEL, PHILIPS_LABEL, CRM_LABEL,
  channelLabel, phonesOf, projectOf, when, whatsappLink,
} from '../../lib/leads/view'
import { STAGE_LABEL, LOST_REASON_LABEL, followUpState, riyadhToday, shortDate } from '../../lib/leads/pipeline'
import { Attachments } from './parts'

// ─── The Lead tab (2026-10-19) ─────────────────────────────────────────────
// The owner: a "lead details" tab before the battle card, the one that opens
// once a lead is assigned. Everything a salesperson needs to pick up the
// phone, on one screen: who, how to reach them (call, WhatsApp, email),
// what they want, where it came from, who has it, where it stands with its
// next step and follow-up (editable here), and the files that came with it.
// Before, this was spread over the row, the email tab and the card.

const dash = <span className="text-text-tertiary">—</span>

function Row({ label, children }) {
  return (
    <div className="contents">
      <dt className="text-text-tertiary pt-0.5">{label}</dt>
      <dd className="min-w-0 text-text break-words" dir="auto">{children || dash}</dd>
    </div>
  )
}

function Box({ title, children, aside }) {
  return (
    <section className="border border-border bg-white">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-text">{title}</h4>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

const FOLLOW_TONE = { overdue: 'text-red-600 font-semibold', today: 'text-amber-800 font-semibold' }
const input = 'w-full border border-border bg-white text-text text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400'

/** The next step and follow-up date, changed here without opening the card. */
function NextStep({ lead, workspaceId, onChange }) {
  const [edit, setEdit] = useState(null) // { next_step, follow_up } while editing
  const [state, setState] = useState({ busy: false, error: '' })
  const f = followUpState(lead.follow_up, riyadhToday())
  async function save() {
    setState({ busy: true, error: '' })
    const r = await leadsApi('stage', workspaceId, { lead_id: lead.id, next_step: edit.next_step, follow_up: edit.follow_up })
    if (r.error) return setState({ busy: false, error: r.error })
    setState({ busy: false, error: '' })
    setEdit(null)
    onChange?.(r.lead)
  }
  if (edit) {
    return (
      <div className="space-y-2">
        <input value={edit.next_step} onChange={(e) => setEdit({ ...edit, next_step: e.target.value })} maxLength={500}
          placeholder="e.g. Send the quote, call the PM" aria-label="Next step" className={input} dir="auto" />
        <input type="date" value={edit.follow_up} onChange={(e) => setEdit({ ...edit, follow_up: e.target.value })} aria-label="Follow-up date" className={`${input} max-w-[12rem]`} />
        <div className="flex items-center gap-2">
          <Button size="xs" onClick={save} disabled={state.busy}>{state.busy ? <Spinner size="sm" /> : null}Save</Button>
          <Button size="xs" variant="ghost" onClick={() => setEdit(null)} disabled={state.busy}>Cancel</Button>
          {state.error && <span className="text-[11px] text-red-600">{state.error}</span>}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm text-text" dir="auto">{lead.next_step || <span className="text-text-tertiary">No next step yet</span>}</p>
        <p className={`text-xs ${FOLLOW_TONE[f] || 'text-text-secondary'}`}>
          {lead.follow_up ? `Follow up ${shortDate(lead.follow_up)}${f === 'overdue' ? ' · overdue' : f === 'today' ? ' · today' : ''}` : 'No follow-up date'}
        </p>
      </div>
      <Button size="xs" variant="secondary" onClick={() => setEdit({ next_step: lead.next_step || '', follow_up: lead.follow_up || '' })}>Change</Button>
    </div>
  )
}

export default function LeadOverview({ lead, workspaceId, team = [], me = '', onChange, onReassign }) {
  const d = lead.details || {}
  const phones = phonesOf(lead)
  const owner = team.find((m) => m.user_id === lead.assigned_to)
  const phase = projectOf(lead)
  const who = [SENDER_LABEL[lead.sender_type], lead.source_check === 'verified' ? 'verified' : lead.source_check ? 'not verified' : ''].filter(Boolean).join(' · ')

  return (
    <div className="px-4 pb-4 pt-3 md:pl-[8.25rem] text-xs space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        {/* ── Who, and how to reach them ── */}
        <Box title="Contact">
          <p className="text-sm font-semibold text-text" dir="auto">{lead.company || lead.name || lead.email || 'Unknown sender'}</p>
          {lead.company && lead.name && <p className="text-text-secondary mt-0.5" dir="auto">{lead.name}</p>}
          {who && <p className="text-text-tertiary mt-0.5">{who}</p>}
          <div className="mt-3 space-y-1.5">
            {phones.map((p) => (
              <div key={p} className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums text-text" dir="ltr">{p}</span>
                <a href={`tel:${p.replace(/[^\d+]/g, '')}`} className="inline-flex items-center px-2 py-0.5 border border-border hover:bg-surface-subtle text-text font-semibold">Call</a>
                {whatsappLink(p) && <a href={whatsappLink(p)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center px-2 py-0.5 border border-sage-200 bg-sage-50 text-sage-700 hover:bg-sage-100 font-semibold">WhatsApp</a>}
              </div>
            ))}
            {lead.email && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-text break-all">{lead.email}</span>
                <a href={`mailto:${lead.email}`} className="inline-flex items-center px-2 py-0.5 border border-border hover:bg-surface-subtle text-text font-semibold">Email</a>
              </div>
            )}
            {!phones.length && !lead.email && <p className="text-text-tertiary">No phone or email in the enquiry.</p>}
          </div>
        </Box>

        {/* ── Where it stands ── */}
        <Box title="Where it stands" aside={lead.stage ? <span className={`text-[11px] font-semibold px-2 py-0.5 ${lead.stage === 'won' ? 'bg-sage-50 text-sage-700' : lead.stage === 'lost' ? 'bg-red-50 text-red-600' : 'bg-stone-100 text-text'}`}>{STAGE_LABEL[lead.stage]}</span> : null}>
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
            <Row label="Owner">
              <span className="flex flex-wrap items-center gap-2">
                <span>{lead.assigned_to ? (lead.assigned_to === me ? 'You' : owner ? (owner.full_name || owner.email) : 'Someone who left the team') : <span className="text-text-tertiary">No one yet</span>}</span>
                {/* A sales admin moves it, at any stage; it keeps its stage and card. */}
                {onReassign && <Button size="xs" variant="secondary" onClick={onReassign}>{lead.assigned_to ? 'Reassign' : 'Assign'}</Button>}
              </span>
            </Row>
            {lead.assigned_at && <Row label="Assigned">{when(lead.assigned_at)}{lead.forward_status === 'failed' ? <span className="text-red-600"> · email not forwarded</span> : lead.forward_status === 'sent' ? ' · email forwarded' : ''}</Row>}
            {lead.stage_at && <Row label="Stage since">{when(lead.stage_at)}</Row>}
            {lead.stage === 'lost' && <Row label="Lost">{LOST_REASON_LABEL[lead.lost_reason] || ''}{lead.lost_to ? `, to ${lead.lost_to}` : ''}</Row>}
            <Row label="Odoo">{lead.crm_status ? CRM_LABEL[lead.crm_status] : <span className="text-text-tertiary">Not sent yet</span>}</Row>
          </dl>
          {lead.stage && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="eyebrow mb-1.5">Next step</p>
              <NextStep lead={lead} workspaceId={workspaceId} onChange={onChange} />
            </div>
          )}
        </Box>
      </div>

      {/* ── What they want ── */}
      <Box title="What they want">
        <p className="text-sm text-text leading-relaxed" dir="auto">{lead.summary || lead.subject || <span className="text-text-tertiary">Not in the enquiry</span>}</p>
        <dl className="mt-3 grid grid-cols-[6.5rem_1fr] sm:grid-cols-[6.5rem_1fr_6.5rem_1fr] gap-x-3 gap-y-1.5">
          <Row label="Products">{[d.products, d.quantity].filter(Boolean).join(' · ')}</Row>
          <Row label="Brands">{[d.brands, PHILIPS_LABEL[lead.philips]].filter(Boolean).join(' · ')}</Row>
          <Row label="Location">{d.location}</Row>
          <Row label="Deadline">{d.urgency}</Row>
          <Row label="Project">{phase ? PROJECT_LABEL[phase] || phase : ''}</Row>
          <Row label="Request">{REQUEST_LABEL[lead.request_type]}</Row>
          <Row label="Came in">{channelLabel(lead)}{lead.source === 'email' && lead.folder ? ` · ${FOLDER_LABEL[lead.folder] || lead.folder}` : ''}</Row>
          <Row label="Received">{when(lead.received_at || lead.created_at)}</Row>
        </dl>
        {lead.source === 'manual' && lead.message && (
          <p className="mt-3 pt-3 border-t border-border whitespace-pre-wrap text-text-secondary leading-relaxed" dir="auto">{lead.message}</p>
        )}
      </Box>

      {/* ── Files ── */}
      {lead.source === 'email' && (
        <div className="border border-border bg-white p-4">
          <Attachments lead={lead} workspaceId={workspaceId} />
        </div>
      )}
    </div>
  )
}
