import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp, actions } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
import { Card, Button, Badge, PlatformPill, Input, Textarea, Select, Spinner, Toggle, Empty } from '../../components/ui/index'
import { uid, formatDate } from '../../lib/utils'
import { buildInstructionsString, isBrandProfileEmpty } from '../../lib/brandBrain'
import { requestCampaignPlan, writeCampaignPosts } from '../../lib/campaignPlanner'
import { suggestDesign } from '../../lib/designSuggestion'

const GOALS = ['Brand awareness','Lead generation','Product launch','Community engagement','Event promotion','Sales & offers']
const PLATFORMS = ['instagram', 'linkedin'] // only platforms with a generation pipeline today

const IG_TONES = [
  { value: 'professional',  label: 'Professional' },
  { value: 'inspirational', label: 'Inspirational' },
  { value: 'educational',   label: 'Educational' },
  { value: 'casual',        label: 'Casual & Friendly' },
  { value: 'promotional',   label: 'Promotional' },
]
const LI_TONES = [
  { value: 'thought_leader',   label: 'Thought Leader' },
  { value: 'executive',        label: 'Executive' },
  { value: 'technical_expert', label: 'Technical Expert' },
  { value: 'warm_human',       label: 'Warm & Human' },
  { value: 'promotional',      label: 'Promotional' },
]
const toneLabel = p => (p.platform === 'linkedin' ? LI_TONES : IG_TONES).find(t => t.value === p.tone)?.label || p.tone

const DEFAULT_DRAFT = {
  step: 'goal', // 'goal' | 'plan'
  goal: '', goalCategory: '', platforms: ['instagram', 'linkedin'],
  startDate: '', endDate: '', approxCount: '', includeHolidays: true,
  campaignName: '', posts: [],
  campaignId: null, // lazily created the first time any post is individually scheduled, or on final confirm
}

// Both the plan list and the per-post editor read/write the same draft
// object in shared app state, so navigating between them never loses data.
function useDraft() {
  const { state, dispatch } = useApp()
  const draft = state.campaignPlanDraft || DEFAULT_DRAFT
  const update = patch => dispatch(actions.setCampaignPlanDraft({ ...draft, ...patch }))
  const clear  = () => dispatch(actions.setCampaignPlanDraft(null))
  return { draft, update, clear, state, dispatch }
}

// Creates the campaign the first time it's needed (either an individual
// "Add to Schedule" or the final batch confirm) and reuses it afterward, so
// scheduling posts one at a time and then confirming the rest doesn't create
// duplicate campaigns.
function ensureCampaignId(draft, dispatch, update) {
  if (draft.campaignId) return draft.campaignId
  const campaignId = uid()
  dispatch(actions.addCampaign({
    id: campaignId,
    name: draft.campaignName.trim() || draft.goal.trim().slice(0, 60),
    goal: draft.goalCategory,
    status: 'live',
    platforms: draft.platforms,
    description: draft.goal.trim(),
    startDate: draft.startDate, endDate: draft.endDate,
    createdAt: new Date().toISOString(),
  }))
  update({ campaignId })
  return campaignId
}

export function CampaignPlanner() {
  const { draft, update, clear, state } = useDraft()
  const navigate = useNavigate()
  const webhookUrl  = state.webhooks?.campaignPlanner || ''

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const { step, goal, goalCategory, platforms, startDate, endDate, approxCount, includeHolidays, campaignName, posts } = draft

  const togglePlatform = p => update({ platforms: platforms.includes(p) ? platforms.filter(x => x !== p) : [...platforms, p] })

  function validateGoalStep() {
    if (!goal.trim()) return 'Describe the goal first.'
    if (platforms.length === 0) return 'Select at least one platform.'
    if (!startDate || !endDate) return 'Pick a start and end date.'
    if (new Date(endDate) < new Date(startDate)) return 'End date is before the start date.'
    return ''
  }

  async function handleGeneratePlan() {
    const validationError = validateGoalStep()
    if (validationError) { setError(validationError); return }
    setError(''); setLoading(true)
    const instructions = buildInstructionsString(state.brandProfile, '')
    const result = await requestCampaignPlan(webhookUrl, {
      goal: goal.trim(),
      goal_category: goalCategory || null,
      platforms,
      start_date: startDate,
      end_date: endDate,
      approx_post_count: approxCount ? Number(approxCount) : null,
      include_holidays: includeHolidays,
      instructions: instructions || null,
    })
    setLoading(false)
    if (result.error) { setError(result.error); return }
    update({ posts: result.posts, campaignName: result.suggestedName || goal.trim().slice(0, 60), step: 'plan' })
  }

  function addPost() {
    const newPost = { _rowId: `manual_${uid()}`, platform: 'instagram', date: startDate, topic: '', angle: '', tone: 'professional' }
    update({ posts: [...posts, newPost] })
    navigate(`/campaigns/plan/post/${newPost._rowId}`)
  }

  const brandReady = state.brandProfile && !isBrandProfileEmpty(state.brandProfile)
  const scheduledCount = posts.filter(p => p._scheduled).length

  return (
    <div className="max-w-5xl space-y-5">
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-5 rounded-full" style={{ background: 'linear-gradient(180deg,#7c3aed,#a78bfa)' }} />
          <p className="text-xs font-semibold text-purple-700 tracking-[0.12em] uppercase">Campaign Automation</p>
        </div>
        <h1 className="font-display text-2xl font-bold text-stone-900 mb-2">State the goal. We'll plan the campaign.</h1>
        <p className="text-sm text-text-secondary leading-relaxed max-w-xl">
          Describe what you're actually trying to achieve — not a topic, a goal. We'll turn that into a dated,
          platform-by-platform set of post ideas, pulling from your Brand Brain profile. You review and edit
          before anything gets scheduled.
        </p>
      </Card>

      {!brandReady && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
          <span className="font-medium">No Brand Brain profile set.</span> The plan will work without it, but it'll be generic.
          Set it up in <button onClick={() => navigate('/brand-brain')} className="underline font-medium hover:text-amber-800">Brand Brain</button> first for better results.
        </div>
      )}

      {!webhookUrl && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
          <span className="font-medium">Campaign Planner webhook not configured.</span> Add it in Settings → Integrations → Workflow Webhooks before generating a plan.
        </div>
      )}

      {step === 'goal' && (
        <Card className="p-6 space-y-5">
          <Textarea
            label="What's the goal? *"
            placeholder="e.g. Get more hospitality developers and architects to request a quote for our new landscape lighting line over the next 3 weeks."
            value={goal} onChange={e => update({ goal: e.target.value })} rows={4}
          />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Goal category" value={goalCategory} onChange={e => update({ goalCategory: e.target.value })}>
              <option value="">Select...</option>
              {GOALS.map(g => <option key={g} value={g}>{g}</option>)}
            </Select>
            <Input label="Roughly how many posts? (optional)" type="number" min="1" placeholder="Let AI decide"
              value={approxCount} onChange={e => update({ approxCount: e.target.value })} />
          </div>
          <div>
            <p className="text-xs font-medium text-text-secondary mb-2">Platforms *</p>
            <div className="flex gap-2">
              {PLATFORMS.map(p => (
                <button key={p} onClick={() => togglePlatform(p)}
                  className={`px-3 py-1.5 rounded-xl border text-sm font-medium capitalize transition-all ${platforms.includes(p) ? 'bg-amber-600 text-white border-amber-600' : 'bg-white border-border text-text-secondary hover:border-amber-400'}`}>
                  {p}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-text-tertiary mt-1.5">Other platforms aren't wired to a generation pipeline yet — see the roadmap.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Start date *" type="date" value={startDate} onChange={e => update({ startDate: e.target.value })} />
            <Input label="End date *"   type="date" value={endDate}   onChange={e => update({ endDate: e.target.value })} />
          </div>
          <Toggle checked={includeHolidays} onChange={e => update({ includeHolidays: e.target.checked })}
            label="Factor in Saudi public holidays falling in this range (Founding Day, National Day, Eid, etc.)" />
          {error && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{error}</div>}
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" onClick={() => { clear(); navigate('/campaigns') }}>Cancel</Button>
            <Button onClick={handleGeneratePlan} disabled={loading}>
              {loading ? <><Spinner size="sm" /> Planning…</> : 'Generate Plan'}
            </Button>
          </div>
        </Card>
      )}

      {step === 'plan' && (
        <div className="space-y-4">
          <Card className="p-5">
            <Input label="Campaign name" value={campaignName} onChange={e => update({ campaignName: e.target.value })} />
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-text">{posts.length} posts proposed{scheduledCount > 0 ? ` — ${scheduledCount} already scheduled` : ''}</p>
                <p className="text-xs text-text-tertiary">Click a post to open it — nothing is scheduled until you confirm or schedule it individually.</p>
              </div>
              <Button variant="secondary" size="xs" onClick={addPost}>+ Add post</Button>
            </div>
            <div className="divide-y divide-border">
              {posts.map((p, i) => (
                <button key={p._rowId} onClick={() => navigate(`/campaigns/plan/post/${p._rowId}`)}
                  className="w-full text-left px-5 py-3.5 flex items-center gap-3 hover:bg-surface-subtle transition-colors">
                  <span className="text-xs font-semibold text-text-disabled w-5 flex-shrink-0 text-right">{i + 1}</span>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${p.platform === 'linkedin' ? 'bg-[#0A66C2]/10 text-[#0A66C2]' : 'bg-pink-50 text-pink-600'}`}>
                    {p.platform === 'linkedin' ? 'LinkedIn' : 'Instagram'}
                  </span>
                  <span className="text-xs text-text-tertiary w-24 flex-shrink-0">{p.date ? formatDate(p.date) : 'No date'}</span>
                  <span className="text-sm text-text font-medium flex-1 truncate">{p.topic || 'Untitled post'}</span>
                  <span className="text-[11px] text-text-tertiary flex-shrink-0 hidden sm:inline">{toneLabel(p)}</span>
                  {p._scheduled && (
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-sage-100 text-sage-700 flex-shrink-0 flex items-center gap-1">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                      Scheduled
                    </span>
                  )}
                  <svg className="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              ))}
              {posts.length === 0 && <p className="text-xs text-text-tertiary p-5 text-center">No posts left — add one or go back and regenerate.</p>}
            </div>
          </Card>

          {error && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{error}</div>}

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => update({ step: 'goal' })}>Back</Button>
            <ConfirmButton onError={setError} />
          </div>
        </div>
      )}
    </div>
  )
}

// Confirms whatever in the plan hasn't already been individually scheduled.
function ConfirmButton({ onError }) {
  const { draft, update, dispatch, state } = useDraft()
  const navigate = useNavigate()
  const [committing, setCommitting] = useState(false)
  const { activeWorkspaceId, accessToken } = useAuth()
  const { posts, campaignName, goal, startDate, endDate } = draft

  const remaining = posts.filter(p => !p._scheduled)

  async function handleConfirm() {
    if (posts.length === 0) { onError('Add at least one post before scheduling.'); return }
    if (posts.some(p => !p.date || !p.topic.trim())) { onError('Every post needs a date and a topic.'); return }
    onError(''); setCommitting(true)

    const campaignId = ensureCampaignId(draft, dispatch, update)

    if (remaining.length === 0) {
      // everything was already scheduled individually — just close out
      dispatch(actions.addNotification({ id: uid(), message: `Campaign "${campaignName}" already fully scheduled.`, createdAt: new Date().toISOString() }))
      setCommitting(false); dispatch(actions.setCampaignPlanDraft(null)); navigate('/schedule'); return
    }

    const instructions = buildInstructionsString(state.brandProfile, '')
    const result = await writeCampaignPosts(activeWorkspaceId, accessToken, campaignId, remaining, instructions)
    setCommitting(false)

    if (result.error) { onError(result.error); return }
    if (!result.ok) {
      onError(`${result.failedCount} of ${remaining.length} remaining posts failed to schedule. You can add them manually from the Schedule tab.`)
    } else {
      dispatch(actions.addNotification({ id: uid(), message: `Campaign "${campaignName}" scheduled — ${remaining.length} post${remaining.length === 1 ? '' : 's'} added.`, createdAt: new Date().toISOString() }))
    }
    dispatch(actions.setCampaignPlanDraft(null))
    navigate('/schedule')
  }

  return (
    <Button onClick={handleConfirm} disabled={committing}>
      {committing
        ? <><Spinner size="sm" /> Scheduling…</>
        : remaining.length === posts.length
          ? `Confirm & Schedule ${posts.length} Post${posts.length === 1 ? '' : 's'}`
          : `Confirm & Schedule Remaining ${remaining.length} Post${remaining.length === 1 ? '' : 's'}`}
    </Button>
  )
}

// ─── Per-post editor — its own full page, not a modal ──────────────────────
// Lives at /campaigns/plan/post/:rowId. Reads and writes the same shared
// draft as the plan list above, so edits here show up immediately when you
// navigate back.
export function CampaignPostEditor() {
  const { rowId } = useParams()
  const navigate = useNavigate()
  const { draft, update, dispatch, state } = useDraft()
  const { posts, startDate, endDate } = draft
  const { activeWorkspaceId, accessToken } = useAuth()

  const [scheduling, setScheduling] = useState(false)
  const [scheduleError, setScheduleError] = useState('')

  const index = posts.findIndex(p => p._rowId === rowId)
  const post  = posts[index]

  function updatePost(field, value) {
    update({ posts: posts.map(p => p._rowId === rowId ? { ...p, [field]: value } : p) })
  }
  function handleDelete() {
    update({ posts: posts.filter(p => p._rowId !== rowId) })
    navigate('/campaigns/plan')
  }

  async function handleAddToSchedule() {
    setScheduleError(''); setScheduling(true)
    const campaignId = ensureCampaignId(draft, dispatch, update)
    const instructions = buildInstructionsString(state.brandProfile, '')
    const result = await writeCampaignPosts(activeWorkspaceId, accessToken, campaignId, [post], instructions)
    setScheduling(false)
    if (result.error) { setScheduleError(result.error); return }
    if (!result.ok) { setScheduleError(result.results?.[0]?.error || 'Failed to schedule this post.'); return }
    update({ posts: posts.map(p => p._rowId === rowId ? { ...p, _scheduled: true } : p) })
    dispatch(actions.addNotification({ id: uid(), message: `"${post.topic}" added to your ${post.platform === 'linkedin' ? 'LinkedIn' : 'Instagram'} schedule.`, createdAt: new Date().toISOString() }))
  }

  if (!posts.length || !post) {
    return (
      <div className="max-w-2xl">
        <Card className="p-6">
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>}
            title="This post isn't in an active plan"
            description="The plan may have been confirmed, cancelled, or this is a stale link."
            action={<Button onClick={() => navigate('/campaigns/plan')}>Start a new plan</Button>}
          />
        </Card>
      </div>
    )
  }

  const design = post.suggestedStyle
    ? { tip: post.designTip || 'No specific design note from the plan — use your judgment on the Create page.', fromPlan: true }
    : { tip: suggestDesign(post).tip, fromPlan: false }

  return (
    <div className="max-w-7xl space-y-5">
      <Card className="p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs font-semibold text-purple-700 tracking-[0.1em] uppercase mb-1">Post {index + 1} of {posts.length}</p>
          <p className="text-sm text-text-secondary">Part of the plan you're building — changes here are reflected as soon as you go back.</p>
        </div>
        {post._scheduled && (
          <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-sage-100 text-sage-700 flex items-center gap-1.5 flex-shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            Already in your schedule
          </span>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
        <Card className="p-6 space-y-4 self-start">
          {post._scheduled && (
            <div className="rounded-xl bg-sage-50 border border-sage-100 px-4 py-3 text-xs text-sage-700">
              This post is already live in your {post.platform === 'linkedin' ? 'LinkedIn' : 'Instagram'} schedule. Editing fields here won't update it — make changes from the Schedule tab instead.
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Select label="Platform" value={post.platform} disabled={post._scheduled} onChange={e => updatePost('platform', e.target.value)}>
              <option value="instagram">Instagram</option>
              <option value="linkedin">LinkedIn</option>
            </Select>
            <Input label="Date" type="date" value={post.date} disabled={post._scheduled}
              min={startDate || undefined} max={endDate || undefined}
              onChange={e => updatePost('date', e.target.value)} />
          </div>
          <Input label="Topic" value={post.topic} disabled={post._scheduled} onChange={e => updatePost('topic', e.target.value)} />
          <Textarea label="Angle (optional)" rows={3} value={post.angle} disabled={post._scheduled} onChange={e => updatePost('angle', e.target.value)} />
          <Select label="Tone" value={post.tone} disabled={post._scheduled} onChange={e => updatePost('tone', e.target.value)}>
            {(post.platform === 'linkedin' ? LI_TONES : IG_TONES).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>

          {scheduleError && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{scheduleError}</div>}

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <button onClick={handleDelete} disabled={post._scheduled}
              className={`text-xs font-medium flex items-center gap-1.5 ${post._scheduled ? 'text-text-disabled cursor-not-allowed' : 'text-red-500 hover:text-red-600'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
              Delete this post
            </button>
            <div className="flex items-center gap-2">
              <Button variant={post._scheduled ? 'secondary' : 'outline'} size="sm" onClick={handleAddToSchedule} disabled={post._scheduled || scheduling}>
                {scheduling
                  ? <><Spinner size="sm" /> Adding…</>
                  : post._scheduled
                    ? '✓ Added to Schedule'
                    : 'Add to Schedule'}
              </Button>
              <Button size="sm" onClick={() => navigate('/campaigns/plan')}>Back to Plan</Button>
            </div>
          </div>
        </Card>

        {/* Design suggestion — a starting point, not a guarantee */}
        <Card className="p-6 space-y-4 self-start">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-purple-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-text">How to design this post</p>
                <p className="text-[11px] text-text-tertiary">Based on this post's topic and tone</p>
              </div>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-1 rounded-full flex-shrink-0 ${design.fromPlan ? 'bg-purple-100 text-purple-700' : 'bg-stone-100 text-stone-600'}`}>
              {design.fromPlan ? 'From your plan' : 'Estimated'}
            </span>
          </div>

          <p className="text-sm text-text leading-relaxed">{design.tip}</p>

          <p className="text-[11px] text-text-tertiary pt-2 border-t border-border">
            A starting point, not a final call — fine-tune the actual look on the Create page when this post is generated.
          </p>
        </Card>
      </div>
    </div>
  )
}
