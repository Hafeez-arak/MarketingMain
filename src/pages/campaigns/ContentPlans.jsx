import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
import { Card, Button, Empty, Spinner, ConfirmDialog, IconBadge, Icon } from '../../components/ui/index'
import { formatDate } from '../../lib/utils'
import { fetchPlans, fetchPlanWithIdeas, deletePlan } from '../../lib/contentPlans'
import { dbIdeaToDraft, momentsInRange } from './CampaignPlanner'

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
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  useEffect(() => {
    if (!activeWorkspaceId) return
    setLoading(true)
    fetchPlans(activeWorkspaceId, accessToken).then(p => { setPlans(p); setLoading(false) })
  }, [activeWorkspaceId])

  async function openPlan(plan) {
    setOpening(plan.id)
    const { ideas } = await fetchPlanWithIdeas(accessToken, plan.id)
    setOpening(null)
    dispatch(actions.setCampaignPlanDraft({
      // Always open on the review screen so the ideas are visible and editable —
      // even for an already-approved plan (the old 'done' step hid every idea
      // behind a bare summary card).
      step: 'review',
      month: plan.month || '', goal: plan.goal || '', goalCategory: plan.goal_category || '',
      platforms: plan.platforms || ['instagram', 'linkedin'],
      startDate: plan.start_date || '', endDate: plan.end_date || '',
      approxCount: '', includeHolidays: true,
      contentMixTarget: plan.content_mix_target || '',
      name: plan.name || '', ideas: ideas.map(dbIdeaToDraft), planId: plan.id,
    }))
    navigate('/campaigns/plan')
  }

  async function handleDelete(plan) {
    await deletePlan(accessToken, plan.id)
    setPlans(prev => prev.filter(p => p.id !== plan.id))
    setDeleteTarget(null)
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display font-bold text-2xl text-text">Content Plans</h2>
          <p className="text-sm text-text-secondary mt-0.5">Monthly plans and their approved ideas.</p>
        </div>
        <Button onClick={() => { dispatch(actions.setCampaignPlanDraft(null)); navigate('/campaigns/plan') }}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          New Monthly Plan
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-text-tertiary text-sm"><Spinner size="sm" /> <span className="ml-2">Loading plans…</span></div>
      ) : plans.length === 0 ? (
        <Card className="shadow-none border-border/80">
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
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
            <Card key={plan.id} className="p-5 flex flex-col shadow-none border-border/80">
              <div className="flex items-start gap-3 mb-3">
                <IconBadge>{Icon.calendar}</IconBadge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-text text-sm leading-snug">{plan.name || 'Untitled plan'}</h3>
                    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full capitalize flex-shrink-0 ${STATUS_STYLE[plan.status] || STATUS_STYLE.draft}`}>{plan.status}</span>
                  </div>
                  {plan.start_date && <p className="text-[11px] text-text-tertiary mt-0.5">{formatDate(plan.start_date)} – {formatDate(plan.end_date)}</p>}
                </div>
              </div>

              {plan.goal && <p className="text-xs text-text-secondary leading-relaxed line-clamp-2 mb-3">{plan.goal}</p>}

              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {(plan.platforms || []).map(p => (
                  <span key={p} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-muted text-text-secondary">
                    {p === 'linkedin' ? 'LinkedIn' : 'Instagram'}
                  </span>
                ))}
                {moments.map((m, i) => (
                  <span key={i} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{m.name}</span>
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
