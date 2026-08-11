import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { Card, Button, Input, Textarea, Select, IconBadge, PageHeader } from '../../components/ui/index'
import { Icon } from '../../components/ui/icons'
import { uid } from '../../lib/utils'

const PLATFORMS = ['instagram','facebook','linkedin','tiktok','x']
const STATUSES  = ['draft','live','paused','completed']
const GOALS     = ['Brand awareness','Lead generation','Product launch','Community engagement','Event promotion','Sales & offers']

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

export function NewCampaign() {
  const { dispatch } = useApp()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', goal: '', status: 'draft', platforms: [], description: '', startDate: '', endDate: '' })
  const [errors, setErrors] = useState({})
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const togglePlatform = p => set('platforms', form.platforms.includes(p) ? form.platforms.filter(x => x !== p) : [...form.platforms, p])

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Campaign name is required'
    if (form.platforms.length === 0) e.platforms = 'Select at least one platform'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSave() {
    if (!validate()) return
    dispatch(actions.addCampaign({ id: uid(), ...form, createdAt: new Date().toISOString() }))
    dispatch(actions.addNotification({ id: uid(), message: `Campaign "${form.name}" created.`, createdAt: new Date().toISOString() }))
    navigate('/campaigns')
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Card className="p-6 space-y-5">
        <Input label="Campaign name *" placeholder="e.g. Summer 2025 Launch" value={form.name} onChange={e => set('name', e.target.value)} error={errors.name} />

        <div className="grid grid-cols-2 gap-4">
          <Select label="Goal" value={form.goal} onChange={e => set('goal', e.target.value)}>
            <option value="">Select goal...</option>
            {GOALS.map(g => <option key={g} value={g}>{g}</option>)}
          </Select>
          <Select label="Status" value={form.status} onChange={e => set('status', e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </Select>
        </div>

        <div>
          <p className="eyebrow mb-2">Platforms *</p>
          {/* Selected/unselected reads as a filled vs. outlined box. With
              square corners and a shared border on both states, the row stays
              on one baseline as items toggle. */}
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map(p => (
              <button key={p} onClick={() => togglePlatform(p)}
                className={`px-3 py-1.5 border text-xs font-medium capitalize transition-colors
                  ${form.platforms.includes(p)
                    ? 'bg-amber-700 text-white border-amber-700'
                    : 'bg-white border-border text-text-secondary hover:border-stone-400 hover:text-text'}`}>
                {p === 'x' ? 'X / Twitter' : p}
              </button>
            ))}
          </div>
          {errors.platforms && <p className="text-xs text-red-600 mt-1.5">{errors.platforms}</p>}
        </div>

        <Textarea label="Description" placeholder="What is this campaign about?" value={form.description} onChange={e => set('description', e.target.value)} rows={3} />

        <div className="grid grid-cols-2 gap-4">
          <Input label="Start date" type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
          <Input label="End date"   type="date" value={form.endDate}   onChange={e => set('endDate',   e.target.value)} />
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={() => navigate('/campaigns')}>Cancel</Button>
          <Button onClick={handleSave}>Save campaign</Button>
        </div>
      </Card>
    </div>
  )
}
