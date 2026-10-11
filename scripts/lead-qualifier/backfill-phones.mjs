#!/usr/bin/env node
// ─── One-time: phone numbers for leads stored before 2026-10-11 ────────────
// Every lead gets the numbers written in its text (free, in code). A lead or
// a doubtful one with none in its text also has its signature picture read,
// found by Message-ID in the mailbox that read it (read only), one small
// model call each.
//
//   node --env-file=.env scripts/lead-qualifier/backfill-phones.mjs [--dry] [--no-images]

import { db } from '../../api/agent/_supabase.js'
import { leadDeps } from '../../api/leads/_deps.js'
import { accessToken, signatureImages } from '../../api/leads/_mail.js'
import { askPhonesInImages } from '../../api/leads/_intake.js'
import { extractPhones, mergePhones } from '../../src/lib/leads/qualify.js'

const dry = process.argv.includes('--dry')
const images = !process.argv.includes('--no-images')
const deps = leadDeps()
const GRAPH = 'https://graph.microsoft.com/v1.0'
const leads = []
for (let from = 0; ; from += 1000) {
  const page = await db(`leads?verdict=neq.duplicate&select=id,workspace_id,source,source_ref,mailbox,phone,message,verdict,human_verdict&order=id&offset=${from}&limit=1000`) || []
  leads.push(...page)
  if (page.length < 1000) break
}
const mailboxes = await db('lead_mailboxes?status=eq.active&select=*') || []
const tokens = {}
const tally = { text: 0, picture: 0, none: 0, written: 0 }
for (const l of leads) {
  let phones = mergePhones([l.phone], extractPhones(l.message))
  if (phones.length) tally.text++
  const verdict = l.human_verdict || l.verdict
  if (!phones.length && images && l.source === 'email' && ['qualified', 'needs_review'].includes(verdict)) {
    const mb = mailboxes.find((m) => (m.label || m.email) === l.mailbox)
    if (mb) {
      tokens[mb.id] ||= (await accessToken(deps, mb)).token
      const q = new URLSearchParams({ $filter: `internetMessageId eq '${l.source_ref.replace(/'/g, "''")}'`, $select: 'id' })
      const r = await fetch(`${GRAPH}/me/messages?${q}`, { headers: { Authorization: `Bearer ${tokens[mb.id]}` } })
      const id = r.ok ? (await r.json())?.value?.[0]?.id : null
      if (id) {
        const pics = await signatureImages(deps, tokens[mb.id], id)
        phones = dry ? [] : await askPhonesInImages(deps, { workspaceId: l.workspace_id, images: pics })
        if (dry && pics.length) console.log(`${l.id}: ${pics.length} picture(s) to read`)
        if (phones.length) tally.picture++
      }
    }
  }
  if (!phones.length) { tally.none++; continue }
  if (!dry) { await db(`leads?id=eq.${l.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { phones } }); tally.written++ }
}
console.log(dry ? 'Dry run:' : 'Done:', leads.length, 'leads', tally)
