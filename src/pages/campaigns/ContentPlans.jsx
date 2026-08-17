import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, Button, Empty, Spinner, ConfirmDialog, IconBadge, PageHeader } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { formatDate } from '../../lib/utils'
import { fetchPlans, fetchPlanWithIdeas, deletePlan } from '../../lib/contentPlans'
import { momentsInRange, planDraftFromPlan } from '../../lib/campaignPlan'

const STATUS_STYLE = {
  draft:    'bg-stone-100 text-stone-600',
  approved: 'bg-sage-100 text-sage-700',
  active:   'bg-blue-50 text-blue-600',
  archived: 'bg-stone-100 text-text-tertiary',
}

export function ContentPlans() {
  const { dispatch } = useApp()
  const navigate = useNavigate()
  const { activeWorkspaceId, accessToken } = useAuth()

  const [plans,   setPlans]   = useState([])
  // Derived rather than a flag set inside the effect. As a bonus it fixes a
  // race the flag had: a slow response for a workspace you've already
  // navigated away from could overwrite the current one's plans.
  const [loadedFor, setLoadedFor] = useState(null)
  const [opening, setOpening] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const loading = !!activeWorkspaceId && loadedFor !== activeWorkspaceId

  useEffect(() => {
    if (!activeWorkspaceId) return
    let alive = true
    fetchPlans(activeWorkspaceId, accessToken).then(p => {
      if (!alive) return
      setPlans(p); setLoadedFor(activeWorkspaceId)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken])

  async function openPlan(plan) {
    setOpening(plan.id)
    const { ideas } = await fetchPlanWithIdeas(activeWorkspaceId, accessToken, plan.id)
    setOpening(null)
    dispatch(actions.setCampaignPlanDraft(planDraftFromPlan(plan, ideas)))
    navigate('/campaigns/plan')
  }

  async function handleDelete(plan) {
    await deletePlan(accessToken, plan.id)
    setPlans(prev => prev.filter(p => p.id !== plan.id))
    setDeleteTarget(null)
  }

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader title="Content Plans" subtitle="Monthly plans and their approved ideas.">
        <Button onClick={() => { dispatch(actions.setCampaignPlanDraft(null)); navigate('/campaigns/plan') }}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          New monthly plan
        </Button>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-text-tertiary text-sm"><Spinner size="sm" /> <span className="ml-2">Loading plans…</span></div>
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
                    <span className={`text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] flex-shrink-0 ${STATUS_STYLE[plan.status] || STATUS_STYLE.draft}`}>{plan.status}</span>
                  </div>
                  {plan.start_date && <p className="text-[11px] text-text-tertiary mt-0.5">{formatDate(plan.start_date)} – {formatDate(plan.end_date)}</p>}
                </div>
              </div>

              {plan.goal && <p className="text-xs text-text-secondary leading-relaxed line-clamp-2 mb-3">{plan.goal}</p>}

              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {/* Plans written before LinkedIn was dropped still carry
                    ['instagram','linkedin'], and every entry now renders the
                    same label — so those rows showed "INSTAGRAM INSTAGRAM".
                    Filter the stored array rather than trusting it: the row is
                    history, and rewriting it to match today's platform list
                    would edit what the plan actually asked for. */}
                {(plan.platforms || []).filter(p => p === 'instagram').map(p => (
                  <span key={p} className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-surface-subtle border border-border text-text-secondary">
                    Instagram
                  </span>
                ))}
                {moments.map((m, i) => (
                  <span key={i} className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-amber-100 text-amber-800">{m.name}</span>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-border mt-auto">
                <Button size="xs" onClick={() => openPlan(plan)} disabled={opening === plan.id}>
                  {opening === plan.id ? <><Spinner size="sm" /> Opening…</> : 'Open'}
                </Button>
                <button onClick={() => setDeleteTarget(plan)} className="ml-auto text-text-tertiary hover:text-red-500 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                </button>
              </div>
            </Card>
          )})}
        </div>
      )}

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)} title="Delete plan"
        message="This permanently deletes the plan and all its ideas. This cannot be undone." danger />
    </div>
  )
}
