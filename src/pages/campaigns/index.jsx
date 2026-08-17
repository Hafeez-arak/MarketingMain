import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { IconBadge, PageHeader } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'

// This page is the two doors into content generation. It used to also export
// a NewCampaign form, which wrote a "campaign" into the in-memory app store
// and nowhere else — no Supabase row, no workflow, nothing downstream ever
// read it. Removed rather than left as a door that leads nowhere.

export function Campaigns() {
  const { dispatch } = useApp()
  const navigate = useNavigate()

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Content Generation" subtitle="Plan a month of on-brand posts, or pick up a saved plan." />

      {/* Two stacked entry rows sharing one border seam — the second card's
          top edge is the first card's bottom edge (-mt-px), so the pair reads
          as one panel with a division rather than two floating slabs. */}
      <div>
        {/* "Plan with AI" always starts a fresh plan — clear any leftover draft
            first, otherwise CampaignPlanner's useDraft() picks up wherever a
            previous plan left off (mid-review, or already finalized) instead
            of showing the setup screen. */}
        <button onClick={() => { dispatch(actions.setCampaignPlanDraft(null)); navigate('/campaigns/plan') }}
          className="group w-full text-left border border-border bg-white p-5 flex items-start gap-4 transition-colors hover:bg-surface-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:relative">
          <IconBadge>{Icon.trending}</IconBadge>
          <div className="flex-1 min-w-0">
            <p className="eyebrow text-text-tertiary mb-1.5">Monthly planning</p>
            <h2 className="font-semibold text-text text-sm mb-1.5">Plan with AI</h2>
            <p className="text-xs text-text-secondary leading-relaxed max-w-lg">
              Pick a month and we'll propose a full slate of on-brand post ideas — pulling from your Brand Brain
              and the seasonal moments in range. You approve the ones worth making.
            </p>
          </div>
          <svg className="w-4 h-4 text-text-tertiary flex-shrink-0 mt-0.5 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>

        {/* Saved plans entry */}
        <button onClick={() => navigate('/campaigns/plans')}
          className="group w-full text-left border border-border -mt-px bg-white p-5 flex items-center gap-4 transition-colors hover:bg-surface-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:relative">
          <IconBadge tone="sage">{Icon.calendar}</IconBadge>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-text text-sm">Content Plans</h2>
            <p className="text-xs text-text-secondary mt-1">View and reopen your saved monthly plans and their approved ideas.</p>
          </div>
          <svg className="w-4 h-4 text-text-tertiary flex-shrink-0 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </div>
    </div>
  )
}
