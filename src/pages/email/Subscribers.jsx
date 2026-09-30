import { useMemo, useState } from 'react'
import { Card, Button, Input, Empty, Skeleton, SectionHead } from '../../components/ui/index'
import { displayName, LANGUAGES } from '../../lib/email/contacts'
import { saveSettings } from '../../lib/email/client'
import { ContactStatus, Notice, Stat, EIcon } from './parts'
import { pct, shortDate, dateTime, download } from './format'

// ─── Replied & signed up ───────────────────────────────────────────────────
// Outreach → "Replied & signed up": every prospect who answered an outreach
// email, in one list. Two ways in, both automatic:
//
//   Signed up   pressed the Sign-up button and confirmed. Moved to the
//               newsletter lane (consent: opted in), into the group
//               SUBSCRIBERS_GROUP.
//   Replied     wrote back with anything but "stop". Moved to the newsletter
//               lane (consent: business contact), into REPLIES_GROUP.
//
// A reply that said stop is listed too, as "Asked to stop", because a person
// looking for who answered should see that they did, and that nobody will
// write to them again. Below the list: what the sign-up page says.

const HOW = {
  signed: { label: 'Signed up', tone: 'bg-sage-100 text-sage-700' },
  replied: { label: 'Replied', tone: 'bg-sky-50 text-sky-700' },
  stop: { label: 'Asked to stop', tone: 'bg-stone-100 text-stone-600' },
}
const howOf = c => (c.subscribed_at ? 'signed' : c.status === 'unsubscribed' ? 'stop' : 'replied')
const whenOf = c => c.subscribed_at || c.replied_at

export function Subscribers({ workspaceId, data, loading, reload, setTab }) {
  const [query, setQuery] = useState('')
  const [weekAgo] = useState(() => Date.now() - 7 * 86_400_000)

  const people = useMemo(() => data.contacts
    .filter(c => c.subscribed_at || c.replied_at)
    .sort((a, b) => String(whenOf(b)).localeCompare(String(whenOf(a)))), [data.contacts])
  const signed = people.filter(c => howOf(c) === 'signed').length
  const replied = people.filter(c => howOf(c) === 'replied').length
  const interested = signed + replied

  const campaignName = id => {
    const c = data.campaigns.find(x => x.id === id)
    return c ? (c.name || c.subject || 'Untitled') : ''
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter(c => [c.email, c.first_name, c.last_name, c.company].some(v => String(v || '').toLowerCase().includes(q)))
  }, [people, query])

  const thisWeek = people.filter(c => howOf(c) !== 'stop' && Date.parse(whenOf(c)) >= weekAgo).length
  const prospectsWritten = useMemo(() => {
    const cold = new Set(data.campaigns.filter(c => c.audience === 'cold').map(c => c.id))
    return data.stats.filter(s => cold.has(s.campaign_id)).reduce((n, s) => n + Number(s.sent || 0), 0)
  }, [data.campaigns, data.stats])

  function exportCsv() {
    const cell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const header = ['email', 'first_name', 'last_name', 'company', 'job_title', 'language', 'what_they_did', 'when', 'from_campaign', 'status']
    const rows = people.map(c => [c.email, c.first_name, c.last_name, c.company, c.job_title, c.language, HOW[howOf(c)].label, whenOf(c), campaignName(c.subscribed_campaign_id), c.status])
    download('outreach-replies-and-sign-ups.csv', `\uFEFF${[header, ...rows].map(r => r.map(cell).join(',')).join('\r\n')}`)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border">
        <Stat loading={loading} label="Signed up" value={signed.toLocaleString()} hint="Pressed the Sign-up button and confirmed" />
        <Stat loading={loading} label="Replied" value={replied.toLocaleString()} hint="Wrote back, and did not ask to stop" />
        <Stat loading={loading} label="This week" value={thisWeek.toLocaleString()} hint="Signed up or replied in the last 7 days" />
        <Stat loading={loading} label="Response rate" value={pct(interested, prospectsWritten)} hint={`Of ${prospectsWritten.toLocaleString()} outreach emails sent`}
          info="People who signed up or replied, divided by every outreach email sent, follow-ups included." />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="font-semibold text-text text-sm">Who answered</h3>
            <p className="text-xs text-text-tertiary mt-1">
              Everyone who signed up or replied is added to your newsletter list by itself, in the groups “Newsletter subscribers” and “Replied to outreach”. Their follow-ups stop.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input className="w-52" placeholder="Search name, email, company" value={query} onChange={e => setQuery(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!people.length}>Export CSV</Button>
            <Button size="sm" onClick={() => setTab('marketing', { campaign: 'new' })} disabled={!interested}>Send them a newsletter</Button>
          </div>
        </div>
        {loading ? (
          <div className="p-5 space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : people.length === 0 ? (
          <Empty icon={<EIcon name="users" />} title="Nobody has answered yet"
            description="When a prospect replies to an outreach email, or presses its Sign-up button, they appear here."
            action={<Button size="sm" onClick={() => setTab('cold')}>Outreach campaigns</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-text-tertiary border-b border-border">
                  <th className="px-5 py-2 font-semibold">Person</th>
                  <th className="px-3 py-2 font-semibold">Company</th>
                  <th className="px-3 py-2 font-semibold">What they did</th>
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">From campaign</th>
                  <th className="px-3 py-2 font-semibold">Language</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(c => {
                  const how = HOW[howOf(c)]
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-2 min-w-0">
                        <p className="text-text font-medium truncate max-w-[240px]">{displayName(c)}</p>
                        {displayName(c) !== c.email && <p className="text-text-tertiary truncate max-w-[240px]">{c.email}</p>}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{c.company || '—'}{c.job_title ? <span className="text-text-tertiary"> · {c.job_title}</span> : null}</td>
                      <td className="px-3 py-2"><span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] whitespace-nowrap ${how.tone}`}>{how.label}</span></td>
                      <td className="px-3 py-2 text-text-secondary whitespace-nowrap" title={dateTime(whenOf(c))}>{shortDate(whenOf(c))}</td>
                      <td className="px-3 py-2">
                        {c.subscribed_campaign_id && campaignName(c.subscribed_campaign_id)
                          ? <button className="underline text-text-secondary hover:text-text" onClick={() => setTab('cold', { campaign: c.subscribed_campaign_id, view: '1' })}>{campaignName(c.subscribed_campaign_id)}</button>
                          : <span className="text-text-tertiary">—</span>}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{LANGUAGES[c.language] || '—'}</td>
                      <td className="px-3 py-2"><ContactStatus status={c.status} /></td>
                    </tr>
                  )
                })}
                {shown.length === 0 && <tr><td colSpan={7} className="px-5 py-4 text-text-tertiary">Nobody matches “{query}”.</td></tr>}
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
