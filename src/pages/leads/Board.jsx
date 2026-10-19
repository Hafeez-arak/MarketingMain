import { useCallback, useEffect, useRef, useState } from 'react'
import { askAssistant, assistantMounted } from '../../lib/askAssistant'
import { Button, Skeleton, Input, Select, Spinner } from '../../components/ui/index'
import { fetchLeadsPage, leadsApi } from '../../lib/leads/client'
import {
  SHOW_OPTIONS, EMPTY_FILTERS, activeFilterCount, effectiveVerdict, PAGE_SIZE, pageLabel, pageCount, when,
  channelLabel, brandOf, phonesOf, projectOf,
  ownerLabel, shortName, leadTabs, forwardWords, assignable, leadLabels,
} from '../../lib/leads/view'
import { useT } from '../../lib/i18n'
import { LW } from './words'
import { VerdictTag, LeadDetail, LeadTabs, LeadName, MarkUnread } from './parts'
import { useLeadReads } from './useLeadReads'
import BattleCard from './BattleCard'
import { StageBar, DeleteLead } from './Pipeline'
import AssignDialog, { PersonOptions } from './AssignDialog'
import LeadOverview from './LeadOverview'
import LeadTasks from './LeadTasks'

// ─── The leads list ────────────────────────────────────────────────────────
// What the sales team asked for (2026-10-11): one clean row per lead with
// the criteria as columns (who wrote, what they want, JIH / tender /
// maintenance, verified, company or free email, Junk), filters on each, and
// everything else (the email as it arrived, why the agent decided, Outlook)
// one click away in the opened row. Filtered and paged in the database, so
// every lead is reachable however many there are.
//
// The CRM column (2026-10-12): a sales admin (or the access admin) approves
// a lead into Odoo from here, after a confirmation that shows what will be
// sent. Everyone else sees where each lead stands.
//
// A lead someone has opens on its battle card (BattleCard.jsx; made at
// approval from 2026-10-12, at assignment since 2026-10-19), with the email
// one tab away. Since 2026-10-19 it opens on the Lead tab (LeadOverview.jsx).
//
// The Owner column (2026-10-13): a sales admin assigns a lead to one person
// on the sales team at any time, which forwards the customer's email to them
// at once; Approve asks for someone when no one has it yet. A salesperson
// sees only their own leads (the database decides, can_see_lead).
//
// The Inbox (2026-10-18): this list is where enquiries are sorted, approved
// and assigned; the approved ones, and the ones added by hand, are worked in
// the Pipeline (Pipeline.jsx). An opened lead in the pipeline shows its
// stage bar here too.


// Column widths, shared by the header and every row so they line up.
const GRID = 'md:grid md:grid-cols-[6.5rem_minmax(0,1.6fr)_minmax(0,2fr)_6.5rem_6rem_6rem_5.5rem_6.5rem_6.5rem_7rem] md:gap-3 md:items-start'

function Cell({ label, children, className = '' }) {
  // On a phone each value carries its own label; on a desktop the header does.
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="md:hidden text-[10px] text-text-tertiary uppercase tracking-wide me-1.5">{label}</span>
      {children}
    </div>
  )
}

const dash = <span className="text-text-tertiary">—</span>

// Clicks inside the CRM cell act on the CRM, not on opening the row.
const stop = (e) => e.stopPropagation()

/** Where the lead stands with Odoo, and the Approve button for those who may. */
function CrmCell({ lead, canApprove, onAsk }) {
  const { t, lang } = useT(LW)
  const CRM = leadLabels(lang).crm
  const st = lead.crm_status
  if (st === 'sent') {
    return lead.crm_url
      ? <a href={lead.crm_url} target="_blank" rel="noreferrer" onClick={stop} className="text-xs font-semibold text-sage-700 hover:underline">{t.inOdoo}</a>
      : <span className="text-xs font-semibold text-sage-700">{CRM.sent}</span>
  }
  if (st === 'queued') return <span className="text-[11px] font-semibold text-amber-800 leading-tight block">{CRM.queued}</span>
  if (st === 'sending') return <span className="text-[11px] text-text-secondary">{CRM.sending}</span>
  if (st === 'failed') {
    return (
      <span className="block" title={lead.crm_error || ''}>
        <span className="text-[11px] font-semibold text-red-600 block">{CRM.failed}</span>
        {canApprove && <Button size="xs" variant="secondary" className="mt-1" onClick={(e) => { stop(e); onAsk(lead) }}>{t.retry}</Button>}
      </span>
    )
  }
  if (canApprove && lead.verdict !== 'duplicate') {
    return <Button size="xs" variant="primary" onClick={(e) => { stop(e); onAsk(lead) }}>{t.approve}</Button>
  }
  return dash
}

/**
 * Who has the lead. A sales admin clicks it to assign or reassign; a forward
 * that failed shows here in red, since the person has not got the email.
 */
function OwnerCell({ lead, team, me, canApprove, onAssign }) {
  const { t, lang } = useT(LW)
  const label = ownerLabel(lead, team, me, lang)
  const failed = lead.forward_status === 'failed'
  const tone = !lead.assigned_to ? 'text-text-tertiary' : lead.assigned_to === me ? 'text-text font-semibold' : 'text-text'
  if (!canApprove) {
    return <span className={`text-xs ${tone}`}>{label}</span>
  }
  return (
    <span onClick={stop} className="block">
      {lead.assigned_to
        ? <button type="button" onClick={() => onAssign(lead)} title={t.assignElse}
            className={`text-xs hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 ${tone}`}>{label}</button>
        : <Button size="xs" variant="secondary" onClick={() => onAssign(lead)}>{t.assign}</Button>}
      {failed && <span className="block text-[10px] font-semibold text-red-600">{leadLabels(lang).forward.failed}</span>}
    </span>
  )
}

/**
 * Under an opened row: who has it, since when, and whether the customer's
 * email reached them. A failed forward says why and offers to try again.
 */
function OwnerLine({ lead, team, me, canApprove, onForward }) {
  const { t, lang } = useT(LW)
  const FWD = leadLabels(lang).forward
  const [busy, setBusy] = useState(false)
  if (!lead.assigned_to) return null
  const person = team.find((m) => m.user_id === lead.assigned_to)
  const who = lead.assigned_to === me ? t.youWord : person ? (person.full_name || person.email) : t.someoneLeft
  async function again() {
    setBusy(true)
    await onForward(lead)
    setBusy(false)
  }
  return (
    <div className="px-4 pt-3 md:ps-[8.25rem] text-[11px] text-text-secondary flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{t.assignedTo} <span className="font-semibold text-text">{who}</span>{lead.assigned_at ? ` · ${when(lead.assigned_at, lang)}` : ''}</span>
      {lead.forward_status === 'sent' && <span className="text-sage-700">· {FWD.sent}{lead.forwarded_at ? ` ${when(lead.forwarded_at, lang)}` : ''}</span>}
      {lead.forward_status === 'sending' && <span>· {FWD.sending}</span>}
      {lead.forward_status === 'failed' && (
        <>
          <span className="text-red-600 font-semibold">· {FWD.failed}: {lead.forward_error}</span>
          {canApprove && <Button size="xs" variant="secondary" onClick={again} disabled={busy}>{busy ? <Spinner size="sm" /> : null}{t.tryAgain}</Button>}
        </>
      )}
    </div>
  )
}

/**
 * The two clocks the CEO set (2026-10-18): a first reply within 4 hours and
 * a quote within 72. Until Odoo says it for them, the owner (or a sales
 * admin) marks each here; the CEO page counts from these marks.
 */
function ProgressLine({ lead, me, canApprove, onMark }) {
  const { t, lang } = useT(LW)
  const [busy, setBusy] = useState('')
  const [value, setValue] = useState('')
  const [asking, setAsking] = useState(false)
  if (!lead.assigned_to || !(lead.assigned_to === me || canApprove)) return null
  async function mark(what, extra) {
    setBusy(what)
    await onMark(lead, what, extra)
    setBusy('')
    setAsking(false)
  }
  return (
    <div className="px-4 pt-2 md:ps-[8.25rem] text-[11px] text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {lead.first_reply_at
        ? <span className="text-sage-700">{t.firstReplySent(when(lead.first_reply_at, lang))}</span>
        : <Button size="xs" variant="secondary" onClick={() => mark('replied')} disabled={Boolean(busy)}>{busy === 'replied' ? <Spinner size="sm" /> : null}{t.markReply}</Button>}
      {lead.quote_sent_at ? (
        <span className="text-sage-700">
          {t.quoteSent(when(lead.quote_sent_at, lang))}{Number(lead.deal_value_sar) > 0 ? ` · ${lang === 'ar' ? '' : 'SAR '}${Math.round(lead.deal_value_sar).toLocaleString('en-US')}${lang === 'ar' ? ' ر.س' : ''}` : ''}
          <button type="button" className="ms-2 text-text-tertiary hover:text-text underline" onClick={() => mark('clear_quote')} disabled={Boolean(busy)}>{t.undo}</button>
        </span>
      ) : asking ? (
        <span className="inline-flex items-center gap-2">
          <Input type="number" min="0" inputMode="decimal" placeholder={t.quoteValuePh} value={value} onChange={(e) => setValue(e.target.value)} className="w-52" />
          <Button size="xs" onClick={() => mark('quote_sent', { deal_value_sar: value })} disabled={Boolean(busy)}>{busy === 'quote_sent' ? <Spinner size="sm" /> : null}{t.save}</Button>
          <button type="button" className="text-text-tertiary hover:text-text" onClick={() => setAsking(false)}>{t.cancel}</button>
        </span>
      ) : (
        <Button size="xs" variant="secondary" onClick={() => setAsking(true)} disabled={Boolean(busy)}>{t.markQuote}</Button>
      )}
    </div>
  )
}

/**
 * The project phase, set by anyone on the team (2026-10-12): stated in the
 * email or not, they pick it after the call. Picking what the agent read
 * goes back to following the agent.
 */
function ProjectPicker({ lead, onSet }) {
  const { t, lang } = useT(LW)
  const PROJECT = leadLabels(lang).project
  const [busy, setBusy] = useState(false)
  // The choices exist only while the menu is open (2026-10-18): a <select>
  // on every row put "Not stated JIH Tender Maintenance" into the page text,
  // so a screen reader, a copy or the assistant reading the screen saw every
  // option on every lead.
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const toggle = useRef(null)
  const value = projectOf(lead) || 'none'
  const choices = [['none', t.notStated], ...Object.entries(PROJECT)]
  const label = value === 'none' ? t.notStated : PROJECT[value] || value

  useEffect(() => {
    if (!open) return
    box.current?.querySelector('[aria-checked="true"]')?.focus()
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  function close() {
    setOpen(false)
    toggle.current?.focus()
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...box.current.querySelectorAll('[role="menuitemradio"]')]
    const i = items.indexOf(document.activeElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
  }
  async function change(choice) {
    close()
    if (choice === value) return
    const agent = lead.project_type || 'none'
    setBusy(true)
    await onSet(lead, choice === agent ? null : choice)
    setBusy(false)
  }
  return (
    <span ref={box} onClick={stop} onKeyDown={onKey} className="relative block -ms-1">
      {/* aria-disabled rather than disabled while saving: a disabled button
          drops keyboard focus, and the person picking would lose their place. */}
      <button ref={toggle} type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) setOpen((o) => !o) }}
        aria-haspopup="menu" aria-expanded={open} aria-label={t.projectPhase(label)}
        className={`max-w-full text-start text-xs border border-transparent hover:border-border focus:border-border focus:outline-none px-1 py-0.5 cursor-pointer ${busy ? 'opacity-50' : ''} ${value !== 'none' ? 'font-semibold text-text' : 'text-text-tertiary'}`}>
        {label}
      </button>
      {open && (
        <span role="menu" aria-label={t.projectPhaseMenu}
          className="absolute start-0 top-full z-20 mt-0.5 min-w-[8rem] py-1 bg-surface border border-border shadow-md flex flex-col">
          {choices.map(([k, l]) => (
            <button key={k} type="button" role="menuitemradio" aria-checked={k === value} onClick={() => change(k)}
              className={`text-start text-xs px-2 py-1 hover:bg-surface-subtle focus:bg-surface-subtle focus:outline-none ${k === value ? 'font-semibold text-text' : 'text-text-secondary'}`}>
              {l}
            </button>
          ))}
        </span>
      )}
      {lead.human_project_type && <span className="block px-1 text-[10px] text-text-tertiary">{t.setByTeam}</span>}
    </span>
  )
}

/**
 * The Battle card tab of a lead no one has yet: the card is made when it is
 * assigned (the owner, 2026-10-19), so say so, and offer Assign to those
 * who may.
 */
function CardWaiting({ lead, canApprove, onAssign }) {
  const { t } = useT(LW)
  return (
    <div className="px-4 pb-5 pt-3 md:ps-[8.25rem] text-xs space-y-2">
      <p className="text-text">{t.cardWhenAssigned}</p>
      <p className="text-text-secondary leading-relaxed max-w-[60ch]">
        {t.cardWhy}
      </p>
      {canApprove
        ? <Button size="xs" onClick={() => onAssign(lead)}>{t.assignAndCard}</Button>
        : <p className="text-text-tertiary">{t.adminAssigns}</p>}
    </div>
  )
}

function Row({ lead, open, onToggle, onReview, onSetProject, workspaceId, mailboxes, canApprove, onAsk, team, me, onAssign, onForward, onChange, onDeleted, unread, onMarkUnread, onMark }) {
  const { t, lang } = useT(LW)
  const L = leadLabels(lang)
  const v = effectiveVerdict(lead)
  const v2 = (lead.criteria_version || 1) >= 2
  const junk = lead.folder === 'junk'
  // A lead someone has opens on its card; any other on its email.
  // Someone has it: it opens on the Lead tab (2026-10-19); any other on its email.
  const [tab, setTab] = useState(lead.approved_at || lead.stage || lead.assigned_to || lead.source === 'manual' ? 'lead' : 'email')
  const hasTabs = lead.verdict !== 'duplicate'
  return (
    <li className={open ? 'bg-surface-subtle' : ''}>
      {/* A div, not a button: the row holds the Approve button, and a button
          cannot hold another. Keyboard: Enter or Space opens it. */}
      <div role="button" tabIndex={0} onClick={onToggle} aria-expanded={open}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle() } }}
        className={`w-full text-start px-4 py-3 hover:bg-surface-subtle transition-colors cursor-pointer grid grid-cols-2 gap-x-3 gap-y-1.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 ${GRID}`}>
        <Cell label={t.col.received} className="col-span-2 md:col-span-1">
          <span className="text-[11px] text-text-secondary tabular-nums">{when(lead.received_at || lead.created_at, lang)}</span>
          <span className="block text-[10px] mt-0.5 text-text-secondary font-semibold">{channelLabel(lead, { lang })}</span>
          {lead.source === 'email' && lead.folder && (
            <span className={`block text-[10px] ${junk ? 'text-red-600 font-semibold' : 'text-text-tertiary'}`}>{L.folder[lead.folder] || lead.folder}</span>
          )}
        </Cell>
        <Cell label={t.col.from} className="col-span-2 md:col-span-1">
          <LeadName lead={lead} unread={unread} />
          <span className="text-[11px] text-text-tertiary truncate block">
            <span dir="ltr">{lead.email ? lead.email.split('@')[1] : ''}</span>{lead.email_kind === 'free' ? t.freeEmailTag : ''}
          </span>
          {phonesOf(lead)[0] && <span className="text-[11px] text-text-secondary truncate block tabular-nums" dir="ltr">{phonesOf(lead)[0]}{phonesOf(lead).length > 1 ? ` +${phonesOf(lead).length - 1}` : ''}</span>}
        </Cell>
        <Cell label={t.col.wants} className="col-span-2 md:col-span-1">
          <span className="text-xs text-text line-clamp-2" dir="auto">{lead.summary || lead.subject || lead.message}</span>
          {L.philips[lead.philips] && <span className={`text-[10px] ${lead.philips === 'only' ? 'text-red-600 font-semibold' : 'text-text-tertiary'}`}>{L.philips[lead.philips]}</span>}
        </Cell>
        <Cell label={t.col.who}>
          <span className={`text-xs ${lead.sender_type === 'trader' ? 'text-amber-800 font-semibold' : 'text-text'}`}>{v2 ? L.sender[lead.sender_type] || dash : dash}</span>
        </Cell>
        <Cell label={t.col.request}>
          <span className="text-xs text-text">{L.request[lead.request_type] || dash}</span>
        </Cell>
        <Cell label={t.col.project}>
          <ProjectPicker lead={lead} onSet={onSetProject} />
        </Cell>
        <Cell label={t.col.source}>
          {v2 && lead.source_check
            ? <span className={`text-xs ${lead.source_check === 'verified' ? 'text-sage-700' : 'text-amber-800'}`}>{lead.source_check === 'verified' ? L.words.verified : L.words.notVerified}</span>
            : dash}
        </Cell>
        <Cell label={t.col.verdict} className="md:text-end">
          <VerdictTag verdict={v} corrected={Boolean(lead.human_verdict && lead.human_verdict !== lead.verdict)} />
        </Cell>
        <Cell label={t.col.owner}>
          <OwnerCell lead={lead} team={team} me={me} canApprove={canApprove} onAssign={onAssign} />
        </Cell>
        <Cell label={t.col.crm} className="md:text-end">
          <CrmCell lead={lead} canApprove={canApprove} onAsk={onAsk} />
        </Cell>
      </div>
      {open && (
        <div className="border-t border-border bg-white">
          <OwnerLine lead={lead} team={team} me={me} canApprove={canApprove} onForward={onForward} />
          <StageBar lead={lead} workspaceId={workspaceId} onChange={onChange} />
          <ProgressLine lead={lead} me={me} canApprove={canApprove} onMark={onMark} />
          <LeadTasks lead={lead} workspaceId={workspaceId} me={me} />
          {hasTabs ? (
            <>
              <LeadTabs tabs={leadTabs(lead, lang)} value={tab} onChange={setTab}>
                <AskAboutLead lead={lead} />
                <MarkUnread onClick={onMarkUnread} />
                <DeleteLead lead={lead} workspaceId={workspaceId} me={me} canAll={canApprove} onDeleted={onDeleted} />
              </LeadTabs>
              {tab === 'lead'
                ? <LeadOverview lead={lead} workspaceId={workspaceId} team={team} me={me} onChange={onChange} onReassign={canApprove ? () => onAssign(lead) : undefined} />
                : tab === 'card'
                  ? (lead.approved_at || lead.stage || lead.assigned_to ? <BattleCard lead={lead} workspaceId={workspaceId} onLeadChange={onChange} /> : <CardWaiting lead={lead} canApprove={canApprove} onAssign={onAssign} />)
                  : <LeadDetail lead={lead} onReview={onReview} workspaceId={workspaceId} mailboxes={mailboxes} wide />}
            </>
          ) : (
            <>
              <div className="flex px-4 pt-3 md:ps-[8.25rem]"><span className="ms-auto"><DeleteLead lead={lead} workspaceId={workspaceId} me={me} canAll={canApprove} onDeleted={onDeleted} /></span></div>
              <LeadDetail lead={lead} onReview={onReview} workspaceId={workspaceId} mailboxes={mailboxes} wide />
            </>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * "Ask Arak about this lead": opens the assistant with this lead pinned, so a
 * question like "is this worth chasing?" is about it. Hidden where there is
 * no assistant (the sales-only Leads app).
 */
function AskAboutLead({ lead }) {
  const { t } = useT(LW)
  if (!assistantMounted()) return null
  const who = lead.company || lead.name || t.thisSender
  return (
    <button type="button" onClick={() => askAssistant({ item: { entity: 'lead', id: lead.id, label: t.askLabel(who) } })}
      className="text-xs px-2.5 py-1 text-amber-800 hover:text-amber-900 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400">
      {t.askArak}
    </button>
  )
}

/**
 * "Send this lead to Odoo?": exactly what will be sent, and what happens if
 * Odoo is not connected yet. Nothing is sent until the button is pressed.
 * It goes with a salesperson: the one it is assigned to, or one chosen here
 * (which forwards them the email, as Assign does).
 */
function ApproveDialog({ lead, team, busy, error, onCancel, onConfirm }) {
  const { t, lang, dir } = useT(LW)
  const L = leadLabels(lang)
  const [to, setTo] = useState(lead.assigned_to || '')
  const person = team.find((m) => m.user_id === to)
  const changing = to && to !== lead.assigned_to
  const phones = phonesOf(lead)
  const rows = [
    [t.d.company, lead.company], [t.d.contact, lead.name], [t.d.email, lead.email], [t.d.phone, phones.join(', ')],
    [t.d.wants, lead.summary || lead.subject], [t.d.who, L.sender[lead.sender_type]], [t.d.project, L.project[lead.project_type]],
    [t.d.cameIn, channelLabel(lead, { lang })],
  ].filter(([, v]) => v)
  const notQualified = effectiveVerdict(lead) !== 'qualified'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(28,35,33,0.45)' }} onClick={busy ? undefined : onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="approve-title" onClick={stop} dir={dir} lang={lang}
        className="bg-white shadow-dropdown w-full max-w-md border border-border animate-fade-scale p-6 space-y-4">
        <h3 id="approve-title" className="font-semibold text-text text-sm">
          {lead.crm_status === 'failed' ? t.retryOdooQ : t.approveQ}
        </h3>
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-tertiary">{k}</dt>
              <dd className="text-text min-w-0 break-words" dir="auto">{v}</dd>
            </div>
          ))}
        </dl>
        <Select label={t.assignedTo} value={to} onChange={(e) => setTo(e.target.value)} disabled={lead.crm_status === 'failed' && Boolean(lead.assigned_to)}>
          <option value="">{t.chooseWho}</option>
          <PersonOptions team={team} />
        </Select>
        {changing && <p className="text-xs text-text-secondary leading-relaxed">{forwardWords(lead, person, lang)}</p>}
        <p className="text-xs text-text-secondary leading-relaxed">
          {t.approveBody(person ? shortName(person) : t.them)}
          {notQualified ? t.alsoQualified : ''}
          {' '}{t.ifNotConnected}
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1 justify-center" disabled={busy} onClick={onCancel}>{t.cancel}</Button>
          <Button className="flex-1 justify-center" disabled={busy || !to} onClick={() => onConfirm(to)}>
            {busy ? <Spinner size="sm" /> : null}{busy ? t.sending : t.approveSend}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function LeadsBoard({ workspaceId, onReview, refreshKey = 0, mailboxes = [], canApprove = false, team = [], me = '' }) {
  const { t, lang, dir } = useT(LW)
  const L = leadLabels(lang)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  // The search box waits for a pause in typing before it asks the database.
  const [searchText, setSearchText] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(null)
  const [list, setList] = useState({ key: null, rows: [], total: 0, error: '' })
  const wanted = useRef('')
  const top = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchText ? f : { ...f, search: searchText }))
      setPage(0)
    }, 350)
    return () => clearTimeout(t)
  }, [searchText])

  const key = `${workspaceId}|${JSON.stringify(filters)}|${page}|${refreshKey}`
  const load = useCallback(async () => {
    if (!workspaceId) return
    wanted.current = key
    try {
      const r = await fetchLeadsPage(workspaceId, { filters, page, me })
      if (wanted.current !== key) return
      if (!r.rows.length && r.total && page > 0) return setPage(pageCount(r.total) - 1)
      setList({ key, ...r, error: '' })
    } catch (err) {
      if (wanted.current === key) setList({ key, rows: [], total: 0, error: err.message || String(err) })
    }
  }, [workspaceId, filters, page, key, me])

  useEffect(() => { queueMicrotask(load) }, [load])

  // Read and unread, for this person (2026-10-19).
  const reads = useLeadReads(workspaceId, me, list.rows)

  const replaceRow = (id, updated) => setList((s) => ({ ...s, rows: s.rows.map((l) => (l.id === id ? { ...l, ...updated } : l)) }))

  // A correction changes the row in place; it leaves the list on the next load.
  async function review(lead, verdict, reason) {
    const updated = await onReview(lead, verdict, reason)
    if (updated) replaceRow(lead.id, updated)
    return updated // the detail opens its "why?" box only once the No is saved
  }

  // An action on a row that failed (the list itself stays as it is).
  const [actionError, setActionError] = useState('')

  // The team's project phase: saved at once, the row shows it.
  async function setProject(lead, project) {
    const r = await leadsApi('set_project', workspaceId, { lead_id: lead.id, project })
    if (r.error) return setActionError(r.error)
    setActionError('')
    replaceRow(lead.id, r.lead)
  }

  // Approve → confirm → Odoo. The row shows the outcome; Odoo's refusal, if
  // any, stays on the row (Retry) rather than in the dialog.
  const [asking, setAsking] = useState(null)
  const [approving, setApproving] = useState({ busy: false, error: '' })
  async function approve(assignTo) {
    setApproving({ busy: true, error: '' })
    const r = await leadsApi('approve', workspaceId, { lead_id: asking.id, assign_to: assignTo })
    if (r.error) return setApproving({ busy: false, error: r.error })
    replaceRow(asking.id, r.lead)
    setApproving({ busy: false, error: '' })
    setAsking(null)
  }

  // Assign → confirm → the email is forwarded. A failed forward stays on the
  // row (with Try again), as an Odoo refusal does.
  const [assigning, setAssigning] = useState(null)
  const [assignState, setAssignState] = useState({ busy: false, error: '' })
  async function assign(userId) {
    setAssignState({ busy: true, error: '' })
    const r = await leadsApi('assign', workspaceId, { lead_id: assigning.id, user_id: userId })
    if (r.error) return setAssignState({ busy: false, error: r.error })
    replaceRow(assigning.id, r.lead)
    setActionError(r.odooError ? t.odooOwnerFailed(r.odooError) : '')
    setAssignState({ busy: false, error: '' })
    setAssigning(null)
  }
  async function mark(lead, what, extra = {}) {
    const r = await leadsApi('lead_mark', workspaceId, { lead_id: lead.id, what, ...extra })
    if (r.error) return setActionError(r.error)
    setActionError('')
    replaceRow(lead.id, r.lead)
  }

  async function forwardAgain(lead) {
    const r = await leadsApi('forward', workspaceId, { lead_id: lead.id })
    if (r.error) return setActionError(r.error)
    setActionError('')
    replaceRow(lead.id, r.lead)
  }

  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(0); setOpen(null) }
  const clear = () => { setFilters((f) => ({ ...EMPTY_FILTERS, show: f.show })); setSearchText(''); setPage(0); setOpen(null) }
  const goTo = (p) => {
    setPage(p); setOpen(null)
    const y = top.current?.getBoundingClientRect().top
    if (y != null && y < 0) top.current.scrollIntoView({ block: 'start' })
  }

  const loading = list.key !== key
  const pages = pageCount(list.total)
  const extra = activeFilterCount(filters)

  return (
    <div ref={top} className="bg-white border border-border min-w-0 scroll-mt-4" dir={dir} lang={lang}>
      {/* ── Filters ── */}
      <div className="p-4 border-b border-border grid grid-cols-2 md:grid-cols-4 xl:grid-cols-[1.3fr_1fr_1.1fr_1fr_1fr_1fr_1fr_1fr_1.5fr] gap-3 items-end">
        <Select label={t.f.show} value={filters.show} onChange={set('show')} className="col-span-2 md:col-span-1">
          {SHOW_OPTIONS.map((o) => <option key={o.key} value={o.key}>{L.show[o.key]}</option>)}
        </Select>
        <Select label={t.f.owner} value={filters.owner} onChange={set('owner')}>
          <option value="">{t.anyone}</option>
          {me && <option value="me">{t.mine}</option>}
          {canApprove && <option value="none">{t.unassigned}</option>}
          {canApprove && assignable(team).filter((m) => m.user_id !== me).map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}
        </Select>
        <Select label={t.f.cameIn} value={filters.channel} onChange={set('channel')}>
          <option value="">{t.anywhere}</option>
          <option value="website">{channelLabel({ source: 'website_form' }, { lang })}</option>
          <option value="manual">{L.source.manual}</option>
          {mailboxes.map((m) => <option key={m.id} value={m.label || m.email}>{t.mailboxOption(brandOf(m.label || m.email), m.label || m.email)}</option>)}
        </Select>
        <Select label={t.f.who} value={filters.sender} onChange={set('sender')}>
          <option value="">{t.anyone}</option>
          {Object.entries(L.sender).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select label={t.f.project} value={filters.project} onChange={set('project')}>
          <option value="">{t.any}</option>
          {[...Object.entries(L.project), ['none', t.notStated]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select label={t.f.request} value={filters.request} onChange={set('request')}>
          <option value="">{t.any}</option>
          {Object.entries(L.request).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select label={t.f.folder} value={filters.folder} onChange={set('folder')}>
          <option value="">{t.any}</option>
          {Object.entries(L.folder).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select label={t.f.email} value={filters.emailKind} onChange={set('emailKind')}>
          <option value="">{t.any}</option>
          <option value="company">{t.companyDomain}</option>
          <option value="free">{t.freeEmail}</option>
        </Select>
        <div className="col-span-2 md:col-span-2 xl:col-span-1">
          <Input id="leads-search" label={t.f.search} placeholder={t.searchPh} value={searchText} onChange={(e) => setSearchText(e.target.value)} dir="auto" />
        </div>
      </div>
      {actionError && <p className="px-4 py-2 text-xs text-red-600 border-b border-border">{actionError}</p>}
      <div className="px-4 py-2 flex items-center justify-between gap-3 border-b border-border">
        <p className="text-[11px] text-text-secondary tabular-nums">
          {loading ? t.loading : t.leadsN(list.total)}
          {extra > 0 && !loading ? t.filtersOn(extra) : ''}
        </p>
        {extra > 0 && <Button size="xs" variant="ghost" onClick={clear}>{t.clearFilters}</Button>}
      </div>

      {/* ── Header (desktop) ── */}
      <div className={`hidden ${GRID} px-4 py-2 border-b border-border text-[10px] font-semibold text-text-tertiary uppercase tracking-wide`}>
        <span>{t.col.received}</span><span>{t.col.from}</span><span>{t.col.wants}</span><span>{t.col.who}</span><span>{t.col.request}</span><span>{t.col.project}</span><span>{t.col.source}</span><span className="text-end">{t.col.verdict}</span><span>{t.col.owner}</span><span className="text-end">{t.col.crm}</span>
      </div>

      {loading ? (
        <div className="p-4 space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : list.error ? (
        <p className="px-4 py-10 text-sm text-red-600 text-center">{t.loadFailed(list.error)}</p>
      ) : !list.rows.length ? (
        <p className="px-4 py-10 text-sm text-text-tertiary text-center">{extra ? t.noMatch : t.noneYet}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.rows.map((l) => (
            <Row key={l.id} lead={l} open={open === l.id} unread={reads.unread(l)} onReview={review}
              onToggle={() => { if (open !== l.id) reads.mark(l, true); setOpen(open === l.id ? null : l.id) }}
              onMarkUnread={() => { reads.mark(l, false); setOpen(null) }}
              onSetProject={setProject} workspaceId={workspaceId} mailboxes={mailboxes} canApprove={canApprove} onAsk={(lead) => { setApproving({ busy: false, error: '' }); setAsking(lead) }}
              team={team} me={me} onAssign={(lead) => { setAssignState({ busy: false, error: '' }); setAssigning(lead) }} onForward={forwardAgain}
              onChange={(updated) => replaceRow(updated.id, updated)}
              onDeleted={(gone) => { setOpen(null); setList((st) => ({ ...st, rows: st.rows.filter((x) => x.id !== gone.id), total: Math.max(0, st.total - 1) })) }}
              onMark={mark} />
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border">
        <p className="text-[11px] text-text-tertiary tabular-nums">{pageLabel(page, PAGE_SIZE, list.total, lang)}</p>
        {pages > 1 && (
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => goTo(0)} disabled={page === 0}>{t.first}</Button>
            <Button size="xs" variant="secondary" onClick={() => goTo(page - 1)} disabled={page === 0}>{t.previous}</Button>
            <span className="text-[11px] text-text-secondary tabular-nums px-1">{t.pageOf(page + 1, pages)}</span>
            <Button size="xs" variant="secondary" onClick={() => goTo(page + 1)} disabled={page >= pages - 1}>{t.next}</Button>
            <Button size="xs" variant="ghost" onClick={() => goTo(pages - 1)} disabled={page >= pages - 1}>{t.last}</Button>
          </div>
        )}
      </div>
      {asking && <ApproveDialog lead={asking} team={team} busy={approving.busy} error={approving.error} onCancel={() => setAsking(null)} onConfirm={approve} />}
      {assigning && <AssignDialog lead={assigning} team={team} busy={assignState.busy} error={assignState.error} onCancel={() => setAssigning(null)} onConfirm={assign} />}
    </div>
  )
}
