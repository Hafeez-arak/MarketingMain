import { useState } from 'react'
import { Card, SectionHead, Button, Input, Textarea, Select, Modal, ConfirmDialog, Empty } from '../../components/ui/index'
import { useAuth } from '../../store/auth'
import { saveSettings, emailApi } from '../../lib/email/client'
import { brandTodayKey, formatBrandDateTime } from '../../lib/brandTime'
import {
  PRESETS, HARD_MAX_PER_MAILBOX, WARMUP_DAYS, mailboxReadiness, mailboxCap, mailboxDomainProblem, domainOf,
} from '../../lib/email/cold'
import { Notice, EIcon } from './parts'

// ─── Outreach mailboxes ────────────────────────────────────────────────────
// The cold lane's senders: real mailboxes on a separate outreach domain,
// connected with an app password. Everything that writes goes through the
// server (/api/email/mailbox_*), which proves the login before storing
// anything and keeps the password sealed where this page cannot read it.
//
// What a person sees per mailbox is what the sender will do with it today:
// warming up until a date, or ready with today's limit (the ramp included).

export function OutreachMailboxes({ workspaceId, data, status, reload }) {
  const { user } = useAuth()
  const mailboxes = data.mailboxes || []
  const settings = data.settings || status?.settings || {}
  const enabled = Boolean(settings.cold_sending_enabled)
  const today = brandTodayKey()
  const [editing, setEditing] = useState(null)        // mailbox | 'new'
  const [removing, setRemoving] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null)
  const [confirmOn, setConfirmOn] = useState(false)

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
          subtitle="Cold emails go out from these, one at a time, Sunday to Thursday 9:00–17:00 Riyadh. Never from your marketing sender or your company domain."
          action={<Button size="sm" onClick={() => setEditing('new')}><EIcon name="plus" /> Connect mailbox</Button>}
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
            description={`Connect a mailbox on your outreach domain. Outreach from it can begin ${WARMUP_DAYS} days after its warm-up starts.`}
            action={<Button size="sm" onClick={() => setEditing('new')}>Connect the first one</Button>} />
        ) : (
          <div className="divide-y divide-border">
            {mailboxes.map(mb => {
              const ready = mailboxReadiness(mb, today)
              const cap = mailboxCap(mb, today)
              const paused = mb.status === 'paused'
              return (
                <div key={mb.id} className="px-5 py-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-text truncate">{mb.from_name ? `${mb.from_name} <${mb.email}>` : mb.email}</p>
                      <MailboxState mailbox={mb} ready={ready} />
                    </div>
                    <p className="text-[11px] text-text-tertiary mt-0.5">
                      {ready.ready
                        ? `Today: up to ${cap.cap}${cap.ramping ? ` (ramping up; its limit is ${cap.own})` : ''}.`
                        : ready.reason}
                      {mb.last_sent_at && ` Last sent ${formatBrandDateTime(mb.last_sent_at)}.`}
                    </p>
                    {mb.last_error && mb.status !== 'active' && <p className="text-[11px] text-red-600 mt-0.5">{mb.last_error}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="xs" variant="secondary" disabled={!!busy}
                      onClick={() => act('mailbox_test', { mailbox_id: mb.id, to: user?.email }, r => `Test sent from ${r.from} to ${r.sent_to}. Check it arrived in the inbox, not spam or Promotions.`)}>
                      {busy === `mailbox_test:${mb.id}` ? 'Sending…' : 'Send test'}
                    </Button>
                    <Button size="xs" variant="secondary" onClick={() => setEditing(mb)}>{mb.status === 'error' ? 'Reconnect' : 'Edit'}</Button>
                    {mb.status !== 'error' && (
                      <Button size="xs" variant="ghost" disabled={!!busy}
                        onClick={() => act('mailbox_pause', { mailbox_id: mb.id, paused: !paused }, () => (paused ? 'Mailbox resumed.' : 'Mailbox paused.'))}>
                        {paused ? 'Resume' : 'Pause'}
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" onClick={() => setRemoving(mb)} aria-label="Remove"><EIcon name="trash" /></Button>
                  </div>
                </div>
              )
            })}
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
        message="Its password is deleted and its follow-ups still waiting are cancelled (they belong to its threads). First emails still queued go out from the other mailboxes. Emails already sent stay in the history."
        onConfirm={() => act('mailbox_delete', { mailbox_id: removing.id }, () => 'Mailbox removed.')} />
      <ConfirmDialog open={confirmOn} onClose={() => setConfirmOn(false)} title="Switch outreach sending on?"
        message="Running outreach campaigns start sending to prospects from the ready mailboxes, within each mailbox's daily limit, on the next run (every 10 minutes, working hours only)."
        onConfirm={() => setEnabled(true)} />
    </div>
  )
}

function MailboxState({ mailbox, ready }) {
  const [label, cls] = mailbox.status === 'error' ? ['Needs reconnecting', 'bg-red-50 text-red-600']
    : mailbox.status === 'paused' ? ['Paused', 'bg-stone-100 text-stone-600']
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
  const domainProblem = form.email ? mailboxDomainProblem(form.email, [settings.from_email, settings.reply_to, userEmail].map(domainOf)) : ''
  const reconnect = mailbox?.status === 'error'

  function choosePreset(key) {
    setPreset(key)
    if (key === 'google') setForm(f => ({ ...f, ...pick(PRESETS.google) }))
  }

  async function save() {
    setSaving(true); setError('')
    const r = await emailApi('mailbox_save', workspaceId, {
      mailbox: {
        ...form, id: mailbox?.id,
        username: form.username.trim() || form.email.trim(),
        daily_limit: Number(form.daily_limit),
        smtp_port: Number(form.smtp_port), imap_port: Number(form.imap_port),
        warmup_started_on: form.warmup_started_on || null,
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
          <Select label="Provider" value={preset} onChange={e => choosePreset(e.target.value)}>
            {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </Select>
          <Input label="Mailbox address" value={form.email} onChange={e => set('email', e.target.value)} placeholder="ahmed@araklighting.com"
            error={domainProblem} disabled={!!mailbox && !reconnect} />
          <Input label="Sender name" value={form.from_name} onChange={e => set('from_name', e.target.value)} placeholder="Ahmed Al-Harbi"
            hint="A real person's name. Prospects answer people, not companies." />
          <Input label={mailbox ? 'App password (only to change it)' : 'App password'} type="password" autoComplete="new-password"
            value={password} onChange={e => setPassword(e.target.value)} placeholder="abcd efgh ijkl mnop"
            hint="The app password made for this mailbox, not its account password." />
          <Textarea label="Signature" rows={3} value={form.signature} onChange={e => set('signature', e.target.value)}
            placeholder={'Ahmed Al-Harbi\nProject Sales, ARAK Lighting\n+966 5x xxx xxxx'} hint="Added under every email from this mailbox, as plain text." />
          <div className="space-y-4">
            <Input label={`Most per day (max ${HARD_MAX_PER_MAILBOX})`} type="number" min={0} max={HARD_MAX_PER_MAILBOX}
              value={form.daily_limit} onChange={e => set('daily_limit', e.target.value)}
              hint="The first week sends 5 a day and the second 10, whatever this says. 15–30 is the safe range." />
            <Input label="Warm-up started on" type="date" value={form.warmup_started_on} max={brandTodayKey()}
              onChange={e => set('warmup_started_on', e.target.value)}
              hint={`The day your warm-up service began on this mailbox. Outreach starts ${WARMUP_DAYS} days later.`} />
          </div>
        </div>

        {preset === 'custom' && (
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

