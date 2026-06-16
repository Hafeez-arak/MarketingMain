import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/appStore'
import { Card, Button, Badge, PlatformPill, Input, Textarea, Select, Modal, Empty, ConfirmDialog } from '../../components/ui/index'
import { uid, formatDate } from '../../lib/utils'

const PLATFORMS = ['instagram','facebook','linkedin','tiktok','x']
const STATUSES  = ['draft','live','paused','completed']
const GOALS     = ['Brand awareness','Lead generation','Product launch','Community engagement','Event promotion','Sales & offers']

export function Campaigns() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [deleteId, setDeleteId] = useState(null)

  const filtered = filter === 'all' ? state.campaigns : state.campaigns.filter(c => c.status === filter)

  return (
    <div className="max-w-5xl space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 bg-white border border-border rounded-xl p-1">
          {['all','live','draft','paused','completed'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-brand-600 text-white' : 'text-text-secondary hover:text-text hover:bg-surface-subtle'}`}>
              {f === 'all' ? `All (${state.campaigns.length})` : f}
            </button>
          ))}
        </div>
        <Button onClick={() => navigate('/campaigns/new')}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          New campaign
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
            title={filter === 'all' ? 'No campaigns yet' : `No ${filter} campaigns`}
            description="Create your first campaign to organise your content across platforms."
            action={<Button onClick={() => navigate('/campaigns/new')}>Create campaign</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(c => (
            <Card key={c.id} className="overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-text">{c.name}</h3>
                  <Badge status={c.status} />
                </div>
                {c.goal && <p className="text-xs text-text-secondary mb-3">{c.goal}</p>}
                <div className="flex flex-wrap gap-1 mb-4">
                  {(c.platforms || []).map(p => <PlatformPill key={p} platform={p} />)}
                </div>
                {c.description && <p className="text-xs text-text-tertiary line-clamp-2 mb-3">{c.description}</p>}
                <div className="flex items-center gap-3 pt-3 border-t border-border">
                  <p className="text-xs text-text-tertiary flex-1">{formatDate(c.createdAt)}</p>
                  <Button variant="ghost" size="xs" onClick={() => setDeleteId(c.id)}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                  </Button>
                  <Button variant="secondary" size="xs" onClick={() => navigate('/campaigns/new')}>Edit</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => dispatch(actions.deleteCampaign(deleteId))}
        title="Delete campaign"
        message="This will permanently delete this campaign. This cannot be undone."
        danger
      />
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
    <div className="max-w-2xl space-y-5">
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
                className={`px-3 py-1.5 rounded-xl border text-sm font-medium capitalize transition-all ${form.platforms.includes(p) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-border text-text-secondary hover:border-brand-400'}`}>
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
