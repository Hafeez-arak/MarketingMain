import { useMemo, useState } from 'react'
import { Card, Button, Input, Empty, Skeleton, SectionHead } from '../../components/ui/index'
import { displayName, LANGUAGES } from '../../lib/email/contacts'
import { saveSettings } from '../../lib/email/client'
import { ContactStatus, Notice, Stat, EIcon } from './parts'
import { pct, shortDate, dateTime, download } from './format'

// ─── Subscribers ───────────────────────────────────────────────────────────
// Prospects who pressed the Sign-up button in an outreach email and
// confirmed. Signing up moved them to the marketing lane (consent: opted in)
// and into the "Newsletter subscribers" group, so a marketing campaign to
// that group reaches them. This tab keeps them in one place, with the
// outreach campaign each one came from, and sets what the sign-up page says.

export function Subscribers({ workspaceId, data, loading, reload, setTab }) {
  const [query, setQuery] = useState('')
  const [weekAgo] = useState(() => Date.now() - 7 * 86_400_000)

  const subscribers = useMemo(() => data.contacts
    .filter(c => c.subscribed_at)
    .sort((a, b) => String(b.subscribed_at).localeCompare(String(a.subscribed_at))), [data.contacts])

  const campaignName = id => {
    const c = data.campaigns.find(x => x.id === id)
    return c ? (c.name || c.subject || 'Untitled') : ''
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return subscribers
    return subscribers.filter(c => [c.email, c.first_name, c.last_name, c.company].some(v => String(v || '').toLowerCase().includes(q)))
  }, [subscribers, query])

  const thisWeek = subscribers.filter(c => Date.parse(c.subscribed_at) >= weekAgo).length
  const stillActive = subscribers.filter(c => c.status === 'active').length
  const prospectsWritten = useMemo(() => {
    const cold = new Set(data.campaigns.filter(c => c.audience === 'cold').map(c => c.id))
    return data.stats.filter(s => cold.has(s.campaign_id)).reduce((n, s) => n + Number(s.sent || 0), 0)
  }, [data.campaigns, data.stats])

  function exportCsv() {
    const cell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const header = ['email', 'first_name', 'last_name', 'company', 'job_title', 'language', 'subscribed_at', 'from_campaign', 'status']
    const rows = subscribers.map(c => [c.email, c.first_name, c.last_name, c.company, c.job_title, c.language, c.subscribed_at, campaignName(c.subscribed_campaign_id), c.status])
    download('newsletter-subscribers.csv', `\uFEFF${[header, ...rows].map(r => r.map(cell).join(',')).join('\r\n')}`)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border">
        <Stat loading={loading} label="Subscribers" value={subscribers.length.toLocaleString()} hint="Signed up from an outreach email" />
        <Stat loading={loading} label="This week" value={thisWeek.toLocaleString()} hint="In the last 7 days" />
        <Stat loading={loading} label="Still subscribed" value={stillActive.toLocaleString()} hint={`${subscribers.length - stillActive} unsubscribed or bounced since`} />
        <Stat loading={loading} label="Sign-up rate" value={pct(subscribers.length, prospectsWritten)} hint={`Of ${prospectsWritten.toLocaleString()} outreach emails sent`}
          info="Sign-ups divided by every outreach email sent, follow-ups included." />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="font-semibold text-text text-sm">Newsletter subscribers</h3>
            <p className="text-xs text-text-tertiary mt-1">
              They are in the marketing group “Newsletter subscribers”. Send them the newsletter from the Marketing tab.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input className="w-52" placeholder="Search name, email, company" value={query} onChange={e => setQuery(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!subscribers.length}>Export CSV</Button>
            <Button size="sm" onClick={() => setTab('marketing', { campaign: 'new' })} disabled={!subscribers.length}>Write to them</Button>
          </div>
        </div>
        {loading ? (
          <div className="p-5 space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : subscribers.length === 0 ? (
          <Empty icon={<EIcon name="users" />} title="No subscribers yet"
            description="Add a Sign-up button to an outreach email. Everyone who presses it and confirms appears here."
            action={<Button size="sm" onClick={() => setTab('cold')}>Go to Cold outreach</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-text-tertiary border-b border-border">
                  <th className="px-5 py-2 font-semibold">Person</th>
                  <th className="px-3 py-2 font-semibold">Company</th>
                  <th className="px-3 py-2 font-semibold">Language</th>
                  <th className="px-3 py-2 font-semibold">Signed up</th>
                  <th className="px-3 py-2 font-semibold">From campaign</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(c => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2 min-w-0">
                      <p className="text-text font-medium truncate max-w-[240px]">{displayName(c)}</p>
                      {displayName(c) !== c.email && <p className="text-text-tertiary truncate max-w-[240px]">{c.email}</p>}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{c.company || '—'}{c.job_title ? <span className="text-text-tertiary"> · {c.job_title}</span> : null}</td>
                    <td className="px-3 py-2 text-text-secondary">{LANGUAGES[c.language] || '—'}</td>
                    <td className="px-3 py-2 text-text-secondary whitespace-nowrap" title={dateTime(c.subscribed_at)}>{shortDate(c.subscribed_at)}</td>
                    <td className="px-3 py-2">
                      {c.subscribed_campaign_id && campaignName(c.subscribed_campaign_id)
                        ? <button className="underline text-text-secondary hover:text-text" onClick={() => setTab('cold', { campaign: c.subscribed_campaign_id, view: '1' })}>{campaignName(c.subscribed_campaign_id)}</button>
                        : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="px-3 py-2"><ContactStatus status={c.status} /></td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={6} className="px-5 py-4 text-text-tertiary">Nobody matches “{query}”.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {loading
        ? <Card className="p-5"><Skeleton className="h-32 w-full" /></Card>
        // Mounted once the settings have loaded, so the form starts from them.
        : <SignupPage key={workspaceId} workspaceId={workspaceId} settings={data.settings} reload={reload} />}
    </div>
  )
}

/** What the page behind the Sign-up button says, and the gift it hands over. */
function SignupPage({ workspaceId, settings, reload }) {
  const [form, setForm] = useState(() => ({
    newsletter_name: settings?.newsletter_name || '',
    subscribe_offer: settings?.subscribe_offer || '',
    subscribe_gift_url: settings?.subscribe_gift_url || '',
  }))
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const badLink = form.subscribe_gift_url.trim() && !/^https:\/\//i.test(form.subscribe_gift_url.trim())

  async function save() {
    setSaving(true); setMessage(null)
    try {
      await saveSettings(workspaceId, {
        newsletter_name: form.newsletter_name.trim(),
        subscribe_offer: form.subscribe_offer.trim(),
        subscribe_gift_url: form.subscribe_gift_url.trim(),
      })
      await reload()
      setMessage({ tone: 'sage', text: 'Saved. The sign-up page uses it from now on.' })
    } catch (err) {
      setMessage({ tone: 'red', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <SectionHead title="The sign-up page" subtitle="What a prospect sees after pressing the Sign-up button. They confirm with one more press, so a company's link scanner cannot sign them up by itself." />
      <div className="p-5 grid md:grid-cols-3 gap-4 items-start">
        <Input label="Newsletter name" value={form.newsletter_name} onChange={e => set('newsletter_name', e.target.value)}
          placeholder="e.g. After Dark" hint="Shown as “Join …”." />
        <Input label="What they get" value={form.subscribe_offer} onChange={e => set('subscribe_offer', e.target.value)}
          placeholder="e.g. our free guide: 5 Lighting Control Mistakes That Waste Budget" hint="Promised on the page before they confirm." />
        <Input label="Link to the gift (optional)" value={form.subscribe_gift_url} onChange={e => set('subscribe_gift_url', e.target.value)}
          placeholder="https://…/guide.pdf" hint={badLink ? 'Use a full https:// link.' : 'A download button after they confirm. Empty: the page says it is on its way, and you send it.'} />
        <div className="md:col-span-3 flex items-center justify-end gap-3">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <Button onClick={save} disabled={saving || badLink}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Card>
  )
}
