import { useState } from 'react'
import { Button } from '../../components/ui/index'
import { Pagination } from '../../components/ui/Pagination'
import { STUCK_NEEDS_PERSON } from '../../lib/email/cold'
import { emailApi, fetchStuckSends } from '../../lib/email/client'
import { useCached, usePage, pageBeyond } from './data'
import { Notice } from './parts'
import { dateTime } from './format'

// ─── Emails stuck in 'sending' ─────────────────────────────────────────────
// A sending run that died while handing an email over leaves it 'sending',
// and it is never retried by itself (a duplicate cold email is worse than a
// lost one). The run settles what a Microsoft mailbox can prove from its Sent
// Items and Drafts; what is left here is a person's call. Three answers:
// it went out (follow-ups carry on), send it again, or drop it.
//
// Read here, 20 at a time with the total, for the whole workspace (the
// Overview) or one campaign (its page). Silent while it loads and when there
// are none: it is a warning, not a list.

const WAITING_FOR_RUN = 'Being checked against the mailbox. This settles itself on the next sending run.'
const SIZE = 20

export function StuckSends({ data, workspaceId, reload, campaignId = null }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const family = `stuck:${workspaceId}:${campaignId || ''}`
  const [page, setPage] = usePage(family)
  const read = useCached(workspaceId ? `${family}:${page}` : null,
    () => fetchStuckSends(workspaceId, { campaignId, page, size: SIZE }), { keep: family })
  const back = pageBeyond(read, page, SIZE)
  if (back != null) setPage(back)
  const rows = read.data?.rows || []
  const count = read.data?.count || 0
  if (!count) return null

  const campaignName = id => data.campaigns.find(c => c.id === id)?.name || 'a campaign'
  const mailbox = id => (data.mailboxes || []).find(m => m.id === id)
  // A Microsoft row the run has not looked at yet may still settle itself;
  // a person can answer anyway, but is told that.
  const pendingCheck = r => mailbox(r.mailbox_id)?.provider === 'microsoft' && r.error !== STUCK_NEEDS_PERSON.microsoft

  async function answer(row, outcome) {
    setBusy(`${row.id}:${outcome}`); setError('')
    const r = await emailApi('stuck_resolve', workspaceId, { send_id: row.id, outcome })
    setBusy('')
    if (r.error) setError(r.error)
    await reload()
  }

  return (
    <Notice tone="amber" title={`${count.toLocaleString()} email${count === 1 ? '' : 's'} may not have gone out`}>
      <p>
        The sending run stopped while handing {count === 1 ? 'this email' : 'these emails'} over, so nobody knows for sure whether {count === 1 ? 'it' : 'they'} left.
        Nothing is sent again without you, so no prospect gets the same email twice.
      </p>
      {error && <p className="text-red-600 mt-1.5">{error}</p>}
      <ul className={`mt-2 divide-y divide-amber-200 border-t border-amber-200 ${read.stale ? 'opacity-60' : ''}`}>
        {rows.map(r => (
          <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-text font-medium truncate">
                {r.email} <span className="font-normal text-text-tertiary">· {r.step ? `follow-up ${r.step}` : 'first email'}{campaignId ? '' : ` · ${campaignName(r.campaign_id)}`}</span>
              </p>
              <p className="text-[11px] text-text-tertiary">
                From {mailbox(r.mailbox_id)?.email || 'a removed mailbox'} · {dateTime(r.updated_at)}. {pendingCheck(r) ? WAITING_FOR_RUN : (r.error || STUCK_NEEDS_PERSON.smtp)}
              </p>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              <Button size="xs" variant="secondary" disabled={!!busy} onClick={() => answer(r, 'sent')}>It went out</Button>
              <Button size="xs" variant="secondary" disabled={!!busy} onClick={() => answer(r, 'retry')}>Send again</Button>
              <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => answer(r, 'drop')}>Drop it</Button>
            </div>
          </li>
        ))}
      </ul>
      <Pagination page={page} pageSize={SIZE} count={count} onPage={setPage} busy={read.stale} className="!px-0 border-amber-200" />
    </Notice>
  )
}
