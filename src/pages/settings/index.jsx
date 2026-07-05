import { useState } from 'react'
import { useApp, actions } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
import { Card, WarmCard, Button, Input, Select, Toggle, Avatar, Modal, ConfirmDialog } from '../../components/ui/index'
import { uid, PLATFORM_META } from '../../lib/utils'

// ─── Workspace / Supabase status ────────────────────────────────────────────
// Phase 0 replaced manually-pasted Supabase credentials with real auth —
// this is now a read-only status card, not a form. Nothing here is
// editable because there's nothing left for a user to configure: the
// project URL/anon key are fixed in the app's build, and which workspace's
// data you see is determined by who you're signed in as.
function SupabaseConfig() {
  const { activeWorkspace } = useAuth()
  const isConfigured = !!activeWorkspace

  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#3ECF8E]">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21.362 9.354H12V.396a.396.396 0 0 0-.716-.233L2.203 12.424l-.401.562a1.04 1.04 0 0 0 .836 1.659H12v8.959a.396.396 0 0 0 .716.233l9.081-12.261.401-.562a1.04 1.04 0 0 0-.836-1.66z"/>
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium text-text text-sm">Workspace data store</p>
              {isConfigured
                ? <span className="text-[10px] bg-sage-100 text-sage-700 px-2 py-0.5 rounded-full font-semibold">● Connected</span>
                : <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">No active workspace</span>}
            </div>
            <p className="text-xs text-text-tertiary mt-0.5">
              {isConfigured
                ? `Signed in to "${activeWorkspace.name}". Your data is isolated to this workspace — nothing to configure.`
                : 'Try signing out and back in.'}
            </p>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ─── Workflow Webhooks ─────────────────────────────────────────────────────
const WORKFLOW_CONFIGS = [
  {
    platform: 'instagram',
    label: 'Instagram Workflow',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-instagram',
    description: 'Triggers AI content generation — captions, images, style switching.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="2" y="2" width="20" height="20" rx="5"/>
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'instagramReels',
    label: 'Instagram Reels Webhook',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-instagram-reels',
    description: 'Triggers the Reels workflow — FLUX cover image + Wan 2.5 I2V video generation.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#dc2743 50%,#bc1888 100%)' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'instagramSchedule',
    label: 'Instagram Schedule Webhook',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-instagram-schedule',
    description: 'Separate path for dispatching pre-planned monthly schedule entries.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'instagramScheduleRegen',
    label: 'Instagram Schedule — Regen Image',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-instagram-schedule-regen',
    description: 'Called when you click Regenerate Image on a scheduled post.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.27-4.93"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'linkedin',
    label: 'LinkedIn Workflow',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-linkedin',
    description: 'Triggers AI post generation — hooks, body copy, optional image.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#0A66C2]">
        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'linkedinSchedule',
    label: 'LinkedIn Schedule Webhook',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-linkedin-schedule',
    description: 'Separate path for dispatching pre-planned monthly schedule entries.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#0A66C2]">
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'linkedinScheduleRegen',
    label: 'LinkedIn Schedule — Regen Image',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-linkedin-schedule-regen',
    description: 'Called when you click Regenerate Image on a monthly schedule post.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#0A66C2]">
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.27-4.93"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'campaignPlanner',
    label: 'Campaign Planner Workflow',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-campaign-planner',
    description: 'Decomposes a stated goal into a dated set of post ideas across platforms. Returns a plan — never writes to Supabase itself.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#7c3aed,#a78bfa)' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.36-6.36l-2.12 2.12M8.76 15.24l-2.12 2.12m12.72 0l-2.12-2.12M8.76 8.76L6.64 6.64"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'instagramPlanGen',
    label: 'Instagram Plan Generation',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-ig-plan-generation',
    description: 'When a plan is approved, generates each approved Instagram idea (caption + image) into pending_review, ready to review before scheduling.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#f09433,#bc1888)' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>
      </div>
    ),
  },
  {
    platform: 'linkedinPlanGen',
    label: 'LinkedIn Plan Generation',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-li-plan-generation',
    description: 'When a plan is approved, generates each approved LinkedIn idea (hook/body + image) into pending_review, ready to review before scheduling.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#0A66C2' }}>
        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M4.98 3.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM3 9h4v12H3zM10 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.3c0-1.26-.02-2.9-1.77-2.9s-2.03 1.38-2.03 2.8V21h-4z"/></svg>
      </div>
    ),
  },
]

function WorkflowWebhooks() {
  const { state, dispatch } = useApp()
  const [drafts, setDrafts]   = useState(() => {
    const d = {}
    WORKFLOW_CONFIGS.forEach(c => { d[c.platform] = state.webhooks?.[c.platform] || '' })
    return d
  })
  const [saved,   setSaved]   = useState({})
  const [visible, setVisible] = useState({})

  function handleSave(platform) {
    const url = drafts[platform].trim()
    dispatch(actions.setWebhook(platform, url))
    // Normalise the draft to the trimmed value so isDirty resolves to false
    // right after saving (otherwise a trailing space keeps the button "dirty").
    setDrafts(d => ({ ...d, [platform]: url }))
    dispatch(actions.addNotification({ id: uid(), message: url ? `${platform} webhook saved.` : `${platform} webhook cleared.`, createdAt: new Date().toISOString() }))
    setSaved(s => ({ ...s, [platform]: true }))
    setTimeout(() => setSaved(s => ({ ...s, [platform]: false })), 2000)
  }

  return (
    <Card>
      <div className="px-6 py-5 border-b border-border">
        <h3 className="font-semibold text-text">Workflow Webhooks</h3>
        <p className="text-xs text-text-tertiary mt-0.5">Paste your n8n webhook URLs — the webapp calls these to trigger content generation.</p>
      </div>
      <div className="divide-y divide-border">
        {WORKFLOW_CONFIGS.map(cfg => {
          const isSet   = !!(state.webhooks?.[cfg.platform])
          const isDirty = drafts[cfg.platform] !== (state.webhooks?.[cfg.platform] || '')
          const show    = visible[cfg.platform]

          return (
            <div key={cfg.platform} className="p-6 space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                {cfg.icon}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-text text-sm">{cfg.label}</p>
                    {isSet
                      ? <span className="text-[10px] bg-sage-100 text-sage-700 px-2 py-0.5 rounded-full font-semibold">● Configured</span>
                      : <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">Not set</span>
                    }
                  </div>
                  <p className="text-xs text-text-tertiary mt-0.5">{cfg.description}</p>
                </div>
              </div>

              {/* URL input */}
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <input
                    type={show ? 'text' : 'password'}
                    name={`webhook-${cfg.platform}`}
                    placeholder={cfg.placeholder}
                    value={drafts[cfg.platform]}
                    onChange={e => setDrafts(d => ({ ...d, [cfg.platform]: e.target.value }))}
                    // A webhook URL is not a login password — stop password managers
                    // (1Password / LastPass / Chrome) from auto-refilling the masked
                    // field, which silently reverts edits and blocks replacing the URL.
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                    className="w-full rounded-xl border border-border bg-surface-subtle text-text text-xs px-3.5 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono placeholder:font-sans placeholder:text-text-tertiary transition-all"
                  />
                  <button onClick={() => setVisible(v => ({ ...v, [cfg.platform]: !v[cfg.platform] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text transition-colors">
                    {show
                      ? <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                </div>
                <button
                  onClick={() => handleSave(cfg.platform)}
                  disabled={!isDirty}
                  className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex-shrink-0 ${
                    saved[cfg.platform]
                      ? 'bg-sage-100 text-sage-700 border border-sage-200'
                      : isDirty
                        ? 'btn-amber'
                        : 'bg-surface-subtle text-text-tertiary border border-border cursor-not-allowed'
                  }`}>
                  {saved[cfg.platform]
                    ? '✓ Saved'
                    : (isDirty && !drafts[cfg.platform].trim() ? 'Clear' : 'Save')}
                </button>
              </div>

              {/* Helper */}
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-100">
                <svg className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  In n8n: click the <strong>Webhook</strong> node → copy the <strong>Production URL</strong>.
                  Use the <strong>Test URL</strong> while building to see live executions.
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Settings ──────────────────────────────────────────────────────────────
export function Settings() {
  const { state, dispatch } = useApp()
  const [showCreate, setShowCreate] = useState(false)
  const [newWsName, setNewWsName]   = useState('')
  const [editingId, setEditingId]   = useState(null)
  const [editName, setEditName]     = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const workspaces = state.workspaces || []
  const activeId   = state.activeWorkspaceId

  function handleCreate() {
    const name = newWsName.trim()
    if (!name) return
    const id = 'ws_' + Date.now().toString(36)
    dispatch(actions.createWorkspace({ id, name, createdAt: new Date().toISOString() }))
    setNewWsName('')
    setShowCreate(false)
  }

  function handleRename(id) {
    const name = editName.trim()
    if (!name) return
    dispatch(actions.renameWorkspace({ id, name }))
    setEditingId(null)
  }

  function handleDelete(id) {
    dispatch(actions.deleteWorkspace(id))
    setConfirmDelete(null)
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Card className="overflow-hidden">
        <div className="px-6 py-5 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-display font-semibold text-text text-lg">Workspaces</h3>
            <p className="text-xs text-text-tertiary mt-0.5">Each workspace is isolated — separate content, posts, and settings.</p>
          </div>
          <Button size="sm" onClick={() => { setShowCreate(true); setNewWsName('') }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            New Workspace
          </Button>
        </div>

        {/* Create inline form */}
        {showCreate && (
          <div className="px-6 py-4 border-b border-border bg-amber-50/40">
            <p className="text-xs font-semibold text-text-secondary mb-2">Workspace name</p>
            <div className="flex gap-2">
              <input
                autoFocus
                value={newWsName}
                onChange={e => setNewWsName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false) }}
                placeholder="e.g. Nour Interiors"
                className="flex-1 rounded-xl border border-border bg-white text-text text-sm px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all"
              />
              <Button size="sm" onClick={handleCreate} disabled={!newWsName.trim()}>Create</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Workspace list */}
        <ul className="divide-y divide-border">
          {workspaces.map(ws => {
            const isActive  = ws.id === activeId
            const isEditing = editingId === ws.id
            return (
              <li key={ws.id}
                className={`flex items-center gap-3 px-6 py-3.5 transition-colors ${isActive ? 'bg-amber-50/40' : 'hover:bg-surface-muted'}`}>
                {/* Avatar */}
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                  style={{ background: isActive ? 'linear-gradient(135deg,#96acb2,#4c5e61)' : 'linear-gradient(135deg,#929ca7,#4b5357)' }}>
                  {ws.name.charAt(0).toUpperCase()}
                </div>

                {/* Name / edit */}
                {isEditing ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(ws.id); if (e.key === 'Escape') setEditingId(null) }}
                    className="flex-1 rounded-lg border border-amber-300 bg-white text-text text-sm px-3 py-1 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text truncate">{ws.name}</p>
                    {isActive && <p className="text-[10px] text-amber-600 font-semibold">Active</p>}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <Button size="xs" onClick={() => handleRename(ws.id)} disabled={!editName.trim()}>Save</Button>
                      <Button size="xs" variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      {!isActive && (
                        <Button size="xs" variant="outline"
                          onClick={() => dispatch(actions.switchWorkspace(ws.id))}>
                          Switch
                        </Button>
                      )}
                      <button
                        onClick={() => { setEditingId(ws.id); setEditName(ws.name) }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text hover:bg-surface-subtle transition-colors"
                        title="Rename">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
                      </button>
                      {workspaces.length > 1 && (
                        <button
                          onClick={() => setConfirmDelete(ws)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Delete">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      {/* Danger Zone */}
      <Card className="p-6 border-red-200">
        <h3 className="font-semibold text-red-600 mb-2">Danger Zone</h3>
        <p className="text-xs text-text-secondary mb-4">Delete the active workspace. This is permanent and cannot be undone.</p>
        <Button variant="danger" size="sm"
          disabled={workspaces.length <= 1}
          onClick={() => setConfirmDelete(workspaces.find(w => w.id === activeId))}>
          Delete workspace
        </Button>
        {workspaces.length <= 1 && (
          <p className="text-[11px] text-text-tertiary mt-2">Create a second workspace before you can delete this one.</p>
        )}
      </Card>

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(26,20,16,0.35)', backdropFilter: 'blur(6px)' }}>
          <div className="bg-white rounded-2xl shadow-dropdown w-full max-w-sm border border-border animate-fade-scale p-6 space-y-4">
            <h3 className="font-display font-semibold text-text text-lg">Delete "{confirmDelete.name}"?</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              All content, posts, campaigns, and settings for this workspace will be permanently removed.
            </p>
            <div className="flex gap-3 pt-1">
              <Button variant="secondary" className="flex-1 justify-center" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" className="flex-1 justify-center" onClick={() => handleDelete(confirmDelete.id)}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Integrations ──────────────────────────────────────────────────────────
const thirdParty = [
  { id:'n8n',      name:'n8n',       desc:'Workflow automation',    category:'automation' },
  { id:'resend',   name:'Resend',    desc:'Email delivery',         category:'email' },
  { id:'openai',   name:'OpenAI',    desc:'AI content generation',  category:'ai' },
  { id:'supabase', name:'Supabase',  desc:'Database & storage',     category:'data' },
  { id:'stripe',   name:'Stripe',    desc:'Payments',               category:'payments' },
  { id:'zapier',   name:'Zapier',    desc:'No-code automation',     category:'automation' },
  { id:'slack',    name:'Slack',     desc:'Team notifications',     category:'messaging' },
  { id:'twilio',   name:'Twilio',    desc:'SMS & WhatsApp',         category:'messaging' },
]

export function Integrations() {
  const { state } = useApp()
  const platforms = Object.entries(PLATFORM_META)

  return (
    <div className="max-w-4xl space-y-6">
      {/* Supabase — needed for schedule auto-generation */}
      <SupabaseConfig />

      {/* Workflow Webhooks */}
      <WorkflowWebhooks />

      {/* Social platforms */}
      <Card className="overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <h3 className="font-semibold text-text">Social Accounts</h3>
          <p className="text-xs text-text-tertiary mt-0.5">Connect your social media accounts for direct publishing.</p>
        </div>
        <div className="divide-y divide-border">
          {platforms.map(([key, meta]) => {
            const connected = state.connectedAccounts?.[key]
            return (
              <div key={key} className="flex items-center gap-4 px-6 py-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-white text-xs`}
                  style={{ background: meta.color }}>
                  {meta.abbr}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-text text-sm">{meta.label}</p>
                  <p className="text-xs text-text-tertiary">{connected ? 'Connected' : 'Not connected'}</p>
                </div>
                <Button variant={connected ? 'secondary' : 'outline'} size="sm">
                  {connected ? 'Disconnect' : 'Connect'}
                </Button>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Third-party integrations */}
      <Card className="overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <h3 className="font-semibold text-text">Integrations</h3>
          <p className="text-xs text-text-tertiary mt-0.5">Connect tools to extend Campai's capabilities.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-5">
          {thirdParty.map(t => (
            <div key={t.id} className="flex items-center gap-3 p-3.5 rounded-xl border border-border hover:border-amber-300 hover:bg-amber-50/30 transition-all group">
              <div className="w-9 h-9 rounded-xl bg-surface-subtle flex items-center justify-center flex-shrink-0 text-xs font-bold text-text-secondary group-hover:bg-amber-100 group-hover:text-amber-700 transition-colors">
                {t.name.slice(0,2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-text text-sm">{t.name}</p>
                <p className="text-xs text-text-tertiary">{t.desc}</p>
              </div>
              <Button variant="ghost" size="xs">Connect</Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ─── Team ──────────────────────────────────────────────────────────────────
export function Team() {
  const { state, dispatch } = useApp()
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name:'', email:'', role:'editor' })

  function handleAdd() {
    if (!form.name || !form.email) return
    dispatch(actions.addTeamMember({ id: uid(), ...form, joinedAt: new Date().toISOString() }))
    setForm({ name:'', email:'', role:'editor' })
    setShowModal(false)
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-semibold text-text text-xl">Team</h2>
          <p className="text-sm text-text-secondary mt-0.5">{state.team.length + 1} member{state.team.length + 1 !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          Invite Member
        </Button>
      </div>

      <Card className="overflow-hidden">
        {/* Current user */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-border bg-amber-50/30">
          <Avatar name="Admin" size="md" />
          <div className="flex-1">
            <p className="font-semibold text-text text-sm">Admin (You)</p>
            <p className="text-xs text-text-tertiary">admin@arak.sa</p>
          </div>
          <span className="tag-amber">Owner</span>
        </div>

        {state.team.length === 0 ? (
          <div className="py-14 text-center">
            <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-stone-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <p className="text-sm text-text-secondary mb-3">No team members yet</p>
            <Button size="sm" onClick={() => setShowModal(true)}>Invite someone</Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {state.team.map(m => (
              <li key={m.id} className="flex items-center gap-4 px-6 py-4 hover:bg-surface-muted transition-colors">
                <Avatar name={m.name} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-text text-sm truncate">{m.name}</p>
                  <p className="text-xs text-text-tertiary">{m.email}</p>
                </div>
                <span className="text-xs capitalize text-text-secondary px-2 py-1 rounded-lg bg-surface-subtle">{m.role}</span>
                <Button variant="ghost" size="xs" onClick={() => dispatch(actions.removeTeamMember(m.id))}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Invite Team Member">
        <div className="p-6 space-y-4">
          <Input label="Full name" placeholder="e.g. Sara Ahmed" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <Input label="Email address" type="email" placeholder="sara@arak.sa" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <Select label="Role" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
            <option value="manager">Manager</option>
          </Select>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1 justify-center" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button className="flex-1 justify-center" onClick={handleAdd} disabled={!form.name || !form.email}>Send Invite</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
