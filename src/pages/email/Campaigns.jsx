import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, Button, Input, Select, Textarea, Modal, ConfirmDialog, Empty, Skeleton, SectionHead } from '../../components/ui/index'
import { useAuth } from '../../store/auth'
import { pickRecipients, displayName } from '../../lib/email/contacts'
import { renderEmail, marketingProblems, MERGE_TAGS, applyMergeTags, toPlainText, subscribeButton } from '../../lib/email/render'
import { brandTodayKey } from '../../lib/brandTime'
import { mailboxReadiness, mailboxCap, coldProblems } from '../../lib/email/cold'
import { saveCampaign, deleteCampaign, fetchCampaignSends, emailApi, fetchBrandKit, duplicateCampaign } from '../../lib/email/client'
import { renderDesign, designChecks, designFromText, hasDesign, templates } from '../../lib/email/design'
import { DesignEditor } from './DesignEditor'
import { WeeklyDrafts, WeeklyDraftsSkeleton } from './WeeklyDrafts'
import { AudienceTag, CampaignStatus, Notice, Stat, EIcon } from './parts'
import { pct, shortDate, dateTime, download } from './format'

// ─── Campaigns: Marketing and Cold ─────────────────────────────────────────
// The same screens for both lanes, with the differences made explicit:
//
//              Marketing                    Cold
//   look       branded letter + footer      plain, like a typed email
//   sent by    Resend, from the subdomain   our outreach mailboxes, one at a time
//   follow-ups none                         up to three, stopped by a reply
//   AI         three options                three options, or one written for
//                                            a single prospect

const EMPTY = {
  marketing: { name: '', subject: '', preheader: '', body: '', language: 'en', language_only: false, group_ids: [], follow_ups: [] },
  cold: {
    name: '', subject: '', preheader: '', body: '', language: 'en', language_only: false, group_ids: [], mailbox_ids: [],
    follow_ups: [
      { delay_days: 3, subject: '', body: '' },
      { delay_days: 5, subject: '', body: '' },
    ],
  },
}

const SAMPLE_CONTACT = { first_name: 'Sara', company: 'Example Co', email: 'sara@example.com' }

// In previews the sign-up button opens the test page, never a real sign-up.
const TEST_SUBSCRIBE_URL = typeof window === 'undefined' ? '' : `${window.location.origin}/api/email/subscribe?t=test`

export function Campaigns(props) {
  const { params, setTab, audience, data, loading } = props
  const open = params.get('campaign')
  if (open) {
    const campaign = open === 'new' ? null : data.campaigns.find(c => c.id === open)
    if (open !== 'new' && !campaign) {
      if (loading) return <Card className="p-5"><Skeleton className="h-40 w-full" /></Card>
      return <Notice tone="amber" title="Campaign not found" action={<Button size="sm" variant="secondary" onClick={() => setTab(audience)}>Back</Button>}>It may have been deleted.</Notice>
    }
    if (!campaign || (['draft', 'paused'].includes(campaign.status) && !params.get('view'))) {
      // A stable key: saving a new draft moves the URL from ?campaign=new to
      // ?campaign=<id>, and that must not remount the composer and throw
      // away what is on screen (or the send dialog about to open).
      return <Composer {...props} key={`composer-${audience}`} campaign={campaign} />
    }
    return <CampaignDetail {...props} key={open} campaign={campaign} />
  }
  return <CampaignList {...props} />
}

// ─── List ──────────────────────────────────────────────────────────────────

function CampaignList({ audience, data, loading, setTab, workspaceId, reload }) {
  const [deleting, setDeleting] = useState(null)
  const campaigns = data.campaigns.filter(c => c.audience === audience)
  const statsById = new Map(data.stats.map(s => [s.campaign_id, s]))
  const cold = audience === 'cold'

  return (
    <div className="space-y-3">
      {cold && !loading && <ColdLaneNotice data={data} setTab={setTab} />}
      {!cold && (loading ? <WeeklyDraftsSkeleton /> : <WeeklyDrafts workspaceId={workspaceId} data={data} reload={reload} setTab={setTab} />)}
      <Card>
        <SectionHead
          title={cold ? 'Outreach campaigns' : 'Marketing campaigns'}
          subtitle={cold ? 'A first email and follow-ups, personal and plain, to a cold group.' : 'One email to one or more marketing groups.'}
          action={<Button size="sm" onClick={() => setTab(audience, { campaign: 'new' })} disabled={loading}><EIcon name="plus" /> New campaign</Button>}
        />
        {loading ? (
          <div className="p-5 space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        ) : campaigns.length === 0 ? (
          <Empty icon={<EIcon name="send" />} title="No campaigns yet"
            description={cold
              ? 'Pick a group of prospects, write a short first email (or let the AI write one per prospect from the research), and set up follow-ups.'
              : 'Write an update for customers and partners: a finished project, a new product line, an event invitation. The AI can draft three options from your Brand Brain and this week\'s research.'}
            action={<Button size="sm" onClick={() => setTab(audience, { campaign: 'new' })}>Write the first one</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-text-tertiary border-b border-border">
                  <th className="text-left font-semibold px-5 py-2">Campaign</th>
                  <th className="text-left font-semibold px-3 py-2">Groups</th>
                  <th className="text-left font-semibold px-3 py-2">Status</th>
                  <th className="text-right font-semibold px-3 py-2">Recipients</th>
                  <th className="text-right font-semibold px-3 py-2">Sent</th>
                  <th className="text-right font-semibold px-3 py-2">Opened</th>
                  <th className="text-right font-semibold px-3 py-2">Clicked</th>
                  <th className="text-right font-semibold px-3 py-2">Bounced</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => {
                  const st = statsById.get(c.id) || {}
                  const sent = Number(st.sent || 0)
                  const groupNames = c.group_ids.map(id => data.groups.find(g => g.id === id)?.name).filter(Boolean)
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-subtle cursor-pointer" onClick={() => setTab(audience, { campaign: c.id })}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium text-text truncate max-w-[300px]">{c.name || c.subject || 'Untitled'}</p>
                        <p className="text-[11px] text-text-tertiary truncate max-w-[300px]">
                          {c.subject && c.name ? `${c.subject} · ` : ''}
                          {c.status === 'scheduled' ? `Goes out ${dateTime(c.scheduled_for)}` : shortDate(c.launched_at || c.updated_at)}
                          {c.language === 'ar' && ' · Arabic'}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-text-secondary max-w-[180px] truncate">{groupNames.join(', ') || '—'}</td>
                      <td className="px-3 py-2.5"><CampaignStatus status={c.status} /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{c.recipients ? c.recipients.toLocaleString() : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{sent.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pct(Number(st.opened || 0), sent)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pct(Number(st.clicked || 0), sent)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pct(Number(st.bounced || 0), sent)}</td>
                      <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button size="xs" variant="ghost" title="Duplicate" onClick={async () => {
                            const copy = await duplicateCampaign(workspaceId, c)
                            await reload()
                            setTab(audience, { campaign: copy.id })
                          }}>Duplicate</Button>
                          {['draft', 'cancelled'].includes(c.status) && (
                            <Button size="xs" variant="ghost" onClick={() => setDeleting(c)} aria-label="Delete"><EIcon name="trash" /></Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} danger title="Delete this campaign?"
        message="The draft is removed. Nothing has been sent from it."
        onConfirm={async () => { await deleteCampaign(workspaceId, deleting.id); await reload() }} />
    </div>
  )
}

/** Why outreach would not go out right now, if it would not. Silent when all is well. */
function ColdLaneNotice({ data, setTab }) {
  const today = brandTodayKey()
  const mailboxes = data.mailboxes || []
  const toSettings = <Button size="sm" variant="secondary" onClick={() => setTab('settings')}>Mailboxes</Button>
  if (!mailboxes.length) {
    return (
      <Notice tone="sky" title="No outreach mailbox is connected" action={toSettings}>
        Outreach can be written, tested on yourself and exported, but it is only sent from an outreach mailbox, never from the marketing sender.
      </Notice>
    )
  }
  const ready = mailboxes.filter(m => mailboxReadiness(m, today).ready)
  if (!ready.length) {
    const dates = mailboxes.map(m => mailboxReadiness(m, today).readyOn).filter(Boolean).sort()
    return (
      <Notice tone="sky" title="The outreach mailboxes are not ready yet" action={toSettings}>
        {dates.length ? `The first one can start sending on ${dates[0]}, when its warm-up is done.` : 'None of them has a warm-up start date, or they are paused.'}
        {' '}Campaigns can be written and started now; they wait until then.
      </Notice>
    )
  }
  if (!data.settings?.cold_sending_enabled) {
    return (
      <Notice tone="amber" title="Outreach sending is off" action={toSettings}>
        Running outreach campaigns send nothing until it is switched on.
      </Notice>
    )
  }
  const perDay = ready.reduce((n, m) => n + mailboxCap(m, today).cap, 0)
  return (
    <p className="text-[11px] text-text-tertiary">
      Sending from {ready.length} mailbox{ready.length === 1 ? '' : 'es'}, up to {perDay} emails today, Sunday–Thursday 9:00–17:00 Riyadh.
    </p>
  )
}

// ─── Composer ──────────────────────────────────────────────────────────────

function Composer({ audience, campaign, data, workspaceId, reload, setTab, status }) {
  const { user } = useAuth()
  const cold = audience === 'cold'
  const [form, setForm] = useState(() => campaign
    ? { ...EMPTY[audience], ...campaign, follow_ups: Array.isArray(campaign.follow_ups) ? campaign.follow_ups : [] }
    : { ...EMPTY[audience] })
  const [id, setId] = useState(campaign?.id || null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)   // { tone, text }
  const [testTo, setTestTo] = useState(user?.email || '')
  const [sending, setSending] = useState(false)
  const [previewIdx, setPreviewIdx] = useState(0)
  const [editingStep, setEditingStep] = useState(0)   // cold: 0 = first email, n = follow-up n
  const bodyRef = useRef(null)
  const settings = data.settings || status?.settings || {}
  // A new marketing email starts at the template gallery, the way Brevo's does.
  const [choosing, setChoosing] = useState(() => !campaign && !cold)
  const [kit, setKit] = useState(null)
  useEffect(() => {
    let live = true
    fetchBrandKit(workspaceId)
      .then(k => { if (live) setKit(k) })
      .catch(() => { if (live) setKit({ logos: [], photos: [], brandColors: '', website: '' }) })
    return () => { live = false }
  }, [workspaceId])

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true) }
  const laneGroups = data.groups.filter(g => g.audience === audience)
  // Cold: the mailboxes it may send from. None ticked means all of them.
  const allMailboxes = data.mailboxes || []
  const chosenIds = form.mailbox_ids || []
  const sendingMailboxes = cold ? (chosenIds.length ? allMailboxes.filter(m => chosenIds.includes(m.id)) : allMailboxes) : []

  const recipients = useMemo(() => pickRecipients({
    contacts: data.contacts, memberships: data.members, groupIds: form.group_ids, audience,
    language: form.language_only ? form.language : null,
  }), [data.contacts, data.members, form.group_ids, audience, form.language_only, form.language])

  const skippedReasons = useMemo(() => {
    const m = new Map()
    for (const s of recipients.skipped) m.set(s.reason, (m.get(s.reason) || 0) + 1)
    return [...m.entries()]
  }, [recipients.skipped])

  // What is being edited: the first email or one follow-up.
  const step = cold && editingStep > 0 ? form.follow_ups[editingStep - 1] : null
  const current = step
    ? { subject: step.subject || `Re: ${form.subject}`, body: step.body }
    : { subject: form.subject, body: form.body }
  // Functional updates throughout: applying an AI draft sets subject and body
  // in one go, and two updates built from the same stale `form` would each
  // undo the other.
  function updateCurrent(patch) {
    setDirty(true)
    if (!step) { setForm(f => ({ ...f, ...patch })); return }
    const idx = editingStep - 1
    setForm(f => ({ ...f, follow_ups: f.follow_ups.map((x, i) => (i === idx ? { ...x, ...patch } : x)) }))
  }
  const setCurrent = (k, v) => updateCurrent({ [k]: v })

  const designed = !cold && hasDesign(form.design)
  const setDesign = design => { setForm(f => ({ ...f, design })); setDirty(true) }

  const sample = useMemo(() => recipients.eligible[previewIdx] || recipients.eligible[0] || SAMPLE_CONTACT, [recipients.eligible, previewIdx])
  const signature = cold ? (sendingMailboxes[0]?.signature || '') : ''
  const preview = useMemo(() => renderEmail({
    audience, subject: current.subject, preheader: step ? '' : form.preheader, body: current.body,
    language: form.language, contact: sample,
    sender: { from_name: settings.from_name, company_address: settings.company_address },
    unsubscribeUrl: cold ? '' : '#unsubscribe', signature, subscribeUrl: cold ? TEST_SUBSCRIBE_URL : '',
  }), [audience, current.subject, current.body, form.preheader, form.language, sample, settings.from_name, settings.company_address, cold, step, signature])

  const checks = designed ? designChecks(form.design) : { problems: [], warnings: [] }
  // Cold: the same check the server makes at launch, follow-ups included.
  const problems = cold
    ? coldProblems(form)
    : [...marketingProblems({ subject: form.subject, body: designed ? 'designed' : form.body, sender: settings }), ...checks.problems]
  const warnings = checks.warnings

  async function save({ quiet = false } = {}) {
    setSaving(true)
    try {
      const saved = await saveCampaign(workspaceId, { ...form, audience }, id)
      setDirty(false)
      if (!id) {
        setId(saved.id)
        // Reload first, then put the id in the URL, so the page never looks
        // for a campaign it has not loaded yet. The id in the URL is what
        // makes a browser refresh reopen this draft rather than a blank one.
        await reload()
        setTab(audience, { campaign: saved.id })
      } else {
        reload()
      }
      if (!quiet) setMessage({ tone: 'sage', text: 'Draft saved.' })
      return saved
    } catch (err) {
      setMessage({ tone: 'red', text: err.message })
      return null
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    setSending(true); setMessage(null)
    // Cold, with a mailbox connected: the test goes out from it, the real way.
    if (cold && sendingMailboxes.length) {
      const r = await emailApi('mailbox_test', workspaceId, {
        mailbox_id: sendingMailboxes[0].id, to: testTo, subject: current.subject, body: current.body,
        language: form.language, sample: recipients.eligible[previewIdx] || null,
      })
      setSending(false)
      setMessage(r.error ? { tone: 'red', text: r.error } : { tone: 'sage', text: `Test sent from ${r.from} to ${r.sent_to}. Check the inbox and the spam folder.` })
      return
    }
    const r = await emailApi('send_test', workspaceId, {
      to: testTo, audience, subject: current.subject, preheader: step ? '' : form.preheader, body: current.body,
      design: designed && !step ? form.design : undefined,
      language: form.language, sample: recipients.eligible[previewIdx] || null,
    })
    setSending(false)
    setMessage(r.error ? { tone: 'red', text: r.error } : { tone: 'sage', text: `Test sent to ${r.sent_to}. Check the inbox and the spam folder.` })
  }

  function insertAtCursor(text) {
    const el = bodyRef.current?.querySelector('textarea')
    const value = current.body || ''
    if (!el) { setCurrent('body', value + text); return }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    const selected = value.slice(start, end)
    const inserted = typeof text === 'function' ? text(selected) : text
    setCurrent('body', value.slice(0, start) + inserted + value.slice(end))
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + inserted.length })
  }

  const [confirmLaunch, setConfirmLaunch] = useState(false)
  const [confirmPlain, setConfirmPlain] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  const audienceCard = (
    <Card className="p-5 space-y-4">
      <Input label="Campaign name (internal)" value={form.name} onChange={e => set('name', e.target.value)}
        placeholder={cold ? 'e.g. Riyadh hotel projects, October' : 'e.g. October update: new projects'} />
      <div>
        <p className="eyebrow mb-1.5">Send to</p>
        {laneGroups.length === 0 ? (
          <p className="text-xs text-text-tertiary">No {cold ? 'cold' : 'marketing'} groups yet. <button className="underline" onClick={() => setTab('groups')}>Create one</button>.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {laneGroups.map(g => {
              const on = form.group_ids.includes(g.id)
              const n = data.members.filter(m => m.group_id === g.id).length
              return (
                <label key={g.id} className={`flex items-center gap-1.5 text-xs border px-2 py-1 cursor-pointer ${on ? 'border-amber-700 bg-amber-50 text-text' : 'border-border text-text-secondary hover:border-stone-400'}`}>
                  <input type="checkbox" checked={on}
                    onChange={() => set('group_ids', on ? form.group_ids.filter(x => x !== g.id) : [...form.group_ids, g.id])} />
                  {g.name} <span className="text-text-tertiary">({n})</span>
                </label>
              )
            })}
          </div>
        )}
        {form.group_ids.length > 0 && (
          <p className="text-xs mt-2 text-text-secondary">
            <strong className="text-text">{recipients.eligible.length.toLocaleString()}</strong> will receive it
            {recipients.skipped.length > 0 && <> · {recipients.skipped.length} skipped ({skippedReasons.map(([r, n]) => `${n} ${r.toLowerCase()}`).join('; ')})</>}
          </p>
        )}
      </div>
      {cold && allMailboxes.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5">Send from</p>
          <div className="flex flex-wrap gap-2">
            {allMailboxes.map(m => {
              const on = chosenIds.includes(m.id)
              return (
                <label key={m.id} className={`flex items-center gap-1.5 text-xs border px-2 py-1 cursor-pointer ${on ? 'border-amber-700 bg-amber-50 text-text' : 'border-border text-text-secondary hover:border-stone-400'}`}>
                  <input type="checkbox" checked={on}
                    onChange={() => set('mailbox_ids', on ? chosenIds.filter(x => x !== m.id) : [...chosenIds, m.id])} />
                  {m.from_name ? `${m.from_name} · ` : ''}{m.email}
                </label>
              )
            })}
          </div>
          <p className="text-[11px] text-text-tertiary mt-1">
            {chosenIds.length ? 'Only the ticked mailboxes send this campaign.' : 'None ticked: every ready mailbox shares the work.'}
            {' '}Each prospect's follow-ups come from the mailbox that wrote to them first, in the same thread.
          </p>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3 items-end">
        <Select label="Written in" value={form.language} onChange={e => set('language', e.target.value)}
          hint="Sets the layout (right-to-left for Arabic) and the footer.">
          <option value="en">English</option>
          <option value="ar">Arabic</option>
        </Select>
        <label className="flex items-start gap-2 text-xs text-text-secondary pb-5 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={form.language_only} onChange={e => set('language_only', e.target.checked)} />
          <span>Only send to contacts who prefer {form.language === 'ar' ? 'Arabic' : 'English'}. Write a second campaign in the other language for the rest.</span>
        </label>
      </div>
    </Card>
  )

  const sendCard = (
    <Card className="p-4 space-y-3">
      {problems.length > 0 && (
        <ul className="text-xs text-amber-800 space-y-0.5">{problems.map(p => <li key={p}>• {p}</li>)}</ul>
      )}
      {warnings.length > 0 && (
        <ul className="text-[11px] text-text-tertiary space-y-0.5">{warnings.map(w => <li key={w}>Tip: {w}</li>)}</ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Input className="flex-1 min-w-[180px]" label="Send a test to" value={testTo} onChange={e => setTestTo(e.target.value)} />
        <Button variant="secondary" onClick={sendTest} disabled={sending || !testTo || !(status?.configured?.resend || sendingMailboxes.length)}>
          {sending ? 'Sending…' : 'Send test'}
        </Button>
      </div>
      {!(status?.configured?.resend || sendingMailboxes.length) && <p className="text-[11px] text-text-tertiary">Sending is not switched on yet.</p>}
      {cold && sendingMailboxes.length > 0 && <p className="text-[11px] text-text-tertiary">Sent from {sendingMailboxes[0].email}, only to the address above.</p>}

      {cold ? (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
          <Button variant="secondary" disabled={!recipients.eligible.length || !form.body.trim()}
            onClick={() => download(`outreach-${(form.name || 'campaign').replace(/\W+/g, '-').toLowerCase()}.csv`, coldExport(form, recipients.eligible))}>
            Export personalised emails (CSV)
          </Button>
          <Button onClick={async () => { const saved = await save({ quiet: true }); if (saved) setConfirmLaunch(true) }}
            disabled={problems.length > 0 || !recipients.eligible.length || saving || !allMailboxes.length}
            title={!allMailboxes.length ? 'Connect an outreach mailbox first' : undefined}>
            Start sequence…
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
          <Button onClick={async () => { const s = await save({ quiet: true }); if (s) setConfirmLaunch(true) }}
            disabled={problems.length > 0 || !recipients.eligible.length || saving}>
            Send or schedule…
          </Button>
        </div>
      )}
    </Card>
  )

  if (choosing) {
    return (
      <TemplatePicker
        kit={kit}
        onBack={() => setTab(audience)}
        onPick={design => { setForm(f => ({ ...f, design })); setDirty(true); setChoosing(false) }}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setTab(audience)}><EIcon name="back" /> All {cold ? 'outreach' : 'marketing'} campaigns</Button>
        <div className="flex items-center gap-2">
          {campaign?.status === 'paused' && <CampaignStatus status="paused" />}
          {dirty && <span className="text-[11px] text-text-tertiary">Unsaved changes</span>}
          <Button size="sm" variant="secondary" onClick={() => save()} disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</Button>
        </div>
      </div>

      {cold && <ColdLaneNotice data={data} setTab={setTab} />}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {designed ? (
        <>
          <div className="grid xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
            <div className="space-y-4">
              {audienceCard}
              <Card className="p-5 space-y-3">
                <div className="grid md:grid-cols-2 gap-3">
                  <Input label="Subject" value={form.subject} onChange={e => set('subject', e.target.value)} maxLength={120}
                    hint={`${form.subject.length}/60 characters is the most that shows on a phone.`} />
                  <Input label="Preview line" value={form.preheader} onChange={e => set('preheader', e.target.value)} maxLength={140}
                    hint="The grey line after the subject in the inbox." />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="xs" variant="outline" onClick={() => setAiOpen(true)}><EIcon name="spark" /> Write with AI</Button>
                  <Button size="xs" variant="ghost" onClick={() => setConfirmPlain(true)}>Switch to plain text</Button>
                </div>
              </Card>
            </div>
            <div className="space-y-4 xl:sticky xl:top-4">
              {recipients.eligible.length > 0 && (
                <Card className="px-4 py-2.5 flex items-center justify-between gap-2">
                  <p className="text-xs text-text-secondary">Merge fields shown as</p>
                  <select className="text-[11px] border border-border bg-white px-1.5 py-1 text-text-secondary max-w-[200px]" value={previewIdx}
                    onChange={e => setPreviewIdx(Number(e.target.value))}>
                    {recipients.eligible.slice(0, 50).map((c, i) => <option key={c.id} value={i}>{displayName(c)}</option>)}
                  </select>
                </Card>
              )}
              {sendCard}
            </div>
          </div>
          <DesignEditor
            design={form.design}
            onChange={setDesign}
            language={form.language}
            kit={kit}
            sample={sample}
            sender={{ from_name: settings.from_name, company_address: settings.company_address }}
            subject={form.subject}
            preheader={form.preheader}
            onReplaceFromTemplate={() => setChoosing(true)}
          />
        </>
      ) : (
      <div className="grid xl:grid-cols-2 gap-4 items-start">
        {/* ── Left: what to send, to whom ── */}
        <div className="space-y-4">
          {audienceCard}

          <Card className="p-5 space-y-3">
            {cold && (
              <div className="flex flex-wrap gap-0">
                {[0, ...form.follow_ups.map((_, i) => i + 1)].map(i => (
                  <button key={i} onClick={() => setEditingStep(i)}
                    className={`px-3 py-1.5 text-xs font-semibold border -ml-px first:ml-0 ${editingStep === i ? 'bg-amber-700 text-white border-amber-700 relative z-10' : 'bg-white text-text-secondary border-border hover:bg-surface-subtle'}`}>
                    {i === 0 ? 'First email' : `Follow-up ${i}`}
                  </button>
                ))}
                {form.follow_ups.length < 3 && (
                  <button onClick={() => { set('follow_ups', [...form.follow_ups, { delay_days: 4, subject: '', body: '' }]); setEditingStep(form.follow_ups.length + 1) }}
                    className="px-3 py-1.5 text-xs border border-dashed border-border -ml-px text-text-tertiary hover:text-text">+ Follow-up</button>
                )}
              </div>
            )}

            {step ? (
              <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                <Input label="Subject" value={step.subject} onChange={e => setCurrent('subject', e.target.value)} placeholder={`Re: ${form.subject || 'first subject'}`}
                  hint="Leave empty to reply in the same thread (Re: first subject)." />
                <Input label="Days after previous" type="number" min={1} max={30} className="w-32" value={step.delay_days}
                  onChange={e => setCurrent('delay_days', Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
              </div>
            ) : (
              <>
                <Input label="Subject" value={form.subject} onChange={e => set('subject', e.target.value)} maxLength={120}
                  hint={`${form.subject.length}/60 characters is the most that shows on a phone.`} />
                {!cold && (
                  <Input label="Preview line" value={form.preheader} onChange={e => set('preheader', e.target.value)} maxLength={140}
                    hint="The grey line after the subject in the inbox. Add to the subject; do not repeat it." />
                )}
              </>
            )}

            <div ref={bodyRef}>
              <div className="flex flex-wrap items-center gap-1 mb-1.5">
                <span className="eyebrow mr-2">{step ? `Follow-up ${editingStep}` : 'Email'}</span>
                <ToolButton onClick={() => insertAtCursor(sel => `**${sel || 'bold text'}**`)}>Bold</ToolButton>
                {!cold && <ToolButton onClick={() => insertAtCursor(sel => `[${sel || 'link text'}](https://)`)}>Link</ToolButton>}
                {cold && (
                  <ToolButton onClick={() => insertAtCursor(sel => `\n\n${subscribeButton(sel || (form.language === 'ar' ? 'أرسلوا لي الدليل ←' : 'Send me the guide →'))}\n\n`)}>
                    Sign-up button
                  </ToolButton>
                )}
                <ToolButton onClick={() => insertAtCursor('\n- ')}>Bullet</ToolButton>
                <select className="text-[11px] border border-border bg-white px-1.5 py-1 text-text-secondary" value=""
                  onChange={e => { if (e.target.value) insertAtCursor(`{{${e.target.value}${e.target.value === 'first_name' ? '|there' : ''}}}`) }}>
                  <option value="">Insert field…</option>
                  {MERGE_TAGS.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select>
                <div className="flex-1" />
                {!cold && !step && (
                  <Button size="xs" variant="ghost" onClick={() => {
                    setDesign(designFromText({ body: form.body, logo: kit?.logos?.[0]?.public_url || '' }))
                  }}>Use drag &amp; drop design</Button>
                )}
                <Button size="xs" variant="outline" onClick={() => setAiOpen(true)}><EIcon name="spark" /> Write with AI</Button>
              </div>
              <Textarea rows={cold ? 10 : 14} value={current.body} onChange={e => setCurrent('body', e.target.value)}
                dir={form.language === 'ar' ? 'rtl' : 'ltr'}
                placeholder={cold
                  ? 'Hi {{first_name|there}},\n\nSaw that … is moving into fit-out. …\n\nWould a short call next week be useful?'
                  : 'Hi {{first_name|there}},\n\nA quick update from Arak: …\n\n[See the project](https://arak-sa.com/...)'} />
              <p className="text-[11px] text-text-tertiary mt-1">
                Blank line = new paragraph. **bold**, [text](link), “- ” for bullets. {'{{first_name|there}}'} uses “there” when a name is missing.
                {cold
                  ? ' The opt-out sentence is added automatically. A Sign-up button lets the reader join your newsletter in one click; they move to the Subscribers tab and get no more outreach. English and Arabic may share one email: each paragraph takes its own direction.'
                  : ' The footer with your address and the unsubscribe link is added automatically.'}
              </p>
              {step && (
                <div className="flex justify-end mt-2">
                  <Button size="xs" variant="ghost" onClick={() => { set('follow_ups', form.follow_ups.filter((_, i) => i !== editingStep - 1)); setEditingStep(0) }}>Remove this follow-up</Button>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ── Right: preview and send ── */}
        <div className="space-y-4 xl:sticky xl:top-4">
          <Card>
            <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-text">Preview</p>
              {recipients.eligible.length > 0 && (
                <select className="text-[11px] border border-border bg-white px-1.5 py-1 text-text-secondary max-w-[220px]" value={previewIdx}
                  onChange={e => setPreviewIdx(Number(e.target.value))}>
                  {recipients.eligible.slice(0, 50).map((c, i) => <option key={c.id} value={i}>As {displayName(c)}</option>)}
                </select>
              )}
            </div>
            <div className="px-4 py-2 border-b border-border text-xs space-y-0.5">
              <p className="text-text-tertiary">From <span className="text-text">{cold
                ? (sendingMailboxes.length ? sendingMailboxes.map(m => m.email).join(', ') : 'an outreach mailbox (none connected)')
                : (settings.from_name ? `${settings.from_name} <${settings.from_email || '…'}>` : (settings.from_email || 'Set the sender in Settings'))}</span></p>
              <p className="text-text-tertiary">Subject <span className="text-text font-medium">{preview.subject || '—'}</span></p>
            </div>
            <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="w-full h-[460px] bg-white" />
          </Card>

          {sendCard}
        </div>
      </div>
      )}

      {aiOpen && (
        <AiDrafts
          workspaceId={workspaceId} audience={audience} language={form.language}
          current={current} contacts={cold ? recipients.eligible : []}
          onClose={() => setAiOpen(false)}
          designed={designed}
          onUse={(opt, { textOnly = false } = {}) => {
            if (step) updateCurrent({ subject: opt.subject, body: opt.body })
            else setForm(f => {
              const next = { ...f, subject: opt.subject, body: opt.body, preheader: cold ? '' : (opt.preheader || f.preheader), name: f.name || opt.angle }
              // In a design, the option's text becomes the blocks — keeping the
              // logo and the chosen style — unless only the subject was wanted.
              if (hasDesign(f.design) && !textOnly) {
                const logo = f.design.blocks.find(b => b.type === 'logo')?.src || kit?.logos?.[0]?.public_url || ''
                next.design = designFromText({ body: opt.body, logo, style: f.design.style })
              }
              if (textOnly) { next.body = f.body }
              return next
            })
            setDirty(true)
            setAiOpen(false)
          }}
        />
      )}

      <ConfirmDialog open={confirmPlain} onClose={() => setConfirmPlain(false)} title="Switch to plain text?"
        message="The design is removed and the email becomes the plain text below. Pictures, buttons and layout are lost. The text you last got from the AI stays."
        onConfirm={() => setDesign(null)} />

      {confirmLaunch && id && cold && (
        <ColdLaunchModal
          workspaceId={workspaceId} campaignId={id} recipients={recipients} mailboxes={sendingMailboxes}
          followUps={form.follow_ups.length} enabled={Boolean(settings.cold_sending_enabled)}
          onClose={() => setConfirmLaunch(false)}
          onDone={async msg => { setConfirmLaunch(false); await reload(); setTab(audience, { campaign: id, view: '1' }); setMessage(msg) }}
        />
      )}
      {confirmLaunch && id && !cold && (
        <LaunchModal
          workspaceId={workspaceId} campaignId={id} recipients={recipients} status={status}
          onClose={() => setConfirmLaunch(false)}
          onDone={async msg => { setConfirmLaunch(false); await reload(); setTab(audience, { campaign: id, view: '1' }); setMessage(msg) }}
        />
      )}
    </div>
  )
}

// ─── Template gallery ──────────────────────────────────────────────────────
// Where a new marketing email starts. Each card is a real render of the
// template (same renderer as the send), with the Brand Brain logo already in.

function TemplatePicker({ kit, onPick, onBack }) {
  const list = useMemo(() => templates({
    logo: kit?.logos?.[0]?.public_url || '',
    website: kit?.website || 'https://arak-sa.com',
  }), [kit])
  const sender = { from_name: '', company_address: '' }
  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onBack}><EIcon name="back" /> All marketing campaigns</Button>
      <Card>
        <SectionHead title="Choose a starting point" subtitle="Every template is fully editable: drag blocks in, move them, change colours. Your logo is already in." />
        {!kit ? (
          <div className="p-5 grid sm:grid-cols-2 lg:grid-cols-5 gap-4">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-72 w-full" />)}</div>
        ) : (
          <div className="p-5 grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {list.map(t => (
              <button key={t.key} type="button" onClick={() => onPick(t.design)}
                className="text-left border border-border hover:border-amber-700 group flex flex-col">
                <div className="h-56 overflow-hidden bg-surface-muted relative pointer-events-none">
                  <iframe title={t.label} tabIndex={-1} sandbox=""
                    srcDoc={renderDesign({ design: t.design, subject: t.label, contact: { first_name: 'Sara' }, sender }).html}
                    style={{ width: 640, height: 900, transform: 'scale(0.36)', transformOrigin: 'top left', border: 0 }} />
                </div>
                <div className="px-3 py-2.5 border-t border-border">
                  <p className="text-sm font-semibold text-text group-hover:text-amber-800">{t.label}</p>
                  <p className="text-[11px] text-text-tertiary mt-0.5 leading-snug">{t.hint}</p>
                </div>
              </button>
            ))}
            <button type="button" onClick={() => onPick(null)}
              className="text-left border border-dashed border-border hover:border-amber-700 group flex flex-col">
              <div className="h-56 flex items-center justify-center bg-white text-text-tertiary text-xs px-6 text-center">
                Just text, like a personal email. No design.
              </div>
              <div className="px-3 py-2.5 border-t border-border">
                <p className="text-sm font-semibold text-text group-hover:text-amber-800">Plain text</p>
                <p className="text-[11px] text-text-tertiary mt-0.5 leading-snug">Quickest to write. You can switch to a design later.</p>
              </div>
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}

function ToolButton({ onClick, children }) {
  return <button type="button" onClick={onClick} className="px-2 py-1 text-[11px] font-semibold border border-border bg-white text-text-secondary hover:bg-surface-subtle hover:text-text">{children}</button>
}

/** One row per prospect, first email merged, for sending by hand until the mailbox exists. */
function coldExport(form, contacts) {
  const cell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const header = ['email', 'name', 'company', 'subject', 'body', ...form.follow_ups.flatMap((_, i) => [`follow_up_${i + 1}_after_days`, `follow_up_${i + 1}_body`])]
  const rows = contacts.map(c => {
    const links = { subscribeUrl: c.unsubscribe_token ? `${window.location.origin}/api/email/subscribe?t=${c.unsubscribe_token}` : '' }
    return [
      c.email, displayName(c), c.company,
      applyMergeTags(form.subject, c, links), toPlainText(applyMergeTags(form.body, c, links)),
      ...form.follow_ups.flatMap(f => [f.delay_days, toPlainText(applyMergeTags(f.body, c, links))]),
    ]
  })
  return `\uFEFF${[header, ...rows].map(r => r.map(cell).join(',')).join('\r\n')}`
}

// ─── AI drafts ─────────────────────────────────────────────────────────────

function AiDrafts({ workspaceId, audience, language, current, contacts, onClose, onUse, designed = false }) {
  const [brief, setBrief] = useState('')
  const [contactId, setContactId] = useState('')
  const [improve, setImprove] = useState(Boolean(current.body?.trim()))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const cold = audience === 'cold'

  async function run() {
    setBusy(true); setResult(null)
    const r = await emailApi('draft', workspaceId, {
      audience, language, brief, contact_id: contactId || undefined,
      current: improve ? current : undefined,
    })
    setBusy(false)
    setResult(r)
  }

  return (
    <Modal open onClose={onClose} title="Write with AI" width="max-w-4xl">
      <div className="p-5 space-y-4">
        <p className="text-xs text-text-secondary leading-relaxed">
          Written from your Brand Brain{cold ? ' and, for one prospect, their details and research lead' : ' and what the research agent found this week'}. Three different angles; pick one and edit it.
          Counts against the monthly AI budget (a few cents per draft).
          {designed && ' “Use in the design” replaces the blocks with the new text, keeping your logo and colours; Undo in the editor does not reach back past it, so save first if you like the current layout.'}
        </p>
        <Textarea label="What should this email do?" rows={3} value={brief} onChange={e => setBrief(e.target.value)}
          placeholder={cold
            ? 'e.g. Introduce our architectural lighting for their hotel project and ask who handles lighting selection.'
            : 'e.g. Share the lighting we did for the new office tower and invite them to our showroom. Leave empty to let the research decide.'} />
        <div className="flex flex-wrap items-end gap-3">
          {cold && contacts.length > 0 && (
            <Select label="Write for one prospect (optional)" value={contactId} onChange={e => setContactId(e.target.value)} className="min-w-[260px]">
              <option value="">No, a template for the whole group</option>
              {contacts.slice(0, 200).map(c => <option key={c.id} value={c.id}>{displayName(c)}{c.company ? `, ${c.company}` : ''}</option>)}
            </Select>
          )}
          {current.body?.trim() && (
            <label className="flex items-center gap-2 text-xs text-text-secondary pb-2">
              <input type="checkbox" checked={improve} onChange={e => setImprove(e.target.checked)} /> Improve on the current draft
            </label>
          )}
          <div className="flex-1" />
          <Button onClick={run} disabled={busy}>{busy ? 'Writing…' : result?.options ? 'Write three more' : 'Write three options'}</Button>
        </div>

        {busy && <div className="grid md:grid-cols-3 gap-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-56 w-full" />)}</div>}
        {result?.error && <Notice tone={result.capped ? 'amber' : 'red'}>{result.error}</Notice>}
        {result?.options && (
          <div className="grid md:grid-cols-3 gap-3">
            {result.options.map((o, i) => (
              <div key={i} className="border border-border flex flex-col">
                <div className="px-3 py-2 border-b border-border bg-surface-subtle">
                  <p className="text-[10px] uppercase tracking-wide font-semibold text-text-tertiary">{o.angle || `Option ${i + 1}`}</p>
                  <p className="text-sm font-semibold text-text mt-0.5" dir={language === 'ar' ? 'rtl' : 'ltr'}>{o.subject}</p>
                  {o.preheader && <p className="text-[11px] text-text-tertiary mt-0.5" dir={language === 'ar' ? 'rtl' : 'ltr'}>{o.preheader}</p>}
                </div>
                <p className="px-3 py-2 text-xs text-text-secondary whitespace-pre-wrap flex-1 max-h-64 overflow-y-auto scrollbar-thin" dir={language === 'ar' ? 'rtl' : 'ltr'}>{o.body}</p>
                <div className="px-3 py-2 border-t border-border flex flex-wrap gap-2">
                  <Button size="xs" onClick={() => onUse(o)}>{designed ? 'Use in the design' : 'Use this one'}</Button>
                  {designed && <Button size="xs" variant="ghost" onClick={() => onUse(o, { textOnly: true })}>Subject only</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
        {result?.cost > 0 && <p className="text-[10px] text-text-tertiary text-right">Cost ${result.cost.toFixed(3)}</p>}
      </div>
    </Modal>
  )
}

// ─── Launch ────────────────────────────────────────────────────────────────

function LaunchModal({ workspaceId, campaignId, recipients, status, onClose, onDone }) {
  const [when, setWhen] = useState('now')
  const [date, setDate] = useState(() => brandTodayKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cap = status?.cap
  const n = recipients.eligible.length
  const today = Math.min(n, cap?.remaining ?? 0)

  async function go() {
    setBusy(true); setError('')
    const r = await emailApi('launch', workspaceId, { campaign_id: campaignId, when, date: when === 'schedule' ? date : undefined })
    setBusy(false)
    if (r.error) { setError(r.error); return }
    const d = r.dispatched
    onDone({
      tone: 'sage',
      text: r.scheduled
        ? `Scheduled: ${r.queued} emails go out on ${date}, from about 9:00 Riyadh time, within that day's limit.`
        : `${d?.sent ?? 0} sent now${r.queued > (d?.sent ?? 0) ? `, ${r.queued - (d?.sent ?? 0)} queued for the next mornings (daily limit)` : ''}.${d?.stoppedBy && !/limit/.test(d.stoppedBy) ? ` ${d.stoppedBy}` : ''}`,
    })
  }

  return (
    <Modal open onClose={onClose} title="Send campaign" width="max-w-md">
      <div className="p-5 space-y-4">
        <div className="text-sm text-text-secondary space-y-1">
          <p><strong className="text-text">{n.toLocaleString()}</strong> people will receive this email.</p>
          {recipients.skipped.length > 0 && <p className="text-xs">{recipients.skipped.length} in these groups are skipped (unsubscribed, bounced, or in the cold lane).</p>}
          {cap && (
            <p className="text-xs">
              Today's limit leaves room for <strong className="text-text">{cap.remaining}</strong> more
              {cap.limitedBy ? ` (set by ${cap.limitedBy})` : ''}.
              {n > today && ` The rest go out over the following mornings, automatically.`}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Send now</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={when === 'schedule'} onChange={() => setWhen('schedule')} /> Schedule for a morning</label>
          {when === 'schedule' && (
            <Input type="date" value={date} min={brandTodayKey()} onChange={e => setDate(e.target.value)}
              hint="Goes out from about 9:00 Riyadh time that day. Tuesday to Thursday mornings are usually best for business email." />
          )}
        </div>
        {error && <Notice tone="red">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={go} disabled={busy || !n}>{busy ? 'Working…' : when === 'now' ? `Send to ${n.toLocaleString()}` : 'Schedule'}</Button>
        </div>
      </div>
    </Modal>
  )
}

/** Starting a cold sequence: nothing is sent here; the sending runs pick it up. */
function ColdLaunchModal({ workspaceId, campaignId, recipients, mailboxes, followUps, enabled, onClose, onDone }) {
  const [when, setWhen] = useState('now')
  const [date, setDate] = useState(() => brandTodayKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const today = brandTodayKey()
  const ready = mailboxes.filter(m => mailboxReadiness(m, today).ready)
  const perDay = ready.reduce((sum, m) => sum + mailboxCap(m, today).cap, 0)
  const n = recipients.eligible.length
  // First emails only; follow-ups share the same daily limit later on.
  const days = perDay ? Math.ceil(n / perDay) : null

  async function go() {
    setBusy(true); setError('')
    const r = await emailApi('launch', workspaceId, { campaign_id: campaignId, when, date: when === 'schedule' ? date : undefined })
    setBusy(false)
    if (r.error) { setError(r.error); return }
    onDone({
      tone: 'sage',
      text: `${r.queued} prospects queued${r.recontact ? ` (${r.recontact} left out: written to by another outreach campaign in the last 90 days)` : ''}. `
        + (enabled ? `First emails go out from ${r.mailboxes} mailbox${r.mailboxes === 1 ? '' : 'es'}, about ${r.perDay} a day to start, in working hours.` : 'Nothing goes out until outreach sending is switched on in Settings.'),
    })
  }

  return (
    <Modal open onClose={onClose} title="Start outreach sequence" width="max-w-md">
      <div className="p-5 space-y-4">
        <div className="text-sm text-text-secondary space-y-1.5">
          <p><strong className="text-text">{n.toLocaleString()}</strong> prospects get the first email{followUps ? `, then up to ${followUps} follow-up${followUps === 1 ? '' : 's'} unless they reply` : ''}.</p>
          {ready.length > 0 ? (
            <p className="text-xs">
              From {ready.length} ready mailbox{ready.length === 1 ? '' : 'es'}, up to <strong className="text-text">{perDay}</strong> a day at first
              {days ? `, so the first emails take about ${days} working day${days === 1 ? '' : 's'}` : ''}. Sending grows as each mailbox's ramp allows.
            </p>
          ) : (
            <p className="text-xs text-amber-800">None of these mailboxes is ready yet, so it cannot start.</p>
          )}
          <p className="text-xs">Anyone another outreach campaign wrote to in the last 90 days is left out. A reply stops their follow-ups.</p>
          {!enabled && <p className="text-xs text-amber-800">Outreach sending is off: it will be queued, and nothing goes out until it is switched on.</p>}
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Start now</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" checked={when === 'schedule'} onChange={() => setWhen('schedule')} /> Start on a day</label>
          {when === 'schedule' && (
            <Input type="date" value={date} min={brandTodayKey()} onChange={e => setDate(e.target.value)}
              hint="From 9:00 Riyadh that day. Sunday to Thursday only." />
          )}
        </div>
        {error && <Notice tone="red">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={go} disabled={busy || !n || !ready.length}>{busy ? 'Working…' : 'Start'}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Detail (after launch) ─────────────────────────────────────────────────

function CampaignDetail({ audience, campaign, data, workspaceId, reload, setTab }) {
  const [sends, setSends] = useState(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const st = data.stats.find(s => s.campaign_id === campaign.id) || {}
  const sent = Number(st.sent || 0)

  useEffect(() => {
    let live = true
    fetchCampaignSends(workspaceId, campaign.id).then(r => { if (live) setSends(r) }).catch(err => { if (live) { setSends([]); setError(err.message) } })
    return () => { live = false }
  }, [workspaceId, campaign.id, campaign.status, data.stats])

  async function act(action) {
    setBusy(action); setError('')
    const r = await emailApi(action, workspaceId, { campaign_id: campaign.id })
    setBusy('')
    if (r.error) setError(r.error)
    await reload()
  }

  const groupNames = campaign.group_ids.map(id => data.groups.find(g => g.id === id)?.name).filter(Boolean)
  const shownSends = (sends || []).filter(s => !filter || s.status === filter)
  const shown = {
    subject: campaign.subject, preheader: campaign.preheader, language: campaign.language,
    contact: { first_name: 'Sara', company: 'Example Co' },
    sender: { from_name: campaign.from_name || data.settings?.from_name, company_address: data.settings?.company_address },
    unsubscribeUrl: audience === 'cold' ? '' : '#unsubscribe',
    subscribeUrl: audience === 'cold' ? TEST_SUBSCRIBE_URL : '',
  }
  const preview = audience === 'marketing' && hasDesign(campaign.design)
    ? renderDesign({ ...shown, design: campaign.design })
    : renderEmail({ ...shown, audience, body: campaign.body })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setTab(audience)}><EIcon name="back" /> All campaigns</Button>
        <div className="flex gap-2">
          {['sending', 'scheduled'].includes(campaign.status) && <Button size="sm" variant="secondary" onClick={() => act('pause')} disabled={!!busy}>Pause</Button>}
          {campaign.status === 'paused' && <>
            <Button size="sm" variant="secondary" onClick={() => setTab(audience, { campaign: campaign.id })}>Edit wording</Button>
            <Button size="sm" onClick={() => act('resume')} disabled={!!busy}>Resume sending</Button>
          </>}
          {['sending', 'scheduled', 'paused'].includes(campaign.status) && <Button size="sm" variant="danger" onClick={() => setConfirmCancel(true)} disabled={!!busy}>Cancel the rest</Button>}
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={async () => {
            setBusy('duplicate')
            try { const copy = await duplicateCampaign(workspaceId, campaign); await reload(); setTab(audience, { campaign: copy.id }) }
            catch (err) { setError(err.message) }
            finally { setBusy('') }
          }}>Duplicate</Button>
        </div>
      </div>
      {error && <Notice tone="red">{error}</Notice>}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><AudienceTag audience={audience} /><CampaignStatus status={campaign.status} /></div>
            <h2 className="text-base font-semibold text-text mt-2">{campaign.name || campaign.subject}</h2>
            <p className="text-xs text-text-tertiary mt-1">
              {campaign.subject} · to {groupNames.join(', ') || '—'} · from {campaign.from_email || '—'}
            </p>
            <p className="text-xs text-text-tertiary mt-0.5">
              {campaign.status === 'scheduled' ? `Goes out ${dateTime(campaign.scheduled_for)}` : `Started ${dateTime(campaign.launched_at)}`}
              {campaign.completed_at && ` · finished ${dateTime(campaign.completed_at)}`}
            </p>
          </div>
        </div>
      </Card>

      {audience === 'cold' ? (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border border border-border">
        <Stat label="Prospects" value={Number(campaign.recipients || 0).toLocaleString()} hint={`${Number(st.queued || 0)} emails still queued`} />
        <Stat label="Emails sent" value={sent.toLocaleString()} hint="First emails and follow-ups" />
        <Stat label="Replied" value={pct(Number(st.replied || 0), Number(campaign.recipients || 0))} hint={`${Number(st.replied || 0)} people`}
          info="Outreach carries no tracking pixel, so replies are the measure. A reply stops that person's follow-ups and moves them to the marketing group “Replied to outreach”. A reply that says stop, unsubscribe or not interested unsubscribes them instead." />
        <Stat label="Subscribed" value={pct(Number(st.subscribed || 0), Number(campaign.recipients || 0))} hint={`${Number(st.subscribed || 0)} people`}
          info="Pressed the Sign-up button and confirmed. They are now in the Subscribers tab and get no more outreach." />
        <Stat label="Bounced" value={pct(Number(st.bounced || 0), sent)} hint={`${Number(st.bounced || 0)} addresses`} tone={Number(st.bounced || 0) / (sent || 1) >= 0.03 && sent >= 20 ? 'text-red-600' : ''} />
        <Stat label="Stopped" value={Number(st.failed || 0).toLocaleString()} hint="Skipped: replied, opted out or bounced elsewhere" />
      </div>
      ) : (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px bg-border border border-border">
        <Stat label="Recipients" value={Number(st.total || campaign.recipients || 0).toLocaleString()} hint={`${Number(st.queued || 0)} still queued`} />
        <Stat label="Sent" value={sent.toLocaleString()} hint={`${Number(st.delivered || 0)} confirmed delivered`} />
        <Stat label="Opened" value={pct(Number(st.opened || 0), sent)} hint={`${Number(st.opened || 0)} people`} info="Apple Mail opens every email automatically, so this runs high. Clicks are the honest signal." />
        <Stat label="Clicked" value={pct(Number(st.clicked || 0), sent)} hint={`${Number(st.clicked || 0)} people`} />
        <Stat label="Bounced" value={pct(Number(st.bounced || 0), sent)} hint={`${Number(st.bounced || 0)} addresses`} tone={Number(st.bounced || 0) / (sent || 1) >= 0.02 && sent >= 20 ? 'text-red-600' : ''} />
        <Stat label="Spam reports" value={Number(st.complained || 0).toLocaleString()} hint={`${Number(st.failed || 0)} failed or skipped`} tone={Number(st.complained || 0) ? 'text-red-600' : ''} />
      </div>
      )}

      <div className="grid xl:grid-cols-2 gap-4 items-start">
        <Card>
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-text">Recipients</p>
            <select className="text-[11px] border border-border bg-white px-1.5 py-1" value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="">All</option>
              {(audience === 'cold'
                ? ['queued', 'sending', 'sent', 'bounced', 'failed', 'skipped', 'cancelled']
                : ['queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'skipped', 'cancelled']).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {sends === null ? <div className="p-4"><Skeleton className="h-32 w-full" /></div> : (
            <div className="max-h-[480px] overflow-y-auto scrollbar-thin">
              <table className="w-full text-xs">
                <tbody>
                  {shownSends.slice(0, 500).map(s => (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-1.5 text-text truncate max-w-[220px]">{s.email}</td>
                      {audience === 'cold' && <td className="px-2 py-1.5 text-text-tertiary whitespace-nowrap">{s.step ? `Follow-up ${s.step}` : 'First'}</td>}
                      <td className="px-2 py-1.5 capitalize text-text-secondary">{s.subscribed_at ? 'subscribed' : s.replied_at ? 'replied' : s.status}</td>
                      <td className="px-2 py-1.5 text-text-tertiary">{(audience === 'cold' && s.mailbox_id && s.sent_at ? `${mailboxEmail(data, s.mailbox_id)} · ` : '')}{s.error || (s.clicked_at ? `clicked ${dateTime(s.clicked_at)}` : s.opened_at ? `opened ${dateTime(s.opened_at)}` : s.sent_at ? dateTime(s.sent_at) : s.status === 'queued' ? `due ${dateTime(s.due_at)}` : '')}</td>
                    </tr>
                  ))}
                  {shownSends.length === 0 && <tr><td className="px-4 py-4 text-text-tertiary">Nobody here.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <div className="px-4 py-2.5 border-b border-border"><p className="text-xs font-semibold text-text">What was sent</p></div>
          <iframe title="Sent email" srcDoc={preview.html} sandbox="" className="w-full h-[480px] bg-white" />
        </Card>
      </div>

      <ConfirmDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} danger title="Cancel the rest of this campaign?"
        message="Emails already sent stay sent. Everything still queued is cancelled and will not go out." onConfirm={() => act('cancel')} />
    </div>
  )
}

function mailboxEmail(data, id) {
  return (data.mailboxes || []).find(m => m.id === id)?.email || 'a removed mailbox'
}
