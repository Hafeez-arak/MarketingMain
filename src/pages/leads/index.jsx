import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { PageHeader, Button, Spinner, Skeleton, Input, Textarea, Toggle } from '../../components/ui/index'
import { Notice, Stat, SubTabs } from '../email/parts'
import { fetchLeads, leadsApi } from '../../lib/leads/client'
import {
  VERDICT_LABEL, VERDICT_TONE, SOURCE_LABEL, effectiveVerdict, monthStats, filterLeads, sheetHealth, modelName,
} from '../../lib/leads/view'

// ─── Lead Agent ────────────────────────────────────────────────────────────
// Admin only (the owner's decision, 2026-10-06). The agent reads every
// enquiry, from the website Sheet now and the info@ mailbox next, and says
// whether it is a real buyer. This page is where you see what it decided,
// correct it, try it on any text, and switch it on or off.
//
// How it is wired (the Sheet's script, the keys) is in docs/LEADS-SETUP.md,
// not on this page: the page says what is wrong, not how to fix it.

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'unqualified', label: 'Unqualified' },
  { key: 'duplicate', label: 'Duplicates' },
  { key: 'pending', label: 'Not checked' },
]

// What went wrong with "Connect a mailbox", in the words a person needs.
const MS_ERRORS = {
  expired: 'The sign-in took too long. Start it again.',
  browser: 'The sign-in finished in a different browser from the one that started it. Start it again here.',
  consent: 'Microsoft asked for an admin\'s approval of the app. A Microsoft 365 admin needs to approve it once.',
  denied: 'The sign-in was cancelled.',
  config: 'Microsoft sign-in is not switched on for this app yet.',
  token: 'Microsoft did not hand back a sign-in. Try again.',
  no_mailbox: 'That account has no Exchange mailbox.',
  graph: 'Microsoft would not let the agent open that mailbox. Try again, or check the account.',
  save: 'The mailbox could not be saved. Try again.',
}

const money = (n) => `$${(Number(n) || 0).toFixed(n && n < 0.1 ? 4 : 2)}`

function VerdictTag({ verdict, corrected = false }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4] whitespace-nowrap ${VERDICT_TONE[verdict] || VERDICT_TONE.pending}`}>
      {VERDICT_LABEL[verdict] || verdict}
      {corrected && <span className="font-semibold normal-case tracking-normal opacity-70">· corrected</span>}
    </span>
  )
}

function when(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' })
}

export default function LeadAgent() {
  const { isAccessAdmin, activeWorkspaceId } = useAuth()
  const [leads, setLeads] = useState([])
  const [status, setStatus] = useState(null)
  const [loadedFor, setLoadedFor] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState('all')
  const [open, setOpen] = useState(null)
  // Back from Microsoft's sign-in (Connect a mailbox): ?ms=connected or ?ms_error=…
  const [params] = useSearchParams()
  const msBack = params.get('ms') === 'connected' ? { ok: true, mailbox: params.get('mailbox') || 'The mailbox' }
    : params.get('ms_error') ? { ok: false, code: params.get('ms_error') } : null
  // "Now" for the month and the Sheet's last call, taken when data loads
  // rather than during render.
  const [now, setNow] = useState(() => new Date())

  const reload = useCallback(async () => {
    if (!activeWorkspaceId) return
    const ws = activeWorkspaceId
    setRefreshing(true)
    try {
      const [rows, s] = await Promise.all([fetchLeads(ws), leadsApi('status', ws)])
      setLeads(rows)
      setNow(new Date())
      setStatus(s.error ? { error: s.error } : s)
      setError('')
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoadedFor(ws)
      setRefreshing(false)
    }
  }, [activeWorkspaceId])

  useEffect(() => { if (isAccessAdmin) queueMicrotask(reload) }, [reload, isAccessAdmin])

  const loading = loadedFor !== activeWorkspaceId
  const stats = useMemo(() => monthStats(leads, now), [leads, now])
  const shown = useMemo(() => filterLeads(leads, tab), [leads, tab])

  if (!isAccessAdmin) return <Navigate to="/" replace />

  const settings = status?.settings
  const sheet = sheetHealth(settings?.last_intake_at, now)

  async function setEnabled(enabled) {
    const r = await leadsApi('set_enabled', activeWorkspaceId, { enabled })
    if (r.error) return setError(r.error)
    setStatus((s) => ({ ...s, settings: r.settings }))
  }

  async function review(lead, verdict) {
    const r = await leadsApi('review', activeWorkspaceId, { lead_id: lead.id, verdict })
    if (r.error) return setError(r.error)
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, ...r.lead } : l)))
  }

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title="Lead Agent" subtitle="Reads every enquiry and says whether it is a real buyer, so salespeople only open the ones worth their time. Admin only.">
        <Button variant="secondary" size="sm" onClick={reload} disabled={refreshing || !activeWorkspaceId}>
          {refreshing ? <Spinner size="sm" /> : null}
          Refresh
        </Button>
      </PageHeader>

      {msBack?.ok && <Notice tone="sage" title={`${msBack.mailbox} is connected`}>The agent reads its new mail every 5 minutes, read only. The last week's mail is read first, a few at a time.</Notice>}
      {msBack && !msBack.ok && <Notice tone="red" title="The mailbox was not connected">{MS_ERRORS[msBack.code] || 'Microsoft did not finish the sign-in. Try again.'}</Notice>}
      {error && <Notice tone="red" title="Something went wrong">{error}</Notice>}
      {status?.error && <Notice tone="red" title="Could not load the agent's settings">{status.error}</Notice>}

      {/* ── Is it running ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-border border border-border">
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Agent</p>
          {loading ? <Skeleton className="h-6 w-24 mt-1" /> : (
            <div className="mt-1.5"><Toggle checked={Boolean(settings?.enabled)} onChange={setEnabled} label={settings?.enabled ? 'On' : 'Off'} /></div>
          )}
          <p className="text-[10px] text-text-tertiary mt-1">Off: new enquiries wait unread until it is on again.</p>
        </div>
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Model</p>
          {loading ? <Skeleton className="h-6 w-24 mt-1" /> : <p className="text-sm font-bold text-text mt-1">{modelName(status?.model)}</p>}
          <p className="text-[10px] text-text-tertiary mt-1">Through OpenRouter. Names, emails and phone numbers are hidden from it.</p>
        </div>
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">OpenRouter key</p>
          {loading ? <Skeleton className="h-6 w-24 mt-1" /> : status?.key?.valid
            ? <p className="text-sm font-bold text-sage-700 mt-1">Working{status.key.limitRemaining != null ? ` · ${money(status.key.limitRemaining)} left` : ''}</p>
            : <p className="text-sm font-bold text-red-600 mt-1">{status?.key?.saved ? 'Saved key is not accepted' : 'No key saved'}</p>}
          <p className="text-[10px] text-text-tertiary mt-1">{status?.key?.fromDeployment ? 'Using the deployment\'s key.' : 'Replace it under Connection, on the right.'}</p>
        </div>
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Website Sheet</p>
          {loading ? <Skeleton className="h-6 w-24 mt-1" /> : (
            <p className={`text-sm font-bold mt-1 ${sheet.state === 'ok' ? 'text-sage-700' : sheet.state === 'stale' ? 'text-amber-800' : 'text-text-secondary'}`}>{sheet.label}</p>
          )}
          <p className="text-[10px] text-text-tertiary mt-1">{sheet.state === 'stale' ? 'The Sheet checks every 5 minutes; it has stopped calling in.' : 'The Sheet sends new enquiries every 5 minutes.'}</p>
        </div>
      </div>

      {/* ── This month ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border border border-border">
        <Stat label="Qualified" value={stats.qualified} hint="Real buyers this month" tone="text-sage-700" loading={loading} />
        <Stat label="Needs review" value={stats.needs_review} hint="A person should look" tone="text-amber-800" loading={loading} />
        <Stat label="Unqualified" value={stats.unqualified} hint="Pitches, jobs, spam" loading={loading} />
        <Stat label="Duplicates" value={stats.duplicate} hint="Same sender sent it again" loading={loading} />
        <Stat label="AI spend" value={money(stats.spend)} hint={stats.reviewed ? `${stats.reviewed} checked by a person, ${stats.corrected} corrected` : 'This month, on these enquiries'} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* ── The leads ── */}
        <div className="lg:col-span-2 bg-white border border-border min-w-0">
          <div className="px-4 pt-3"><SubTabs items={TABS} value={tab} onChange={setTab} /></div>
          {loading ? (
            <div className="p-4 space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !shown.length ? (
            <p className="px-4 py-10 text-sm text-text-tertiary text-center">
              {leads.length ? 'No enquiries in this tab.' : 'No enquiries yet. They appear here once the website Sheet sends them.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((l) => {
                const v = effectiveVerdict(l)
                const isOpen = open === l.id
                return (
                  <li key={l.id}>
                    <button type="button" onClick={() => setOpen(isOpen ? null : l.id)}
                      className="w-full text-left px-4 py-3 hover:bg-surface-subtle transition-colors flex items-start gap-3">
                      <div className="w-24 flex-shrink-0">
                        <p className="text-[11px] text-text-secondary tabular-nums">{when(l.received_at || l.created_at)}</p>
                        <p className="text-[10px] text-text-tertiary mt-0.5 truncate" title={l.mailbox || ''}>{SOURCE_LABEL[l.source] || l.source}{l.mailbox ? ` · ${l.mailbox.split('@')[0]}@` : ''}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-text truncate">{l.company || l.name || l.email || 'Unknown sender'}</p>
                        <p className="text-xs text-text-secondary mt-0.5 line-clamp-2" dir="auto">{l.summary || l.message}</p>
                        {l.reason && <p className="text-[11px] text-text-tertiary mt-1 line-clamp-1">{l.reason}</p>}
                        {!l.verdict && l.error && <p className="text-[11px] text-red-600 mt-1 line-clamp-1">{l.error}</p>}
                      </div>
                      <div className="flex-shrink-0"><VerdictTag verdict={v} corrected={Boolean(l.human_verdict && l.human_verdict !== l.verdict)} /></div>
                    </button>
                    {isOpen && <LeadDetail lead={l} onReview={review} />}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="space-y-4 min-w-0">
          <TryIt workspaceId={activeWorkspaceId} />
          <Connection workspaceId={activeWorkspaceId} status={status} loading={loading} onChange={setStatus} onError={setError} onReload={reload} now={now} />
        </div>
      </div>
    </div>
  )
}

function LeadDetail({ lead, onReview }) {
  const d = lead.details || {}
  const facts = [['Products', d.products], ['Brands', d.brands], ['Quantity', d.quantity], ['Location', d.location], ['Stage', d.stage], ['Urgency', d.urgency]].filter(([, v]) => v)
  const asks = Array.isArray(lead.ask_next) ? lead.ask_next : []
  return (
    <div className="px-4 pb-4 pl-[7.75rem] space-y-3 text-xs">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-text-secondary">
        <p><span className="text-text-tertiary">Name </span>{lead.name || '—'}</p>
        <p className="truncate"><span className="text-text-tertiary">Email </span>{lead.email || '—'}</p>
        <p><span className="text-text-tertiary">Phone </span>{lead.phone || '—'}</p>
      </div>
      {lead.subject && <p className="text-text-tertiary">{lead.subject}</p>}
      <p className="whitespace-pre-wrap text-text leading-relaxed border-l-2 border-border pl-3" dir="auto">{lead.message}</p>
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
        {lead.link && <a href={lead.link} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-amber-800 hover:underline">Open in Outlook</a>}
        <p className="text-[10px] text-text-tertiary">{lead.mailbox ? `${lead.mailbox} · ` : ''}{lead.model ? `${modelName(lead.model)} · ${money(lead.cost_usd)}` : ''}{lead.confidence ? ` · ${lead.confidence} confidence` : ''}</p>
      </div>
    </div>
  )
}

function TryIt({ workspaceId }) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null)

  async function run() {
    setBusy(true); setOut(null)
    const r = await leadsApi('try', workspaceId, { subject, message })
    setBusy(false)
    setOut(r)
  }

  const v = out?.verdict
  return (
    <div className="bg-white border border-border p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-text">Try it</p>
        <p className="text-[11px] text-text-tertiary mt-0.5">Paste any enquiry or email, in Arabic or English, to see what the agent decides. Nothing is saved.</p>
      </div>
      <Input id="lead-try-subject" placeholder="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <Textarea id="lead-try-message" rows={5} placeholder="Paste the message here" value={message} onChange={(e) => setMessage(e.target.value)} dir="auto" />
      <Button size="sm" onClick={run} disabled={busy || !message.trim()}>
        {busy ? <Spinner size="sm" /> : null}
        Check
      </Button>
      {out?.error && <p className="text-xs text-red-600">{out.error}</p>}
      {v && (
        <div className="border-t border-border pt-3 space-y-1.5 text-xs">
          <div className="flex items-center gap-2"><VerdictTag verdict={v.verdict} /><span className="text-text-tertiary">{v.category.replace(/_/g, ' ')} · {v.confidence} confidence</span></div>
          <p className="text-text">{v.reason}</p>
          {v.summary && <p className="text-text-secondary">{v.summary}</p>}
          {v.ask_next?.length > 0 && <ul className="list-disc pl-4 text-text-secondary">{v.ask_next.map((a) => <li key={a}>{a}</li>)}</ul>}
          <p className="text-[10px] text-text-tertiary">{modelName(out.model)} · {money(out.cost)}</p>
        </div>
      )}
    </div>
  )
}

function Connection({ workspaceId, status, loading, onChange, onError, onReload, now }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState('')
  const intakeKey = status?.settings?.intake_key || ''
  const exportKey = status?.settings?.export_key || ''
  const master = sheetHealth(status?.settings?.last_export_at, now)

  async function connectMailbox() {
    setBusy('connect')
    const r = await leadsApi('mail_connect_start', workspaceId)
    if (r.error) { setBusy(''); return onError(r.error) }
    window.location.assign(r.url)
  }

  async function checkNow() {
    setBusy('check')
    const r = await leadsApi('mail_check_now', workspaceId)
    setBusy('')
    if (r.error) return onError(r.error)
    onReload()
  }

  async function disconnect(mb) {
    setBusy(`off:${mb.id}`)
    const r = await leadsApi('mail_disconnect', workspaceId, { mailbox_id: mb.id })
    setBusy('')
    if (r.error) return onError(r.error)
    onReload()
  }

  async function saveKey() {
    setBusy('key')
    const r = await leadsApi('save_key', workspaceId, { openrouter_key: key })
    setBusy('')
    if (r.error) return onError(r.error)
    setKey('')
    onChange((s) => ({ ...s, key: { ...s?.key, ...r.key, fromDeployment: false } }))
  }

  async function rotate(which = 'intake') {
    setBusy(`rotate:${which}`)
    const r = await leadsApi(which === 'export' ? 'rotate_export_key' : 'rotate_intake_key', workspaceId)
    setBusy('')
    if (r.error) return onError(r.error)
    onChange((s) => ({ ...s, settings: r.settings }))
  }

  async function copy(which, value) {
    try { await navigator.clipboard.writeText(value); setCopied(which); setTimeout(() => setCopied(''), 1500) } catch { /* the key is selectable */ }
  }

  return (
    <div className="bg-white border border-border p-4 space-y-4">
      <p className="text-sm font-semibold text-text">Connection</p>
      <div className="space-y-1.5">
        <p className="eyebrow">Mailboxes it reads</p>
        {loading ? <Skeleton className="h-8 w-full" /> : (
          <>
            {(status?.mailboxes || []).length === 0 && <p className="text-[11px] text-text-tertiary">None yet. Connect info@ to have its new enquiries sorted too.</p>}
            {(status?.mailboxes || []).map((mb) => {
              const health = sheetHealth(mb.last_checked_at, now)
              const c = mb.last_counts || {}
              return (
                <div key={mb.id} className="border border-border px-2.5 py-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-text truncate">{mb.email}</p>
                    <Button size="xs" variant="ghost" onClick={() => disconnect(mb)} disabled={busy === `off:${mb.id}`}>Disconnect</Button>
                  </div>
                  {mb.status === 'reconnect'
                    ? <p className="text-[11px] text-red-600">Microsoft no longer accepts its sign-in. Connect it again. {mb.last_error}</p>
                    : <p className={`text-[11px] ${health.state === 'stale' ? 'text-amber-800' : 'text-text-tertiary'}`}>{mb.last_checked_at ? health.label.replace('Checked', 'Read') : 'Not read yet'}{c.seen != null ? ` · last round: ${c.seen} new, ${c.skipped || 0} skipped as not enquiries` : ''}</p>}
                  {mb.status !== 'reconnect' && mb.last_error && <p className="text-[11px] text-red-600">{mb.last_error}</p>}
                </div>
              )
            })}
            <div className="flex gap-2">
              <Button size="xs" variant="secondary" onClick={connectMailbox} disabled={busy === 'connect' || status?.microsoft === false}>
                {busy === 'connect' ? <Spinner size="sm" /> : null}
                {(status?.mailboxes || []).length ? 'Connect another' : 'Connect a mailbox'}
              </Button>
              {(status?.mailboxes || []).length > 0 && (
                <Button size="xs" variant="ghost" onClick={checkNow} disabled={busy === 'check'}>{busy === 'check' ? <Spinner size="sm" /> : null}Check now</Button>
              )}
            </div>
            <p className="text-[10px] text-text-tertiary">Sign in as the mailbox. The agent can only read it: it cannot send, move or delete anything.</p>
          </>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="eyebrow">Website Sheet key</p>
        {loading ? <Skeleton className="h-8 w-full" /> : (
          <div className="flex gap-2">
            <code className="flex-1 min-w-0 truncate px-2 py-1.5 bg-surface-subtle border border-border text-[11px] select-all">{intakeKey || '—'}</code>
            <Button size="xs" variant="secondary" onClick={() => copy('intake', intakeKey)} disabled={!intakeKey}>{copied === 'intake' ? 'Copied' : 'Copy'}</Button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-text-tertiary">The Sheet's script sends this with every call.</p>
          <Button size="xs" variant="ghost" onClick={() => rotate('intake')} disabled={busy === 'rotate:intake' || loading}>New key</Button>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="eyebrow">Master Sheet key</p>
        {loading ? <Skeleton className="h-8 w-full" /> : (
          <div className="flex gap-2">
            <code className="flex-1 min-w-0 truncate px-2 py-1.5 bg-surface-subtle border border-border text-[11px] select-all">{exportKey || '—'}</code>
            <Button size="xs" variant="secondary" onClick={() => copy('export', exportKey)} disabled={!exportKey}>{copied === 'export' ? 'Copied' : 'Copy'}</Button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className={`text-[10px] ${master.state === 'stale' ? 'text-amber-800' : 'text-text-tertiary'}`}>
            {master.state === 'never' ? 'The leads workbook has not connected yet.' : `Leads workbook: ${master.label.toLowerCase()}.`} It can read every lead.
          </p>
          <Button size="xs" variant="ghost" onClick={() => rotate('export')} disabled={busy === 'rotate:export' || loading}>New key</Button>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="eyebrow">{status?.key?.saved ? 'Replace the OpenRouter key' : 'OpenRouter key'}</p>
        <div className="flex gap-2">
          <input id="lead-openrouter-key" type="password" autoComplete="off" placeholder="sk-or-…" value={key} onChange={(e) => setKey(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1.5 border border-border text-xs focus:outline-none focus:border-amber-700" />
          <Button size="xs" onClick={saveKey} disabled={busy === 'key' || !key.trim()}>{busy === 'key' ? <Spinner size="sm" /> : 'Save'}</Button>
        </div>
        <p className="text-[10px] text-text-tertiary">Checked with OpenRouter, then stored sealed. No one can read it back, including you.</p>
      </div>
    </div>
  )
}
