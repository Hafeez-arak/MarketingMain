import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { PageHeader, Button, Spinner, Skeleton, Input, Textarea, PillSelect } from '../../components/ui/index'
import { Notice, Stat, SubTabs } from '../email/parts'
import { fetchTargets, saveIcp, updateAccount, updateTarget, updateEvent } from '../../lib/sales/client'
import {
  normaliseIcp, hasIcp, rankTargets, formatAmount, buyerLabel, playLabel, icpToForm, formToIcp,
  ACCOUNT_STATUSES, BUYERS,
} from '../../lib/sales/icp'
import { eventsAhead, isOpenTarget, whenLabel, targetStats } from '../../lib/sales/view'
import { OPPORTUNITY_STATUSES, EVENT_DECISIONS } from '../../lib/agent/intel'

// ─── Sales → Targets ───────────────────────────────────────────────────────
// Who to go after, in one place, built on the company's own won and lost
// deals (the Oct 2026 CRM + email analysis). Four lists:
//
//   Accounts to work   existing customers to reactivate, upsell or extend —
//                      the analysis showed they win about three times as
//                      often as new ones, so they come first.
//   New targets        every project and company the weekly research found,
//                      scored against the ICP in code, split into the core
//                      track (what we usually win) and the broader one (where
//                      we want to grow). A lead found by any lens shows here
//                      too, even if the research report already listed it.
//   Events             expos and conferences where these buyers gather.
//   Ideal customer     the ICP itself, editable, with the questions to ask
//                      first and the client problems marketing should answer.
//
// Admin only, like the Lead Agent: client names and order values.

const TABS = [
  { key: 'accounts', label: 'Accounts to work' },
  { key: 'targets', label: 'New targets' },
  { key: 'events', label: 'Events' },
  { key: 'icp', label: 'Ideal customer' },
]

const TRACK_TABS = [
  { key: 'core', label: 'Core — what we win' },
  { key: 'broader', label: 'Broader — where we grow' },
  { key: 'other', label: 'Other research leads' },
]

const BAND_TONE = {
  strong: 'bg-sage-50 text-sage-700 border-sage-200',
  possible: 'bg-amber-50 text-amber-800 border-amber-200',
  weak: 'bg-surface-subtle text-text-tertiary border-border',
}

const STATUS_LABEL = { new: 'New', assigned: 'Assigned', pursued: 'Pursuing', won: 'Won', lost: 'Lost', dropped: 'Dropped' }
const DECISION_LABEL = { undecided: 'Undecided', visiting: 'Visiting', exhibiting: 'Exhibiting', sponsoring: 'Sponsoring', skipping: 'Skipping' }

const dateLabel = d => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')

function Tag({ children, tone = 'bg-surface-subtle text-text-secondary border-border' }) {
  return <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold border whitespace-nowrap ${tone}`}>{children}</span>
}

export default function Targets() {
  const { isAccessAdmin, activeWorkspaceId } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'accounts'
  const setTab = key => setParams(prev => { const n = new URLSearchParams(prev); n.set('tab', key); return n }, { replace: true })

  const [data, setData] = useState(null)
  const [loadedFor, setLoadedFor] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())

  const reload = useCallback(async () => {
    if (!activeWorkspaceId) return
    const ws = activeWorkspaceId
    setRefreshing(true)
    try {
      setData(await fetchTargets(ws))
      setNow(new Date())
      setError('')
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoadedFor(ws)
      setRefreshing(false)
    }
  }, [activeWorkspaceId])

  useEffect(() => { if (isAccessAdmin) queueMicrotask(reload) }, [reload, isAccessAdmin])

  const loading = loadedFor !== activeWorkspaceId || !data
  const icp = useMemo(() => normaliseIcp(data?.icp), [data?.icp])
  const openOpps = useMemo(() => (data?.opportunities || []).filter(isOpenTarget), [data?.opportunities])
  const ranked = useMemo(() => rankTargets(openOpps, icp), [openOpps, icp])
  const stats = useMemo(
    () => targetStats({ accounts: data?.accounts || [], ranked, events: data?.events || [], now }),
    [data?.accounts, data?.events, ranked, now],
  )

  if (!isAccessAdmin) return <Navigate to="/" replace />

  // Optimistic: the row changes at once and reverts only if the save fails.
  const patchRow = (kind, id, change) =>
    setData(d => ({ ...d, [kind]: d[kind].map(r => (r.id === id ? { ...r, ...change } : r)) }))
  const act = async (kind, id, change, save) => {
    const before = data[kind].find(r => r.id === id)
    patchRow(kind, id, change)
    const r = await save()
    if (!r.ok) {
      patchRow(kind, id, before)
      setError(r.error)
    }
  }

  const errs = data?.errors || {}

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title="Targets" subtitle="Who sales should go after: existing customers to work, new projects that fit our ideal customer, and the events where they gather. Built from our own won and lost deals. Admin only.">
        <Button variant="secondary" size="sm" onClick={reload} disabled={refreshing || !activeWorkspaceId}>
          {refreshing ? <Spinner size="sm" /> : null}
          Refresh
        </Button>
      </PageHeader>

      {error && <Notice tone="red" title="Something went wrong">{error}</Notice>}
      {!loading && !hasIcp(data.icp) && !errs.icp && (
        <Notice title="No ideal customer written yet">
          The weekly research only looks for targets once an ideal customer is written. Open the Ideal customer tab to write one.
        </Notice>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border border border-border">
        <Stat label="Accounts to work" value={stats.accounts} hint={`${stats.accountsUntouched} not contacted yet`} loading={loading} tone="text-sage-700" />
        <Stat label="Core targets" value={stats.core} hint="Look like what we usually win" loading={loading} />
        <Stat label="Broader targets" value={stats.broader} hint="Bigger or newer kinds of work" loading={loading} />
        <Stat label="Strong fit" value={stats.strong} hint="Score 60 or more against the ICP" loading={loading} tone="text-amber-800" />
        <Stat label="Events, next 90 days" value={stats.events90} hint={data?.lastRunAt ? `Research last ran ${dateLabel(data.lastRunAt)}` : 'No research run yet'} loading={loading} />
      </div>

      <div className="bg-white border border-border min-w-0">
        <div className="px-4 pt-3"><SubTabs items={TABS} value={tab} onChange={setTab} /></div>
        {loading ? (
          <div className="p-4 space-y-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : tab === 'accounts' ? (
          <AccountsTab rows={data.accounts} error={errs.accounts}
            onChange={(id, change) => act('accounts', id, change, () => updateAccount(activeWorkspaceId, id, change))} />
        ) : tab === 'targets' ? (
          <TargetsTab ranked={ranked} closed={(data.opportunities || []).filter(r => !isOpenTarget(r))} icp={icp} error={errs.opportunities} now={now}
            onChange={(id, change) => act('opportunities', id, change, () => updateTarget(activeWorkspaceId, id, change))} />
        ) : tab === 'events' ? (
          <EventsTab rows={eventsAhead(data.events, now)} error={errs.events}
            onChange={(id, decision) => act('events', id, { decision }, () => updateEvent(activeWorkspaceId, id, decision))} />
        ) : (
          <IcpTab icp={data.icp} updatedAt={data.icpUpdatedAt} error={errs.icp}
            onSave={async config => {
              const r = await saveIcp(activeWorkspaceId, config)
              if (r.ok) setData(d => ({ ...d, icp: config, icpUpdatedAt: new Date().toISOString() }))
              return r
            }} />
        )}
      </div>
    </div>
  )
}

// ─── Accounts to work ──────────────────────────────────────────────────────

function AccountsTab({ rows = [], error, onChange }) {
  const [showParked, setShowParked] = useState(false)
  if (error) return <p className="px-4 py-10 text-sm text-red-600 text-center">Could not load the accounts: {error}</p>
  const shown = rows.filter(r => showParked || !['won', 'parked'].includes(r.status))
  if (!rows.length) return <p className="px-4 py-10 text-sm text-text-tertiary text-center">No accounts loaded yet.</p>
  return (
    <div>
      <div className="px-4 py-2 flex items-center justify-between gap-3 text-[11px] text-text-tertiary">
        <span>Existing customers win about three times as often as new ones. Priority 1 first, largest first.</span>
        <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={showParked} onChange={e => setShowParked(e.target.checked)} /> Show won and parked
        </label>
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {shown.map(a => <AccountRow key={a.id} a={a} onChange={onChange} />)}
      </ul>
    </div>
  )
}

function AccountRow({ a, onChange }) {
  const [note, setNote] = useState(a.owner_note || '')
  const [owner, setOwner] = useState(a.owner || '')
  return (
    <li className="px-4 py-3 grid grid-cols-1 lg:grid-cols-12 gap-3">
      <div className="lg:col-span-7 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Tag tone={a.priority === 1 ? 'bg-amber-50 text-amber-800 border-amber-200' : undefined}>P{a.priority}</Tag>
          <p className="text-sm font-semibold text-text" dir="auto">{a.name}</p>
        </div>
        <p className="text-[11px] text-text-tertiary mt-1 tabular-nums">
          {[a.orders != null && `${a.orders} order${a.orders === 1 ? '' : 's'}`, formatAmount(a.value_sar),
            a.last_order && `last ${dateLabel(a.last_order)}`, a.bought && `bought ${a.bought}`,
            a.open_deals ? `${a.open_deals} open CRM deal${a.open_deals === 1 ? '' : 's'} (${formatAmount(a.open_value_sar)})` : '']
            .filter(Boolean).join(' · ')}
        </p>
        <div className="flex gap-1 flex-wrap mt-1.5">{(a.plays || []).map(p => <Tag key={p} tone="bg-sky-50 text-sky-800 border-sky-200">{playLabel(p)}</Tag>)}</div>
        {a.why && <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{a.why}</p>}
      </div>
      <div className="lg:col-span-5 grid grid-cols-2 gap-2 content-start">
        <PillSelect value={a.status} onChange={e => onChange(a.id, { status: e.target.value })}>
          {ACCOUNT_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </PillSelect>
        <Input placeholder="Owner" value={owner} onChange={e => setOwner(e.target.value)}
          onBlur={() => owner !== (a.owner || '') && onChange(a.id, { owner })} />
        <Input type="date" value={a.next_step_on || ''} onChange={e => onChange(a.id, { next_step_on: e.target.value || null })} />
        <span className="text-[10px] text-text-tertiary self-center">Next step date</span>
        <div className="col-span-2">
          <Textarea rows={2} placeholder="What happened, what is next" value={note} onChange={e => setNote(e.target.value)}
            onBlur={() => note !== (a.owner_note || '') && onChange(a.id, { owner_note: note })} />
        </div>
      </div>
    </li>
  )
}

// ─── New targets ───────────────────────────────────────────────────────────

function TargetsTab({ ranked, closed = [], icp, error, onChange }) {
  const [track, setTrack] = useState('core')
  const [showClosed, setShowClosed] = useState(false)
  if (error) return <p className="px-4 py-10 text-sm text-red-600 text-center">Could not load the targets: {error}</p>
  const rows = showClosed ? closed.map(r => ({ ...r, fit: { score: 0, band: 'weak', reasons: [], flags: [] } })) : ranked[track]
  return (
    <div>
      <div className="px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <SubTabs items={TRACK_TABS.map(t => ({ ...t, label: `${t.label} (${ranked[t.key].length})` }))} value={showClosed ? '' : track}
          onChange={k => { setShowClosed(false); setTrack(k) }} />
        <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-text-tertiary">
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Won, lost and dropped ({closed.length})
        </label>
      </div>
      <p className="px-4 pb-2 text-[11px] text-text-tertiary">
        {track === 'core' && !showClosed && `About ${icp.mix.core}% of the weekly search goes here: targets that look like the work we usually win.`}
        {track === 'broader' && !showClosed && `About ${icp.mix.broader}% goes here: larger packages and kinds of buyer we want to grow into. Judged on fit, never on being unlike the past.`}
        {track === 'other' && !showClosed && 'Projects the other research questions found. Scored on their name and scope alone.'}
      </p>
      {!rows.length ? (
        <p className="px-4 py-10 text-sm text-text-tertiary text-center border-t border-border">
          Nothing here yet. Targets appear after the weekly research runs with an ideal customer written.
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map(r => <TargetRow key={r.id} r={r} onChange={onChange} />)}
        </ul>
      )}
    </div>
  )
}

function TargetRow({ r, onChange }) {
  const [note, setNote] = useState(r.owner_note || '')
  const fit = r.fit || {}
  const facts = [
    r.segment && fit.segment, r.buyer && buyerLabel(r.buyer), formatAmount(r.value_sar), r.stage, r.location,
    r.contractor && `contractor ${r.contractor}`, r.consultant && `consultant ${r.consultant}`, r.client && `client ${r.client}`,
  ].filter(Boolean)
  return (
    <li className="px-4 py-3 grid grid-cols-1 lg:grid-cols-12 gap-3">
      <div className="lg:col-span-8 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Tag tone={BAND_TONE[fit.band]}>{fit.band === 'strong' ? 'Strong fit' : fit.band === 'possible' ? 'Possible' : 'Weak fit'} · {fit.score}</Tag>
          <p className="text-sm font-semibold text-text" dir="auto">{r.name}</p>
          {r.type === 'tender' && <Tag>Tender</Tag>}
          {r.type === 'lead' && <Tag>Company</Tag>}
        </div>
        {r.headline && <p className="text-xs text-text-secondary mt-1" dir="auto">{r.headline}</p>}
        {facts.length > 0 && <p className="text-[11px] text-text-tertiary mt-1" dir="auto">{facts.join(' · ')}</p>}
        {(fit.reasons || []).length > 0 && (
          <p className="text-[11px] text-sage-700 mt-1.5">Fits: {fit.reasons.join(' · ')}</p>
        )}
        {(fit.flags || []).map(f => <p key={f} className="text-[11px] text-amber-800 mt-0.5">Ask first: {f}</p>)}
        {r.suggested_action && <p className="text-xs text-text mt-1.5"><span className="font-semibold">Next: </span>{r.suggested_action}</p>}
        {r.contact && <p className="text-[11px] text-text-secondary mt-1" dir="auto"><span className="font-semibold">Contact: </span>{r.contact}</p>}
        <p className="text-[10px] text-text-tertiary mt-1.5">
          {r.first_seen_at && `Found ${dateLabel(r.first_seen_at)}`}
          {r.times_seen > 1 && ` · seen ${r.times_seen} weeks`}
          {r.last_change && ` · changed: ${r.last_change}`}
          {r.source_url && <> · <a href={r.source_url} target="_blank" rel="noreferrer" className="underline">source</a></>}
        </p>
      </div>
      <div className="lg:col-span-4 space-y-2">
        <PillSelect value={r.status || 'new'} onChange={e => onChange(r.id, { status: e.target.value })}>
          {OPPORTUNITY_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
        </PillSelect>
        <Textarea rows={2} placeholder="Who has it, what happened" value={note} onChange={e => setNote(e.target.value)}
          onBlur={() => note !== (r.owner_note || '') && onChange(r.id, { owner_note: note })} />
      </div>
    </li>
  )
}

// ─── Events ────────────────────────────────────────────────────────────────

function EventsTab({ rows = [], error, onChange }) {
  if (error) return <p className="px-4 py-10 text-sm text-red-600 text-center">Could not load the events: {error}</p>
  if (!rows.length) return <p className="px-4 py-10 text-sm text-text-tertiary text-center">No upcoming events found yet.</p>
  return (
    <ul className="divide-y divide-border border-t border-border mt-2">
      {rows.map(e => (
        <li key={e.id} className="px-4 py-3 grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-2">
            <p className="text-xs font-semibold text-text tabular-nums">{e.start_date ? dateLabel(e.start_date) : 'Date to confirm'}</p>
            <p className="text-[11px] text-text-tertiary">{whenLabel(e.days)}</p>
          </div>
          <div className="lg:col-span-7 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {e.relevance === 'high' && <Tag tone="bg-amber-50 text-amber-800 border-amber-200">High</Tag>}
              <p className="text-sm font-semibold text-text" dir="auto">{e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="hover:underline">{e.name}</a> : e.name}</p>
            </div>
            <p className="text-[11px] text-text-tertiary mt-0.5">{[e.venue, e.city, e.organizer].filter(Boolean).join(' · ')}</p>
            {e.exhibitor_deadline && (
              <p className={`text-[11px] mt-1 ${e.deadlineDays !== null && e.deadlineDays >= 0 && e.deadlineDays <= 30 ? 'text-red-600 font-semibold' : 'text-text-secondary'}`}>
                Exhibitor deadline {dateLabel(e.exhibitor_deadline)} ({whenLabel(e.deadlineDays)})
              </p>
            )}
            {(e.competitors_exhibiting || []).length > 0 && <p className="text-[11px] text-text-secondary mt-0.5">Competitors there: {e.competitors_exhibiting.join(', ')}</p>}
            {e.recommendation && <p className="text-xs text-text mt-1">{e.recommendation}</p>}
          </div>
          <div className="lg:col-span-3">
            <PillSelect value={e.decision || 'undecided'} onChange={ev => onChange(e.id, ev.target.value)}>
              {EVENT_DECISIONS.map(d => <option key={d} value={d}>{DECISION_LABEL[d] || d}</option>)}
            </PillSelect>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ─── Ideal customer ────────────────────────────────────────────────────────

function IcpTab({ icp: raw, updatedAt, error, onSave }) {
  const icp = normaliseIcp(raw)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => icpToForm(raw))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  if (error) return <p className="px-4 py-10 text-sm text-red-600 text-center">Could not load the ideal customer: {error}</p>

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  async function save() {
    setSaving(true)
    const r = await onSave(formToIcp(form, raw))
    setSaving(false)
    if (r.ok) { setEditing(false); setSaveError('') } else setSaveError(r.error)
  }

  if (editing) {
    return (
      <div className="p-4 space-y-4">
        {saveError && <Notice tone="red" title="Not saved">{saveError}</Notice>}
        <Textarea label="Who we target" rows={4} value={form.summary} onChange={set('summary')} />
        <Input label="Built from" value={form.evidence} onChange={set('evidence')} />
        <Input label="Share of weekly search on the core track (%)" type="number" min={0} max={100} value={form.core} onChange={set('core')}
          hint="The rest goes to the broader track." />
        <Textarea label="Segments" rows={8} value={form.segments} onChange={set('segments')}
          hint="One per line: name | core or broader | weight 1–3 | words that identify it, comma separated | note" />
        <div>
          <p className="text-xs font-semibold text-text mb-1">Buyers</p>
          <p className="text-[11px] text-text-tertiary mb-2">Weight from −3 (a warning) to 3 (the best buyer). 0 means it does not count.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {BUYERS.map(([k, label]) => (
              <div key={k} className="flex items-center gap-2">
                <input type="number" min={-3} max={3} className="w-14 border border-border px-2 py-1 text-xs"
                  value={form.buyers[k]} onChange={e => setForm(f => ({ ...f, buyers: { ...f.buyers, [k]: e.target.value } }))} />
                <span className="text-xs text-text-secondary w-56 flex-shrink-0">{label}</span>
                <input className="flex-1 min-w-0 border border-border px-2 py-1 text-xs" placeholder="note"
                  value={form.buyerNotes[k]} onChange={e => setForm(f => ({ ...f, buyerNotes: { ...f.buyerNotes, [k]: e.target.value } }))} />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="Best package size up to (SAR)" type="number" value={form.sweet_max} onChange={set('sweet_max')} />
          <Input label="Fine up to (SAR)" type="number" value={form.ok_max} onChange={set('ok_max')} />
          <Input label="Regions" value={form.regions} onChange={set('regions')} hint="Comma separated words" />
        </div>
        <Input label="Note on size" value={form.size_note} onChange={set('size_note')} />
        <Textarea label="Red flags" rows={6} value={form.red_flags} onChange={set('red_flags')}
          hint="One per line: flag | what to do | words that reveal it, comma separated" />
        <Textarea label="Ask these first" rows={5} value={form.ask_first} onChange={set('ask_first')} hint="One question per line" />
        <Textarea label="What wins for us" rows={5} value={form.win_levers} onChange={set('win_levers')} hint="One per line" />
        <Textarea label="Client problems, and how marketing answers them" rows={6} value={form.pains} onChange={set('pains')}
          hint="One per line: the problem | what we say about it" />
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving}>{saving ? <Spinner size="sm" /> : null}Save</Button>
          <Button variant="secondary" onClick={() => { setEditing(false); setForm(icpToForm(raw)) }}>Cancel</Button>
        </div>
      </div>
    )
  }

  const segs = track => icp.segments.filter(s => s.track === track)
  return (
    <div className="p-4 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-text leading-relaxed whitespace-pre-line">{icp.summary || 'Not written yet.'}</p>
          {icp.evidence && <p className="text-[11px] text-text-tertiary mt-1">Built from: {icp.evidence}{updatedAt ? ` · updated ${dateLabel(updatedAt)}` : ''}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={() => { setForm(icpToForm(raw)); setEditing(true) }}>Edit</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[['core', `Core track · ${icp.mix.core}% of search`, 'What our own history says we win'],
          ['broader', `Broader track · ${icp.mix.broader}% of search`, 'Where we want to grow']].map(([t, title, note]) => (
          <div key={t} className="border border-border p-3">
            <p className="text-xs font-semibold text-text">{title}</p>
            <p className="text-[11px] text-text-tertiary mb-2">{note}</p>
            {segs(t).length ? (
              <ul className="space-y-1">
                {segs(t).map(s => (
                  <li key={s.key} className="text-xs text-text-secondary">
                    <span className="font-semibold text-text">{s.label}</span>{s.note ? ` — ${s.note}` : ''}
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-text-tertiary">None yet.</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <IcpList title="Good buyers and warnings" items={icp.buyers.map(b => `${b.weight > 0 ? '✓' : '⚠'} ${buyerLabel(b.key)}${b.note ? ` — ${b.note}` : ''}`)} />
        <IcpList title="Size and region" items={[
          icp.size.sweet_max && `Best under ${formatAmount(icp.size.sweet_max)}`,
          icp.size.ok_max && `Fine up to ${formatAmount(icp.size.ok_max)}`,
          icp.size.note,
          icp.regions.length && `Region: ${icp.regions.join(', ')}`,
        ].filter(Boolean)} />
        <IcpList title="Ask these first" items={icp.ask_first} ordered />
        <IcpList title="Red flags" items={icp.red_flags.map(f => `${f.label}${f.advice ? ` — ${f.advice}` : ''}`)} />
        <IcpList title="What wins for us" items={icp.win_levers} />
        <IcpList title="Client problems → what marketing says" items={icp.pains.map(p => `${p.pain}${p.angle ? ` → ${p.angle}` : ''}`)} />
      </div>
    </div>
  )
}

function IcpList({ title, items = [], ordered = false }) {
  const L = ordered ? 'ol' : 'ul'
  return (
    <div className="border border-border p-3">
      <p className="text-xs font-semibold text-text mb-2">{title}</p>
      {items.length ? (
        <L className={`space-y-1 text-xs text-text-secondary ${ordered ? 'list-decimal pl-4' : ''}`}>
          {items.map(i => <li key={i}>{i}</li>)}
        </L>
      ) : <p className="text-xs text-text-tertiary">None yet.</p>}
    </div>
  )
}
