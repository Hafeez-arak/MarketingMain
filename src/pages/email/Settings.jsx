import { useState } from 'react'
import { Card, SectionHead, Button, Input, Textarea, Toggle, Skeleton } from '../../components/ui/index'
import { useAuth } from '../../store/auth'
import { isValidEmail } from '../../lib/email/contacts'
import { saveSettings, emailApi } from '../../lib/email/client'
import { Notice } from './parts'
import { OutreachMailboxes } from './Mailboxes'

// ─── Settings ──────────────────────────────────────────────────────────────
// Who the email is from, what every footer says, and how fast sending may
// grow. One-time setup outside the app (Resend, DNS, Vercel) is not shown
// here on purpose; it lives in docs/EMAIL-SETUP.md.

const PLANS = [
  { key: 'free', label: 'Resend Free', daily: 100, monthly: 3000 },
  { key: 'pro', label: 'Resend Pro ($20/mo)', daily: 50000, monthly: 50000 },
]

export function EmailSettings(props) {
  const { loading, data, status, workspaceId } = props
  if (loading) {
    return <div className="space-y-4">{[0, 1, 2].map(i => <Card key={i} className="p-5"><Skeleton className="h-24 w-full" /></Card>)}</div>
  }
  // Rendered only once the data is in, and keyed on the workspace: the form
  // starts from what is stored and starts again on a workspace switch, with
  // no effect copying props into state. After a save the form already holds
  // what was saved, so it is deliberately not re-keyed on updated_at.
  const s = data.settings || status?.settings || {}
  return <SettingsForm {...props} key={workspaceId} initial={s} />
}

function SettingsForm({ workspaceId, data, status, reload, initial: s }) {
  const { user } = useAuth()
  const [form, setForm] = useState(() => ({
    from_name: s.from_name || 'Arak Lighting',
    from_email: s.from_email || '',
    reply_to: s.reply_to || '',
    company_address: s.company_address || '',
    warmup_enabled: s.warmup_enabled !== false,
    provider_daily_limit: s.provider_daily_limit ?? 100,
    provider_monthly_limit: s.provider_monthly_limit ?? 3000,
  }))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [testTo, setTestTo] = useState(user?.email || '')
  const [testing, setTesting] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const errors = {
    from_email: form.from_email && !isValidEmail(form.from_email) ? 'Not a valid address' : '',
    reply_to: form.reply_to && !isValidEmail(form.reply_to) ? 'Not a valid address' : '',
  }
  const plan = PLANS.find(p => p.daily === Number(form.provider_daily_limit) && p.monthly === Number(form.provider_monthly_limit))?.key || 'custom'

  async function save() {
    if (Object.values(errors).some(Boolean)) { setMessage({ tone: 'red', text: 'Fix the highlighted addresses first.' }); return }
    setSaving(true); setMessage(null)
    try {
      await saveSettings(workspaceId, {
        ...form,
        from_email: form.from_email.trim().toLowerCase(),
        reply_to: form.reply_to.trim().toLowerCase(),
        provider_daily_limit: Math.max(0, Number(form.provider_daily_limit) || 0),
        provider_monthly_limit: Math.max(0, Number(form.provider_monthly_limit) || 0),
      })
      setMessage({ tone: 'sage', text: 'Settings saved.' })
      await reload()
    } catch (err) {
      setMessage({ tone: 'red', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true); setMessage(null)
    const r = await emailApi('send_test', workspaceId, {
      to: testTo, audience: 'marketing', subject: 'Sending check',
      body: 'Hi {{first_name|there}},\n\nThis is a test from the Email section. If it arrived in the inbox (not spam), sending is set up correctly.\n\n- Sender and domain: working\n- Footer and unsubscribe link: below',
    })
    setTesting(false)
    setMessage(r.error ? { tone: 'red', text: r.error } : { tone: 'sage', text: `Test sent to ${r.sent_to}.` })
  }


  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Card>
        <SectionHead title="Marketing sender" subtitle="Who newsletters come from. Sent through Resend, from a subdomain so your staff mailboxes are never affected." />
        <div className="p-5 grid md:grid-cols-2 gap-4">
          <Input label="From name" value={form.from_name} onChange={e => set('from_name', e.target.value)} hint="What people see in their inbox." />
          <Input label="From address" value={form.from_email} onChange={e => set('from_email', e.target.value)} error={errors.from_email}
            placeholder="updates@email.arak-sa.com" hint="Must be on your verified sending domain." />
          <Input label="Replies go to" value={form.reply_to} onChange={e => set('reply_to', e.target.value)} error={errors.reply_to}
            placeholder="marketing@arak-sa.com" hint="A real inbox someone reads. Replies are good for your reputation." />
          <Textarea label="Company address (footer)" rows={3} value={form.company_address} onChange={e => set('company_address', e.target.value)}
            placeholder={'ARAK Lighting\nStreet, District\nRiyadh, Saudi Arabia'} hint="Printed in every marketing email. Required by anti-spam rules." />
        </div>
      </Card>

      <Card>
        <SectionHead title="Sending limits and warm-up" subtitle="The daily limit is the lowest of warm-up, the health brake, and your Resend plan." />
        <div className="p-5 space-y-4">
          <div className="grid md:grid-cols-3 gap-4 items-end">
            <div>
              <p className="eyebrow mb-1.5">Resend plan</p>
              <div className="flex">
                {PLANS.map(p => (
                  <button key={p.key} type="button" onClick={() => setForm(f => ({ ...f, provider_daily_limit: p.daily, provider_monthly_limit: p.monthly }))}
                    className={`flex-1 px-3 py-2 text-xs font-semibold border -ml-px first:ml-0 ${plan === p.key ? 'bg-amber-700 text-white border-amber-700 relative z-10' : 'bg-white text-text-secondary border-border hover:bg-surface-subtle'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <Input label="Per day" type="number" min={0} value={form.provider_daily_limit} onChange={e => set('provider_daily_limit', e.target.value)} />
            <Input label="Per month" type="number" min={0} value={form.provider_monthly_limit} onChange={e => set('provider_monthly_limit', e.target.value)} />
          </div>
          <Toggle checked={form.warmup_enabled} onChange={v => set('warmup_enabled', v)}
            label="Warm-up: start small and grow the daily limit over six weeks (strongly recommended for a new domain)" />
          <p className="text-[11px] text-text-tertiary">
            The health brake cannot be switched off: sending pauses by itself if spam reports reach 0.3% or bounces reach 5% in a week, and holds volume low above 2% bounces.
          </p>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
      </div>

      <Card>
        <SectionHead title="Test sending" subtitle="Sends one email, with this sender and footer, to the address below." />
        <div className="p-5 flex flex-wrap items-end gap-2">
          <Input className="min-w-[260px]" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@arak-sa.com" />
          <Button variant="secondary" onClick={test} disabled={testing || !status?.configured?.resend || !data.settings?.from_email}>
            {testing ? 'Sending…' : 'Send test'}
          </Button>
          {!data.settings?.from_email && <p className="w-full text-[11px] text-text-tertiary">Save a From address above first.</p>}
        </div>
      </Card>

      <OutreachMailboxes workspaceId={workspaceId} data={data} status={status} reload={reload} />
    </div>
  )
}
