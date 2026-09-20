import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { Spinner } from '../ui/index'
import { RangePicker } from './RangePicker'
import { useAuth } from '../../store/auth'
import { fetchFollowerHistory } from '../../lib/zernioConnect'
import { rangeLabel, resolveRange } from '../../lib/dateRange'
import { followerRowsFrom, followerSpanLabel } from '../../lib/followerSeries'

// ─── Follower history, on its own clock ────────────────────────────────────
//
// "How did the audience grow" is a question about a longer span than "how did
// last week's posts do", and until this card had its own picker the two had
// to share one. Widening the page to see three months of followers also
// widened every post number on it.
//
// ── HOW THE TWO PICKERS RELATE ──
//
// The card FOLLOWS the page's range until somebody touches its own picker,
// and goes back to following it the moment the page's range changes again.
// So:
//
//   · change the range at the top      → this card follows along
//   · change the range on this card    → only this card moves
//   · change the top one again         → this card falls back in step
//
// That last rule is the one worth stating, because the alternative — a local
// choice that outlives every later change above it — is how a card ends up
// quietly showing March under a page that says September. The override is
// deliberately shallow: it survives until the next thing that contradicts it.
//
// `following` is therefore not a copy of the page's range; it is the ABSENCE
// of a local one. Copying would make "has the user overridden this?"
// impossible to answer the moment the two happened to be equal.

const axisTick = { fontSize: 11, fill: '#7a848c' }

const shortDay = iso => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function FollowerHistoryCard({ pageRange, accountId, initial = null, children }) {
  const { activeWorkspaceId } = useAuth()

  // null means "following the page". See the note above: this is an absence,
  // not a copy.
  const [override, setOverride] = useState(null)
  const range = override || pageRange

  const pageKey = pageRange?.from && pageRange?.to
    ? `${pageRange.from}..${pageRange.to}`
    : `d${pageRange?.days ?? 30}`

  // Back in step whenever the page's range changes. Keyed on the VALUE rather
  // than the object, so a re-render that rebuilds an equal `{days: 30}` does
  // not silently discard a local choice.
  const firstPageKey = useRef(pageKey)
  useEffect(() => {
    if (firstPageKey.current === pageKey) return
    firstPageKey.current = pageKey
    setOverride(null)
  }, [pageKey])

  // The page already fetched the following-the-page window, so that one is
  // drawn from what arrived with the page rather than asked for twice.
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!override || !activeWorkspaceId || !accountId) return
    const n = ++seq.current
    setLoading(true)
    setError('')
    const res = await fetchFollowerHistory(activeWorkspaceId, accountId, override)
    if (n !== seq.current) return
    if (res?.error) setError(res.error)
    setPayload(res?.error ? null : res)
    setLoading(false)
  }, [override, activeWorkspaceId, accountId])

  useEffect(() => { queueMicrotask(load) }, [load])

  const rows = useMemo(() => {
    const source = override ? payload : initial
    return followerRowsFrom(source, accountId).map(r => ({ ...r, label: shortDay(r.date) }))
  }, [override, payload, initial, accountId])

  const measured = useMemo(() => followerSpanLabel(rows), [rows])

  const asked = resolveRange(range)

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <RangePicker value={range} onChange={setOverride} />
        {loading && <Spinner size="sm" />}
        {/* Said only while it is true, so the usual case carries no chrome. */}
        {override && (
          <button onClick={() => setOverride(null)}
            className="text-[11px] text-text-tertiary hover:text-text underline">
            Back in step with the page
          </button>
        )}
      </div>

      {error ? (
        <div className="h-[220px] flex items-center justify-center text-center px-6">
          <p className="text-xs text-text-tertiary">Followers did not load: {error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="h-[220px] flex flex-col items-center justify-center text-center gap-2 px-6">
          <p className="text-sm font-medium text-text">Nothing recorded in this window</p>
          <p className="text-xs text-text-tertiary">
            Zernio counts followers once a day and keeps no history from before an account was
            connected, so {rangeLabel(range).toLowerCase()} can be emptier than the window suggests.
            Reconnecting an account starts the series again.
          </p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e5e6" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: '#e0e5e6' }}
                minTickGap={24} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, border: '1px solid #e7e5e4', borderRadius: 0 }} />
              {/* Dots below a fortnight: a line through one point draws nothing. */}
              <Line type="monotone" dataKey="followers" stroke="#657b81" strokeWidth={2}
                dot={rows.length <= 14} />
            </LineChart>
          </ResponsiveContainer>
          {/* What the series covers, which is not what was asked for — the
              gap between the two is the whole point of saying both. */}
          <p className="text-[11px] text-text-tertiary mt-2">
            {measured}
            {asked.days > rows.length ? ` · asked for ${rangeLabel(range).toLowerCase()}` : ''}
          </p>
        </>
      )}
      {children}
    </>
  )
}
