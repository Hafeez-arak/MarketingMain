import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { Skeleton } from '../../components/ui/index'
import { Notice } from '../email/parts'
import { replyPreviewHtml, replyHtml, websiteFromContact } from '../../lib/leads/autoReply'

// ─── Test: the replies leads WOULD get (2026-10-29) ────────────────────────
// Before any auto-reply is sent, the owner and the sales admin read what the
// agent wrote for the last 15 qualified leads (scripts/lead-qualifier/reply-test.mjs
// stores them as lead_replies status 'test'). Nothing here is ever sent, and
// the tab is read only. RLS shows the rows to whoever may approve leads.
//
// Each reply is shown as the email will look: the text, then the mailbox's
// own Outlook signature (lead_mailboxes.reply_signature, pictures included),
// never another mailbox's: a CLB email is answered from info@clb with CLB's
// signature. A website enquiry is answered from the mailbox on the company's
// website domain, as api/leads/_reply.js does. The email sits in a sandboxed
// frame: no script in it can run.

const day = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Riyadh' }) : '')
const cameIn = (lead) => (lead?.source === 'website_form' ? 'Website form' : lead?.mailbox || 'Email')

const domainOf = (e) => String(e || '').toLowerCase().split('@')[1] || ''

/** The mailbox a reply goes from: the one the email came to; a website enquiry, the one on the website's domain. */
function mailboxFor(lead, mailboxes, site) {
  const to = String(lead?.mailbox || '').toLowerCase()
  if (lead?.source !== 'website_form') return mailboxes.find((m) => to && (m.label?.toLowerCase() === to || m.email?.toLowerCase() === to)) || null
  return (site && mailboxes.find((m) => m.can_send && [domainOf(m.label), domainOf(m.email)].includes(site)))
    || mailboxes.find((m) => m.can_send) || null
}

function EmailFrame({ html }) {
  const [height, setHeight] = useState(320)
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0;padding:4px 2px">${html}</body></html>`
  return (
    <iframe title="The reply as the email will look" sandbox="allow-same-origin allow-popups" srcDoc={doc} className="w-full border-0 block" style={{ height }}
      onLoad={(e) => { try { setHeight(e.currentTarget.contentDocument.documentElement.scrollHeight + 8) } catch { /* keep the default */ } }} />
  )
}

function ReplyCard({ row, mailbox }) {
  const lead = row.lead || {}
  const review = (lead.human_verdict || lead.verdict) === 'needs_review'
  return (
    <div className="bg-white border border-border grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="p-4 space-y-1.5 border-b md:border-b-0 md:border-r border-border min-w-0">
        <p className="text-sm font-semibold text-text break-words">{lead.company || lead.name || lead.email || 'Unknown sender'}</p>
        <p className="text-[11px] text-text-tertiary">{day(lead.received_at)} · {cameIn(lead)}</p>
        {review && <p className="text-[11px] font-semibold text-amber-800">Needs review: replied only if the sales admin approves it</p>}
        <p className="text-xs text-text-secondary break-words"><span className="text-text-tertiary">They asked: </span>{lead.summary || lead.subject || '—'}</p>
        {!row.skip_reason && <p className="text-[11px] text-text-tertiary break-words">From {mailbox?.label || mailbox?.email || 'info@'}</p>}
      </div>
      <div className="p-4 min-w-0">
        {row.skip_reason
          ? <p className="text-xs text-amber-800">No reply. {row.skip_reason}</p>
          : <>
            <p className="text-xs font-semibold text-text pb-2 mb-3 border-b border-border break-words">{row.subject}</p>
            {mailbox?.reply_signature?.html
              ? <EmailFrame html={replyPreviewHtml(row.body, mailbox.reply_signature)} />
              : <>
                <EmailFrame html={replyHtml(row.body, { signature: [] })} />
                <p className="text-[11px] text-amber-800 mt-2">{mailbox ? `${mailbox.label || mailbox.email} has no signature copied yet, so this reply would wait instead of going.` : 'Its mailbox is not connected.'}</p>
              </>}
          </>}
      </div>
    </div>
  )
}

export default function ReplyTest({ workspaceId, refreshKey }) {
  const [loaded, setLoaded] = useState({ for: null, rows: [], mailboxes: [], site: '', error: '' })

  useEffect(() => {
    if (!workspaceId) return
    let live = true
    Promise.all([
      supabase.from('lead_replies')
        .select('id,subject,body,skip_reason,created_at,lead:leads(name,company,email,source,mailbox,received_at,summary,subject,verdict,human_verdict)')
        .eq('workspace_id', workspaceId).eq('status', 'test'),
      supabase.from('lead_mailboxes').select('id,email,label,can_send,reply_signature').eq('workspace_id', workspaceId).order('created_at'),
      // The website's domain names the mailbox website enquiries are answered from.
      supabase.from('brand_profile').select('contact_info').eq('workspace_id', workspaceId).maybeSingle(),
    ]).then(([replies, mbs, brand]) => {
      if (!live) return
      const rows = (replies.data || []).sort((a, b) => String(b.lead?.received_at || '').localeCompare(String(a.lead?.received_at || '')))
      // A mailbox read that fails only costs the signature (the plain one shows instead).
      setLoaded({ for: workspaceId, rows, mailboxes: mbs.data || [], site: websiteFromContact(brand.data?.contact_info), error: replies.error?.message || '' })
    })
    return () => { live = false }
  }, [workspaceId, refreshKey])

  const loading = loaded.for !== workspaceId
  const written = loaded.rows.filter((r) => !r.skip_reason).length

  return (
    <div className="space-y-3">
      <Notice tone="sky" title="Test replies: nothing is sent">
        The reply each of the last 15 qualified leads would get, as the email will look. Read them and say what to change. Replies start going out only after you approve them.
      </Notice>
      {loaded.error && <Notice tone="red" title="The test replies did not load">{loaded.error}</Notice>}
      {loading
        ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}</div>
        : !loaded.error && (loaded.rows.length
          ? <>
            <p className="text-xs text-text-tertiary">{written} {written === 1 ? 'reply' : 'replies'} for {loaded.rows.length} {loaded.rows.length === 1 ? 'lead' : 'leads'}, newest first, each with its mailbox&apos;s own signature.</p>
            {loaded.rows.map((r) => <ReplyCard key={r.id} row={r} mailbox={mailboxFor(r.lead, loaded.mailboxes, loaded.site)} />)}
          </>
          : <p className="text-xs text-text-tertiary">No test replies have been written yet.</p>)}
    </div>
  )
}
