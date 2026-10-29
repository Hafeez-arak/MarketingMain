#!/usr/bin/env node
// ─── Copy a lead mailbox's Outlook signature for its auto-replies ─────────
// The same as "Copy signature from Outlook" on Agent settings
// (api/leads/_reply.js copySignature): Outlook keeps signatures where the
// Graph API cannot read them, so it is copied from the newest draft or sent
// email in that mailbox that carries it (<div id="Signature">), with its
// inline pictures, into lead_mailboxes.reply_signature. Sends nothing.
//
//   node --env-file=.env scripts/lead-qualifier/copy-signature.mjs --mailbox info@arak-sa.com

import { db } from '../../api/agent/_supabase.js'
import { leadDeps } from '../../api/leads/_deps.js'
import { copySignature } from '../../api/leads/_reply.js'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const label = arg('mailbox', 'info@arak-sa.com').toLowerCase()

const [mb] = await db(`lead_mailboxes?or=(label.eq.${encodeURIComponent(label)},email.eq.${encodeURIComponent(label)})&select=id,workspace_id`) || []
if (!mb) throw new Error(`No lead mailbox ${label}.`)
const out = await copySignature(leadDeps(), { workspaceId: mb.workspace_id, mailboxId: mb.id })
if (out.error) throw new Error(out.error)
console.log(`Copied ${label}'s signature from ${out.from}: ${out.pictures} pictures.`)
