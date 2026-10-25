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
import { eventsAhead, isOpenTarget, targetStats } from '../../lib/sales/view'
import { OPPORTUNITY_STATUSES, EVENT_DECISIONS } from '../../lib/agent/intel'
import { useT, fmtDay } from '../../lib/i18n'
import { SW } from './words'

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

const TABS = ['accounts', 'targets', 'events', 'icp'].map(key => ({ key }))
const TRACK_TABS = ['core', 'broader', 'other'].map(key => ({ key }))

const BAND_TONE = {
  strong: 'bg-sage-50 text-sage-700 border-sage-200',
  possible: 'bg-amber-50 text-amber-800 border-amber-200',
  weak: 'bg-surface-subtle text-text-tertiary border-border',
}

const dateLabel = (d, lang = 'en') => (d ? fmtDay(String(d).slice(0, 10), lang, { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const amount = (n, lang) => formatAmount(n, lang === 'ar' ? 'ر.س' : 'SAR')

function Tag({ children, tone = 'bg-surface-subtle text-text-secondary border-border' }) {
  return <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold border whitespace-nowrap ${tone}`}>{children}</span>
}

export default function Targets() {
  const { canSection, activeWorkspaceId } = useAuth()
  const { t, lang, dir } = useT(SW)
  // v2: Sales section access (was: the access admin only).
  const canUse = canSection('sales', 'view')
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

  useEffect(() => { if (canUse) queueMicrotask(reload) }, [reload, canUse])

  const loading = loadedFor !== activeWorkspaceId || !data
  const icp = useMemo(() => normaliseIcp(data?.icp), [data?.icp])
  const openOpps = useMemo(() => (data?.opportunities || []).filter(isOpenTarget), [data?.opportunities])
  const ranked = useMemo(() => rankTargets(openOpps, icp), [openOpps, icp])
  const stats = useMemo(
    () => targetStats({ accounts: data?.accounts || [], ranked, events: data?.events || [], now }),
    [data?.accounts, data?.events, ranked, now],
  )

  if (!canUse) return <Navigate to="/" replace />

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
    <div className="max-w-7xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={t.title} subtitle={t.subtitle}>
        <Button variant="secondary" size="sm" onClick={reload} disabled={refreshing || !activeWorkspaceId}>
          {refreshing ? <Spinner size="sm" /> : null}
          {t.refresh}
        </Button>
      </PageHeader>

      {error && <Notice tone="red" title={t.somethingWrong}>{error}</Notice>}
      {!loading && !hasIcp(data.icp) && !errs.icp && (
        <Notice title={t.noIcp}>
          {t.noIcpBody}
        </Notice>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border border border-border">
        <Stat label={t.stat.accounts} value={stats.accounts} hint={t.stat.untouched(stats.accountsUntouched)} loading={loading} tone="text-sage-700" />
        <Stat label={t.stat.core} value={stats.core} hint={t.stat.coreHint} loading={loading} />
        <Stat label={t.stat.broader} value={stats.broader} hint={t.stat.broaderHint} loading={loading} />
        <Stat label={t.stat.strong} value={stats.strong} hint={t.stat.strongHint} loading={loading} tone="text-amber-800" />
        <Stat label={t.stat.events} value={stats.events90} hint={data?.lastRunAt ? t.stat.lastRan(dateLabel(data.lastRunAt, lang)) : t.stat.noRun} loading={loading} />
      </div>

      <div className="bg-white border border-border min-w-0">
        <div className="px-4 pt-3"><SubTabs items={TABS.map(x => ({ ...x, label: t.tabs[x.key] }))} value={tab} onChange={setTab} /></div>
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
          // The ideal customer: the sales manager's configuration, in English for now.
          <div dir="ltr" lang="en">
          {lang === 'ar' && <p className="px-4 pt-3 text-[11px] text-text-tertiary" dir="rtl" lang="ar">{t.icpEnglish}</p>}
          <IcpTab icp={data.icp} updatedAt={data.icpUpdatedAt} error={errs.icp}
            onSave={async config => {
              const r = await saveIcp(activeWorkspaceId, config)
              if (r.ok) setData(d => ({ ...d, icp: config, icpUpdatedAt: new Date().toISOString() }))
              return r
            }} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Accounts to work ──────────────────────────────────────────────────────

function AccountsTab({ rows = [], error, onChange }) {
  const { t } = useT(SW)
  const [showParked, setShowParked] = useState(false)
  const [prio, setPrio] = useState('all')
  if (error) return <p className="px-4 py-10 text-sm text-red-600 text-center">{t.accountsFailed(error)}</p>
  const open = rows.filter(r => showParked || !['won', 'parked'].includes(r.status))
  const shown = open.filter(r => prio === 'all' || String(r.priority) === prio)
  if (!rows.length) return <p className="px-4 py-10 text-sm text-text-tertiary text-center">{t.noAccounts}</p>
  const prioTabs = [{ key: 'all', label: t.prioAll(open.length) },
    ...['1', '2', '3'].map(p => ({ key: p, label: t.prioN(p, open.filter(r => String(r.priority) === p).length) }))]
  return (
    <div>
      <div className="px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <SubTabs items={prioTabs} value={prio} onChange={setPrio} />
        <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap text-[11px] text-text-tertiary">
          <input type="checkbox" checked={showParked} onChange={e => setShowParked(e.target.checked)} /> {t.showParked}
        </label>
      </div>
      <p className="px-4 pb-2 text-[11px] text-text-tertiary">
        Every client we have closed a job with. Existing customers win about three times as often as new ones. Priority 1 first, largest first.
      </p>
      <ul className="divide-y divide-border border-t border-border">
        {shown.map(a => <AccountRow key={a.id} a={a} onChange={onChange} />)}
      </ul>
    </div>
  )
}

function AccountRow({ a, onChange }) {
  const { t, lang } = useT(SW)
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
          {[a.orders != null && t.orders(a.orders), amount(a.value_sar, lang),
            a.last_order && t.lastOrder(dateLabel(a.last_order, lang)), a.bought && t.bought(a.bought), a.sold_by && t.soldBy(a.sold_by),
            a.open_deals ? t.openDeals(a.open_deals, amount(a.open_value_sar, lang)) : '']
            .filter(Boolean).join(' · ')}
        </p>
        <div className="flex gap-1 flex-wrap mt-1.5">{(a.plays || []).map(p => <Tag key={p} tone="bg-sky-50 text-sky-800 border-sky-200">{t.plays[p] || playLabel(p)}</Tag>)}</div>
        {a.why && <p className="text-xs text-text-secondary mt-1.5 leading-relaxed" dir="auto">{a.why}</p>}
      </div>
      <div className="lg:col-span-5 grid grid-cols-2 gap-2 content-start">
        <PillSelect value={a.status} onChange={e => onChange(a.id, { status: e.target.value })}>
          {ACCOUNT_STATUSES.map(([k, l]) => <option key={k} value={k}>{t.accountStatus[k] || l}</option>)}
        </PillSelect>
        <Input placeholder={t.owner} dir="auto" value={owner} onChange={e => setOwner(e.target.value)}
          onBlur={() => owner !== (a.owner || '') && onChange(a.id, { owner })} />
        <Input type="date" value={a.next_step_on || ''} onChange={e => onChange(a.id, { next_step_on: e.target.value || null })} />
        <span className="text-[10px] text-text-tertiary self-center">{t.nextStepDate}</span>
        <div className="col-span-2">
          <Textarea rows={2} placeholder={t.notePh} dir="auto" value={note} onChange={e => setNote(e.target.value)}
            onBlur={() => note !== (a.owner_note || '') && onChange(a.id, { owner_note: note })} />
        </div>
      </div>
    </li>
  )
}

// ─── New targets ───────────────────────────────────────────────────────────

function TargetsTab({ ranked, closed = [], icp, error, onChange }) {
  const { t } = useT(SW)
  const [track, setTrack] = useState('core')
  const [showClosed, setShowClosed] = useState(false)
  if (error) return <p className="px-4 py-10 text-sm text-red-600 text-center">{t.targetsFailed(error)}</p>
  const rows = showClosed ? closed.map(r => ({ ...r, fit: { score: 0, band: 'weak', reasons: [], flags: [] } })) : ranked[track]
  return (
    <div>
      <div className="px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <SubTabs items={TRACK_TABS.map(x => ({ ...x, label: `${t.tracks[x.key]} (${ranked[x.key].length})` }))} value={showClosed ? '' : track}
          onChange={k => { setShowClosed(false); setTrack(k) }} />
        <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-text-tertiary">
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> {t.closedN(closed.length)}
        </label>
      </div>
      <p className="px-4 pb-2 text-[11px] text-text-tertiary">
        {track === 'core' && !showClosed && t.coreIntro(icp.mix.core)}
        {track === 'broader' && !showClosed && t.broaderIntro(icp.mix.broader)}
        {track === 'other' && !showClosed && t.otherIntro}
      </p>
      {!rows.length ? (
        <p className="px-4 py-10 text-sm text-text-tertiary text-center border-t border-border">
          {t.noTargets}
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
  const { t, lang } = useT(SW)
  const [note, setNote] = useState(r.owner_note || '')
  const fit = r.fit || {}
  const facts = [
    r.segment && fit.segment, r.buyer && (t.buyers[r.buyer] || buyerLabel(r.buyer)),
    // The value is labelled for what it is. A bare "2.7B SAR" next to a
    // package-sized company read as a deal size; the fit line below carries
    // our estimated share of it.
    r.value_sar && `${amount(r.value_sar, lang)}${r.value_kind === 'package' ? t.package : r.value_kind === 'project' ? t.project : ''}`,
    r.stage, r.location,
    r.contractor && t.contractor(r.contractor), r.consultant && t.consultant(r.consultant), r.client && t.client(r.client),
  ].filter(Boolean)
  return (
    <li className="px-4 py-3 grid grid-cols-1 lg:grid-cols-12 gap-3">
      <div className="lg:col-span-8 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Tag tone={BAND_TONE[fit.band]}>{t.band[fit.band] || t.band.weak} · {fit.score}</Tag>
          <p className="text-sm font-semibold text-text" dir="auto">{r.name}</p>
          {r.type === 'tender' && <Tag>{t.tender}</Tag>}
          {r.type === 'lead' && <Tag>{t.company}</Tag>}
        </div>
        {r.headline && <p className="text-xs text-text-secondary mt-1" dir="auto">{r.headline}</p>}
        {facts.length > 0 && <p className="text-[11px] text-text-tertiary mt-1" dir="auto">{facts.join(' · ')}</p>}
        {r.package && (
          <p className="text-xs text-text mt-1.5" dir="auto">
            <span className="font-semibold">{t.ourPiece}</span>{r.package}
            {r.package_value_sar ? ` (${amount(r.package_value_sar, lang)})` : ''}
          </p>
        )}
        {(fit.reasons || []).length > 0 && (
          <p className="text-[11px] text-sage-700 mt-1.5" dir="auto">{t.fits}{fit.reasons.join(' · ')}</p>
        )}
        {(fit.flags || []).map(f => <p key={f} className="text-[11px] text-amber-800 mt-0.5" dir="auto">{t.askFirst}{f}</p>)}
        {r.suggested_action && <p className="text-xs text-text mt-1.5" dir="auto"><span className="font-semibold">{t.next}</span>{r.suggested_action}</p>}
        {r.contact && <p className="text-[11px] text-text-secondary mt-1" dir="auto"><span className="font-semibold">{t.contact}</span>{r.contact}</p>}
        <p className="text-[10px] text-text-tertiary mt-1.5">
          {r.first_seen_at && t.found(dateLabel(r.first_seen_at, lang))}
          {r.times_seen > 1 && t.seenWeeks(r.times_seen)}
          {r.last_change && t.changed(r.last_change)}
          {r.source_url && <> · <a href={r.source_url} target="_blank" rel="noreferrer" className="underline">{t.source}</a></>}
        </p>
      </div>
      <div className="lg:col-span-4 space-y-2">
        <PillSelect value={r.status || 'new'} onChange={e => onChange(r.id, { status: e.target.value })}>
          {OPPORTUNITY_STATUSES.map(s => <option key={s} value={s}>{t.oppStatus[s] || s}</option>)}
        </PillSelect>
        <Textarea rows={2} placeholder={t.whoHasIt} dir="auto" value={note} onChange={e => setNote(e.target.value)}
          onBlur={() => note !== (r.owner_note || '') && onChange(r.id, { owner_note: note })} />
      </div>
    </li>
  )
}

// ─── Events ────────────────────────────────────────────────────────────────

function EventsTab({ rows = [], error, onChange }) {
  const { t, lang } = useT(SW)
  if (error) return <p className="px-4 py-10 text-sm text-red-600 text-center">{t.eventsFailed(error)}</p>
  if (!rows.length) return <p className="px-4 py-10 text-sm text-text-tertiary text-center">{t.noEvents}</p>
  return (
    <ul className="divide-y divide-border border-t border-border mt-2">
      {rows.map(e => (
        <li key={e.id} className="px-4 py-3 grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-2">
            <p className="text-xs font-semibold text-text tabular-nums">{e.start_date ? dateLabel(e.start_date, lang) : t.dateToConfirm}</p>
            <p className="text-[11px] text-text-tertiary">{t.when(e.days)}</p>
          </div>
          <div className="lg:col-span-7 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {e.relevance === 'high' && <Tag tone="bg-amber-50 text-amber-800 border-amber-200">{t.high}</Tag>}
              <p className="text-sm font-semibold text-text" dir="auto">{e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="hover:underline">{e.name}</a> : e.name}</p>
            </div>
            <p className="text-[11px] text-text-tertiary mt-0.5">{[e.venue, e.city, e.organizer].filter(Boolean).join(' · ')}</p>
            {e.exhibitor_deadline && (
              <p className={`text-[11px] mt-1 ${e.deadlineDays !== null && e.deadlineDays >= 0 && e.deadlineDays <= 30 ? 'text-red-600 font-semibold' : 'text-text-secondary'}`}>
                {t.deadline(dateLabel(e.exhibitor_deadline, lang), t.when(e.deadlineDays))}
              </p>
            )}
            {(e.competitors_exhibiting || []).length > 0 && <p className="text-[11px] text-text-secondary mt-0.5">{t.competitorsThere(e.competitors_exhibiting.join(', '))}</p>}
            {e.recommendation && <p className="text-xs text-text mt-1" dir="auto">{e.recommendation}</p>}
          </div>
          <div className="lg:col-span-3">
            <PillSelect value={e.decision || 'undecided'} onChange={ev => onChange(e.id, ev.target.value)}>
              {EVENT_DECISIONS.map(d => <option key={d} value={d}>{t.decisions[d] || d}</option>)}
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
        <Textarea label="What we sell" rows={4} value={form.offers} onChange={set('offers')}
          hint="One per line: name | one-off or recurring | note. Recurring means a yearly contract, e.g. maintenance. Prospects pick one of these." />
        <Textarea label="When we are hired" rows={2} value={form.hire_stage} onChange={set('hire_stage')}
          hint="When in a project's life buyers hire us, e.g. at design stage, or late, at external works. Research looks for projects at this stage." />
        <Textarea label="Segments" rows={8} value={form.segments} onChange={set('segments')}
          hint="One per line: name | core or broader | weight 1–3 | words that identify it, comma separated | note | share % (optional, e.g. 6-8)" />
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input label="Our share of a project (%)" value={form.share} onChange={set('share')}
            hint="e.g. 3-5. A project's value is turned into our package value with this. Empty: values are taken as package sizes." />
          <div className="md:col-span-2">
            <Input label="Note on share" value={form.share_note} onChange={set('share_note')}
              hint="A segment can have its own share: add | 6-8 at the end of its line above." />
          </div>
        </div>
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
          icp.share && `Our share of a project: ${icp.share.min === icp.share.max ? icp.share.min : `${icp.share.min}–${icp.share.max}`}%`,
          icp.share?.note,
          icp.regions.length && `Region: ${icp.regions.join(', ')}`,
        ].filter(Boolean)} />
        <IcpList title="What we sell, and when we are hired" items={[
          ...icp.offers.map(o => `${o.label}${o.kind === 'recurring' ? ' (yearly)' : ''}${o.note ? ` — ${o.note}` : ''}`),
          icp.hire_stage && `Hired: ${icp.hire_stage}`,
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
