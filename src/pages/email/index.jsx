import { useState } from 'react'
import { useApp, actions } from '../../store/app'
import { Card, Button, Badge, Empty, ConfirmDialog, Toggle, PageHeader } from '../../components/ui/index'
import { formatDate } from '../../lib/utils'

export function EmailFlows() {
  const { state, dispatch } = useApp()
  const [deleteId, setDeleteId] = useState(null)

  function toggleStatus(flow) {
    dispatch(actions.updateEmailFlow({ id: flow.id, status: flow.status === 'active' ? 'paused' : 'active' }))
  }

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title="Email Flows" subtitle="Automated email sequences triggered by subscriber actions." />

      {state.emailFlows.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
            title="No email flows yet"
            description="Not built yet — this section is a placeholder for automated email sequences."
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
