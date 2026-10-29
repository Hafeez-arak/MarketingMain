import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { Skeleton } from '../../components/ui/index'
import { Notice } from '../email/parts'
import { REPLY_SIGNATURE } from '../../lib/leads/autoReply'

// ─── Test: the replies leads WOULD get (2026-10-29) ────────────────────────
// Before any auto-reply is sent, the owner and the sales admin read what the
// agent wrote for the last 15 qualified leads (scripts/lead-qualifier/reply-test.mjs
// stores them as lead_replies status 'test'). Nothing here is ever sent, and
// the tab is read only. RLS shows the rows to whoever may approve leads.

const day = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Riyadh' }) : '')
const cameIn = (lead) => (lead?.source === 'website_form' ? 'Website form' : lead?.mailbox || 'Email')

function ReplyCard({ row }) {
  const lead = row.lead || {}
  const review = (lead.human_verdict || lead.verdict) === 'needs_review'
  return (
    <div className="bg-white border border-border grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="p-4 space-y-1.5 border-b md:border-b-0 md:border-r border-border min-w-0">
        <p className="text-sm font-semibold text-text break-words">{lead.company || lead.name || lead.email || 'Unknown sender'}</p>
        <p className="text-[11px] text-text-tertiary">{day(lead.received_at)} · {cameIn(lead)}</p>
        {review && <p className="text-[11px] font-semibold text-amber-800">Needs review: replied only if the sales admin approves it</p>}
        <p className="text-xs text-text-secondary break-words"><span className="text-text-tertiary">They asked: </span>{lead.summary || lead.subject || '—'}</p>
      </div>
      <div className="p-4 min-w-0">
        {row.skip_reason
          ? <p className="text-xs text-amber-800">No reply. {row.skip_reason}</p>
          : <>
            <p className="text-xs font-semibold text-text pb-2 mb-3 border-b border-border break-words">{row.subject}</p>
            <p className="text-[13px] text-text leading-relaxed whitespace-pre-wrap break-words">{`${row.body}\n\n\n${REPLY_SIGNATURE.join('\n')}`}</p>
          </>}
      </div>
    </div>
  )
}

export default function ReplyTest({ workspaceId, refreshKey }) {
  const [loaded, setLoaded] = useState({ for: null, rows: [], error: '' })

  useEffect(() => {
    if (!workspaceId) return
    let live = true
    supabase.from('lead_replies')
      .select('id,subject,body,skip_reason,created_at,lead:leads(name,company,email,source,mailbox,received_at,summary,subject,verdict,human_verdict)')
      .eq('workspace_id', workspaceId).eq('status', 'test')
      .then(({ data, error }) => {
        if (!live) return
        const rows = (data || []).sort((a, b) => String(b.lead?.received_at || '').localeCompare(String(a.lead?.received_at || '')))
        setLoaded({ for: workspaceId, rows, error: error ? error.message : '' })
      })
    return () => { live = false }
  }, [workspaceId, refreshKey])

  const loading = loaded.for !== workspaceId
  const written = loaded.rows.filter((r) => !r.skip_reason).length

  return (
    <div className="space-y-3">
      <Notice tone="sky" title="Test replies: nothing is sent">
        The reply each of the last 15 qualified leads would get. Read them and say what to change. Replies start going out only after you approve them.
      </Notice>
      {loaded.error && <Notice tone="red" title="The test replies did not load">{loaded.error}</Notice>}
      {loading
        ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}</div>
        : !loaded.error && (loaded.rows.length
          ? <>
            <p className="text-xs text-text-tertiary">{written} {written === 1 ? 'reply' : 'replies'} for {loaded.rows.length} {loaded.rows.length === 1 ? 'lead' : 'leads'}, newest first, each with the info@ account&apos;s own signature.</p>
            {loaded.rows.map((r) => <ReplyCard key={r.id} row={r} />)}
          </>
          : <p className="text-xs text-text-tertiary">No test replies have been written yet.</p>)}
    </div>
  )
}
