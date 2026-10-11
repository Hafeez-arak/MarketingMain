import { useState } from 'react'
import { Button, Spinner } from '../../components/ui/index'
import { downloadEmailFile } from '../../lib/leads/client'
import { VERDICT_LABEL, VERDICT_TONE, criteriaLabels, modelName, money, phonesOf, channelLabel, FOLDER_LABEL } from '../../lib/leads/view'

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

/** An opened lead: the email as it arrived, why the agent decided, what to ask, and the way into Outlook. */
export function LeadDetail({ lead, onReview, workspaceId, wide = false }) {
  const [fileState, setFileState] = useState({ busy: false, error: '' })
  async function openInApp() {
    setFileState({ busy: true, error: '' })
    const r = await downloadEmailFile(workspaceId, lead)
    setFileState({ busy: false, error: r.error || '' })
  }
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
      {lead.verdict && lead.verdict !== 'duplicate' && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-text-tertiary">Is the agent right?</span>
          <Button size="xs" variant={lead.human_verdict === lead.verdict ? 'primary' : 'secondary'} onClick={() => onReview(lead, lead.verdict)}>Yes</Button>
          {['qualified', 'needs_review', 'unqualified'].filter((v) => v !== lead.verdict).map((v) => (
            <Button key={v} size="xs" variant={lead.human_verdict === v ? 'primary' : 'secondary'} onClick={() => onReview(lead, v)}>
              No, {VERDICT_LABEL[v].toLowerCase()}
            </Button>
          ))}
          {lead.human_verdict && <Button size="xs" variant="ghost" onClick={() => onReview(lead, null)}>Clear</Button>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {lead.source === 'email' && (
          <Button size="xs" variant="secondary" onClick={openInApp} disabled={fileState.busy}
            title="Downloads the original email with its attachments; open it to see it in the Outlook app">
            {fileState.busy ? <Spinner size="sm" /> : null}Open in Outlook app
          </Button>
        )}
        {lead.link && <a href={lead.link} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-amber-800 hover:underline">Open in Outlook on the web</a>}
        {fileState.error && <p className="text-[11px] text-red-600">{fileState.error}</p>}
        <p className="text-[10px] text-text-tertiary">{lead.mailbox ? `${lead.mailbox} · ` : ''}{lead.model ? `${modelName(lead.model)} · ${money(lead.cost_usd)}` : ''}{lead.confidence ? ` · ${lead.confidence} confidence` : ''}</p>
      </div>
    </div>
  )
}
