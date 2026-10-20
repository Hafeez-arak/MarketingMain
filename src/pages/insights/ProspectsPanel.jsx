import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, PillSelect, Skeleton, Spinner } from '../../components/ui/index'
import {
  fetchProspects, fetchProspectSetup, findProspects, setProspectStatus, addProspectToOutreach, searchState,
} from '../../lib/prospects'
import { segmentSuggestions, PROSPECT_STATUSES, DEFAULT_COUNT } from '../../lib/agent/prospects'
import { normaliseIcp } from '../../lib/sales/icp'

// ─── Research → Prospects ──────────────────────────────────────────────────
// Companies we could contract with, found when someone asks. Not part of the
// weekly report: a person names a kind of company ("hotels", "restaurant
// chains with drive-throughs"), one search runs, and every company it finds
// waits here for a person to put it into outreach, call it, or reject it.
// A rejected company is never proposed again.

const domainOf = url => String(url || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0]
const linkOf = url => (/^https?:\/\//i.test(url) ? url : `https://${url}`)
const fmtDate = d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const money = n => (n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? 'under $0.01' : '')

const FILTERS = ['new', 'added', 'contacted', 'rejected']

function Line({ label, children }) {
  if (!children) return null
  return (
    <p className="text-sm text-text-secondary leading-relaxed" dir="auto">
      <span className="font-semibold text-text">{label}: </span>{children}
    </p>
  )
}

function ProspectCard({ p, offerLabel, busy, onStatus, onOutreach }) {
  const low = p.confidence != null && p.confidence < 0.5
  return (
    <li className="bg-white border border-border p-4 space-y-2 min-w-0">
      <div className="space-y-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-text" dir="auto">
            {p.name}
            {low && <span className="ml-2 align-middle px-1.5 py-0.5 border text-[11px] font-semibold bg-amber-50 text-amber-800 border-amber-200">Not sure it fits</span>}
          </p>
          <p className="text-xs text-text-tertiary mt-0.5" dir="auto">
            {[p.segment, p.city, p.created_at && `found ${fmtDate(p.created_at)}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" data-print-hide>
          {p.status === 'new' && (
            <>
              <Button size="sm" onClick={() => onOutreach(p)} disabled={busy || !p.email}
                title={p.email ? 'Add to Email → Outreach' : 'No published email: call them instead'}>
                Add to outreach
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onStatus(p, 'contacted')} disabled={busy}>Contacted</Button>
              <Button size="sm" variant="secondary" onClick={() => onStatus(p, 'rejected')} disabled={busy}>Reject</Button>
            </>
          )}
          {p.status === 'added' && (
            <Button size="sm" variant="secondary" onClick={() => onStatus(p, 'contacted')} disabled={busy}>Mark contacted</Button>
          )}
          {p.status === 'rejected' && (
            <Button size="sm" variant="secondary" onClick={() => onStatus(p, 'new')} disabled={busy}>Bring back</Button>
          )}
        </div>
      </div>

      <Line label="What they run">{p.sites}</Line>
      <Line label="Why they fit">{p.fit}</Line>
      <Line label="Offer first">{[offerLabel(p.offer), p.pitch].filter(Boolean).join(' — ')}</Line>
      <Line label="Our project to name">{p.proof}</Line>
      <Line label="Ask for">{p.ask_for}</Line>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm pt-1 min-w-0 [&_a]:break-all">
        {p.website && <a href={linkOf(p.website)} target="_blank" rel="noopener noreferrer" className="text-text underline underline-offset-2">{domainOf(p.website)}</a>}
        {p.email && <a href={`mailto:${p.email}`} className="text-text underline underline-offset-2">{p.email}</a>}
        {p.phone && <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} className="text-text underline underline-offset-2" dir="ltr">{p.phone}</a>}
        {p.linkedin && <a href={p.linkedin} target="_blank" rel="noopener noreferrer" className="text-text underline underline-offset-2">LinkedIn</a>}
        {!p.email && !p.phone && <span className="text-text-tertiary">No published email or phone found.</span>}
      </div>
      <p className="text-xs text-text-tertiary">
        {p.source_url && <>Found on <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{domainOf(p.source_url)}</a></>}
        {p.contact_source && <> · contact from <a href={p.contact_source} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{domainOf(p.contact_source)}</a></>}
        {(p.email || p.phone) && ' · check before you send'}
      </p>
    </li>
  )
}

export function ProspectsPanel({ workspaceId, accessToken, onCount }) {
  const [data, setData] = useState({ prospects: [], searches: [] })
  const [setup, setSetup] = useState({ targetPersonas: '', icp: null })
  // Which company the lists on screen belong to, so switching company shows a
  // skeleton rather than the last company's prospects.
  const [loadedFor, setLoadedFor] = useState(null)
  const loaded = loadedFor === workspaceId
  const [loadError, setLoadError] = useState('')
  const [segment, setSegment] = useState('')
  const [area, setArea] = useState('')
  const [count, setCount] = useState(String(DEFAULT_COUNT))
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [filter, setFilter] = useState('new')
  const [busyId, setBusyId] = useState(null)
  const [note, setNote] = useState('')

  // A slow answer for the company someone has just switched away from must
  // never land on the new one's screen.
  const current = useRef(workspaceId)
  useEffect(() => { current.current = workspaceId }, [workspaceId])

  const load = useCallback(() => {
    const ws = workspaceId
    if (!ws) return Promise.resolve()
    const mine = () => current.current === ws
    return Promise.all([fetchProspects(ws), fetchProspectSetup(ws)])
      .then(([d, st]) => { if (mine()) { setData(d); setSetup(st); setLoadError('') } })
      .catch(err => { if (mine()) setLoadError(String(err?.message || err)) })
      .finally(() => { if (mine()) setLoadedFor(ws) })
  }, [workspaceId])

  useEffect(() => { load() }, [load])

  const toReview = data.prospects.filter(p => p.status === 'new').length
  useEffect(() => { onCount?.(loaded ? toReview : null) }, [onCount, loaded, toReview])

  const suggestions = useMemo(() => segmentSuggestions(setup), [setup])
  const offers = useMemo(() => normaliseIcp(setup.icp || {}).offers, [setup.icp])
  const offerLabel = useCallback(key => offers.find(o => o.key === key)?.label || '', [offers])
  const last = searchState(data.searches[0])
  const shown = data.prospects.filter(p => p.status === filter)
  const counts = Object.fromEntries(FILTERS.map(f => [f, data.prospects.filter(p => p.status === f).length]))

  async function find() {
    if (!segment.trim() || running) return
    setRunning(true)
    setResult(null)
    const r = await findProspects({ workspaceId, accessToken, segment: segment.trim(), area: area.trim(), count: Number(count) })
    setResult(r)
    setRunning(false)
    setFilter('new')
    await load()
  }

  async function changeStatus(p, status) {
    setBusyId(p.id)
    setNote('')
    try {
      const row = await setProspectStatus(workspaceId, p.id, status)
      setData(d => ({ ...d, prospects: d.prospects.map(x => (x.id === p.id ? { ...x, ...row } : x)) }))
    } catch (err) {
      setNote(`${p.name} could not be updated: ${err.message}`)
    }
    setBusyId(null)
  }

  async function toOutreach(p) {
    setBusyId(p.id)
    setNote('')
    try {
      const row = await addProspectToOutreach(workspaceId, p)
      setData(d => ({ ...d, prospects: d.prospects.map(x => (x.id === p.id ? { ...x, ...row } : x)) }))
      setNote(`${p.name} is in Email → Outreach, in the group for this kind of company.`)
    } catch (err) {
      setNote(`${p.name} could not be added: ${err.message}`)
    }
    setBusyId(null)
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-border p-4 space-y-3" data-print-hide>
        <div>
          <p className="text-[15px] font-semibold text-text">Find companies to contract with</p>
          <p className="text-sm text-text-secondary mt-0.5 leading-relaxed max-w-[72ch]">
            Name a kind of company. The search finds real ones, why each would buy from us, what to offer first,
            and their public contacts. It uses AI and web search, counts toward this company&rsquo;s monthly AI limit,
            and takes one to three minutes.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_110px_auto] items-end">
          <Input label="Kind of company" value={segment} onChange={e => setSegment(e.target.value)}
            placeholder="e.g. hotels, restaurant chains, hospitals, owners' associations" disabled={running}
            onKeyDown={e => { if (e.key === 'Enter') find() }} />
          <Input label="Where" value={area} onChange={e => setArea(e.target.value)} placeholder="e.g. Riyadh" disabled={running} />
          <div>
            <label className="block eyebrow mb-1.5">How many</label>
            <PillSelect value={count} onChange={e => setCount(e.target.value)} className="w-full">
              {['5', '10', '15'].map(n => <option key={n} value={n}>{n}</option>)}
            </PillSelect>
          </div>
          <Button onClick={find} disabled={running || !segment.trim()}>
            {running ? <><Spinner size="sm" /> Searching…</> : 'Find'}
          </Button>
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-text-tertiary self-center mr-1">From who we sell to:</span>
            {suggestions.map(s => (
              <button key={s} type="button" disabled={running} onClick={() => setSegment(s)} dir="auto"
                className={`border px-2 py-1 text-xs text-left transition-colors ${segment === s ? 'border-amber-600 bg-amber-50 text-text' : 'border-border bg-white text-text-secondary hover:text-text hover:border-stone-400'}`}>
                {s}
              </button>
            ))}
          </div>
        )}
        {running && <p className="text-sm text-text-secondary">Searching. This takes one to three minutes; you can keep reading the page.</p>}
        {result && (
          <p className={`text-sm leading-relaxed ${result.ok ? 'text-text' : 'text-red-700'}`}>
            {result.ok ? result.message : `The search did not finish: ${result.error}`}
            {result.cost > 0 && <span className="text-text-tertiary"> Cost {money(result.cost)}.</span>}
            {result.ok && result.note && <span className="block text-text-secondary mt-1" dir="auto">{result.note}</span>}
          </p>
        )}
        {!result && last && !running && (
          <p className="text-xs text-text-tertiary">
            Last search: {last.segment}{last.area ? ` in ${last.area}` : ''} · {fmtDate(last.started_at)} ·{' '}
            {last.status === 'complete' ? `${last.added} new` : last.status === 'running' ? 'still running' : `did not finish${last.error ? ` (${last.error})` : ''}`}
          </p>
        )}
      </div>

      {note && <p className="text-sm text-text-secondary">{note}</p>}

      {!loaded ? (
        <div className="space-y-3" aria-busy="true"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>
      ) : loadError ? (
        <p className="text-sm text-red-700">Prospects could not be loaded: {loadError}</p>
      ) : data.prospects.length === 0 ? (
        <p className="text-sm text-text-secondary">No prospects yet. Pick a kind of company above and press Find.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Prospect status">
            {FILTERS.map(f => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                className={`border px-2.5 py-1 text-sm transition-colors ${filter === f ? 'border-amber-700 bg-white text-text font-semibold' : 'border-border bg-white text-text-secondary hover:text-text'}`}>
                {PROSPECT_STATUSES[f]} <span className="tabular-nums text-text-tertiary">{counts[f]}</span>
              </button>
            ))}
          </div>
          {shown.length ? (
            <ul className="grid gap-3 lg:grid-cols-2">
              {shown.map(p => (
                <ProspectCard key={p.id} p={p} offerLabel={offerLabel} busy={busyId === p.id}
                  onStatus={changeStatus} onOutreach={toOutreach} />
              ))}
            </ul>
          ) : <p className="text-sm text-text-secondary">Nothing here.</p>}
        </div>
      )}
    </div>
  )
}
