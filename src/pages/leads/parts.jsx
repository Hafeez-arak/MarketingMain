import { useState } from 'react'
import { Button } from '../../components/ui/index'
import { VERDICT_LABEL, VERDICT_TONE, CRM_LABEL, criteriaLabels, modelName, money, phonesOf, channelLabel, outlookLink, when, FOLDER_LABEL } from '../../lib/leads/view'

// ─── Pieces shared by the leads list and the agent settings ────────────────

export function VerdictTag({ verdict, corrected = false }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4] whitespace-nowrap ${VERDICT_TONE[verdict] || VERDICT_TONE.pending}`}>
      {VERDICT_LABEL[verdict] || verdict}
      {corrected && <span className="font-semibold normal-case tracking-normal opacity-70">· corrected</span>}
    </span>
  )
}

/** The sales team's criteria as small chips. Junk and Philips only are red: someone must look. */
const CHIP_TONE = { Junk: 'bg-red-50 text-red-600', 'Philips only': 'bg-red-50 text-red-600', Trader: 'bg-amber-100 text-amber-800', 'Not verified': 'bg-amber-100 text-amber-800' }
export function CriteriaChips({ lead }) {
  const labels = criteriaLabels(lead)
  if (!labels.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {labels.map((t) => (
        <span key={t} className={`text-[10px] px-1.5 py-0.5 ${CHIP_TONE[t] || 'bg-stone-100 text-stone-600'}`}>{t}</span>
      ))}
    </div>
  )
}

/** Why the agent read the sender, the source and the phase the way it did. */
function Evidence({ lead }) {
  const rows = [
    ['Why', lead.reason],
    ['Sender', lead.sender_evidence],
    ['Source', [lead.source_evidence, lead.website ? `website checked: ${lead.website}` : ''].filter(Boolean).join(' · ')],
    ['Phase', lead.project_evidence],
  ].filter(([, v]) => v)
  if (!rows.length) return null
  return (
    <div className="space-y-0.5">
      {rows.map(([k, v]) => <p key={k}><span className="text-text-tertiary">{k} </span><span className="text-text" dir="auto">{v}</span></p>)}
    </div>
  )
}

/**
 * "Is the agent right?", and after a No an optional line on why: the weekly
 * review turns those into rules (the owner's decision, 2026-10-12). The No
 * is saved at once; the reason is saved with it when given.
 */
function Review({ lead, onReview }) {
  const [why, setWhy] = useState(null) // { verdict, text } while the box is open
  async function no(v) {
    const updated = await onReview(lead, v)
    if (updated) setWhy({ verdict: v, text: '' })
  }
  async function saveWhy(e) {
    e.preventDefault()
    if (why.text.trim()) await onReview(lead, why.verdict, why.text.trim())
    setWhy(null)
  }
  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-tertiary">Is the agent right?</span>
        <Button size="xs" variant={lead.human_verdict === lead.verdict ? 'primary' : 'secondary'} onClick={() => { setWhy(null); onReview(lead, lead.verdict) }}>Yes</Button>
        {['qualified', 'needs_review', 'unqualified'].filter((v) => v !== lead.verdict).map((v) => (
          <Button key={v} size="xs" variant={lead.human_verdict === v ? 'primary' : 'secondary'} onClick={() => no(v)}>
            No, {VERDICT_LABEL[v].toLowerCase()}
          </Button>
        ))}
        {lead.human_verdict && <Button size="xs" variant="ghost" onClick={() => { setWhy(null); onReview(lead, null) }}>Clear</Button>}
      </div>
      {why && (
        <form onSubmit={saveWhy} className="flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={why.text}
            onChange={(e) => setWhy({ ...why, text: e.target.value })}
            maxLength={500}
            placeholder="Why? (optional) e.g. a trader asking for a price list"
            aria-label="Why the agent was wrong (optional)"
            className="flex-1 min-w-[14rem] border border-border bg-white text-text text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <Button size="xs" type="submit" disabled={!why.text.trim()}>Save</Button>
          <Button size="xs" variant="ghost" onClick={() => setWhy(null)}>Skip</Button>
        </form>
      )}
      {!why && lead.human_reason && lead.human_verdict && lead.human_verdict !== lead.verdict && (
        <p className="text-text-tertiary">Why it was corrected: <span className="text-text" dir="auto">{lead.human_reason}</span></p>
      )}
    </div>
  )
}

/**
 * An opened lead: the email as it arrived, why the agent decided, what to
 * ask, and the way into Outlook. Outlook on the web only (the owner's
 * decision, 2026-10-12): no Outlook app opens one message from a link, and
 * the .eml download it replaced was clumsy. The link names the mailbox
 * (outlookLink), so it opens for anyone with access to that mailbox.
 */
export function LeadDetail({ lead, onReview, mailboxes = [], wide = false }) {
  const href = outlookLink(lead, mailboxes)
  const d = lead.details || {}
  const facts = [['Products', d.products], ['Brands', d.brands], ['Quantity', d.quantity], ['Location', d.location], ['Stage', d.stage], ['Urgency', d.urgency]].filter(([, v]) => v)
  const asks = Array.isArray(lead.ask_next) ? lead.ask_next : []
  return (
    <div className={`px-4 pb-4 space-y-3 text-xs ${wide ? 'pt-4 md:pl-[8.25rem]' : 'pl-[7.75rem]'}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-text-secondary">
        <p><span className="text-text-tertiary">Name </span>{lead.name || '—'}</p>
        <p className="truncate"><span className="text-text-tertiary">Email </span>{lead.email || '—'}</p>
        <p><span className="text-text-tertiary">{phonesOf(lead).length > 1 ? 'Phones ' : 'Phone '}</span>
          {phonesOf(lead).length
            ? phonesOf(lead).map((p, i) => <span key={p} className="tabular-nums" dir="ltr">{i ? ', ' : ''}<a href={`tel:${p.replace(/[^\d+]/g, '')}`} className="hover:underline">{p}</a></span>)
            : '—'}
        </p>
      </div>
      <p className="text-text-tertiary">Came in: <span className="text-text-secondary">{channelLabel(lead)}{lead.mailbox ? ` (${lead.mailbox})` : ''}{lead.folder && lead.source === 'email' ? `, ${FOLDER_LABEL[lead.folder] || lead.folder} folder` : ''}</span></p>
      {lead.subject && <p className="text-text-tertiary">{lead.subject}</p>}
      <p className="whitespace-pre-wrap text-text leading-relaxed border-l-2 border-border pl-3" dir="auto">{lead.message}</p>
      <Evidence lead={lead} />
      {facts.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {facts.map(([k, v]) => <p key={k}><span className="text-text-tertiary">{k} </span><span className="text-text">{v}</span></p>)}
        </div>
      )}
      {asks.length > 0 && (
        <div>
          <p className="eyebrow mb-1">Ask on the first call</p>
          <ul className="list-disc pl-4 space-y-0.5 text-text">{asks.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {lead.verdict && lead.verdict !== 'duplicate' && <Review lead={lead} onReview={onReview} />}
      {lead.crm_status && (
        <p className="text-text-tertiary">
          CRM: <span className={lead.crm_status === 'failed' ? 'text-red-600 font-semibold' : 'text-text-secondary'}>{CRM_LABEL[lead.crm_status]}</span>
          {lead.approved_at ? <span> · approved {when(lead.approved_at)}</span> : null}
          {lead.crm_status === 'failed' && lead.crm_error ? <span className="block text-red-600">Odoo said: {lead.crm_error}</span> : null}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {href && (
          <a href={href} target="_blank" rel="noreferrer"
            title="Opens the email in Outlook on the web, in the mailbox it arrived in. Needs access to that mailbox."
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] tracking-wide font-semibold border bg-white text-text border-border hover:border-stone-400 hover:bg-surface-subtle transition-colors">
            Open in Outlook
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7"/></svg>
          </a>
        )}
        <p className="text-[10px] text-text-tertiary">{lead.mailbox ? `${lead.mailbox} · ` : ''}{lead.model ? `${modelName(lead.model)} · ${money(lead.cost_usd)}` : ''}{lead.confidence ? ` · ${lead.confidence} confidence` : ''}</p>
      </div>
    </div>
  )
}
