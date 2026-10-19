import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { Card, Empty, Skeleton } from '../../components/ui/index'
import { fetchRuns, fetchLensResults } from '../../lib/agentRun'
import { isLive } from '../../lib/agent/progress'
import { ResearchTab } from '../insights/ResearchTab'
import SalesShell from './SalesShell'

// ─── The sales team's Research page (2026-10-19) ─────────────────────────
// The weekly research the marketing team reads, in its Sales view: top
// priorities, leads and tenders, competitor moves, events, smart poles. Read
// only: nothing here writes, starts a run or calls a model, so opening it
// costs nothing. It is the same report, not one rewritten for sales.
//
// The database lets a sales seat read these tables and nothing more
// (20261029_sales_read_research.sql).

export default function SalesResearch() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [runs, setRuns] = useState([])
  const [lensRows, setLensRows] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  // Which company the runs on screen belong to: a skeleton until the first
  // answer, never "no research yet" while it is still being asked.
  const [loadedFor, setLoadedFor] = useState(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const now = useMemo(() => new Date(), [])

  useEffect(() => {
    if (!activeWorkspaceId) return undefined
    let alive = true
    fetchRuns(activeWorkspaceId, accessToken, 12, { throwOnError: true })
      .then(async (r) => {
        const list = r || []
        const target = list.find((x) => x.id === selectedId) || list[0]
        const lens = target && isLive(target) ? await fetchLensResults(activeWorkspaceId, target.id, accessToken) : []
        if (!alive) return
        setRuns(list); setLensRows(lens); setError('')
        setLoadedFor(activeWorkspaceId)
      })
      .catch((err) => {
        if (!alive) return
        setError(String(err?.message || err))
        setLoadedFor(activeWorkspaceId)
      })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken, selectedId, tick])

  const selected = useMemo(() => runs.find((r) => r.id === selectedId) || runs[0] || null, [runs, selectedId])
  // A run in progress fills in as it goes, as on the marketing page.
  const watching = isLive(selected)
  useEffect(() => {
    if (!watching) return undefined
    const t = setInterval(() => setTick((n) => n + 1), 8_000)
    return () => clearInterval(t)
  }, [watching])

  const loading = loadedFor !== activeWorkspaceId

  return (
    <SalesShell>
      <div className="space-y-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text tracking-tight">Research</h1>
          <p className="text-xs text-text-secondary mt-0.5">
            What this week&apos;s market research found for sales: openings and tenders, what competitors are doing, and events coming up. Read only.
          </p>
        </div>

        {loading ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : error ? (
          <Card>
            <Empty title="The research could not be loaded" description="This is a connection problem, not missing research. Please refresh the page to try again." />
          </Card>
        ) : (
          <ResearchTab
            readOnly
            run={selected}
            runs={runs}
            lensRows={lensRows}
            selectedId={selectedId}
            onSelectRun={setSelectedId}
            now={now}
          />
        )}
      </div>
    </SalesShell>
  )
}
