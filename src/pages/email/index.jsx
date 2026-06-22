import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/appStore'
import { Card, Button, Badge, Input, Textarea, Select, Modal, Empty, ConfirmDialog, Toggle } from '../../components/ui/index'
import { uid, formatDate } from '../../lib/utils'

const TRIGGERS = ['New subscriber', 'Form submission', 'Cart abandoned', 'First purchase', 'No activity 30 days', 'Custom event']

export function EmailFlows() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const [deleteId, setDeleteId] = useState(null)

  function toggleStatus(flow) {
    dispatch(actions.updateEmailFlow({ id: flow.id, status: flow.status === 'active' ? 'paused' : 'active' }))
  }

  return (
    <div className="max-w-7xl space-y-5">
      {state.emailFlows.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
            title="No email flows yet"
            description="Create automated email sequences triggered by subscriber actions."
            action={<Button onClick={() => navigate('/email/new')}>Create first flow</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {state.emailFlows.map(flow => (
            <Card key={flow.id} className="p-5">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-text">{flow.name}</h3>
                    <Badge status={flow.status} />
                  </div>
                  <p className="text-xs text-text-secondary mb-2">Trigger: <span className="text-text">{flow.trigger}</span></p>
                  {flow.description && <p className="text-xs text-text-tertiary">{flow.description}</p>}
                  <div className="flex items-center gap-4 mt-3 text-xs text-text-tertiary">
                    <span>{flow.steps?.length || 0} steps</span>
                    <span>Created {formatDate(flow.createdAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Toggle checked={flow.status === 'active'} onChange={() => toggleStatus(flow)} />
                  <Button variant="ghost" size="xs" onClick={() => setDeleteId(flow.id)}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                  </Button>
                </div>
              </div>

              {/* Steps preview */}
              {flow.steps?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs font-medium text-text-secondary mb-2">Flow steps</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {flow.steps.map((step, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className="px-2.5 py-1 bg-surface-subtle rounded-lg text-xs text-text border border-border">{step.type}: {step.label}</span>
                        {i < flow.steps.length - 1 && <span className="text-text-tertiary text-xs">→</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => dispatch(actions.deleteEmailFlow(deleteId))}
        title="Delete email flow"
        message="This will permanently delete this email flow and stop all active sends."
        danger
      />
    </div>
  )
}

export function NewEmailFlow() {
  const { dispatch } = useApp()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', trigger: '', description: '', status: 'active' })
  const [steps, setSteps] = useState([])
  const [errors, setErrors] = useState({})

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function addStep(type) {
    const labels = { email: 'Send email', delay: 'Wait', condition: 'Check condition' }
    setSteps(s => [...s, { id: uid(), type, label: labels[type] || type }])
  }

  function removeStep(id) { setSteps(s => s.filter(x => x.id !== id)) }

  function handleSave() {
    const e = {}
    if (!form.name.trim()) e.name = 'Flow name is required'
    if (!form.trigger)     e.trigger = 'Select a trigger'
    setErrors(e)
    if (Object.keys(e).length > 0) return
    dispatch(actions.addEmailFlow({ id: uid(), ...form, steps, createdAt: new Date().toISOString() }))
    dispatch(actions.addNotification({ id: uid(), message: `Email flow "${form.name}" created.`, createdAt: new Date().toISOString() }))
    navigate('/email')
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Card className="p-6 space-y-5">
        <Input label="Flow name *" placeholder="e.g. Welcome series" value={form.name} onChange={e => set('name', e.target.value)} error={errors.name} />

        <Select label="Trigger *" value={form.trigger} onChange={e => set('trigger', e.target.value)} error={errors.trigger}>
          <option value="">Choose what starts this flow...</option>
          {TRIGGERS.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>

        <Textarea label="Description" placeholder="What does this flow do?" value={form.description} onChange={e => set('description', e.target.value)} rows={2} />

        {/* Step builder */}
        <div>
          <p className="text-xs font-medium text-text-secondary mb-2">Flow steps</p>
          {steps.length === 0 && <p className="text-xs text-text-tertiary mb-3">No steps added yet. Add steps to build your sequence.</p>}
          {steps.length > 0 && (
            <div className="space-y-2 mb-3">
              {steps.map((step, i) => (
                <div key={step.id} className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-amber-100 text-amber-600 text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i+1}</div>
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-surface-subtle border border-border rounded-xl text-xs text-text">
                    <span className="capitalize text-text-secondary">{step.type}</span>
                    <span className="text-border-strong">·</span>
                    <span>{step.label}</span>
                  </div>
                  <button onClick={() => removeStep(step.id)} className="w-6 h-6 rounded-lg flex items-center justify-center text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            {[{type:'email',label:'+ Email'},{type:'delay',label:'+ Delay'},{type:'condition',label:'+ Condition'}].map(s => (
              <Button key={s.type} variant="secondary" size="sm" onClick={() => addStep(s.type)}>{s.label}</Button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={() => navigate('/email')}>Cancel</Button>
          <Button onClick={handleSave}>Save flow</Button>
        </div>
      </Card>
    </div>
  )
}
