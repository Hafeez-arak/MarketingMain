import { useEffect, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchRuns } from '../../lib/agentRun'

// ─── The last research run, read but never started ─────────────────────────
//
// A run costs real money (measured around $1, against a monthly cap held in
// the database). So this READS the newest finished run's report and nothing
// else — no button here can spend anything. Starting a run stays on
// /insights, where the cost and the live progress are both visible.
//
// Five runs rather than one, because the newest is often not the one to show.
// It may still be going, it may have failed, or — the case that actually bit —
// it may have spent the month's budget and stopped before it analysed
// anything, which looks complete in every column. summariseRuns walks down to
// the newest run that genuinely thought; this hook just fetches.

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

  // The raw list. What counts as a usable run is a question with a wrong
  // answer that looks right, so it lives in src/lib/researchSummary.js where
  // it is tested, not in a hook.
  return { runs, loading }
}
