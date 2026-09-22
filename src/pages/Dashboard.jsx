import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Button, PageHeader, Spinner } from '../components/ui/index'
import { useConnectedAccounts, publishConnectedAccounts } from '../lib/useConnectedAccounts'
import { syncAccounts, describeSync } from '../lib/zernioConnect'
import { useAuth } from '../store/auth'
import { LIVE_PLATFORMS } from '../lib/utils'
import { combineOverview } from '../lib/dashboardOverview'
import { useDashboardAnalytics } from './dashboard/useDashboardAnalytics'
import { useWebsiteSearch } from './dashboard/useWebsiteSearch'
import { useResearch } from './dashboard/useResearch'
import { useQueue } from './dashboard/useQueue'
import { QueueCards } from './dashboard/Queue'
import { AnalyticsOverview, AnalyticsOverviewSkeleton, PlatformPicker } from './dashboard/Analytics'
import { ResearchCard } from './dashboard/Research'
import { WebsiteCard } from './dashboard/Website'
import { CreatePostDialog } from './dashboard/CreatePost'

// ─── Dashboard ───────────────────────────────────────────────────────────
//
// Rebuilt 2026-09-17. What stood here before read `state.posts`,
// `state.campaigns`, `state.approvals` and `state.emailFlows` from the
// localStorage app store — a store that starts empty and that NOTHING in the
// real pipeline ever writes to. Every tile was a zero, the platform overview
// counted posts in it (and listed Facebook and X, which are not platforms in
// this app at all), and the recent-posts list could never fill. The page was
// not broken; it had never been connected to anything.
//
// Everything on it now comes from a source that is actually written to:
//
//   social numbers   /api/zernio/analytics, one call per connected account,
//                    combined here (src/lib/dashboardOverview.js)
//   the queue        Supabase scheduled_posts, the same view the calendar and
//                    the Post Queue read
//   the website      Google Search Console via /api/agent/search, with the
//                    recommendations computed in code from the rows
//
// The one rule holding all of it together: a number nobody measured prints as
// "—", never as 0. Zero is a measurement, and claiming one we did not take is
// how a dead credential comes to read as a quiet month.
//
// ── WHY THE FETCHES LIVE HERE AND NOT IN THE CARDS ──
//
// "What to do now" at the top of the page is built from the research report,
// the Search Console rules AND the post queue at once, and the cards further
// down draw the same three. Fetching inside each card would mean two Search
// Console round trips per visit — the slowest call on the page, and Google's
// rather than ours — and would let the strip and the card compute "urgent"
// differently from the same rows. One hook each, passed down.

export default function Dashboard() {
  const navigate = useNavigate()
  const { activeWorkspaceId } = useAuth()
  const { allAccounts, loading: loadingAccounts } = useConnectedAccounts()

  const [range, setRange] = useState({ days: 30 })
  const [selected, setSelected] = useState(() => new Set())
  const [creating, setCreating] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [note, setNote] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const { summaries, range: measured, loading, settling } = useDashboardAnalytics({
    accounts: allAccounts, range, reloadKey,
  })
  const website = useWebsiteSearch()
  const research = useResearch()
  const queue = useQueue()

  // Platforms with an account, in the app's usual order.
  const platforms = useMemo(
    () => LIVE_PLATFORMS.filter(p => allAccounts.some(a => a.platform === p)),
    [allAccounts],
  )

  // An empty selection means "all of them", so a workspace that has never
  // touched the picker sees everything — and unticking the last platform
  // cannot leave the page blank with no way back.
  const scoped = useMemo(
    () => (selected.size ? summaries.filter(s => selected.has(s.platform)) : summaries),
    [summaries, selected],
  )
  const overview = useMemo(() => combineOverview(scoped), [scoped])

  function togglePlatform(p) {
    setSelected(prev => {
      const next = new Set(prev.size ? prev : platforms)
      next.has(p) ? next.delete(p) : next.add(p)
      // Back to every platform rather than to nothing.
      return next.size ? next : new Set()
    })
  }

  // Refresh does two things and waits for one, the same way /analytics does:
  // Zernio re-reads each account from its platform now (its own copy is up to
  // ~90 minutes old, which is why a plain re-read appears to do nothing), then
  // the numbers on screen are asked for again.
  async function handleRefresh() {
    setSyncing(true)
    setNote('')
    const live = await syncAccounts(activeWorkspaceId)
    if (live.error) {
      setNote(live.error)
    } else {
      publishConnectedAccounts(activeWorkspaceId, live.accounts)
      setNote(`${describeSync(live.synced)} Reach and impressions can still lag the platform by up to 48 hours.`)
    }
    setReloadKey(k => k + 1)
    setSyncing(false)
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const nothingConnected = !loadingAccounts && allAccounts.length === 0

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader
        title={greeting}
        subtitle="Everything across your social accounts and the website, in one place.">
        <Button variant="secondary" onClick={() => navigate('/schedule')}>View calendar</Button>
        <Button onClick={() => setCreating(true)}>Create post</Button>
      </PageHeader>

      <CreatePostDialog open={creating} onClose={() => setCreating(false)} />

      {nothingConnected ? (
        <Card className="p-6 border-dashed bg-surface-muted">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 border border-amber-200 bg-amber-50 flex items-center justify-center text-amber-700 flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="m15 7-8.5 8.5a2.12 2.12 0 0 0 3 3L18 10a4.24 4.24 0 0 0-6-6l-8.5 8.5a6.36 6.36 0 0 0 9 9L21 13"/></svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-text mb-1">No connected accounts yet</h3>
              <p className="text-sm text-text-secondary mb-3">
                Connect an account and its followers, reach, views and engagement show up here.
              </p>
              <Button onClick={() => navigate('/social')}>Connect an account</Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* The picker and the refresh sit above the numbers they change. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {loadingAccounts
              ? <div className="h-[30px]" />
              : <PlatformPicker platforms={platforms} selected={selected.size ? selected : new Set(platforms)}
                  onToggle={togglePlatform} />}
            <div className="flex items-center gap-2 ml-auto">
              {settling && !loading && <span className="text-[11px] text-text-tertiary">Still loading…</span>}
              <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={syncing || loadingAccounts}>
                {syncing ? <><Spinner size="sm" /> Refreshing…</> : 'Refresh'}
              </Button>
            </div>
          </div>
          {note && <p className="text-xs text-text-secondary -mt-1">{note}</p>}

          {loadingAccounts ? <AnalyticsOverviewSkeleton /> : (
            <AnalyticsOverview
              summaries={summaries}
              overview={overview}
              measured={measured}
              range={range}
              onRange={setRange}
              selected={selected.size ? selected : new Set(platforms)}
              loading={loading}
              settling={settling} />
          )}
        </>
      )}

      {/* Website and SEO. Its own row rather than a column beside the social
          numbers: it answers a different question and deserves the width. */}
      <WebsiteCard data={website.data} loading={website.loading} summary={website.summary}
        recommendations={website.recommendations} pages={website.pages} />

      <QueueCards attention={queue.attention} loading={queue.loading} />

      {/* ── What the research found ──
          At the bottom by the user's choice (2026-09-22): the numbers and the
          things that need fixing come first, the market read after them. */}
      <ResearchCard runs={research.runs} loading={research.loading} />
    </div>
  )
}
