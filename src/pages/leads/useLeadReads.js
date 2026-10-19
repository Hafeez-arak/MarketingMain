import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchReads, fetchReadBefore, setLeadRead } from '../../lib/leads/client'
import { isUnread } from '../../lib/leads/view'

// ─── Which leads this person has opened (2026-10-19) ──────────────────────
// For the rows on screen: their reads, and the company's "everything before
// this is read" date. Opening a lead marks it read at once on screen and
// then in the database; "Mark unread" takes it back. A failed read leaves
// the dot showing, which is the honest answer.

export function useLeadReads(workspaceId, me, rows = []) {
  const [readBefore, setReadBefore] = useState({ ws: null, at: null })
  const [reads, setReads] = useState(() => new Set())
  const ids = useMemo(() => rows.map((r) => r.id), [rows])
  const key = ids.join(',')

  useEffect(() => {
    if (!workspaceId || readBefore.ws === workspaceId) return
    let live = true
    fetchReadBefore(workspaceId).then((at) => { if (live) setReadBefore({ ws: workspaceId, at }) }).catch(() => { if (live) setReadBefore({ ws: workspaceId, at: null }) })
    return () => { live = false }
  }, [workspaceId, readBefore.ws])

  useEffect(() => {
    if (!workspaceId || !me || !key) return
    let live = true
    fetchReads(workspaceId, key.split(',')).then((got) => {
      if (live) setReads((cur) => new Set([...cur, ...got]))
    }).catch(() => {})
    return () => { live = false }
  }, [workspaceId, me, key])

  const ready = readBefore.ws === workspaceId
  const unread = useCallback((lead) => ready && Boolean(me) && isUnread(lead, reads, readBefore.at), [ready, me, reads, readBefore.at])

  const mark = useCallback(async (lead, read = true) => {
    if (!me || !lead?.id) return
    setReads((cur) => {
      const next = new Set(cur)
      if (read) next.add(lead.id); else next.delete(lead.id)
      return next
    })
    const err = await setLeadRead(workspaceId, lead.id, me, read)
    if (err) setReads((cur) => {
      const back = new Set(cur)
      if (read) back.delete(lead.id); else back.add(lead.id)
      return back
    })
  }, [workspaceId, me])

  return { unread, mark }
}
