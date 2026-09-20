import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchAccountAnalytics } from '../../lib/zernioConnect'
import { accountSummary } from '../../lib/dashboardOverview'

// ─── Every connected account's numbers, at once ────────────────────────────
//
// /api/zernio/analytics answers for ONE account, because that is the only
// shape in which it can check the account belongs to this workspace before it
// reads anything. So a dashboard that spans platforms fans out here.
//
// ── WHY EVERY ACCOUNT IS FETCHED, NOT JUST THE SELECTED ONES ──
//
// The platform picker filters what is DRAWN, not what is loaded. Fetching on
// selection would put a network round trip behind every checkbox — and worse,
// unticking Instagram and ticking it again would re-ask Zernio for numbers
// that cannot have changed in the two seconds since. The responses are held
// and the combining is a memo, so the picker is instant and free.
//
// ── ONE SLOW ACCOUNT MUST NOT HOLD UP THE REST ──
//
// Promise.all would make the whole card wait on the slowest platform, and a
// LinkedIn page that times out would blank Instagram's numbers too. Each
// response lands as it arrives, and an account that failed is KEPT as a
// failure rather than dropped — combineOverview surfaces it by name, because
// an account silently missing from a total reads as a platform that had a
// quiet month.

export function useDashboardAnalytics({ accounts = [], range = { days: 30 }, reloadKey = 0 } = {}) {
  const { activeWorkspaceId } = useAuth()
  const [responses, setResponses] = useState({})
  const [pending, setPending] = useState(0)

  // The accounts to ask about, as one comparable string. Without this the
  // effect re-runs on every render: useConnectedAccounts answers from memory
  // first and then replaces the list with Zernio's, and a new array holding
  // the same accounts would restart every request.
  const key = useMemo(
    () => accounts.map(a => `${a.zernio_account_id}:${a.platform}:${a.account_type || ''}`).sort().join('|'),
    [accounts],
  )

  // Guards a slow answer for a previous account list landing on top of a newer
  // one — the same race /analytics has when you click through platforms fast.
  const seq = useRef(0)

  // The window as one comparable string. `range` is an object literal at the
  // call site, so a new one arrives on every render of the page; depending on
  // the object itself would refetch every account on every keystroke anywhere
  // on the dashboard.
  const rangeKey = useMemo(
    () => (range?.from && range?.to ? `${range.from}..${range.to}` : `d${range?.days ?? 30}`),
    [range?.from, range?.to, range?.days],
  )

  const load = useCallback(() => {
    if (!activeWorkspaceId || !accounts.length) {
      setResponses({})
      setPending(0)
      return
    }
    const run = ++seq.current
    setResponses({})
    setPending(accounts.length)

    for (const a of accounts) {
      fetchAccountAnalytics(activeWorkspaceId, a.zernio_account_id, range, {
        platform: a.platform, accountType: a.account_type || null,
      }).then(res => {
        if (run !== seq.current) return
        setResponses(prev => ({ ...prev, [a.zernio_account_id]: res }))
        setPending(n => n - 1)
      })
    }
    // `accounts` is covered by `key` — depending on the array itself would
    // restart every request whenever the accounts store hands back an equal
    // list in a new array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, key, rangeKey])

  // Deferred a tick, like every other first fetch in this app: load() writes
  // state before its first await, and doing that in an effect body is a
  // cascading render React 19 flags.
  useEffect(() => { queueMicrotask(load) }, [load, reloadKey])

  const summaries = useMemo(
    () => accounts
      .filter(a => responses[a.zernio_account_id])
      .map(a => accountSummary(a, responses[a.zernio_account_id])),
    [accounts, responses],
  )

  // The window every account was actually asked about — NOT the one requested.
  // Taken from a response rather than recomputed here, so the chart's x-axis
  // is the range Zernio measured rather than one this browser's clock
  // inferred, and so a preset resolved on the server's clock stays honest.
  const measured = useMemo(() => {
    const first = Object.values(responses).find(r => r?.fromDate)
    return { fromDate: first?.fromDate || '', toDate: first?.toDate || '' }
  }, [responses])

  return {
    summaries,
    range: measured,
    // "Nothing has answered yet", not "a request is running". A partial answer
    // is worth drawing — the alternative is holding an empty page until the
    // slowest platform replies.
    loading: !!accounts.length && summaries.length === 0 && pending > 0,
    settling: pending > 0,
    reload: load,
  }
}
