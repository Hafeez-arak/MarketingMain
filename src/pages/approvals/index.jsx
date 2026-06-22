import { useApp, actions } from '../../store/appStore'
import { Card, Button, Badge, PlatformPill, Empty, PostImage } from '../../components/ui/index'
import { uid, formatDateTime } from '../../lib/utils'

export function Approvals() {
  const { state, dispatch } = useApp()

  function act(id, action) {
    dispatch(actions.updateApproval({ id, status: action }))
    dispatch(actions.addNotification({ id: uid(), message: `Approval ${action}.`, createdAt: new Date().toISOString() }))
  }

  const pending   = state.approvals.filter(a => a.status === 'pending')
  const completed = state.approvals.filter(a => a.status !== 'pending')

  return (
    <div className="max-w-7xl space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 text-center"><p className="text-2xl font-bold text-text">{pending.length}</p><p className="text-xs text-text-secondary mt-0.5">Pending</p></Card>
        <Card className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{state.approvals.filter(a=>a.status==='approved').length}</p><p className="text-xs text-text-secondary mt-0.5">Approved</p></Card>
        <Card className="p-4 text-center"><p className="text-2xl font-bold text-red-500">{state.approvals.filter(a=>a.status==='rejected').length}</p><p className="text-xs text-text-secondary mt-0.5">Rejected</p></Card>
      </div>

      {/* Pending */}
      {pending.length === 0 && completed.length === 0 ? (
        <Card>
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
            title="No approvals yet"
            description="When team members create posts, they will appear here for review."
          />
        </Card>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-text">Pending review</h3>
              {pending.map(a => (
                <Card key={a.id} className="p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <PlatformPill platform={a.platform} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text">{a.title}</p>
                      <p className="text-xs text-text-tertiary mt-0.5">{formatDateTime(a.createdAt)}</p>
                    </div>
                    <Badge status={a.status} />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="success" size="sm" onClick={() => act(a.id, 'approved')}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                      Approve
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => act(a.id, 'rejected')}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
                      Reject
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {completed.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-text text-sm text-text-secondary">Completed</h3>
              {completed.map(a => (
                <Card key={a.id} className="px-5 py-3 flex items-center gap-3 opacity-60">
                  <PlatformPill platform={a.platform} />
                  <p className="flex-1 text-sm text-text truncate">{a.title}</p>
                  <Badge status={a.status} />
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
