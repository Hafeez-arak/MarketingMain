import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/appStore'
import { Card, Button, Input, Textarea, Select } from '../../components/ui/index'
import { uid } from '../../lib/utils'

const PLATFORMS = ['instagram','facebook','linkedin','tiktok','x']
const STATUSES  = ['draft','live','paused','completed']
const GOALS     = ['Brand awareness','Lead generation','Product launch','Community engagement','Event promotion','Sales & offers']

export function Campaigns() {
  const { dispatch } = useApp()
  const navigate = useNavigate()

  return (
    <div className="max-w-5xl space-y-6">
      {/* Hero — AI planning is the primary way to work now */}
      {/* "Plan with AI" always starts a fresh plan — clear any leftover draft
          first, otherwise CampaignPlanner's useDraft() picks up wherever a
          previous plan left off (mid-review, or already finalized) instead
          of showing the setup screen. */}
      <button onClick={() => { dispatch(actions.setCampaignPlanDraft(null)); navigate('/campaigns/plan') }}
        className="group relative w-full text-left rounded-3xl overflow-hidden border border-purple-200/70 p-7 transition-all hover:shadow-dropdown focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        style={{ background: 'linear-gradient(135deg,#faf5ff 0%,#f5f3ff 55%,#fdf4ff 100%)' }}>
        <div className="flex items-start gap-5">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm"
            style={{ background: 'linear-gradient(180deg,#7c3aed,#a78bfa)' }}>
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.36-6.36l-2.12 2.12M8.76 15.24l-2.12 2.12m12.72 0l-2.12-2.12M8.76 8.76L6.64 6.64"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-purple-700 tracking-[0.12em] uppercase mb-1">Monthly Planning</p>
            <h1 className="font-display text-2xl font-bold text-stone-900 mb-1.5">Plan with AI</h1>
            <p className="text-sm text-text-secondary leading-relaxed max-w-lg">
              Pick a month and we'll propose a full slate of on-brand post ideas — pulling from your Brand Brain
              and the seasonal moments in range. You approve the ones worth making.
            </p>
          </div>
          <svg className="w-5 h-5 text-purple-400 flex-shrink-0 mt-1 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </div>
      </button>

      {/* Saved plans entry */}
      <button onClick={() => navigate('/campaigns/plans')}
        className="group w-full text-left rounded-2xl border border-border bg-white p-5 flex items-center gap-4 transition-all hover:border-stone-300 hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0 text-amber-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-text">Content Plans</h2>
          <p className="text-xs text-text-secondary mt-0.5">View and reopen your saved monthly plans and their approved ideas.</p>
        </div>
        <svg className="w-4 h-4 text-text-tertiary flex-shrink-0 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
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
          <p className="text-xs font-medium text-text-secondary mb-2">Platforms *</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => (
              <button key={p} onClick={() => togglePlatform(p)}
                className={`px-3 py-1.5 rounded-xl border text-sm font-medium capitalize transition-all ${form.platforms.includes(p) ? 'bg-amber-600 text-white border-amber-600' : 'bg-white border-border text-text-secondary hover:border-amber-400'}`}>
                {p === 'x' ? 'X / Twitter' : p}
              </button>
            ))}
          </div>
          {errors.platforms && <p className="text-xs text-red-500 mt-1">{errors.platforms}</p>}
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
