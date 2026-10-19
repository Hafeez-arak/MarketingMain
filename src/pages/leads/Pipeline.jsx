import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Select, Skeleton, Spinner, Textarea } from '../../components/ui/index'
import { fetchPipeline, leadsApi } from '../../lib/leads/client'
import { channelLabel, ownerLabel, phonesOf, when, assignable, leadTabs, leadLabels } from '../../lib/leads/view'
import { useT, fmtDay } from '../../lib/i18n'
import { LW } from './words'
import {
  STAGES, OPEN_STAGES, groupByStage, pipelineStats, followUpState, riyadhToday,
} from '../../lib/leads/pipeline'
import { LeadDetail, LeadTabs, LeadName, MarkUnread } from './parts'
import { useLeadReads } from './useLeadReads'
import LeadOverview from './LeadOverview'
import AssignDialog from './AssignDialog'
import BattleCard from './BattleCard'
import LeadTasks from './LeadTasks'

// ─── The Pipeline (2026-10-18) ─────────────────────────────────────────────
// The owner: assigned and approved leads, and leads the team adds by hand,
// gather in one place (assigning puts a lead here since 2026-10-19). Grouped by stage (Odoo's own, so they map over when Odoo connects),
// each row with its owner, a stage dropdown that changes it in one click,
// the next step and the follow-up date, due ones in red. An opened lead has
// the stage bar on top and its battle card below.
//
// A salesperson sees their own (the database decides, can_see_lead); a
// sales admin sees everyone's and filters by owner.

const stop = (e) => e.stopPropagation()

const FOLLOW_TONE = { overdue: 'text-red-600 font-semibold', today: 'text-amber-800 font-semibold', soon: 'text-text', later: 'text-text-secondary', '': 'text-text-tertiary' }

const GRID = 'md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_6.5rem_7.5rem_9rem_minmax(0,1.4fr)] md:gap-3 md:items-start'

/** "Lost, why?": the reason is required, who won it is not. */
function LostDialog({ lead, busy, error, onCancel, onConfirm }) {
  const { t, lang, dir } = useT(LW)
  const [why, setWhy] = useState(lead.lost_reason || '')
  const [to, setTo] = useState(lead.lost_to || '')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(28,35,33,0.45)' }} onClick={busy ? undefined : onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="lost-title" onClick={stop} dir={dir} lang={lang}
        className="bg-white shadow-dropdown w-full max-w-md border border-border animate-fade-scale p-6 space-y-4">
        <h3 id="lost-title" className="font-semibold text-text text-sm">{t.whyLost}</h3>
        <p className="text-xs text-text" dir="auto">{lead.company || lead.name || lead.email}: {lead.summary || lead.subject}</p>
        <Select label={t.reason} value={why} onChange={(e) => setWhy(e.target.value)}>
          <option value="">{t.choose}</option>
          {Object.entries(leadLabels(lang).lost).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Input label={t.whoWon} value={to} onChange={(e) => setTo(e.target.value)} maxLength={200} placeholder={t.competitorPh} dir="auto" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1 justify-center" disabled={busy} onClick={onCancel}>{t.cancel}</Button>
          <Button className="flex-1 justify-center" disabled={busy || !why} onClick={() => onConfirm({ stage: 'lost', lost_reason: why, lost_to: to })}>
            {busy ? <Spinner size="sm" /> : null}{t.markLost}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Moving a lead's stage, shared by the row's dropdown and the stage bar:
 * Lost asks why first; everything else is saved at once.
 */
function useStageChange(workspaceId, onChange) {
  const [asking, setAsking] = useState(null) // the lead being marked lost
  const [state, setState] = useState({ busy: false, error: '' })
  async function send(lead, fields) {
    setState({ busy: true, error: '' })
    const r = await leadsApi('stage', workspaceId, { lead_id: lead.id, ...fields })
    if (r.error) { setState({ busy: false, error: r.error }); return false }
    setState({ busy: false, error: '' })
    setAsking(null)
    onChange(r.lead)
    return true
  }
  function change(lead, stage) {
    if (stage !== 'lost') return send(lead, { stage })
    setState({ busy: false, error: '' })
    setAsking(lead)
  }
  const dialog = asking
    ? <LostDialog lead={asking} busy={state.busy} error={state.error} onCancel={() => setAsking(null)} onConfirm={(f) => send(asking, f)} />
    : null
  return { change, dialog, error: asking ? '' : state.error, busy: state.busy }
}

/** The stage bar on an opened lead, like Odoo's: click a stage to move it there. */
export function StageBar({ lead, workspaceId, onChange }) {
  const { t, lang } = useT(LW)
  const L = leadLabels(lang)
  const { change, dialog, error, busy } = useStageChange(workspaceId, onChange)
  if (!lead.stage) return null
  const at = STAGES.findIndex(([k]) => k === lead.stage)
  return (
    <div className="px-4 pt-3 md:ps-[8.25rem] space-y-1.5">
      <div className="flex flex-wrap items-stretch gap-1" role="group" aria-label={t.stage}>
        {STAGES.map(([k], i) => {
          const label = L.stage[k]
          const current = k === lead.stage
          const end = k === 'won' || k === 'lost'
          const passed = !end && lead.stage !== 'lost' && i < at
          const tone = current
            ? (k === 'won' ? 'bg-sage-700 text-white border-sage-700' : k === 'lost' ? 'bg-red-600 text-white border-red-600' : 'bg-stone-800 text-white border-stone-800')
            : passed ? 'bg-stone-100 text-text border-border' : 'bg-white text-text-secondary border-border hover:bg-surface-subtle'
          return (
            <button key={k} type="button" disabled={busy || current} onClick={() => change(lead, k)} aria-pressed={current}
              className={`text-[11px] px-2.5 py-1 border font-semibold transition-colors disabled:cursor-default ${tone} ${k === 'won' ? 'md:ms-2' : ''}`}>
              {!end && i > 0 ? <span className="me-1 opacity-50">{lang === 'ar' ? '‹' : '›'}</span> : null}{label}
            </button>
          )
        })}
        {busy && <Spinner size="sm" />}
      </div>
      {lead.stage === 'lost' && lead.lost_reason && (
        <p className="text-[11px] text-red-700">{t.lostLine(L.lost[lead.lost_reason], lead.lost_to)}</p>
      )}
      {lead.stage_at && <p className="text-[10px] text-text-tertiary">{t.since(L.stage[lead.stage], when(lead.stage_at, lang))}</p>}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {dialog}
    </div>
  )
}

function StageSelect({ lead, onPick, busy }) {
  const { t, lang } = useT(LW)
  const tone = lead.stage === 'won' ? 'text-sage-700' : lead.stage === 'lost' ? 'text-red-600' : 'text-text'
  return (
    <span onClick={stop} className="block -ms-1">
      <select aria-label={t.stage} value={lead.stage} disabled={busy} onChange={(e) => onPick(lead, e.target.value)}
        className={`max-w-full text-xs font-semibold bg-transparent border border-border hover:border-text-tertiary focus:outline-none px-1.5 py-1 cursor-pointer disabled:opacity-50 ${tone}`}>
        {STAGES.map(([k]) => <option key={k} value={k}>{leadLabels(lang).stage[k]}</option>)}
      </select>
    </span>
  )
}

function Row({ lead, open, onToggle, onPick, busy, team, me, workspaceId, mailboxes, onReview, onChange, today, canAll, onDeleted, unread, onMarkUnread, onAssign }) {
  const { t, lang } = useT(LW)
  const L = leadLabels(lang)
  const [tab, setTab] = useState('lead')
  const f = followUpState(lead.follow_up, today)
  return (
    <li id={`lead-${lead.id}`} className={`scroll-mt-4 ${open ? 'bg-surface-subtle' : ''}`}>
      <div role="button" tabIndex={0} onClick={onToggle} aria-expanded={open}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle() } }}
        className={`w-full text-start px-4 py-3 hover:bg-surface-subtle transition-colors cursor-pointer grid grid-cols-2 gap-x-3 gap-y-1.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 ${GRID}`}>
        <div className="col-span-2 md:col-span-1 min-w-0">
          <LeadName lead={lead} unread={unread} fallback={t.unknown} />
          <span className="text-[11px] text-text-tertiary truncate block" dir="auto">
            {[lead.company ? lead.name : '', phonesOf(lead)[0]].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="col-span-2 md:col-span-1 min-w-0">
          <span className="text-xs text-text line-clamp-2" dir="auto">{lead.summary || lead.subject}</span>
          <span className="text-[10px] text-text-tertiary">{[L.sender[lead.sender_type], L.project[lead.project_final]].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="min-w-0">
          <span className="md:hidden text-[10px] text-text-tertiary uppercase tracking-wide me-1.5">{t.pcol.cameIn}</span>
          <span className="text-[11px] text-text-secondary">{channelLabel(lead, { lang })}</span>
          <span className="block text-[10px] text-text-tertiary tabular-nums">{when(lead.received_at || lead.created_at, lang)}</span>
        </div>
        <div className="min-w-0">
          <span className="md:hidden text-[10px] text-text-tertiary uppercase tracking-wide me-1.5">{t.pcol.owner}</span>
          {onAssign ? (
            <button type="button" onClick={(e) => { stop(e); onAssign(lead) }} title={lead.assigned_to ? t.reassignTitle : t.assign}
              className={`text-xs hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 ${lead.assigned_to ? (lead.assigned_to === me ? 'font-semibold text-text' : 'text-text') : 'text-amber-800 font-semibold'}`}>
              {lead.assigned_to ? ownerLabel(lead, team, me, lang) : t.assign}
            </button>
          ) : (
            <span className={`text-xs ${lead.assigned_to ? (lead.assigned_to === me ? 'font-semibold text-text' : 'text-text') : 'text-text-tertiary'}`}>{ownerLabel(lead, team, me, lang)}</span>
          )}
          {lead.crm_status && <span className="block text-[10px] text-text-tertiary">{L.crm[lead.crm_status]}</span>}
        </div>
        <div className="min-w-0">
          <StageSelect lead={lead} onPick={onPick} busy={busy} />
        </div>
        <div className="col-span-2 md:col-span-1 min-w-0">
          {lead.follow_up
            ? <span className={`text-xs tabular-nums ${FOLLOW_TONE[f]}`}>{fmtDay(lead.follow_up, lang)}{t.followWord[f] ? ` · ${t.followWord[f]}` : ''}</span>
            : <span className="text-xs text-text-tertiary">{OPEN_STAGES.includes(lead.stage) ? t.noFollowUp : '—'}</span>}
          {lead.next_step && <span className="block text-[11px] text-text-secondary line-clamp-2" dir="auto">{lead.next_step}</span>}
        </div>
      </div>
      {open && (
        <div className="border-t border-border bg-white">
          <StageBar lead={lead} workspaceId={workspaceId} onChange={onChange} />
          <LeadTasks lead={lead} workspaceId={workspaceId} me={me} />
          <LeadTabs tabs={leadTabs(lead, lang)} value={tab} onChange={setTab}>
            <MarkUnread onClick={onMarkUnread} />
            <DeleteLead lead={lead} workspaceId={workspaceId} me={me} canAll={canAll} onDeleted={onDeleted} />
          </LeadTabs>
          {tab === 'lead'
            ? <LeadOverview lead={lead} workspaceId={workspaceId} team={team} me={me} onChange={onChange} onReassign={onAssign ? () => onAssign(lead) : undefined} />
            : tab === 'card'
              ? <BattleCard lead={lead} workspaceId={workspaceId} onLeadChange={onChange} />
              : <LeadDetail lead={lead} onReview={onReview} workspaceId={workspaceId} mailboxes={mailboxes} wide />}
        </div>
      )}
    </li>
  )
}

export default function Pipeline({ workspaceId, refreshKey = 0, canApprove = false, team = [], me = '', mailboxes = [], onReview, onCount, focus = '' }) {
  const { t, lang, dir } = useT(LW)
  const [owner, setOwner] = useState(canApprove ? '' : 'me')
  const [search, setSearch] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [open, setOpen] = useState(null)
  const [data, setData] = useState({ key: null, rows: [], error: '' })
  const wanted = useRef('')

  const key = `${workspaceId}|${owner}|${refreshKey}`
  const load = useCallback(async () => {
    if (!workspaceId) return
    wanted.current = key
    try {
      const rows = await fetchPipeline(workspaceId, { owner, me })
      if (wanted.current === key) setData({ key, rows, error: '' })
    } catch (err) {
      if (wanted.current === key) setData({ key, rows: [], error: err.message || String(err) })
    }
  }, [workspaceId, owner, me, key])
  useEffect(() => { queueMicrotask(load) }, [load])

  const reads = useLeadReads(workspaceId, me, data.rows)

  // Assign or reassign, at any stage (2026-10-19): the lead keeps its stage.
  const [assigning, setAssigning] = useState(null)
  const [assignState, setAssignState] = useState({ busy: false, error: '' })
  const [assignNote, setAssignNote] = useState('')
  async function assign(userId) {
    setAssignState({ busy: true, error: '' })
    const r = await leadsApi('assign', workspaceId, { lead_id: assigning.id, user_id: userId })
    if (r.error) return setAssignState({ busy: false, error: r.error })
    if (r.lead && !r.lead.stage) {
      // Taken back before anyone worked it: it leaves the Pipeline.
      setOpen(null)
      setData((d) => ({ ...d, rows: d.rows.filter((x) => x.id !== r.lead.id) }))
    } else if (r.lead) replace(r.lead)
    setAssignNote(r.odooError ? t.movedOdooFailed(r.odooError) : '')
    setAssignState({ busy: false, error: '' })
    setAssigning(null)
  }

  // Opened from a notification (?lead=…): open that lead once it is loaded,
  // show it whoever's it is, and scroll to it.
  const [focused, setFocused] = useState('')
  useEffect(() => {
    if (!focus || focused === focus || data.key !== key) return
    queueMicrotask(() => {
      const lead = data.rows.find((l) => l.id === focus)
      if (!lead) { if (owner) setOwner(''); else setFocused(focus); return }
      setFocused(focus)
      setOpen(focus)
      reads.mark(lead, true)
      setTimeout(() => document.getElementById(`lead-${focus}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50)
    })
  }, [focus, focused, data, key, owner, reads])

  const replace = (lead) => setData((d) => ({ ...d, rows: d.rows.map((l) => (l.id === lead.id ? { ...l, ...lead } : l)) }))
  const { change, dialog, error: stageError, busy } = useStageChange(workspaceId, replace)

  const today = riyadhToday()
  const words = search.trim().toLowerCase()
  const rows = useMemo(() => (words
    ? data.rows.filter((l) => [l.company, l.name, l.email, l.summary, l.subject, l.next_step].some((v) => String(v || '').toLowerCase().includes(words)))
    : data.rows), [data.rows, words])
  const stats = pipelineStats(data.rows, today)
  useEffect(() => { if (data.key === key) onCount?.(stats.open) }, [data.key, key, stats.open, onCount])
  const groups = groupByStage(rows).filter((g) => showClosed || OPEN_STAGES.includes(g.key)).map((g) => ({ ...g, label: leadLabels(lang).stage[g.key] }))
  const loading = data.key !== key

  return (
    <div className="bg-white border border-border min-w-0" dir={dir} lang={lang}>
      <div className="p-4 border-b border-border flex flex-wrap items-end gap-3">
        <Select label={t.f.owner} value={owner} onChange={(e) => { setOwner(e.target.value); setOpen(null) }} className="w-44">
          <option value="">{t.anyone}</option>
          {me && <option value="me">{t.mine}</option>}
          {canApprove && <option value="none">{t.unassigned}</option>}
          {canApprove && assignable(team).filter((m) => m.user_id !== me).map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}
        </Select>
        <Input label={t.f.search} placeholder={t.pipeSearchPh} value={search} onChange={(e) => setSearch(e.target.value)} className="w-64 max-w-full" dir="auto" />
        <label className="flex items-center gap-2 text-xs text-text-secondary pb-2 cursor-pointer">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="accent-amber-700" />
          {t.showClosed}
        </label>
        <p className="ms-auto text-[11px] text-text-secondary tabular-nums pb-2">
          {loading ? t.loading : t.pipeStats(stats)}
        </p>
      </div>
      {stageError && <p className="px-4 py-2 text-xs text-red-600 border-b border-border">{stageError}</p>}
      {assignNote && <p className="px-4 py-2 text-xs text-amber-800 border-b border-border">{assignNote}</p>}

      <div className={`hidden ${GRID} px-4 py-2 border-b border-border text-[10px] font-semibold text-text-tertiary uppercase tracking-wide`}>
        <span>{t.pcol.customer}</span><span>{t.pcol.wants}</span><span>{t.pcol.cameIn}</span><span>{t.pcol.owner}</span><span>{t.pcol.stage}</span><span>{t.pcol.follow}</span>
      </div>

      {loading ? (
        <div className="p-4 space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : data.error ? (
        <p className="px-4 py-10 text-sm text-red-600 text-center">{t.pipeFailed(data.error)}</p>
      ) : !data.rows.length ? (
        <div className="px-4 py-10 text-center space-y-1">
          <p className="text-sm text-text">{t.pipeEmpty}</p>
          <p className="text-xs text-text-tertiary">{t.pipeEmptyHow}</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key}>
            <h3 className={`px-4 py-1.5 bg-surface-subtle border-b border-border text-[10px] font-bold uppercase tracking-wide ${g.leads.length ? 'text-text-secondary' : 'text-text-tertiary'}`}>
              {g.label} <span className="text-text-tertiary tabular-nums">({g.leads.length})</span>
            </h3>
            {g.leads.length > 0 && (
              <ul className="divide-y divide-border border-b border-border">
                {g.leads.map((l) => (
                  <Row key={l.id} lead={l} open={open === l.id} unread={reads.unread(l)} onPick={change} busy={busy}
                    onToggle={() => { if (open !== l.id) reads.mark(l, true); setOpen(open === l.id ? null : l.id) }}
                    onMarkUnread={() => { reads.mark(l, false); setOpen(null) }}
                    onAssign={canApprove ? (lead) => { setAssignState({ busy: false, error: '' }); setAssigning(lead) } : undefined}
                    team={team} me={me} workspaceId={workspaceId} mailboxes={mailboxes} onReview={onReview} onChange={replace} today={today}
                    canAll={canApprove} onDeleted={(gone) => { setOpen(null); setData((d) => ({ ...d, rows: d.rows.filter((x) => x.id !== gone.id) })) }} />
                ))}
              </ul>
            )}
          </section>
        ))
      )}
      {dialog}
      {assigning && <AssignDialog lead={assigning} team={team} busy={assignState.busy} error={assignState.error} onCancel={() => setAssigning(null)} onConfirm={assign} />}
    </div>
  )
}

// ─── Delete a lead ─────────────────────────────────────────────────────────

/**
 * "Delete lead" on an opened lead (2026-10-19), with a confirmation that
 * says what goes and what stays. A sales admin (or the access admin) may
 * delete any lead; a salesperson only the ones they added themselves, so it
 * is not even offered on the others. The server checks the same.
 */
export function DeleteLead({ lead, workspaceId, me, canAll, onDeleted }) {
  const { t, lang, dir } = useT(LW)
  const [asking, setAsking] = useState(false)
  const [state, setState] = useState({ busy: false, error: '' })
  if (!canAll && !(lead.source === 'manual' && lead.added_by && lead.added_by === me)) return null
  async function go() {
    setState({ busy: true, error: '' })
    const r = await leadsApi('lead_delete', workspaceId, { lead_id: lead.id })
    if (r.error) return setState({ busy: false, error: r.error })
    setState({ busy: false, error: '' })
    setAsking(false)
    onDeleted(lead)
  }
  const who = lead.company || lead.name || lead.email || t.thisSender
  return (
    <>
      <button type="button" onClick={() => { setState({ busy: false, error: '' }); setAsking(true) }}
        className="text-xs px-2.5 py-1 text-red-600 hover:text-red-700 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400">
        {t.deleteLead}
      </button>
      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(28,35,33,0.45)' }} onClick={state.busy ? undefined : () => setAsking(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={stop} dir={dir} lang={lang}
            className="bg-white shadow-dropdown w-full max-w-md border border-border animate-fade-scale p-6 space-y-4">
            <h3 id="delete-title" className="font-semibold text-text text-sm">{t.deleteQ}</h3>
            <p className="text-xs text-text" dir="auto">{who}: {lead.summary || lead.subject}</p>
            <ul className="text-xs text-text-secondary leading-relaxed list-disc ps-4 space-y-1">
              <li>{t.delGone}</li>
              {lead.source === 'email' && <li>{t.delEmailStays(lead.mailbox)}</li>}
              {lead.crm_status === 'sent' && <li className="text-amber-800">{t.delInOdoo}</li>}
            </ul>
            {state.error && <p className="text-xs text-red-600">{state.error}</p>}
            <div className="flex gap-3 pt-1">
              <Button variant="secondary" className="flex-1 justify-center" disabled={state.busy} onClick={() => setAsking(false)}>{t.cancel}</Button>
              <Button variant="danger" className="flex-1 justify-center" disabled={state.busy} onClick={go}>
                {state.busy ? <Spinner size="sm" /> : null}{state.busy ? t.deleting : t.deleteLead}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Add a lead by hand ────────────────────────────────────────────────────

const EMPTY_LEAD = {
  company: '', name: '', phone: '', email: '', channel: 'phone', summary: '', sender_type: '', project: '',
  location: '', deadline: '', brands: '', notes: '', next_step: '', follow_up: '', assign_to: '',
}

/**
 * "Add lead": a call, a WhatsApp, a walk-in… The lead is the person's own; a
 * sales admin chooses who has it. It goes straight into the Pipeline at New,
 * with its battle card.
 */
export function AddLeadDialog({ workspaceId, canAssign, team = [], me = '', onCancel, onAdded }) {
  const { t, lang, dir } = useT(LW)
  const L = leadLabels(lang)
  // A salesperson's own lead is theirs; a sales admin chooses a salesperson.
  const onTeam = assignable(team).some((m) => m.user_id === me)
  const [f, setF] = useState({ ...EMPTY_LEAD, assign_to: onTeam ? me : '' })
  const [state, setState] = useState({ busy: false, error: '' })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function save() {
    setState({ busy: true, error: '' })
    const { assign_to, ...rest } = f
    const r = await leadsApi('lead_add', workspaceId, canAssign ? { ...rest, assign_to: assign_to || null } : rest)
    if (r.error) return setState({ busy: false, error: r.error })
    setState({ busy: false, error: '' })
    onAdded(r.lead)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center p-4 overflow-y-auto" style={{ background: 'rgba(28,35,33,0.45)' }} onClick={state.busy ? undefined : onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="add-lead-title" onClick={stop} dir={dir} lang={lang}
        className="bg-white shadow-dropdown w-full max-w-2xl border border-border animate-fade-scale p-6 space-y-4 my-4">
        <div>
          <h3 id="add-lead-title" className="font-semibold text-text text-sm">{t.addTitle}</h3>
          <p className="text-xs text-text-secondary mt-1">{t.addSub}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label={t.a.company} value={f.company} onChange={set('company')} maxLength={200} dir="auto" />
          <Input label={t.a.contact} value={f.name} onChange={set('name')} maxLength={200} dir="auto" />
          <Input label={t.a.phone} value={f.phone} onChange={set('phone')} maxLength={60} dir="ltr" />
          <Input label={t.a.email} type="email" value={f.email} onChange={set('email')} maxLength={200} dir="ltr" />
          <Select label={t.a.channel} value={f.channel} onChange={set('channel')}>
            {Object.entries(L.channel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Select label={t.a.who} value={f.sender_type} onChange={set('sender_type')}>
            <option value="">{t.a.notSure}</option>
            {Object.entries(L.sender).filter(([k]) => k !== 'unknown').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Textarea label={t.a.wants} rows={2} value={f.summary} onChange={set('summary')} maxLength={500} className="sm:col-span-2" dir="auto"
            placeholder={t.a.wantsPh} />
          <Select label={t.a.phase} value={f.project} onChange={set('project')}>
            <option value="">{t.notStated}</option>
            {Object.entries(L.project).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Input label={t.a.location} value={f.location} onChange={set('location')} maxLength={200} dir="auto" />
          <Input label={t.a.brands} value={f.brands} onChange={set('brands')} maxLength={200} placeholder={t.a.brandsPh} dir="auto" />
          <Input label={t.a.deadline} value={f.deadline} onChange={set('deadline')} maxLength={200} placeholder={t.a.deadlinePh} dir="auto" />
          <Textarea label={t.a.notes} rows={3} value={f.notes} onChange={set('notes')} maxLength={4000} className="sm:col-span-2" dir="auto"
            placeholder={t.a.notesPh} />
          <Input label={t.a.next} value={f.next_step} onChange={set('next_step')} maxLength={500} placeholder={t.a.nextPh} dir="auto" />
          <Input label={t.a.follow} type="date" value={f.follow_up} onChange={set('follow_up')} />
          {canAssign && (
            <Select label={t.a.whoWorks} value={f.assign_to} onChange={set('assign_to')} className="sm:col-span-2">
              <option value="">{t.a.noOne}</option>
              {assignable(team).map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === me ? t.a.me : m.full_name || m.email}</option>)}
            </Select>
          )}
        </div>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1 justify-center" disabled={state.busy} onClick={onCancel}>{t.cancel}</Button>
          <Button className="flex-1 justify-center" disabled={state.busy || !(f.company.trim() || f.name.trim()) || !f.summary.trim()} onClick={save}>
            {state.busy ? <Spinner size="sm" /> : null}{state.busy ? t.adding : t.addLeadBtn}
          </Button>
        </div>
      </div>
    </div>
  )
}
