import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, Button, Empty, Spinner, Modal, IconBadge, PageHeader, Skeleton } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { formatDate, PLATFORM_META } from '../../lib/utils'
import { fetchPlans, fetchPlanWithIdeas, deletePlan, fetchPlanPosts } from '../../lib/contentPlans'
import { unschedulePost } from '../../lib/scheduledPosts'
import { postLock } from '../../lib/postLock'
import { momentsInRange, planDraftFromPlan } from '../../lib/campaignPlan'

const STATUS_STYLE = {
  draft:    'bg-stone-100 text-stone-600',
  approved: 'bg-sage-100 text-sage-700',
  active:   'bg-sky-50 text-sky-600',
  archived: 'bg-stone-100 text-text-tertiary',
  generating: 'bg-amber-100 text-amber-800 animate-pulse',
}
const STATUS_LABEL = { generating: 'Generating…' }

// Where the plan's ideas actually go — the plan's own `platforms` is only
// what was ticked on setup, and ideas are moved between platforms after.
function planPlatforms(plan) {
  const live = (plan.plan_ideas || []).filter(i => i.status !== 'rejected')
  const set = new Set(live.flatMap(i => (i.platforms?.length ? i.platforms : [i.platform]).filter(Boolean)))
  return set.size ? [...set] : (plan.platforms || [])
}

// Booked at the platform and not out yet: what deleting the plan must cancel,
// or it would still publish with no plan behind it.
const isBookedUnsent = post => post.publish_status === 'scheduled' && !postLock(post).locked

export function ContentPlans() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const { activeWorkspaceId, accessToken } = useAuth()

  const [plans,   setPlans]   = useState([])
  // Derived rather than a flag set inside the effect. As a bonus it fixes a
  // race the flag had: a slow response for a workspace you've already
  // navigated away from could overwrite the current one's plans.
  const [loadedFor, setLoadedFor] = useState(null)
  const [opening, setOpening] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // planId → its post rows. undefined while reading, null if the read failed.
  const [planPosts, setPlanPosts] = useState(undefined)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const loading = !!activeWorkspaceId && loadedFor !== activeWorkspaceId

  useEffect(() => {
    if (!activeWorkspaceId) return
    let alive = true
    fetchPlans(activeWorkspaceId, accessToken, { throwOnError: true }).then(p => {
      if (!alive) return
      setPlans(p); setLoadError(''); setLoadedFor(activeWorkspaceId)
      setPlanPosts(undefined)
      fetchPlanPosts(activeWorkspaceId, accessToken, p.map(x => x.id)).then(byPlan => { if (alive) setPlanPosts(byPlan) })
    }).catch(err => {
      if (!alive) return
      setLoadError(String(err?.message || err)); setLoadedFor(activeWorkspaceId)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken, reloadKey])

  async function openPlan(plan) {
    setOpening(plan.id)
    const { ideas } = await fetchPlanWithIdeas(activeWorkspaceId, accessToken, plan.id)
    setOpening(null)
    dispatch(actions.setCampaignPlanDraft(planDraftFromPlan(plan, ideas)))
    navigate('/campaigns/plan')
  }

  // Owner decision (2026-10-14): deleting a plan cancels its booked, unsent
  // posts, through the same cancel the Post Queue uses. Cancelled posts stay
  // in the queue under Needs attention. If any cancel fails the plan is NOT
  // deleted, so the delete can simply be tried again.
  async function handleDelete(plan) {
    setDeleting(true); setDeleteError('')
    try {
      const fresh = await fetchPlanPosts(activeWorkspaceId, accessToken, [plan.id])
      if (fresh === null) { setDeleteError('Couldn’t check this plan’s booked posts, so nothing was deleted. Try again.'); return }
      const booked = (fresh[plan.id] || []).filter(isBookedUnsent)
      const failed = []
      for (const post of booked) {
        const res = await unschedulePost({ accessToken, post, webhooks: state.webhooks, workspaceId: activeWorkspaceId })
        if (res.error) failed.push(`${post.topic || 'A post'}: ${res.error}`)
      }
      if (failed.length) {
        setDeleteError(`${failed.length} booked post${failed.length === 1 ? '' : 's'} couldn’t be cancelled, so the plan was kept. ${failed.join(' · ')}`)
        return
      }
      const res = await deletePlan(accessToken, plan.id, activeWorkspaceId)
      if (res.error) { setDeleteError(res.error); return }
      setPlans(prev => prev.filter(p => p.id !== plan.id))
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const bookedFor = plan => (planPosts?.[plan.id] || []).filter(isBookedUnsent).length

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader title="Content Planning" subtitle="Monthly plans and their approved ideas.">
        <Button onClick={() => { dispatch(actions.setCampaignPlanDraft(null)); navigate('/campaigns/plan') }}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          New monthly plan
        </Button>
      </PageHeader>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading plans">
          {[0, 1, 2, 3].map(i => (
            <Card key={i} className="p-5">
              <div className="flex items-start gap-3 mb-3">
                <Skeleton className="w-7 h-7 flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
              <Skeleton className="h-3 w-full mb-1.5" />
              <Skeleton className="h-3 w-4/5 mb-4" />
              <div className="pt-3 border-t border-border">
                <Skeleton className="h-7 w-16" />
              </div>
            </Card>
          ))}
        </div>
      ) : loadError && plans.length === 0 ? (
        <Card className="shadow-none border-border">
          <Empty
            title="The plans could not be loaded"
            description={`${loadError}. This is a connection problem, not an empty list: nothing has been lost.`}
            action={<Button variant="secondary" onClick={() => { setLoadedFor(null); setReloadKey(k => k + 1) }}>Try again</Button>}
          />
        </Card>
      ) : plans.length === 0 ? (
        <Card className="shadow-none border-border">
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
            title="No content plans yet"
            description="Plan a month up front — we'll propose ideas and you approve the ones worth making."
            action={<Button onClick={() => { dispatch(actions.setCampaignPlanDraft(null)); navigate('/campaigns/plan') }}>Plan a month</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.map(plan => {
            const moments = momentsInRange(plan.start_date, plan.end_date)
            return (
            <Card key={plan.id} className="p-5 flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                <IconBadge>{Icon.calendar}</IconBadge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-text text-sm leading-snug">{plan.name || 'Untitled plan'}</h3>
                    <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] flex-shrink-0 ${STATUS_STYLE[plan.status] || STATUS_STYLE.draft}`}>{STATUS_LABEL[plan.status] || plan.status}</span>
                  </div>
                  {plan.start_date && <p className="text-[11px] text-text-tertiary mt-0.5">{formatDate(plan.start_date)} – {formatDate(plan.end_date)}</p>}
                </div>
              </div>

              {plan.goal && <p className="text-xs text-text-secondary leading-relaxed line-clamp-2 mb-3">{plan.goal}</p>}

              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {/* Labelled from PLATFORM_META rather than hardcoded. This
                    read `.filter(p => p === 'instagram')` and printed the
                    literal "Instagram" — written when Instagram was the only
                    platform, and correct then. It is not now: a plan targeting
                    TikTok or LinkedIn rendered no chip at all, so the card
                    silently claimed the plan had no platforms.

                    A stored platform we no longer recognise still shows, under
                    its own key. The row is history — a plan really did ask for
                    it — and hiding it would quietly rewrite what was asked. */}
                {planPlatforms(plan).map(p => (
                  <span key={p} className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-surface-subtle border border-border text-text-secondary">
                    {PLATFORM_META[p]?.label || p}
                  </span>
                ))}
                {moments.map((m, i) => (
                  <span key={i} className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-amber-100 text-amber-800">{m.name}</span>
                ))}
              </div>

              <PlanCounts plan={plan} posts={planPosts === undefined ? undefined : planPosts === null ? null : (planPosts[plan.id] || [])} />

              <div className="flex items-center gap-2 pt-3 border-t border-border mt-auto">
                <Button size="xs" onClick={() => openPlan(plan)} disabled={opening === plan.id}>
                  {opening === plan.id ? <><Spinner size="sm" /> Opening…</> : 'Open'}
                </Button>
                <button onClick={() => { setDeleteError(''); setDeleteTarget(plan) }} aria-label="Delete plan" className="ml-auto text-text-tertiary hover:text-red-500 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                </button>
              </div>
            </Card>
          )})}
        </div>
      )}

      <Modal open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} title="Delete plan" width="max-w-sm">
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-secondary leading-relaxed">
            This permanently deletes <span className="font-semibold text-text">{deleteTarget?.name || 'this plan'}</span> and all its ideas.
            {' '}{deleteTarget && (planPosts === undefined
              ? 'Checking for booked posts…'
              : planPosts === null
                ? 'Any posts it has booked will be cancelled first.'
                : bookedFor(deleteTarget) > 0
                  ? `Its ${bookedFor(deleteTarget)} booked post${bookedFor(deleteTarget) === 1 ? '' : 's'} will be cancelled first and kept in the Post Queue.`
                  : 'It has no booked posts.')}
            {' '}This cannot be undone.
          </p>
          {deleteError && <p className="text-xs text-red-600 leading-snug">{deleteError}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" onClick={() => handleDelete(deleteTarget)} disabled={deleting}>
              {deleting ? <><Spinner size="sm" /> Deleting…</> : 'Delete'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// "6 ideas · 4 posts · 2 booked". Ideas come with the plan; posts are a second
// read, so they show a placeholder until it lands and say so if it failed —
// never a 0 that isn't known.
function PlanCounts({ plan, posts }) {
  const ideas = (plan.plan_ideas || []).filter(i => i.status !== 'rejected').length
  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`
  return (
    <p className="text-[11px] text-text-tertiary mb-3 flex items-center gap-1.5">
      <span>{n(ideas, 'idea')}</span>
      <span aria-hidden>·</span>
      {posts === undefined ? <Skeleton className="h-3 w-14 inline-block" />
        : posts === null ? <span>posts couldn’t be counted</span>
        : <span>{n(posts.length, 'post')}{posts.some(isBookedUnsent) ? ` · ${posts.filter(isBookedUnsent).length} booked` : ''}</span>}
    </p>
  )
}
