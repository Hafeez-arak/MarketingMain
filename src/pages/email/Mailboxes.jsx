import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, SectionHead, Button, Input, Textarea, Select, Modal, ConfirmDialog, Empty } from '../../components/ui/index'
import { useAuth } from '../../store/auth'
import { saveSettings, emailApi } from '../../lib/email/client'
import { brandTodayKey, formatBrandDateTime } from '../../lib/brandTime'
import {
  PRESETS, HARD_MAX_PER_MAILBOX, HARD_MAX_TOTAL_PER_MAILBOX, WARMUP_DAYS, WARMUP_DAY_CHOICES, mailboxReadiness, mailboxCap,
  mailboxDomainProblem, domainOf, warmupDaysOf,
} from '../../lib/email/cold'
import { Notice, EIcon } from './parts'

// ─── Outreach mailboxes ────────────────────────────────────────────────────
// The cold lane's senders, two kinds:
//   Microsoft 365   the company's own accounts, connected by signing in to
//                   Microsoft as the mailbox (no password reaches the app);
//                   sends and reads replies through Microsoft Graph.
//   Google          a mailbox on a separate outreach domain, connected with
//                   an app password, over SMTP/IMAP.
// Everything that writes goes through the server (/api/email/mailbox_* and
// ms_connect_start), which proves the login before storing anything and
// keeps the secret sealed where this page cannot read it.
//
// What a person sees per mailbox is what the sender will do with it today:
// warming up until a date, or ready with today's limit (the ramp included),
// and whether its domain passed the DNS check (SPF, DKIM, MX) that every
// sending run makes.
//
// A mailbox on another organisation's Microsoft 365 (CLB, Ghusn, the new
// araklighting.com) connects through "Another organisation"; that
// organisation's admin approves the app once with the link shown here.

export function OutreachMailboxes({ workspaceId, data, status, reload }) {
  const { user } = useAuth()
  const mailboxes = data.mailboxes || []
  const settings = data.settings || status?.settings || {}
  const enabled = Boolean(settings.cold_sending_enabled)
  const today = brandTodayKey()
  const [editing, setEditing] = useState(null)        // mailbox | 'new'
  const [removing, setRemoving] = useState(null)
  const [params, setParams] = useSearchParams()
  // Back from Microsoft: the callback's verdict is in the URL, read once.
  const [message, setMessage] = useState(() => msOutcome(params))
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [confirmOn, setConfirmOn] = useState(false)
  const microsoftOn = Boolean(status?.configured?.microsoft)

  // Then drop the verdict from the URL, so a reload does not repeat it.
  useEffect(() => {
    if (!params.has('ms') && !params.has('ms_error')) return
    const connected = params.has('ms')
    setParams(p => { const n = new URLSearchParams(p); n.delete('ms'); n.delete('ms_error'); return n }, { replace: true })
    if (connected) reload()
  }, [params, setParams, reload])

  async function connectMicrosoft(mailboxId, otherOrg = false) {
    setBusy(`ms:${mailboxId || (otherOrg ? 'other' : 'new')}`); setMessage(null)
    const r = await emailApi('ms_connect_start', workspaceId, mailboxId ? { mailbox_id: mailboxId } : { other_org: otherOrg })
    if (r.error || !r.url) { setBusy(''); setMessage({ tone: 'red', text: r.error || 'Microsoft sign-in could not start.' }); return }
    window.location.assign(r.url)
  }

  async function setEnabled(on) {
    setBusy('switch'); setMessage(null)
    try {
      await saveSettings(workspaceId, { cold_sending_enabled: on })
      setMessage({ tone: on ? 'sage' : 'amber', text: on ? 'Outreach sending is on.' : 'Outreach sending is stopped. Nothing more goes out until it is switched back on.' })
      await reload()
    } catch (err) {
      setMessage({ tone: 'red', text: err.message })
    } finally {
      setBusy('')
    }
  }

  async function act(action, payload, done) {
    setBusy(`${action}:${payload.mailbox_id}`); setMessage(null)
    const r = await emailApi(action, workspaceId, payload)
    setBusy('')
    if (r.error) { setMessage({ tone: 'red', text: r.error }); return }
    setMessage({ tone: 'sage', text: done(r) })
    await reload()
  }

  async function checkDomain(mb) {
    setBusy(`dns:${mb.id}`); setMessage(null)
    const r = await emailApi('mailbox_check_domain', workspaceId, { mailbox_id: mb.id })
    setBusy('')
    if (r.error) { setMessage({ tone: 'red', text: r.error }); return }
    const blocking = r.dns_check?.blocking || []
    setMessage(blocking.length
      ? { tone: 'red', text: `${domainOf(mb.email)} is not ready: ${blocking.join(' ')}` }
      : { tone: 'sage', text: `${domainOf(mb.email)} passed: SPF, DKIM and MX are in place.` })
    await reload()
  }

  async function copyConsent() {
    try { await navigator.clipboard.writeText(status?.outreachConsentUrl || ''); setMessage({ tone: 'sage', text: 'Approval link copied.' }) } catch { /* the link is selectable */ }
  }

  async function runPreview() {
    setBusy('preview')
    const r = await emailApi('cold_preview', workspaceId)
    setBusy('')
    setPreview(r.error ? { error: r.error } : r.preview)
  }

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Card>
        <SectionHead
          title="Outreach mailboxes"
          subtitle="Outreach emails go out from these: never two at once, at uneven times, Sunday to Thursday 9:00–17:00 Riyadh, and never from the newsletter sender."
          action={(
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => connectMicrosoft()} disabled={!microsoftOn || !!busy}
                title={microsoftOn ? 'Sign in to Microsoft as the mailbox' : 'Microsoft sign-in is not switched on yet'}>
                <EIcon name="plus" /> {busy === 'ms:new' ? 'Opening Microsoft…' : 'Connect Microsoft 365'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => connectMicrosoft(null, true)} disabled={!microsoftOn || !!busy}
                title="A mailbox on another organisation's Microsoft 365, such as CLB or Ghusn">
                {busy === 'ms:other' ? 'Opening Microsoft…' : 'Another organisation'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>Connect Google</Button>
            </div>
          )}
        />
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">Outreach sending is {enabled ? 'on' : 'off'}</p>
            <p className="text-[11px] text-text-tertiary">
              {enabled
                ? 'Running outreach campaigns send from the ready mailboxes below. Switch off to stop everything at once.'
                : 'Nothing is sent to prospects while this is off, even from a running campaign. This is also the emergency stop.'}
            </p>
          </div>
          <Button size="sm" variant={enabled ? 'danger' : 'primary'} disabled={busy === 'switch' || (!enabled && !mailboxes.length)}
            onClick={() => (enabled ? setEnabled(false) : setConfirmOn(true))}>
            {enabled ? 'Stop outreach sending' : 'Switch on'}
          </Button>
        </div>

        {mailboxes.length === 0 ? (
          <Empty icon={<EIcon name="mail" />} title="No outreach mailbox yet"
            description={`Sign in with a company Microsoft 365 mailbox, or connect a Google mailbox on an outreach domain (outreach from it begins ${WARMUP_DAYS} days after its warm-up starts).`}
            action={<Button size="sm" onClick={() => connectMicrosoft()} disabled={!microsoftOn || !!busy}>Connect Microsoft 365</Button>} />
        ) : (
          <div className="divide-y divide-border">
            {mailboxes.map(mb => {
              const ready = mailboxReadiness(mb, today)
              const cap = mailboxCap(mb, today)
              const paused = mb.status === 'paused'
              const microsoft = mb.provider === 'microsoft'
              return (
                <div key={mb.id} className="px-5 py-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-text truncate">{mb.from_name ? `${mb.from_name} <${mb.email}>` : mb.email}</p>
                      <MailboxState mailbox={mb} ready={ready} />
                      <span className="text-[10px] text-text-tertiary">{microsoft ? (mb.tenant ? 'Microsoft 365 · other organisation' : 'Microsoft 365') : 'Google / app password'}</span>
                    </div>
                    <p className={`text-[11px] mt-0.5 ${ready.dns ? 'text-red-600' : 'text-text-tertiary'}`}>
                      {ready.ready ? todayLine(cap) : ready.reason}
                      {mb.last_sent_at && ` Last sent ${formatBrandDateTime(mb.last_sent_at)}.`}
                    </p>
                    <DomainLine mailbox={mb} />
                    {mb.last_error && mb.status !== 'active' && <p className="text-[11px] text-red-600 mt-0.5">{mb.last_error}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {microsoft && mb.status === 'error' ? (
                      <Button size="xs" variant="secondary" disabled={!microsoftOn || !!busy} onClick={() => connectMicrosoft(mb.id)}>
                        {busy === `ms:${mb.id}` ? 'Opening Microsoft…' : 'Reconnect'}
                      </Button>
                    ) : (
                      <Button size="xs" variant="secondary" onClick={() => setEditing(mb)}>{mb.status === 'error' ? 'Reconnect' : 'Edit'}</Button>
                    )}
                    {mb.status !== 'error' && (
                      <Button size="xs" variant="ghost" disabled={!!busy}
                        onClick={() => act('mailbox_pause', { mailbox_id: mb.id, paused: !paused }, () => (paused ? 'Mailbox resumed.' : 'Mailbox paused.'))}>
                        {paused ? 'Resume' : 'Pause'}
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => checkDomain(mb)}>
                      {busy === `dns:${mb.id}` ? 'Checking…' : 'Check domain'}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setRemoving(mb)} aria-label="Remove"><EIcon name="trash" /></Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {microsoftOn && status?.outreachConsentUrl && (
          <div className="px-5 py-3 border-t border-border space-y-1.5">
            <p className="text-[11px] text-text-secondary">
              A mailbox on another organisation's Microsoft 365 needs that organisation's admin to approve this app once, before it connects.
              Send them this link. It asks to send email and read the replies; it is not the lead agent's read-only approval.
            </p>
            <div className="flex gap-2 items-center">
              <code className="flex-1 min-w-0 truncate px-2 py-1 bg-surface-subtle border border-border text-[10px] select-all">{status.outreachConsentUrl}</code>
              <Button size="xs" variant="secondary" onClick={copyConsent}>Copy</Button>
            </div>
          </div>
        )}
      </Card>

      {mailboxes.length > 0 && (
        <Card>
          <SectionHead title="What goes out next" subtitle="The sending run, worked out but not done. Nothing is sent by checking."
            action={<Button size="sm" variant="secondary" onClick={runPreview} disabled={busy === 'preview'}>{busy === 'preview' ? 'Checking…' : 'Check now'}</Button>} />
          {preview && (
            <div className="p-5 space-y-2 text-xs">
              {preview.error && <Notice tone="red">{preview.error}</Notice>}
              {!preview.error && !preview.window && <p className="text-text-secondary">Outside sending hours. The next window opens {preview.nextWindow ? formatBrandDateTime(preview.nextWindow) : 'soon'}.</p>}
              {!preview.error && !enabled && <p className="text-amber-800">Outreach sending is off, so none of this will happen until it is switched on.</p>}
              {(preview.workspaces?.[0]?.mailboxes || []).map(line => (
                <div key={line.mailbox} className="flex flex-wrap gap-x-3 border-b border-border last:border-0 pb-1.5">
                  <span className="font-semibold text-text">{line.mailbox}</span>
                  <span className={line.action === 'send' ? 'text-sage-700' : 'text-text-secondary'}>{line.reason}</span>
                  {line.next && <span className="text-text-tertiary">Next: {line.next.step ? `follow-up ${line.next.step}` : 'first email'} to {line.next.email}{line.next.campaign ? ` (${line.next.campaign})` : ''}</span>}
                  {line.capToday != null && <span className="text-text-tertiary">{line.sentToday}/{line.capToday} today</span>}
                </div>
              ))}
              {preview.workspaces?.[0]?.error && <Notice tone="red">{preview.workspaces[0].error}</Notice>}
            </div>
          )}
        </Card>
      )}

      {editing && (
        <MailboxForm workspaceId={workspaceId} mailbox={editing === 'new' ? null : editing} settings={settings} userEmail={user?.email}
          onClose={() => setEditing(null)}
          onSaved={async text => { setEditing(null); setMessage({ tone: 'sage', text }); await reload() }} />
      )}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} danger title={`Remove ${removing?.email}?`}
        message="Its stored login is deleted and its follow-ups still waiting are cancelled (they belong to its threads). First emails still queued go out from the other mailboxes. Emails already sent stay in the history."
        onConfirm={() => act('mailbox_delete', { mailbox_id: removing.id }, () => 'Mailbox removed.')} />
      <ConfirmDialog open={confirmOn} onClose={() => setConfirmOn(false)} title="Switch outreach sending on?"
        message="Running outreach campaigns start sending to prospects from the ready mailboxes, within each mailbox's daily limit, on the next run (every 10 minutes, working hours only)."
        onConfirm={() => setEnabled(true)} />
    </div>
  )
}

// Why the Microsoft sign-in came back without a mailbox. The callback sends
// a code, never text or an address, in the URL.
const MS_ERRORS = {
  consent_denied: 'The other organisation\'s admin did not approve the app.',
  expired: 'The Microsoft sign-in took too long. Start it again.',
  browser: 'The Microsoft sign-in has to finish in the same browser it started in. Start it again.',
  consent: 'Microsoft needs an administrator to approve this app for the organisation before mailboxes can connect.',
  denied: 'The Microsoft sign-in was cancelled.',
  config: 'Microsoft sign-in is not switched on yet.',
  token: 'Microsoft did not complete the sign-in. Start it again.',
  no_mailbox: 'That account has no Microsoft 365 mailbox. It needs an Exchange Online licence first.',
  graph: 'Microsoft signed in, but its mailbox could not be reached. Try again in a minute.',
  personal: 'That is a personal Microsoft account. Sign in with a company mailbox.',
  gone: 'That mailbox was removed while you were signing in.',
  wrong_account: 'You signed in as a different account from the mailbox being reconnected. Sign in as that mailbox.',
  taken: 'That address is already connected with an app password. Remove it first to connect it through Microsoft.',
  save: 'The mailbox could not be saved. Try again.',
}

function msOutcome(params) {
  if (params.get('ms') === 'connected') {
    return { tone: 'sage', text: 'Microsoft 365 mailbox connected. If a warm-up service runs on it, open Edit and enter its warm-up start date and emails a day; outreach then waits for it.' }
  }
  if (params.get('ms') === 'approved') {
    return { tone: 'sage', text: 'Approved. That organisation\'s mailboxes can now connect with "Another organisation".' }
  }
  const err = params.get('ms_error')
  return err ? { tone: 'red', text: MS_ERRORS[err] || 'The Microsoft sign-in did not finish. Try again.' } : null
}

/** Today's line for a ready mailbox: outreach, plus the warm-up that shares its day. */
function todayLine(cap) {
  const warm = cap.warmup ? ` plus ${cap.warmup} warm-up` : ''
  const why = cap.warmupLimits ? ` (warm-up and outreach together stay within ${HARD_MAX_TOTAL_PER_MAILBOX})`
    : cap.ramping ? ` (ramping up; its limit is ${cap.own})` : ''
  return `Today: up to ${cap.cap} outreach${warm}${why}.`
}

/** The sending domain's last DNS check, when it has something to say. */
function DomainLine({ mailbox }) {
  const check = mailbox.dns_check || {}
  if (!check.checked_at) return <p className="text-[11px] text-text-tertiary mt-0.5">Domain not checked yet: it is checked before the first send.</p>
  const warnings = check.warnings || []
  // What blocks is said by the readiness line; only the warnings are left to say.
  if ((check.blocking || []).length) {
    return warnings.length ? <p className="text-[11px] text-amber-800 mt-0.5">Also: {warnings.join(' ')}</p> : null
  }
  return (
    <p className={`text-[11px] mt-0.5 ${warnings.length ? 'text-amber-800' : 'text-text-tertiary'}`}>
      {warnings.length ? warnings.join(' ') : `${check.domain || domainOf(mailbox.email)}: SPF, DKIM and MX in place.`}
      {' '}Checked {formatBrandDateTime(check.checked_at)}.
    </p>
  )
}

function MailboxState({ mailbox, ready }) {
  const [label, cls] = mailbox.status === 'error' ? ['Needs reconnecting', 'bg-red-50 text-red-600']
    : mailbox.status === 'paused' ? ['Paused', 'bg-stone-100 text-stone-600']
    : ready.dns ? ['Domain not ready', 'bg-red-50 text-red-600']
    : ready.ready ? ['Ready', 'bg-sage-100 text-sage-700']
    : ['Warming up', 'bg-sky-50 text-sky-700']
  return <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4] whitespace-nowrap ${cls}`}>{label}</span>
}

// ─── Connect / edit ────────────────────────────────────────────────────────

function MailboxForm({ workspaceId, mailbox, settings, userEmail, onClose, onSaved }) {
  const presetOf = mb => (!mb || mb.smtp_host === PRESETS.google.smtp_host ? 'google' : 'custom')
  const [preset, setPreset] = useState(presetOf(mailbox))
  const [form, setForm] = useState(() => ({
    email: mailbox?.email || '',
    from_name: mailbox?.from_name || '',
    signature: mailbox?.signature || '',
    daily_limit: mailbox?.daily_limit ?? 15,
    warmup_started_on: mailbox?.warmup_started_on || '',
    warmup_per_day: mailbox?.warmup_per_day ?? 0,
    warmup_days: warmupDaysOf(mailbox),
    username: mailbox?.username && mailbox.username !== mailbox.email ? mailbox.username : '',
    smtp_host: mailbox?.smtp_host || PRESETS.google.smtp_host,
    smtp_port: mailbox?.smtp_port || PRESETS.google.smtp_port,
    imap_host: mailbox?.imap_host || PRESETS.google.imap_host,
    imap_port: mailbox?.imap_port || PRESETS.google.imap_port,
  }))
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // The same check the server makes, early, so nobody types a password for a
  // mailbox that will be refused.
  const microsoft = mailbox?.provider === 'microsoft'
  const domainProblem = form.email && !microsoft ? mailboxDomainProblem(form.email, [settings.from_email, settings.reply_to, userEmail].map(domainOf)) : ''
  const reconnect = mailbox?.status === 'error' && !microsoft

  function choosePreset(key) {
    setPreset(key)
    if (key === 'google') setForm(f => ({ ...f, ...pick(PRESETS.google) }))
  }

  async function save() {
    setSaving(true); setError('')
    const r = await emailApi('mailbox_save', workspaceId, microsoft ? {
      mailbox: {
        id: mailbox.id, from_name: form.from_name, signature: form.signature,
        daily_limit: Number(form.daily_limit), warmup_started_on: form.warmup_started_on || null,
        warmup_per_day: Number(form.warmup_per_day), warmup_days: Number(form.warmup_days),
      },
    } : {
      mailbox: {
        ...form, id: mailbox?.id,
        username: form.username.trim() || form.email.trim(),
        daily_limit: Number(form.daily_limit),
        smtp_port: Number(form.smtp_port), imap_port: Number(form.imap_port),
        warmup_started_on: form.warmup_started_on || null,
        warmup_per_day: Number(form.warmup_per_day), warmup_days: Number(form.warmup_days),
      },
      password,
    })
    setSaving(false)
    if (r.error) { setError(r.error); return }
    onSaved(r.verified ? `${r.mailbox.email} is connected: sending and reading both logged in.` : 'Mailbox saved.')
  }

  return (
    <Modal open onClose={onClose} title={mailbox ? (reconnect ? 'Reconnect mailbox' : 'Edit mailbox') : 'Connect an outreach mailbox'} width="max-w-2xl">
      <div className="p-5 space-y-4">
        {!mailbox && (
          <p className="text-xs text-text-secondary leading-relaxed">
            A mailbox on your <strong>outreach domain</strong>, never the company domain, and the <strong>app password</strong> made for it.
            Nothing is stored until both logins work.
          </p>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          {microsoft ? (
            <Input label="Provider" value="Microsoft 365 (signed in)" disabled />
          ) : (
            <Select label="Provider" value={preset} onChange={e => choosePreset(e.target.value)}>
              {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </Select>
          )}
          <Input label="Mailbox address" value={form.email} onChange={e => set('email', e.target.value)} placeholder="ahmed@araklighting.com"
            error={domainProblem} disabled={!!mailbox && !reconnect} />
          <Input label="Sender name" value={form.from_name} onChange={e => set('from_name', e.target.value)} placeholder="Ahmed Al-Harbi"
            hint="A real person's name. Prospects answer people, not companies." />
          {!microsoft && (
            <Input label={mailbox ? 'App password (only to change it)' : 'App password'} type="password" autoComplete="new-password"
              value={password} onChange={e => setPassword(e.target.value)} placeholder="abcd efgh ijkl mnop"
              hint="The app password made for this mailbox, not its account password." />
          )}
          <Textarea label="Signature" rows={3} value={form.signature} onChange={e => set('signature', e.target.value)}
            placeholder={'Ahmed Al-Harbi\nProject Sales, ARAK Lighting\n+966 5x xxx xxxx'} hint="Added under every email from this mailbox, as plain text." />
          <div className="space-y-4">
            <Input label={`Most per day (max ${HARD_MAX_PER_MAILBOX})`} type="number" min={0} max={HARD_MAX_PER_MAILBOX}
              value={form.daily_limit} onChange={e => set('daily_limit', e.target.value)}
              hint="The first week sends 5 a day and the second 10, whatever this says. 15–30 is the safe range." />
            <Input label="Warm-up started on" type="date" value={form.warmup_started_on} max={brandTodayKey()}
              onChange={e => set('warmup_started_on', e.target.value)}
              hint={microsoft
                ? 'The day the warm-up service began on it. Leave empty only for an established company mailbox with no warm-up service: it then starts now at 5 a day.'
                : 'The day your warm-up service began on this mailbox.'} />
            <Select label="Warm up for" value={form.warmup_days} onChange={e => set('warmup_days', e.target.value)}>
              {WARMUP_DAY_CHOICES.map(d => (
                <option key={d} value={d}>{d} days{d === WARMUP_DAYS ? ' (a domain with years of email)' : d === 28 ? ' (a brand-new domain)' : ''}</option>
              ))}
            </Select>
            <Input label="Warm-up emails a day" type="number" min={0} max={HARD_MAX_PER_MAILBOX}
              value={form.warmup_per_day} onChange={e => set('warmup_per_day', e.target.value)}
              hint={`The daily warm-up limit set in the warm-up service. Keep it running after outreach starts; warm-up and outreach together never pass ${HARD_MAX_TOTAL_PER_MAILBOX} a day.`} />
          </div>
        </div>

        {preset === 'custom' && !microsoft && (
          <div className="grid md:grid-cols-4 gap-3 border-t border-border pt-4">
            <Input className="md:col-span-3" label="Sending server (SMTP)" value={form.smtp_host} onChange={e => set('smtp_host', e.target.value)} placeholder="smtp.example.com" />
            <Input label="Port" type="number" value={form.smtp_port} onChange={e => set('smtp_port', e.target.value)} />
            <Input className="md:col-span-3" label="Reading server (IMAP)" value={form.imap_host} onChange={e => set('imap_host', e.target.value)} placeholder="imap.example.com" />
            <Input label="Port" type="number" value={form.imap_port} onChange={e => set('imap_port', e.target.value)} />
            <Input className="md:col-span-4" label="Login (if not the address)" value={form.username} onChange={e => set('username', e.target.value)} />
          </div>
        )}

        {error && <Notice tone="red">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !!domainProblem || !form.email || (!mailbox && !password) || (reconnect && !password)}>
            {saving ? 'Checking the logins…' : mailbox && !reconnect ? 'Save' : 'Connect'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function pick(p) {
  return { smtp_host: p.smtp_host, smtp_port: p.smtp_port, imap_host: p.imap_host, imap_port: p.imap_port }
}

