#!/usr/bin/env node
// ─── One-time: which folder each stored email lead sits in ─────────────────
// Leads read before 2026-10-11 have no folder. This asks Microsoft, read
// only, where each one is now (Inbox, Junk, ...) by its Message-ID and fills
// leads.folder. Mail that has since been deleted for good stays blank.
//
//   node --env-file=.env scripts/lead-qualifier/backfill-folders.mjs [--dry]

import { db } from '../../api/agent/_supabase.js'
import { leadDeps } from '../../api/leads/_deps.js'
import { accessToken, folderNames, folderOf } from '../../api/leads/_mail.js'

const dry = process.argv.includes('--dry')
const deps = leadDeps()
const GRAPH = 'https://graph.microsoft.com/v1.0'
const mailboxes = await db('lead_mailboxes?status=eq.active&select=*') || []
const tally = {}
for (const mb of mailboxes) {
  const tok = await accessToken(deps, mb)
  if (tok.error) { console.log(`${mb.label || mb.email}: ${tok.error.reason || tok.error.message}`); continue }
  const names = await folderNames(deps, tok.token)
  const leads = await db(`leads?workspace_id=eq.${mb.workspace_id}&source=eq.email&mailbox=eq.${encodeURIComponent(mb.label || mb.email)}&folder=eq.&select=id,source_ref&limit=5000`) || []
  console.log(`${mb.label || mb.email}: ${leads.length} leads without a folder`)
  for (const l of leads) {
    const q = new URLSearchParams({ $filter: `internetMessageId eq '${l.source_ref.replace(/'/g, "''")}'`, $select: 'parentFolderId' })
    const r = await fetch(`${GRAPH}/me/messages?${q}`, { headers: { Authorization: `Bearer ${tok.token}` } })
    const j = r.ok ? await r.json() : null
    const folder = j?.value?.[0] ? folderOf(j.value[0], names) : ''
    tally[folder || '(gone)'] = (tally[folder || '(gone)'] || 0) + 1
    if (folder && !dry) await db(`leads?id=eq.${l.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { folder } })
  }
}
console.log(dry ? 'Dry run, nothing written:' : 'Written:', tally)
