import { useState } from 'react'
import { Card, SectionHead, Button, Input, Textarea, Toggle, Skeleton } from '../../components/ui/index'
import { useAuth } from '../../store/auth'
import { isValidEmail } from '../../lib/email/contacts'
import { saveSettings, emailApi } from '../../lib/email/client'
import { Notice } from './parts'

// ─── Settings ──────────────────────────────────────────────────────────────
// Who the email is from, what every footer says, how fast sending may grow,
// and the setup steps that happen outside this app (Resend, GoDaddy, Vercel).

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
    cold_from_name: s.cold_from_name || '',
    cold_from_email: s.cold_from_email || '',
    cold_daily_limit: s.cold_daily_limit ?? 20,
  }))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [testTo, setTestTo] = useState(user?.email || '')
  const [testing, setTesting] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const errors = {
    from_email: form.from_email && !isValidEmail(form.from_email) ? 'Not a valid address' : '',
    reply_to: form.reply_to && !isValidEmail(form.reply_to) ? 'Not a valid address' : '',
    cold_from_email: form.cold_from_email && !isValidEmail(form.cold_from_email) ? 'Not a valid address' : '',
  }
  const sameDomain = form.cold_from_email && form.from_email
    && form.cold_from_email.split('@')[1]?.toLowerCase().endsWith((form.from_email.split('@')[1] || '').toLowerCase().split('.').slice(-2).join('.'))
  const plan = PLANS.find(p => p.daily === Number(form.provider_daily_limit) && p.monthly === Number(form.provider_monthly_limit))?.key || 'custom'

  async function save() {
    if (Object.values(errors).some(Boolean)) { setMessage({ tone: 'red', text: 'Fix the highlighted addresses first.' }); return }
    setSaving(true); setMessage(null)
    try {
      await saveSettings(workspaceId, {
        ...form,
        from_email: form.from_email.trim().toLowerCase(),
        reply_to: form.reply_to.trim().toLowerCase(),
        cold_from_email: form.cold_from_email.trim().toLowerCase(),
        provider_daily_limit: Math.max(0, Number(form.provider_daily_limit) || 0),
        provider_monthly_limit: Math.max(0, Number(form.provider_monthly_limit) || 0),
        cold_daily_limit: Math.max(0, Math.min(50, Number(form.cold_daily_limit) || 0)),
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
    setMessage(r.error ? { tone: 'red', text: r.error } : { tone: 'sage', text: `Test sent to ${r.sent_to}. If it lands in spam, check the DNS records in step 2.` })
  }

  const webhookUrl = `${window.location.origin}/api/email/webhook`
  const cfg = status?.configured || {}

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Card>
        <SectionHead title="Marketing sender" subtitle="Who newsletters come from. Sent through Resend, from a subdomain so your staff mailboxes are never affected." />
        <div className="p-5 grid md:grid-cols-2 gap-4">
          <Input label="From name" value={form.from_name} onChange={e => set('from_name', e.target.value)} hint="What people see in their inbox." />
          <Input label="From address" value={form.from_email} onChange={e => set('from_email', e.target.value)} error={errors.from_email}
            placeholder="updates@email.arak-sa.com" hint="Must be on the domain verified in Resend (email.arak-sa.com)." />
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

      <Card>
        <SectionHead title="Cold outreach sender" subtitle="For later: the separate domain and mailbox. Nothing is sent from here until it is connected." />
        <div className="p-5 grid md:grid-cols-3 gap-4">
          <Input label="From name" value={form.cold_from_name} onChange={e => set('cold_from_name', e.target.value)} placeholder="Ahmed from ARAK Lighting" />
          <Input label="Outreach address" value={form.cold_from_email} onChange={e => set('cold_from_email', e.target.value)} error={errors.cold_from_email}
            placeholder="ahmed@araklighting.com" />
          <Input label="Per day (max 50)" type="number" min={0} max={50} value={form.cold_daily_limit} onChange={e => set('cold_daily_limit', e.target.value)}
            hint="20–40 per mailbox is the safe range." />
          {sameDomain && (
            <div className="md:col-span-3">
              <Notice tone="red">The outreach address is on the same domain as your marketing and staff email. Use a separate domain (e.g. araklighting.com) so a cold campaign can never damage arak-sa.com.</Notice>
            </div>
          )}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
      </div>

      <Card>
        <SectionHead title="Setup steps" subtitle="Done once, outside this app. Each step says where." />
        <ol className="divide-y divide-border text-sm">
          <Step n={1} done={cfg.resend} title="Put the Resend API key on the server">
            <p>Vercel → project <strong>marketing-main</strong> → Settings → Environment Variables → add <code>RESEND_API_KEY</code> (Production and Preview) with the key from Resend → then Deployments → Redeploy.</p>
            <p>The key only needs “Sending access”. Keep it out of chats and documents.</p>
          </Step>
          <Step n={2} title="Verify the sending domain in Resend and GoDaddy">
            <p>Resend → Domains → Add domain → <code>email.arak-sa.com</code> (region: the default is fine). Resend shows 3–4 DNS records.</p>
            <p>GoDaddy → My Products → arak-sa.com → DNS → Add each record exactly as shown (type, name, value). For the name, GoDaddy wants only the part before <code>arak-sa.com</code>, e.g. <code>resend._domainkey.email</code> or <code>send.email</code>.</p>
            <p>These records live on the <em>subdomain</em> only. They do not touch the MX or SPF records your Outlook email uses.</p>
            <p>Back in Resend press Verify (it can take from minutes up to a few hours). Then in the same page turn on <strong>open tracking</strong> and <strong>click tracking</strong>.</p>
          </Step>
          <Step n={3} title="Tighten the main domain's DMARC (recommended)">
            <p>Your arak-sa.com DMARC record is <code>p=none</code> with no reporting address, so nobody would notice if someone spoofed your domain. In GoDaddy, edit the TXT record named <code>_dmarc</code> to:</p>
            <p><code className="break-all">v=DMARC1; p=none; rua=mailto:dmarc@arak-sa.com; adkim=r; aspf=r</code></p>
            <p>Use any mailbox you can read for the rua address. After a few weeks of clean reports, move to <code>p=quarantine</code>.</p>
          </Step>
          <Step n={4} done={cfg.webhook} title="Connect the Resend webhook (opens, clicks, bounces, spam reports)">
            <p>Resend → Webhooks → Add endpoint → URL:</p>
            <p><code className="break-all select-all">{webhookUrl}</code></p>
            <p>Events: email.sent, email.delivered, email.opened, email.clicked, email.bounced, email.complained, email.failed, email.suppressed. Save, copy the <strong>signing secret</strong> (starts with whsec_), and add it in Vercel as <code>RESEND_WEBHOOK_SECRET</code>, then redeploy.</p>
            <p>Without this, email still sends, but bounced addresses are not retired automatically and the numbers stay at zero.</p>
          </Step>
          <Step n={5} done={cfg.cron} title="Switch on the morning sending run">
            <p>Add <code>CRON_SECRET</code> in Vercel (any long random text, e.g. from a password generator), then redeploy. Every morning at 9:00 Riyadh time the app sends scheduled campaigns and the next day's share of large ones.</p>
          </Step>
          <Step n={6} title="Send yourself a test">
            <div className="flex flex-wrap items-end gap-2 not-prose">
              <Input className="min-w-[240px]" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@arak-sa.com" />
              <Button variant="secondary" onClick={test} disabled={testing || !cfg.resend || !data.settings?.from_email}>
                {testing ? 'Sending…' : 'Send test'}
              </Button>
            </div>
            {!data.settings?.from_email && <p>Save a From address above first.</p>}
            <p>Also check it at <a className="underline" href="https://www.mail-tester.com" target="_blank" rel="noreferrer">mail-tester.com</a>: send the test to the address it gives you and aim for 9/10 or better.</p>
          </Step>
          <Step n={7} title="Watch your reputation with Gmail (free)">
            <p>Register <code>email.arak-sa.com</code> at <a className="underline" href="https://postmaster.google.com" target="_blank" rel="noreferrer">Google Postmaster Tools</a>. After a few days of sending it shows how Gmail rates the domain and your spam-report rate.</p>
          </Step>
        </ol>
      </Card>
    </div>
  )
}

function Step({ n, title, done, children }) {
  return (
    <li className="px-5 py-4 flex gap-4">
      <span className={`w-6 h-6 flex-shrink-0 flex items-center justify-center text-xs font-bold border ${done ? 'bg-sage-600 border-sage-600 text-white' : 'border-stone-400 text-text-secondary'}`}>
        {done ? '✓' : n}
      </span>
      <div className="min-w-0 space-y-1.5 text-xs text-text-secondary leading-relaxed">
        <p className="text-sm font-semibold text-text">{title}{done && <span className="ml-2 text-[11px] font-normal text-sage-700">Done</span>}</p>
        {children}
      </div>
    </li>
  )
}
