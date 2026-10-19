import { useEffect, useState } from 'react'
import { Button, Spinner } from '../../components/ui/index'
import { leadsApi } from '../../lib/leads/client'
import { VERDICT_TONE, criteriaLabels, phonesOf, channelLabel, outlookLink, when, leadLabels } from '../../lib/leads/view'
import { useT } from '../../lib/i18n'
import { LW } from './words'
import { emailSegments, emailLinks, isFileLink, fileSize } from '../../lib/leads/emailText'

// ─── Pieces shared by the leads list and the agent settings ────────────────

const TAB_ICON = {
  lead: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />,
  card: <path d="M4 5h16v14H4zM8 9h8M8 13h5" />,
  email: <path d="M3 6h18v12H3zM3 7l9 6 9-6" />,
}

/**
 * The opened lead's tabs (2026-10-19, "make it more evident"): a real tab
 * bar, larger, with an icon each, the open one filled. `tabs` is
 * [[key, label]]; `children` sits at the right end (Ask Arak, Delete).
 */
export function LeadTabs({ tabs, value, onChange, children }) {
  const { t } = useT(LW)
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pt-3 md:ps-[8.25rem]">
      <div role="tablist" aria-label={t.leadTabsAria} className="inline-flex border border-border bg-surface-subtle p-0.5">
        {tabs.map(([k, label]) => {
          const on = value === k
          return (
            <button key={k} type="button" role="tab" aria-selected={on} onClick={() => onChange(k)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 ${on
                ? 'bg-white text-text font-semibold shadow-sm ring-1 ring-border' : 'text-text-secondary hover:text-text hover:bg-white/60'}`}>
              <svg className={`w-4 h-4 ${on ? 'text-amber-700' : 'text-text-tertiary'}`} fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                {TAB_ICON[k] || TAB_ICON.card}
              </svg>
              {label}
            </button>
          )
        })}
      </div>
      <div className="ms-auto flex items-center gap-1">{children}</div>
    </div>
  )
}

/**
 * A lead's name in a list (2026-10-19): bold with a dot until this person
 * has opened it, plain after, like an inbox.
 */
export function LeadName({ lead, unread, fallback = null }) {
  const { t } = useT(LW)
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      {unread && <span className="w-2 h-2 rounded-full bg-sky-600 flex-shrink-0" aria-label={t.unread} />}
      <span className={`text-sm truncate ${unread ? 'font-bold text-text' : 'font-normal text-text-secondary'}`} dir="auto">
        {lead.company || lead.name || lead.email || fallback || t.unknownSender}
      </span>
    </span>
  )
}

/** "Mark unread" on an opened lead: it closes, bold again. */
export function MarkUnread({ onClick }) {
  const { t } = useT(LW)
  return (
    <button type="button" onClick={onClick}
      className="text-xs px-2.5 py-1 text-text-secondary hover:text-text hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400">
      {t.markUnread}
    </button>
  )
}

export function VerdictTag({ verdict, corrected = false }) {
  const { t, lang } = useT(LW)
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4] whitespace-nowrap ${VERDICT_TONE[verdict] || VERDICT_TONE.pending}`}>
      {leadLabels(lang).verdict[verdict] || verdict}
      {corrected && <span className="font-semibold normal-case tracking-normal opacity-70">{t.corrected}</span>}
    </span>
  )
}

/** The sales team's criteria as small chips. Junk and Philips only are red: someone must look. */
// Coloured by meaning, in whichever language the chip is written.
const chipTone = (label, L) => ([L.folder.junk, L.philips.only].includes(label) ? 'bg-red-50 text-red-600'
  : [L.sender.trader, L.words.notVerified].includes(label) ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-600')
export function CriteriaChips({ lead }) {
  const { lang } = useT(LW)
  const L = leadLabels(lang)
  const labels = criteriaLabels(lead, lang)
  if (!labels.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {labels.map((t) => (
        <span key={t} className={`text-[10px] px-1.5 py-0.5 ${chipTone(t, L)}`}>{t}</span>
      ))}
    </div>
  )
}

/** Why the agent read the sender, the source and the phase the way it did. */
function Evidence({ lead }) {
  const { t } = useT(LW)
  const rows = [
    [t.ev.why, lead.reason],
    [t.ev.sender, lead.sender_evidence],
    [t.ev.source, [lead.source_evidence, lead.website ? t.websiteChecked(lead.website) : ''].filter(Boolean).join(' · ')],
    [t.ev.phase, lead.project_evidence],
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
  const { t, lang } = useT(LW)
  const V = leadLabels(lang).verdict
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
        <span className="text-text-tertiary">{t.agentRight}</span>
        <Button size="xs" variant={lead.human_verdict === lead.verdict ? 'primary' : 'secondary'} onClick={() => { setWhy(null); onReview(lead, lead.verdict) }}>{t.yes}</Button>
        {['qualified', 'needs_review', 'unqualified'].filter((v) => v !== lead.verdict).map((v) => (
          <Button key={v} size="xs" variant={lead.human_verdict === v ? 'primary' : 'secondary'} onClick={() => no(v)}>
            {t.noVerdict(V[v])}
          </Button>
        ))}
        {lead.human_verdict && <Button size="xs" variant="ghost" onClick={() => { setWhy(null); onReview(lead, null) }}>{t.clear}</Button>}
      </div>
      {why && (
        <form onSubmit={saveWhy} className="flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={why.text}
            onChange={(e) => setWhy({ ...why, text: e.target.value })}
            maxLength={500}
            placeholder={t.whyPh}
            aria-label={t.whyAria}
            dir="auto"
            className="flex-1 min-w-[14rem] border border-border bg-white text-text text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <Button size="xs" type="submit" disabled={!why.text.trim()}>{t.save}</Button>
          <Button size="xs" variant="ghost" onClick={() => setWhy(null)}>{t.skip}</Button>
        </form>
      )}
      {!why && lead.human_reason && lead.human_verdict && lead.human_verdict !== lead.verdict && (
        <p className="text-text-tertiary">{t.whyCorrected}<span className="text-text" dir="auto">{lead.human_reason}</span></p>
      )}
    </div>
  )
}

/**
 * The email's text with its links clickable and Microsoft's picture
 * placeholders gone (emailText.js). React elements only, never HTML.
 */
export function EmailText({ text }) {
  return (
    <p className="whitespace-pre-wrap text-text leading-relaxed border-s-2 border-border ps-3 break-words" dir="auto">
      {emailSegments(text).map((p, i) => (p.href ? (
        <a key={i} href={p.href} target="_blank" rel="noreferrer noopener" className="text-sky-700 underline underline-offset-2 hover:text-sky-900 break-all">{p.link}</a>
      ) : <span key={i}>{p.text}</span>))}
    </p>
  )
}

/** Download one attachment: fetched with the person's sign-in, then saved. */
async function download(workspaceId, lead, a) {
  const res = await fetch('/api/leads/attachment_file', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: workspaceId, lead_id: lead.id, attachment_id: a.id }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    throw new Error(j?.error || `Download failed (${res.status}).`)
  }
  // A large file comes back as a ten-minute private link to a copy kept for
  // a day (api/leads/_files.js); the link itself says "download".
  if (/application\/json/i.test(res.headers.get('content-type') || '')) {
    const j = await res.json().catch(() => null)
    if (!j?.url) throw new Error(j?.error || 'No download link came back.')
    const link = document.createElement('a')
    link.href = j.url
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    return
  }
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = a.name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * What came with the email (2026-10-19): the attachments, read from the
 * mailbox when the lead is opened, each downloadable here, and the links to
 * shared files (SharePoint, WeTransfer…) written in the text. A salesperson
 * has no access to the info@ mailbox, so this is where they get the BOQ.
 */
export function Attachments({ lead, workspaceId }) {
  const { t } = useT(LW)
  const [list, setList] = useState({ for: null, items: [], error: '' })
  const [busy, setBusy] = useState('')
  const [fail, setFail] = useState('')
  const isEmail = lead.source === 'email'
  useEffect(() => {
    if (!isEmail) return
    let live = true
    leadsApi('attachments', workspaceId, { lead_id: lead.id }).then((r) => {
      if (live) setList({ for: lead.id, items: r.attachments || [], error: r.error || '' })
    })
    return () => { live = false }
  }, [lead.id, workspaceId, isEmail])
  const files = emailLinks(lead.message).filter((l) => isFileLink(l.href))
  const loading = isEmail && list.for !== lead.id
  if (!isEmail && !files.length) return null
  async function get(a) {
    setBusy(a.id); setFail('')
    try { await download(workspaceId, lead, a) } catch (e) { setFail(e.message) }
    setBusy('')
  }
  return (
    <div className="space-y-1.5">
      <p className="eyebrow">{t.attTitle}</p>
      {loading ? <p className="text-text-tertiary flex items-center gap-1.5"><Spinner size="sm" /> {t.lookingMailbox}</p>
        : list.error ? <p className="text-text-tertiary">{t.attFailed(list.error)}</p>
        : isEmail && !list.items.length && !files.length ? <p className="text-text-tertiary">{t.noAtt}</p> : null}
      {list.items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {list.items.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => get(a)} disabled={busy === a.id || a.tooBig || a.kind === 'link'}
                title={a.tooBig ? t.tooBigTitle : a.kind === 'link' ? t.linkTitle : a.big ? t.bigTitle : t.download}
                className="inline-flex items-center gap-1.5 border border-border bg-white px-2.5 py-1.5 text-xs hover:bg-surface-subtle disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400">
                {busy === a.id ? <Spinner size="sm" /> : (
                  <svg className="w-3.5 h-3.5 text-text-tertiary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3"/></svg>
                )}
                <span className="font-semibold text-text max-w-[16rem] truncate" dir="auto">{a.name}</span>
                <span className="text-text-tertiary" dir="ltr">{a.tooBig ? t.tooLarge(fileSize(a.size)) : fileSize(a.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="space-y-0.5">
          {files.map((l) => (
            <li key={l.href}><a href={l.href} target="_blank" rel="noreferrer noopener" className="text-sky-700 underline underline-offset-2 hover:text-sky-900 break-all">{l.host ? t.sharedOn(l.host) : l.link}</a></li>
          ))}
        </ul>
      )}
      {fail && <p className="text-[11px] text-red-600">{fail}</p>}
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
/**
 * "Open in Outlook": the link is worked out at the click, by the server,
 * from where the email is NOW (outlook_link). The stored one dies when the
 * email moves folder, which opened "This message might have been moved or
 * deleted". The tab is opened first, inside the click, or the browser
 * blocks it as a pop-up; it is then sent to the link, or closed with the
 * reason shown here.
 */
function OpenInOutlook({ lead, workspaceId, fallback }) {
  const { t } = useT(LW)
  const [state, setState] = useState({ busy: false, error: '' })
  async function open() {
    const tab = window.open('', '_blank')
    setState({ busy: true, error: '' })
    const r = await leadsApi('outlook_link', workspaceId, { lead_id: lead.id })
    if (r.url) {
      if (tab) { tab.opener = null; tab.location.href = r.url } else window.location.href = r.url
      return setState({ busy: false, error: '' })
    }
    tab?.close()
    setState({ busy: false, error: r.error || t.openFailed })
  }
  return (
    <>
      <Button size="xs" variant="secondary" onClick={open} disabled={state.busy}
        title={t.outlookTitle}>
        {state.busy ? <Spinner size="sm" /> : null}{t.openOutlook}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7"/></svg>
      </Button>
      {state.error && (
        <span className="text-[11px] text-red-600">
          {state.error}
          {fallback && !/deleted/.test(state.error) && <> <a href={fallback} target="_blank" rel="noreferrer" className="underline">{t.trySaved}</a></>}
        </span>
      )}
    </>
  )
}

export function LeadDetail({ lead, onReview, workspaceId, mailboxes = [], wide = false }) {
  const { t, lang } = useT(LW)
  const L = leadLabels(lang)
  const href = outlookLink(lead, mailboxes)
  const d = lead.details || {}
  const facts = [[t.facts.products, d.products], [t.facts.brands, d.brands], [t.facts.quantity, d.quantity], [t.facts.location, d.location], [t.facts.stage, d.stage], [t.facts.urgency, d.urgency]].filter(([, v]) => v)
  const asks = Array.isArray(lead.ask_next) ? lead.ask_next : []
  return (
    <div className={`px-4 pb-4 space-y-3 text-xs ${wide ? 'pt-4 md:ps-[8.25rem]' : 'ps-[7.75rem]'}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-text-secondary">
        <p><span className="text-text-tertiary">{t.nameL}</span><span dir="auto">{lead.name || '—'}</span></p>
        <p className="truncate"><span className="text-text-tertiary">{t.emailL}</span><span dir="ltr">{lead.email || '—'}</span></p>
        <p><span className="text-text-tertiary">{phonesOf(lead).length > 1 ? t.phonesL : t.phoneL}</span>
          {phonesOf(lead).length
            ? phonesOf(lead).map((p, i) => <span key={p} className="tabular-nums" dir="ltr">{i ? ', ' : ''}<a href={`tel:${p.replace(/[^\d+]/g, '')}`} className="hover:underline">{p}</a></span>)
            : '—'}
        </p>
      </div>
      <p className="text-text-tertiary">{t.cameInL}<span className="text-text-secondary">{channelLabel(lead, { lang })}{lead.mailbox ? ` (${lead.mailbox})` : ''}{lead.folder && lead.source === 'email' ? t.folderSuffix(L.folder[lead.folder] || lead.folder) : ''}</span></p>
      {lead.subject && <p className="text-text-tertiary" dir="auto">{lead.subject}</p>}
      <EmailText text={lead.message} />
      <Attachments lead={lead} workspaceId={workspaceId} />
      <Evidence lead={lead} />
      {facts.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {facts.map(([k, v]) => <p key={k}><span className="text-text-tertiary">{k} </span><span className="text-text" dir="auto">{v}</span></p>)}
        </div>
      )}
      {asks.length > 0 && (
        <div>
          <p className="eyebrow mb-1">{t.askFirstCall}</p>
          <ul className="list-disc ps-4 space-y-0.5 text-text">{asks.map((a) => <li key={a} dir="auto">{a}</li>)}</ul>
        </div>
      )}
      {lead.verdict && lead.verdict !== 'duplicate' && lead.source !== 'manual' && <Review lead={lead} onReview={onReview} />}
      {lead.crm_status && (
        <p className="text-text-tertiary">
          {t.crmL}<span className={lead.crm_status === 'failed' ? 'text-red-600 font-semibold' : 'text-text-secondary'}>{L.crm[lead.crm_status]}</span>
          {lead.approved_at ? <span>{t.approvedOn(when(lead.approved_at, lang))}</span> : null}
          {lead.crm_status === 'failed' && lead.crm_error ? <span className="block text-red-600">{t.odooSaid(lead.crm_error)}</span> : null}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {lead.source === 'email' && <OpenInOutlook lead={lead} workspaceId={workspaceId} fallback={href} />}
        <p className="text-[10px] text-text-tertiary">{[lead.mailbox, lead.confidence ? t.confidence(lead.confidence) : ''].filter(Boolean).join(' · ')}</p>
      </div>
    </div>
  )
}
