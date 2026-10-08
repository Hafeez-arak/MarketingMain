import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { PageHeader, Button, Spinner, Skeleton } from '../../components/ui/index'
import { Notice, SubTabs } from '../email/parts'
import { leadsApi } from '../../lib/leads/client'
import { normaliseIcp, buyerLabel, formatAmount } from '../../lib/sales/icp'

// ─── Admin → Agent Brief ───────────────────────────────────────────────────
// What the research agent will actually be asked on its next run, lens by
// lens, word for word — built on the server by the same code a run uses
// (previewLenses in api/agent/_investigate.js), with no model call. Plus the
// two ICPs it works from: the marketing one in the Brand Brain, and the sales
// one that scores targets.
//
// Admin only (the owner's decision, 2026-10-08): the prompts carry the
// tracked leads, the competitor watchlist and the sales ICP.

const TABS = [
  { key: 'sales', label: 'Sales search' },
  { key: 'lenses', label: 'All research questions' },
  { key: 'marketing', label: 'Marketing ICP' },
  { key: 'context', label: 'What the agent knows about us' },
]

export default function AgentBrief() {
  const { isAccessAdmin, activeWorkspaceId } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'sales'
  const setTab = key => setParams(prev => { const n = new URLSearchParams(prev); n.set('tab', key); return n }, { replace: true })
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loadedFor, setLoadedFor] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const reload = useCallback(async () => {
    if (!activeWorkspaceId) return
    const ws = activeWorkspaceId
    setRefreshing(true)
    const r = await leadsApi('lens_preview', ws)
    if (r.error) { setError(r.error); setData(null) } else { setError(''); setData(r) }
    setLoadedFor(ws)
    setRefreshing(false)
  }, [activeWorkspaceId])

  useEffect(() => { if (isAccessAdmin) queueMicrotask(reload) }, [reload, isAccessAdmin])

  if (!isAccessAdmin) return <Navigate to="/" replace />
  const loading = loadedFor !== activeWorkspaceId

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Agent Brief" subtitle="Exactly what the research agent searches for on its next run, word for word, and the customer profiles it works from. Admin only.">
        <Button variant="secondary" size="sm" onClick={reload} disabled={refreshing || !activeWorkspaceId}>
          {refreshing ? <Spinner size="sm" /> : null}
          Refresh
        </Button>
      </PageHeader>

      {error && <Notice tone="red" title="Could not build the brief">{error}</Notice>}

      <div className="bg-white border border-border min-w-0">
        <div className="px-4 pt-3"><SubTabs items={TABS} value={tab} onChange={setTab} /></div>
        {loading ? (
          <div className="p-4 space-y-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : !data ? (
          <p className="px-4 py-10 text-sm text-text-tertiary text-center">Nothing to show.</p>
        ) : tab === 'sales' ? (
          <SalesTab data={data} />
        ) : tab === 'lenses' ? (
          <LensesTab data={data} />
        ) : tab === 'marketing' ? (
          <MarketingTab icp={data.marketingIcp} />
        ) : (
          <div className="p-4">
            <p className="text-[11px] text-text-tertiary mb-2">Every searching lens receives this block first, then its own question. It is built from the Brand Brain.</p>
            <Prompt text={data.brandContext} open />
          </div>
        )}
      </div>
    </div>
  )
}

function Prompt({ text, open = false }) {
  const [show, setShow] = useState(open)
  if (!text) return null
  return (
    <div>
      <button type="button" onClick={() => setShow(s => !s)} className="text-[11px] font-semibold text-amber-800 hover:underline">
        {show ? 'Hide the exact prompt' : `Show the exact prompt (${Math.round(text.length / 100) / 10}k characters)`}
      </button>
      {show && (
        <pre className="mt-2 p-3 bg-surface-subtle border border-border text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words max-h-[600px] overflow-auto" dir="auto">{text}</pre>
      )}
    </div>
  )
}

function LensCard({ l }) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-semibold text-text">{l.label}</p>
        <span className="text-[10px] font-semibold border border-border px-1.5 py-0.5 text-text-secondary">{l.cadence}</span>
        <span className="text-[10px] font-semibold border border-border px-1.5 py-0.5 text-text-secondary">
          {l.searches ? `${l.searches} web searches` : 'no web search'}
        </span>
        {!l.runs && <span className="text-[10px] font-semibold border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">not running</span>}
      </div>
      <p className="text-xs text-text-secondary mt-1">{l.question}</p>
      {l.why_not && <p className="text-[11px] text-amber-800 mt-1">{l.why_not}</p>}
      {l.computed && <p className="text-[11px] text-text-tertiary mt-1">{l.computed}</p>}
      {l.error && <p className="text-[11px] text-red-600 mt-1">Could not build this prompt: {l.error}</p>}
      <div className="mt-1.5"><Prompt text={l.prompt} /></div>
    </li>
  )
}

function SalesTab({ data }) {
  const targets = data.lenses.find(l => l.key === 'targets')
  const openings = data.lenses.find(l => l.key === 'openings')
  const events = data.lenses.find(l => l.key === 'events')
  const icp = normaliseIcp(data.salesIcp)
  const segs = track => icp.segments.filter(s => s.track === track).map(s => s.label)
  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-text-secondary leading-relaxed">
        Three questions feed sales each week. <b>Sales targets</b> hunts projects and companies that fit our ideal customer;{' '}
        <b>Projects &amp; openings</b> hunts projects about to need what we sell; <b>Events &amp; expos</b> finds where buyers gather.
        Everything they find lands on <Link to="/targets" className="underline">Sales → Targets</Link>, scored against the ICP below.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border border border-border">
        <Box title={`Core · ${icp.mix.core}% of the targets search`} items={segs('core')} />
        <Box title={`Broader · ${icp.mix.broader}% of the targets search`} items={segs('broader')} />
        <Box title="Buyers and size" items={[
          ...icp.buyers.map(b => `${b.weight > 0 ? '✓' : '⚠'} ${buyerLabel(b.key)}`),
          icp.size.sweet_max && `Best under ${formatAmount(icp.size.sweet_max)}`,
          icp.size.ok_max && `Fine up to ${formatAmount(icp.size.ok_max)}`,
        ].filter(Boolean)} />
      </div>
      <p className="text-[11px] text-text-tertiary">Edit the ICP on <Link to="/targets?tab=icp" className="underline">Sales → Targets → Ideal customer</Link>; the next run searches with the new version.</p>
      <ul className="divide-y divide-border border border-border">
        {[targets, openings, events].filter(Boolean).map(l => <LensCard key={l.key} l={l} />)}
      </ul>
    </div>
  )
}

function LensesTab({ data }) {
  const weekly = data.lenses.filter(l => l.cadence === 'weekly')
  const total = weekly.filter(l => l.runs).reduce((n, l) => n + l.searches, 0)
  return (
    <div>
      <p className="px-4 py-2 text-[11px] text-text-tertiary">
        {weekly.filter(l => l.runs).length} questions every week, {total} web searches in all, plus the monthly ones. Searched in English and {data.language || 'English'}.
        {data.agenda?.length ? ` Standing questions from the team: ${data.agenda.map(a => a.subject).join('; ')}.` : ''}
      </p>
      <ul className="divide-y divide-border border-t border-border">
        {data.lenses.map(l => <LensCard key={l.key} l={l} />)}
      </ul>
    </div>
  )
}

function MarketingTab({ icp = {} }) {
  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-text-secondary">
        Every caption, plan and research run reads these from the Brand Brain. Edit them in{' '}
        <Link to="/brand-brain" className="underline">Brand Brain → Audience</Link>.
      </p>
      <Field title="Ideal customer (ICP)" text={icp.icp_summary} />
      <Field title="Client problems we solve, and what we say about each" text={icp.client_pains} />
      <Field title="Target personas" text={icp.personas} />
    </div>
  )
}

function Field({ title, text }) {
  return (
    <div className="border border-border p-3">
      <p className="text-xs font-semibold text-text mb-1.5">{title}</p>
      {text ? <p className="text-xs text-text-secondary whitespace-pre-line leading-relaxed" dir="auto">{text}</p>
        : <p className="text-xs text-text-tertiary">Not written yet.</p>}
    </div>
  )
}

function Box({ title, items = [] }) {
  return (
    <div className="bg-white p-3">
      <p className="text-xs font-semibold text-text mb-1.5">{title}</p>
      {items.length ? <ul className="space-y-0.5 text-xs text-text-secondary">{items.map(i => <li key={i}>{i}</li>)}</ul>
        : <p className="text-xs text-text-tertiary">None yet.</p>}
    </div>
  )
}
