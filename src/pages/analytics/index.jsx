import { useNavigate } from 'react-router-dom'
import { useApp } from '../../store/appStore'
import { Card, Button, PlatformPill, Empty } from '../../components/ui/index'

const PLATFORMS = ['instagram','facebook','linkedin','tiktok','x']

export function Analytics() {
  const { state } = useApp()
  const navigate  = useNavigate()

  const hasData = state.posts.length > 0 || state.campaigns.length > 0
  const connectedAny = Object.values(state.connectedAccounts).some(Boolean)

  return (
    <div className="max-w-7xl space-y-5">
      {/* Overview cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total posts created', value: state.posts.length },
          { label: 'Scheduled', value: state.posts.filter(p=>p.status==='scheduled').length },
          { label: 'Published', value: state.posts.filter(p=>p.status==='published').length },
          { label: 'Campaigns', value: state.campaigns.length },
        ].map(s => (
          <Card key={s.label} className="p-5 text-center">
            <p className="text-3xl font-bold text-text mb-1">{s.value}</p>
            <p className="text-xs text-text-secondary">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Platform breakdown */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-text">Posts by platform</h3>
          <p className="text-xs text-text-secondary mt-0.5">Content created across all connected channels</p>
        </div>
        {state.posts.length === 0 ? (
          <Empty
            icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>}
            title="No data yet"
            description="Create and publish posts to start seeing platform breakdown here."
            action={<Button onClick={() => navigate('/social')}>Create first post</Button>}
          />
        ) : (
          <div className="divide-y divide-border">
            {PLATFORMS.map(platform => {
              const platformPosts = state.posts.filter(p => p.platform === platform)
              const published     = platformPosts.filter(p => p.status === 'published').length
              const scheduled     = platformPosts.filter(p => p.status === 'scheduled').length
              if (platformPosts.length === 0) return null
              return (
                <div key={platform} className="flex items-center gap-4 px-5 py-4">
                  <PlatformPill platform={platform} />
                  <div className="flex-1 grid grid-cols-3 gap-4 text-sm">
                    <div><span className="text-text font-medium">{platformPosts.length}</span><span className="text-text-tertiary text-xs ml-1">total</span></div>
                    <div><span className="text-text font-medium">{scheduled}</span><span className="text-text-tertiary text-xs ml-1">scheduled</span></div>
                    <div><span className="text-text font-medium">{published}</span><span className="text-text-tertiary text-xs ml-1">published</span></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Connect accounts prompt */}
      {!connectedAny && (
        <Card className="p-6 border-dashed bg-surface-muted">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="m15 7-8.5 8.5a2.12 2.12 0 0 0 3 3L18 10a4.24 4.24 0 0 0-6-6l-8.5 8.5a6.36 6.36 0 0 0 9 9L21 13"/></svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-text mb-1">Connect your social accounts</h3>
              <p className="text-sm text-text-secondary mb-3">Connect Instagram, Facebook, LinkedIn, TikTok and X to start tracking real performance data — reach, engagement, and follower growth.</p>
              <Button onClick={() => navigate('/integrations')}>Connect accounts</Button>
            </div>
          </div>
        </Card>
      )}

      {/* Campaigns table */}
      {state.campaigns.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-semibold text-text">Campaign activity</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary">Campaign</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary">Platforms</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary">Posts</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {state.campaigns.map(c => {
                const campaignPosts = state.posts.filter(p => p.campaignId === c.id)
                return (
                  <tr key={c.id} className="hover:bg-surface-muted transition-colors">
                    <td className="px-5 py-3 font-medium text-text">{c.name}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">{(c.platforms||[]).map(p=><PlatformPill key={p} platform={p}/>)}</div>
                    </td>
                    <td className="px-5 py-3 text-text-secondary">{campaignPosts.length}</td>
                    <td className="px-5 py-3 capitalize text-text-secondary">{c.status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
