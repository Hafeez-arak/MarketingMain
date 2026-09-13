import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { Button, Select } from './ui/index'
import { fetchPlans, sendIdeasToPlan } from '../lib/contentPlans'

// ─── Sending a run's ideas into a plan ─────────────────────────────────────
// The control that closes the loop. Before this, the agent's most actionable
// output — "rivals are all running Ramadan content and we are not" turned into
// a concrete post idea — was a paragraph someone had to retype into the
// planner, which meant in practice it was read and forgotten every week.
//
// WHY A PLAN PICKER AND NOT A SINGLE BUTTON:
//
// `plan_ideas.plan_id` is required, and that constraint is right rather than
// inconvenient. An idea has to be FOR something — a month, a campaign — and
// which one is a judgement about priorities that the run has no basis to make.
// So the person picks, and the picking is the approval to start work.
//
// The ideas land as `proposed`, the same status the planner's own generated
// ideas arrive in, so they meet the approve/reject that already exists there.
// No second approval surface — RESEARCH-AGENT.md §8b.

export function SendIdeasToPlan({ ideas }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [plans, setPlans] = useState([])
  const [planId, setPlanId] = useState('')
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!activeWorkspaceId || !accessToken) return undefined
    let cancelled = false
    fetchPlans(activeWorkspaceId, accessToken).then(rows => {
      if (cancelled) return
      const list = rows || []
      setPlans(list)
      // Preselect the newest plan. The list is already ordered created_at
      // desc, and defaulting to "choose one" for a workspace with exactly one
      // plan is a click that carries no information.
      if (list.length && !planId) setPlanId(list[0].id)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken, planId])

  const send = useCallback(async () => {
    setSending(true)
    setNote('')
    const plan = plans.find(p => p.id === planId)
    const out = await sendIdeasToPlan({
      workspaceId: activeWorkspaceId,
      accessToken,
      planId,
      planName: plan?.name || '',
      ideas,
      // The plan's own first platform, not a hardcoded Instagram. A LinkedIn
      // plan receiving Instagram-tagged ideas is the kind of wrong that is
      // only noticed at publish time.
      platform: plan?.platforms?.[0] || 'instagram',
    })
    setNote(out.error ? out.error : out.note)
    setSending(false)
  }, [activeWorkspaceId, accessToken, planId, plans, ideas])

  if (!ideas?.length) return null

  // A workspace with no plan cannot receive an idea, and saying so with a way
  // out beats a disabled button with no explanation.
  if (!plans.length) {
    return (
      <div className="mt-3 flex items-center gap-2 text-[11px] text-text-tertiary">
        <span>No content plan exists yet — an idea has to belong to one.</span>
        <Link to="/campaigns" className="underline hover:text-text-secondary">Create a plan</Link>
      </div>
    )
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px]">
          <Select
            label="Send these to"
            value={planId}
            onChange={e => setPlanId(e.target.value)}
            className="text-xs"
          >
            {plans.map(p => (
              <option key={p.id} value={p.id}>{p.name || p.month || 'Untitled plan'}</option>
            ))}
          </Select>
        </div>
        <Button size="sm" onClick={send} disabled={sending || !planId}>
          {sending ? 'Sending…' : `Send ${ideas.length} to planner`}
        </Button>
      </div>
      {note && <p className="mt-2 text-[11px] text-text-secondary">{note}</p>}
      <p className="mt-1.5 text-[11px] text-text-tertiary">
        They arrive as proposals and still need approving in the planner, with the finding
        that produced them attached.
      </p>
    </div>
  )
}
