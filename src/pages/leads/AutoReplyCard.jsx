import { useEffect, useState } from 'react'
import { Spinner, Skeleton, Toggle, ConfirmDialog } from '../../components/ui/index'
import { leadsApi } from '../../lib/leads/client'

// ─── Auto-replies, on Agent settings (2026-10-29) ──────────────────────────
// The switch, whether each mailbox has its signature, and what was sent.
// The signatures are set up behind the scenes (no copy button since
// 2026-10-29: the owner had it removed so nobody overwrites them). Switching
// on stores the moment: only leads that arrive after it are answered
// (api/leads/_reply.js). Before the database has the columns (migration
// 20261107), the card says so and changes nothing.

const when = (s) => (s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }) : '')

export default function AutoReplyCard({ workspaceId, onError }) {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    let live = true
    leadsApi('auto_reply_status', workspaceId).then((r) => { if (live) setState(r.error ? { error: r.error } : r) })
    return () => { live = false }
  }, [workspaceId])

  async function setOn(on) {
    setBusy('switch')
    const r = await leadsApi('set_auto_reply', workspaceId, { on })
    setBusy('')
    if (r.error) return onError(r.error)
    setState((s) => ({ ...s, since: r.since }))
  }

  const on = Boolean(state?.since)
  const counts = state?.counts || {}

  return (
    <div className="bg-white border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">Auto-replies</p>
          <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">
            Every qualified lead gets a short acknowledgement 15–20 minutes after its email arrives, from the mailbox it came to, with that mailbox&apos;s own signature (a CLB email from the CLB mailbox, with CLB&apos;s). Website enquiries are answered from the company&apos;s own website mailbox. A needs-review lead gets one after you approve it. No reply when someone here already answered, or for the same request again within 14 days.
          </p>
        </div>
        {state?.ready && (
          <div className="flex-shrink-0">
            {busy === 'switch' ? <Spinner size="sm" /> : <Toggle checked={on} onChange={(v) => (v ? setConfirming(true) : setOn(false))} label={on ? 'On' : 'Off'} />}
          </div>
        )}
      </div>

      {!state ? <Skeleton className="h-16 w-full" />
        : state.error ? <p className="text-xs text-red-700">{state.error}</p>
          : !state.ready ? <p className="text-xs text-amber-800">Waiting for a database update before auto-replies can be switched on.</p>
            : (
              <>
                <p className="text-xs text-text-secondary">
                  {on ? <>On since {when(state.since)}. Leads from before then are never answered.</> : 'Off. Nothing is sent.'}
                  {(counts.sent || counts.skipped || counts.failed || counts.due) ? ` Sent ${counts.sent || 0}, waiting ${counts.due || 0}, skipped ${counts.skipped || 0}, failed ${counts.failed || 0}.` : ''}
                </p>
                <div className="space-y-2">
                  {(state.mailboxes || []).map((mb) => (
                    <div key={mb.id} className="border-t border-border pt-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-text truncate">{mb.label || mb.email}</p>
                        <p className="text-[11px] text-text-tertiary">
                          {!mb.can_send ? 'Read only: it cannot send replies.'
                            : mb.signature ? 'Signature ready.'
                              : 'No signature yet: its replies wait until one is set up (at most two hours).'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} onConfirm={() => setOn(true)}
        title="Switch auto-replies on?"
        message="From now on, every new qualified lead gets an email 15–20 minutes after it arrives. Leads that came in before now are not answered." />
    </div>
  )
}
