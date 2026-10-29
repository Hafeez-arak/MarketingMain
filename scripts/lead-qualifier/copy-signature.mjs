#!/usr/bin/env node
// ─── Copy a lead mailbox's Outlook signature for its auto-replies ─────────
// Outlook keeps signatures where the Graph API cannot read them, so this
// copies it from the newest draft or sent email in that mailbox that carries
// it (<div id="Signature">), with its inline pictures, into
// lead_mailboxes.reply_signature. Run it again after the signature changes
// in Outlook. Reads the mailbox with the token the lead agent already holds;
// sends nothing.
//
//   node --env-file=.env scripts/lead-qualifier/copy-signature.mjs --mailbox info@arak-sa.com
//
// The easiest source: in Outlook, start a new email from that account so the
// signature is added, and leave it in Drafts.

import { db } from '../../api/agent/_supabase.js'
import { leadDeps } from '../../api/leads/_deps.js'
import { accessToken } from '../../api/leads/_mail.js'
import { signatureFromBody } from '../../src/lib/leads/autoReply.js'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const label = arg('mailbox', 'info@arak-sa.com').toLowerCase()
const GRAPH = 'https://graph.microsoft.com/v1.0'

const [mb] = await db(`lead_mailboxes?or=(label.eq.${encodeURIComponent(label)},email.eq.${encodeURIComponent(label)})&select=*`) || []
if (!mb) throw new Error(`No lead mailbox ${label}.`)
const tok = await accessToken(leadDeps(), mb)
if (tok.error) throw new Error(tok.error.message || String(tok.error))
const H = { Authorization: `Bearer ${tok.token}` }

let found = null
for (const folder of ['drafts', 'sentitems']) {
  const q = new URLSearchParams({ $top: '50', $select: 'id,subject,lastModifiedDateTime,body' })
  const j = await (await fetch(`${GRAPH}/me/mailFolders/${folder}/messages?${q}`, { headers: H })).json()
  if (j.error) throw new Error(`${folder}: ${j.error.message}`)
  const withSig = (j.value || [])
    .filter((m) => /<div[^>]*\bid="Signature"/i.test(m.body?.content || ''))
    .sort((a, b) => b.lastModifiedDateTime.localeCompare(a.lastModifiedDateTime))
  if (withSig.length) { found = { ...withSig[0], folder }; break }
}
if (!found) throw new Error(`No draft or sent email in ${label} carries the Outlook signature. Start a new email from that account in Outlook (the signature is added) and leave it in Drafts.`)

const atts = await (await fetch(`${GRAPH}/me/messages/${found.id}/attachments`, { headers: H })).json()
if (atts.error) throw new Error(atts.error.message)
const sig = signatureFromBody(found.body.content, atts.value || [])
if (!sig) throw new Error('The signature block was empty.')

await db(`lead_mailboxes?id=eq.${mb.id}`, {
  method: 'PATCH', prefer: 'return=minimal',
  body: { reply_signature: { ...sig, copied_from: `${found.folder}: ${found.subject || '(no subject)'}`, copied_at: new Date().toISOString() } },
})
console.log(`Copied ${label}'s signature from ${found.folder} (${found.lastModifiedDateTime}): ${sig.html.length} characters, ${sig.images.length} pictures.`)
