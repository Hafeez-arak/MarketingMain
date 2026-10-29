import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { PageHeader, Button, Spinner, Skeleton, Input, Textarea, Toggle } from '../../components/ui/index'
import { Notice, Stat, SubTabs } from '../email/parts'
import { fetchMonthLeads, leadsApi } from '../../lib/leads/client'
import { VerdictTag, CriteriaChips } from './parts'
import LeadsBoard from './Board'
import Pipeline, { AddLeadDialog } from './Pipeline'
import CrmCard from './CrmCard'
import TeamCard from './TeamCard'
import AutoReplyCard from './AutoReplyCard'
import { RULE_LABELS } from '../../lib/leads/qualify'
import {
  monthStats, sheetHealth, modelName, money,
} from '../../lib/leads/view'

// ─── Leads ─────────────────────────────────────────────────────────────────
// Admin only for now (the owner's decision, 2026-10-06; who else gets in is
// part of separating sales from marketing). Two views: Leads, the clean list
// the sales team asked for (Board.jsx, 2026-10-11), and Agent settings, where
// the agent is switched on or off, tried on any text, and its key and
// mailboxes are managed. sales.araklighting.com opens straight onto it.
//
// How it is wired (the Sheet's script, the keys) is in docs/LEADS-SETUP.md,
// not on this page: the page says what is wrong, not how to fix it.

// Inbox: every enquiry, where leads are sorted, approved and assigned.
// Pipeline (2026-10-18): the approved and hand-added ones, by stage.
const VIEWS = [
  { key: 'leads', label: 'Inbox' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'settings', label: 'Agent settings' },
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
  consent_denied: 'The other organisation\'s admin did not approve the app.',
}




export default function LeadAgent() {
  const { isAccessAdmin, activeWorkspaceId, user } = useAuth()
  // This month's leads, for the counts on Agent settings.
  const [monthLeads, setMonthLeads] = useState([])
  const [status, setStatus] = useState(null)
  // The sales team: the Owner column, the Assign choice, and its own card.
  const [team, setTeam] = useState([])
  const [loadedFor, setLoadedFor] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  // Bumped by Refresh so the list reloads too.
  const [refreshKey, setRefreshKey] = useState(0)
  // Back from Microsoft's sign-in (Connect a mailbox): ?ms=connected or ?ms_error=…
  const [params, setParams] = useSearchParams()
  const msBack = params.get('ms') === 'connected' ? { ok: true, mailbox: params.get('mailbox') || 'The mailbox', forwarding: params.get('forwarding') || '' }
    : params.get('ms') === 'approved' ? { ok: true, approved: true }
    : params.get('ms_error') ? { ok: false, code: params.get('ms_error') } : null
  // Leads is the page; the agent's own settings are one tab away (?view=settings).
  // Coming back from a mailbox sign-in lands on settings, where it happened.
  const view = params.get('view') === 'settings' || msBack ? 'settings' : params.get('view') === 'pipeline' ? 'pipeline' : 'leads'
  const [adding, setAdding] = useState(false)
  // "Now" for the month and the Sheet's last call, taken when data loads
  // rather than during render.
  const [now, setNow] = useState(() => new Date())

  const reload = useCallback(async () => {
    if (!activeWorkspaceId) return
    const ws = activeWorkspaceId
    setRefreshing(true)
    try {
      const [rows, s, t] = await Promise.all([fetchMonthLeads(ws), leadsApi('status', ws), leadsApi('team', ws)])
      setMonthLeads(rows)
      if (!t.error) setTeam(t.team || [])
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
  const stats = useMemo(() => monthStats(monthLeads, now), [monthLeads, now])

  if (!isAccessAdmin) return <Navigate to="/" replace />

  const settings = status?.settings
  const sheet = sheetHealth(settings?.last_intake_at, now)

  async function setEnabled(enabled) {
    const r = await leadsApi('set_enabled', activeWorkspaceId, { enabled })
    if (r.error) return setError(r.error)
    setStatus((s) => ({ ...s, settings: r.settings }))
  }

  /** A person's verdict. Returns the updated lead for the list to show. */
  async function review(lead, verdict, reason) {
    const r = await leadsApi('review', activeWorkspaceId, { lead_id: lead.id, verdict, reason })
    if (r.error) { setError(r.error); return null }
    setMonthLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, ...r.lead } : l)))
    return r.lead
  }

  function refresh() {
    reload()
    setRefreshKey((k) => k + 1)
  }

  function chooseView(v) {
    setParams(v === 'leads' ? {} : { view: v }, { replace: true })
  }

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title="Leads" subtitle="Inbox: every enquiry from the website and the info@ mailboxes, sorted by the agent. Pipeline: the approved and hand-added leads, worked stage by stage.">
        <Button size="sm" onClick={() => setAdding(true)} disabled={!activeWorkspaceId}>+ Add lead</Button>
        <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing || !activeWorkspaceId}>
          {refreshing ? <Spinner size="sm" /> : null}
          Refresh
        </Button>
      </PageHeader>

      <SubTabs items={VIEWS} value={view} onChange={chooseView} />

      {msBack?.ok && msBack.approved && <Notice tone="sage" title="The other organisation approved the app">Its mailboxes can now be connected with "Connect a mailbox from another Microsoft 365".</Notice>}
      {msBack?.ok && !msBack.approved && msBack.forwarding === 'on' && <Notice tone="sage" title={`${msBack.mailbox} may forward now`}>Assigning a lead that came to it forwards the customer's email to the salesperson.</Notice>}
      {msBack?.ok && !msBack.approved && msBack.forwarding === 'refused' && <Notice tone="red" title={`${msBack.mailbox} is still read only`}>Microsoft did not grant sending. On another Microsoft 365, its admin approves the app again (the approval link below) before signing in with "Allow forwarding".</Notice>}
      {msBack?.ok && !msBack.approved && !msBack.forwarding && <Notice tone="sage" title={`${msBack.mailbox} is connected`}>The agent reads its new mail every 5 minutes, read only, from 1 October, and imports July to September in the background.</Notice>}
      {msBack && !msBack.ok && <Notice tone="red" title="The mailbox was not connected">{MS_ERRORS[msBack.code] || 'Microsoft did not finish the sign-in. Try again.'}</Notice>}
      {error && <Notice tone="red" title="Something went wrong">{error}</Notice>}

      {adding && (
        <AddLeadDialog workspaceId={activeWorkspaceId} canAssign team={team} me={user?.id || ''}
          onCancel={() => setAdding(false)} onAdded={() => { setAdding(false); chooseView('pipeline'); setRefreshKey((k) => k + 1) }} />
      )}

      {view === 'leads' ? (
        <LeadsBoard workspaceId={activeWorkspaceId} onReview={review} refreshKey={refreshKey} mailboxes={status?.mailboxes || []} canApprove canTest team={team} me={user?.id || ''} />
      ) : view === 'pipeline' ? (
        <Pipeline workspaceId={activeWorkspaceId} onReview={review} refreshKey={refreshKey} mailboxes={status?.mailboxes || []} canApprove team={team} me={user?.id || ''} focus={params.get('lead') || ''} />
      ) : (
        <>
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
            <p className="text-[10px] text-text-tertiary mt-1">Names, emails and phone numbers are hidden from the AI.</p>
          </div>
          <div className="bg-white px-4 py-3">
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">OpenRouter key</p>
            {loading ? <Skeleton className="h-6 w-24 mt-1" /> : status?.key?.valid
              ? <p className="text-sm font-bold text-sage-700 mt-1">Working{(status.key.creditLeft ?? status.key.limitRemaining) != null ? ` · ${money(status.key.creditLeft ?? status.key.limitRemaining)} left` : ''}</p>
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className="space-y-4 min-w-0">
              <TryIt workspaceId={activeWorkspaceId} />
              <CrmCard workspaceId={activeWorkspaceId} crm={status?.crm} loading={loading}
                onChange={(crm) => setStatus((st) => ({ ...st, crm }))} onError={setError} />
              <TeamCard workspaceId={activeWorkspaceId} team={team} loading={loading} odooConnected={Boolean(status?.crm?.connected)}
                onChange={setTeam} onError={setError} />
              <AutoReplyCard workspaceId={activeWorkspaceId} onError={setError} />
            </div>
            <Connection workspaceId={activeWorkspaceId} status={status} loading={loading} onChange={setStatus} onError={setError} onReload={reload} now={now} />
          </div>
        </>
      )}
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
          <p className="text-text">{RULE_LABELS[v.rule] ? `${RULE_LABELS[v.rule]}. ` : ''}{v.reason}</p>
          <CriteriaChips lead={{ criteria_version: 2, sender_type: v.senderType, source_check: v.sourceCheck, project_type: v.projectType === 'not_stated' ? '' : v.projectType, request_type: v.requestType === 'none' ? '' : v.requestType, philips: v.philips }} />
          {v.summary && <p className="text-text-secondary">{v.summary}</p>}
          {v.ask_next?.length > 0 && <ul className="list-disc pl-4 text-text-secondary">{v.ask_next.map((a) => <li key={a}>{a}</li>)}</ul>}
          <p className="text-[10px] text-text-tertiary">{modelName(out.model)} · {money(out.cost)}</p>
        </div>
      )}
    </div>
  )
}

/**
 * A mailbox the agent reads may also be warmed up for outreach (info@clb-sa
 * .com). The warm-up service's tag marks its emails; the agent skips them.
 */
function WarmupTag({ workspaceId, mailbox, onError, onReload }) {
  const [value, setValue] = useState(null)
  const [busy, setBusy] = useState(false)
  const saved = mailbox.warmup_tag || ''
  const typed = value ?? saved

  async function save() {
    setBusy(true)
    const r = await leadsApi('mail_set_warmup_tag', workspaceId, { mailbox_id: mailbox.id, warmup_tag: typed })
    setBusy(false)
    if (r.error) return onError(r.error)
    setValue(null)
    onReload()
  }

  return (
    <div className="flex gap-2 items-center">
      <label htmlFor={`warmup-tag-${mailbox.id}`} className="text-[11px] text-text-tertiary whitespace-nowrap">Warm-up tag to skip</label>
      <input id={`warmup-tag-${mailbox.id}`} type="text" value={typed} onChange={(e) => setValue(e.target.value)} placeholder="None"
        className="flex-1 min-w-0 px-2 py-1 border border-border text-[11px] focus:outline-none focus:border-amber-700" />
      {value !== null && value !== saved && <Button size="xs" onClick={save} disabled={busy}>{busy ? <Spinner size="sm" /> : 'Save'}</Button>}
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
  const [alertInput, setAlertInput] = useState(null)
  const [alertNote, setAlertNote] = useState('')
  const alertEmails = (status?.settings?.alert_emails || []).join(', ')
  // Problems the health check has emailed about and that are not fixed yet.
  const openProblems = Object.values(status?.settings?.alert_state || {}).filter((p) => p.sentAt)

  async function saveAlerts() {
    setBusy('alerts')
    const r = await leadsApi('set_alert_emails', workspaceId, { alert_emails: alertInput ?? alertEmails })
    setBusy('')
    if (r.error) return onError(r.error)
    setAlertInput(null)
    onChange((s) => ({ ...s, settings: r.settings }))
  }

  async function testAlert() {
    setBusy('test-alert'); setAlertNote('')
    const r = await leadsApi('test_alert', workspaceId)
    setBusy('')
    if (r.error) return onError(r.error)
    setAlertNote(`Test alert sent from ${r.sentFrom} to ${r.to.join(', ')}.`)
  }

  async function checkHealth() {
    setBusy('health'); setAlertNote('')
    const r = await leadsApi('health_check_now', workspaceId)
    setBusy('')
    if (r.error) return onError(r.error)
    setAlertNote(r.issues.length ? `${r.issues.length} problem(s) found${r.sent ? ' and emailed' : ''}: ${r.issues.map((i) => i.title).join('; ')}` : 'Everything is working.')
    onReload()
  }

  // send: "Allow forwarding", the same sign-in asking to send too (Mail.Send).
  async function connectMailbox(otherOrg = false, { send = false, mailbox = null } = {}) {
    setBusy(send ? `send:${mailbox?.id}` : otherOrg ? 'connect-other' : 'connect')
    const r = await leadsApi('mail_connect_start', workspaceId, { other_org: otherOrg, send, login_hint: mailbox?.email || '' })
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
                    <p className="text-xs font-semibold text-text truncate" title={mb.label && mb.label !== mb.email ? `Signed in as ${mb.email}` : ''}>
                      {mb.label || mb.email}{mb.tenant ? <span className="font-normal text-text-tertiary"> · other Microsoft 365</span> : null}
                    </p>
                    <Button size="xs" variant="ghost" onClick={() => disconnect(mb)} disabled={busy === `off:${mb.id}`}>Disconnect</Button>
                  </div>
                  {mb.status === 'reconnect'
                    ? <p className="text-[11px] text-red-600">Microsoft no longer accepts its sign-in. Connect it again. {mb.last_error}</p>
                    : <p className={`text-[11px] ${health.state === 'stale' ? 'text-amber-800' : 'text-text-tertiary'}`}>{mb.last_checked_at ? health.label.replace('Checked', 'Read') : 'Not read yet'}{c.seen != null ? ` · last round: ${c.seen} new, ${c.skipped || 0} skipped as not enquiries` : ''}</p>}
                  {mb.status !== 'reconnect' && mb.last_error && <p className="text-[11px] text-red-600">{mb.last_error}</p>}
                  <p className="text-[11px] text-text-tertiary">
                    Jul–Sep history: {mb.history_done ? 'imported' : mb.history_cursor ? `importing, up to ${String(mb.history_cursor).slice(0, 10)}` : 'starts with the next round'}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-text-tertiary">
                      {mb.can_send ? 'Forwards leads to the person they are assigned to.' : 'Read only: cannot forward leads to salespeople yet.'}
                    </p>
                    {!mb.can_send && (
                      <Button size="xs" variant="secondary" onClick={() => connectMailbox(Boolean(mb.tenant), { send: true, mailbox: mb })} disabled={busy === `send:${mb.id}` || status?.microsoft === false}
                        title={`Sign in as ${mb.email} again, allowing it to send`}>
                        {busy === `send:${mb.id}` ? <Spinner size="sm" /> : null}Allow forwarding
                      </Button>
                    )}
                  </div>
                  <WarmupTag workspaceId={workspaceId} mailbox={mb} onError={onError} onReload={onReload} />
                </div>
              )
            })}
            <div className="flex gap-2">
              <Button size="xs" variant="secondary" onClick={() => connectMailbox(false)} disabled={busy === 'connect' || status?.microsoft === false}>
                {busy === 'connect' ? <Spinner size="sm" /> : null}
                {(status?.mailboxes || []).length ? 'Connect another' : 'Connect a mailbox'}
              </Button>
              {(status?.mailboxes || []).length > 0 && (
                <Button size="xs" variant="ghost" onClick={checkNow} disabled={busy === 'check'}>{busy === 'check' ? <Spinner size="sm" /> : null}Check now</Button>
              )}
            </div>
            <Button size="xs" variant="ghost" onClick={() => connectMailbox(true)} disabled={busy === 'connect-other' || status?.microsoft === false}>
              {busy === 'connect-other' ? <Spinner size="sm" /> : null}
              Connect a mailbox from another Microsoft 365
            </Button>
            {status?.consentUrl && (
              <div className="flex gap-2 items-center">
                <code className="flex-1 min-w-0 truncate px-2 py-1 bg-surface-subtle border border-border text-[10px] select-all">{status.consentUrl}</code>
                <Button size="xs" variant="secondary" onClick={() => copy('consent', status.consentUrl)}>{copied === 'consent' ? 'Copied' : 'Copy'}</Button>
              </div>
            )}
            <p className="text-[10px] text-text-tertiary">Approval link for another organisation's Microsoft 365 admin (once, before its mailboxes connect, and again for forwarding). Sign in as the mailbox. The agent reads it, and with forwarding allowed sends a lead's email to its salesperson; it never moves or deletes anything.</p>
          </>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="eyebrow">Health alerts</p>
        {openProblems.length > 0 && (
          <ul className="text-[11px] text-red-600 list-disc pl-4 space-y-0.5">
            {openProblems.map((p) => <li key={p.title}>{p.title}</li>)}
          </ul>
        )}
        <div className="flex gap-2">
          <input id="lead-alert-emails" type="text" placeholder="name@arak-sa.com" value={alertInput ?? alertEmails} onChange={(e) => setAlertInput(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1.5 border border-border text-xs focus:outline-none focus:border-amber-700" />
          <Button size="xs" onClick={saveAlerts} disabled={busy === 'alerts' || alertInput === null}>{busy === 'alerts' ? <Spinner size="sm" /> : 'Save'}</Button>
        </div>
        <div className="flex gap-2">
          <Button size="xs" variant="secondary" onClick={testAlert} disabled={busy === 'test-alert' || !alertEmails}>{busy === 'test-alert' ? <Spinner size="sm" /> : null}Send test alert</Button>
          <Button size="xs" variant="ghost" onClick={checkHealth} disabled={busy === 'health'}>{busy === 'health' ? <Spinner size="sm" /> : null}Check now</Button>
        </div>
        {alertNote && <p className="text-[11px] text-text-secondary">{alertNote}</p>}
        <p className="text-[10px] text-text-tertiary">Emailed when a Sheet stops, a mailbox needs reconnecting, the AI fails, or credit runs low; again daily until fixed, and once when it works again. Sent from a connected Microsoft 365 mailbox.</p>
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
