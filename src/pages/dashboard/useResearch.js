import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchRuns } from '../../lib/agentRun'
import { latestReport } from '../../lib/dashboardPriority'

// ─── The last research run, read but never started ─────────────────────────
//
// A run costs real money (measured around $1, against a monthly cap held in
// the database). So this READS the newest finished run's report and nothing
// else — no button here can spend anything. Starting a run stays on
// /insights, where the cost and the live progress are both visible.
//
// Five runs rather than one: the newest row may be a run that is still going
// or that failed, and either carries no report. latestReport walks down to the
// newest one that actually produced something, so pressing the button on the
// Research page does not blank the dashboard while it works.

const RUNS_TO_SCAN = 5

export function useResearch() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(async () => {
      if (cancelled) return
      setLoading(true)
      if (!activeWorkspaceId || !accessToken) {
        setRuns([])
        setLoading(false)
        return
      }
      const rows = await fetchRuns(activeWorkspaceId, accessToken, RUNS_TO_SCAN)
      if (cancelled) return
      setRuns(rows || [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken])

  const latest = useMemo(() => latestReport(runs), [runs])

  return {
    loading,
    report: latest?.report || null,
    runAt: latest?.runAt || '',
    // Distinct from "no report": a workspace that has never run research at
    // all should be told that, not shown an empty list as though this week
    // were quiet.
    everRan: runs.length > 0,
  }
}
