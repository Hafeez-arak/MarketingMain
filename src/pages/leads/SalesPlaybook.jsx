import { useAuth } from '../../store/auth'
import SalesShell from './SalesShell'
import Playbook from './Playbook'

// ─── The sales team's Playbook page (2026-11-07) ──────────────────────────
// The battle-card library in the sales app's side bar, beside Leads and
// Research: every seat reads it; a sales admin edits and reviews it.

export default function SalesPlaybook() {
  const { activeWorkspaceId } = useAuth()
  return (
    <SalesShell>
      {activeWorkspaceId ? <Playbook key={activeWorkspaceId} workspaceId={activeWorkspaceId} /> : null}
    </SalesShell>
  )
}
