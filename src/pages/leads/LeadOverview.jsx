import { useState } from 'react'
import { Button, Spinner } from '../../components/ui/index'
import { leadsApi } from '../../lib/leads/client'
import { channelLabel, phonesOf, projectOf, when, whatsappLink, leadLabels } from '../../lib/leads/view'
import { followUpState, riyadhToday } from '../../lib/leads/pipeline'
import { useT, fmtDay } from '../../lib/i18n'
import { LW } from './words'
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
  const { t, lang } = useT(LW)
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
          placeholder={t.nextStepPh} aria-label={t.nextStepAria} className={input} dir="auto" />
        <input type="date" value={edit.follow_up} onChange={(e) => setEdit({ ...edit, follow_up: e.target.value })} aria-label={t.followAria} className={`${input} max-w-[12rem]`} />
        <div className="flex items-center gap-2">
          <Button size="xs" onClick={save} disabled={state.busy}>{state.busy ? <Spinner size="sm" /> : null}{t.save}</Button>
          <Button size="xs" variant="ghost" onClick={() => setEdit(null)} disabled={state.busy}>{t.cancel}</Button>
          {state.error && <span className="text-[11px] text-red-600">{state.error}</span>}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm text-text" dir="auto">{lead.next_step || <span className="text-text-tertiary">{t.noNextStep}</span>}</p>
        <p className={`text-xs ${FOLLOW_TONE[f] || 'text-text-secondary'}`}>
          {lead.follow_up ? t.followUp(fmtDay(lead.follow_up, lang), f) : t.noFollowDate}
        </p>
      </div>
      <Button size="xs" variant="secondary" onClick={() => setEdit({ next_step: lead.next_step || '', follow_up: lead.follow_up || '' })}>{t.change}</Button>
    </div>
  )
}

export default function LeadOverview({ lead, workspaceId, team = [], me = '', onChange, onReassign }) {
  const { t, lang } = useT(LW)
  const L = leadLabels(lang)
  const d = lead.details || {}
  const phones = phonesOf(lead)
  const owner = team.find((m) => m.user_id === lead.assigned_to)
  const phase = projectOf(lead)
  const who = [L.sender[lead.sender_type], lead.source_check === 'verified' ? t.verifiedLc : lead.source_check ? t.notVerifiedLc : ''].filter(Boolean).join(' · ')

  return (
    <div className="px-4 pb-4 pt-3 md:ps-[8.25rem] text-xs space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        {/* ── Who, and how to reach them ── */}
        <Box title={t.contact}>
          <p className="text-sm font-semibold text-text" dir="auto">{lead.company || lead.name || lead.email || t.unknownSender}</p>
          {lead.company && lead.name && <p className="text-text-secondary mt-0.5" dir="auto">{lead.name}</p>}
          {who && <p className="text-text-tertiary mt-0.5">{who}</p>}
          <div className="mt-3 space-y-1.5">
            {phones.map((p) => (
              <div key={p} className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums text-text" dir="ltr">{p}</span>
                <a href={`tel:${p.replace(/[^\d+]/g, '')}`} className="inline-flex items-center px-2 py-0.5 border border-border hover:bg-surface-subtle text-text font-semibold">{t.call}</a>
                {whatsappLink(p) && <a href={whatsappLink(p)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center px-2 py-0.5 border border-sage-200 bg-sage-50 text-sage-700 hover:bg-sage-100 font-semibold">{t.whatsapp}</a>}
              </div>
            ))}
            {lead.email && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-text break-all" dir="ltr">{lead.email}</span>
                <a href={`mailto:${lead.email}`} className="inline-flex items-center px-2 py-0.5 border border-border hover:bg-surface-subtle text-text font-semibold">{t.emailBtn}</a>
              </div>
            )}
            {!phones.length && !lead.email && <p className="text-text-tertiary">{t.noPhoneEmail}</p>}
          </div>
        </Box>

        {/* ── Where it stands ── */}
        <Box title={t.whereStands} aside={lead.stage ? <span className={`text-[11px] font-semibold px-2 py-0.5 ${lead.stage === 'won' ? 'bg-sage-50 text-sage-700' : lead.stage === 'lost' ? 'bg-red-50 text-red-600' : 'bg-stone-100 text-text'}`}>{L.stage[lead.stage]}</span> : null}>
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
            <Row label={t.ownerL}>
              <span className="flex flex-wrap items-center gap-2">
                <span>{lead.assigned_to ? (lead.assigned_to === me ? t.youCap : owner ? (owner.full_name || owner.email) : t.someoneLeftCap) : <span className="text-text-tertiary">{t.noOneYet}</span>}</span>
                {/* A sales admin moves it, at any stage; it keeps its stage and card. */}
                {onReassign && <Button size="xs" variant="secondary" onClick={onReassign}>{lead.assigned_to ? t.reassign : t.assign}</Button>}
              </span>
            </Row>
            {lead.assigned_at && <Row label={t.assignedL}>{when(lead.assigned_at, lang)}{lead.forward_status === 'failed' ? <span className="text-red-600">{t.emailNotFwd}</span> : lead.forward_status === 'sent' ? t.emailFwd : ''}</Row>}
            {lead.stage_at && <Row label={t.stageSince}>{when(lead.stage_at, lang)}</Row>}
            {lead.stage === 'lost' && <Row label={t.lostL}>{L.lost[lead.lost_reason] || ''}{lead.lost_to ? t.toWhom(lead.lost_to) : ''}</Row>}
            <Row label={t.odooL}>{lead.crm_status ? L.crm[lead.crm_status] : <span className="text-text-tertiary">{t.notSentYet}</span>}</Row>
          </dl>
          {lead.stage && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="eyebrow mb-1.5">{t.nextStepT}</p>
              <NextStep lead={lead} workspaceId={workspaceId} onChange={onChange} />
            </div>
          )}
        </Box>
      </div>

      {/* ── What they want ── */}
      <Box title={t.whatWant}>
        <p className="text-sm text-text leading-relaxed" dir="auto">{lead.summary || lead.subject || <span className="text-text-tertiary">{t.notInEnquiry}</span>}</p>
        <dl className="mt-3 grid grid-cols-[6.5rem_1fr] sm:grid-cols-[6.5rem_1fr_6.5rem_1fr] gap-x-3 gap-y-1.5">
          <Row label={t.o.products}>{[d.products, d.quantity].filter(Boolean).join(' · ')}</Row>
          <Row label={t.o.brands}>{[d.brands, L.philips[lead.philips]].filter(Boolean).join(' · ')}</Row>
          <Row label={t.o.location}>{d.location}</Row>
          <Row label={t.o.deadline}>{d.urgency}</Row>
          <Row label={t.o.project}>{phase ? L.project[phase] || phase : ''}</Row>
          <Row label={t.o.request}>{L.request[lead.request_type]}</Row>
          <Row label={t.o.cameIn}>{channelLabel(lead, { lang })}{lead.source === 'email' && lead.folder ? ` · ${L.folder[lead.folder] || lead.folder}` : ''}</Row>
          <Row label={t.o.received}>{when(lead.received_at || lead.created_at, lang)}</Row>
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
