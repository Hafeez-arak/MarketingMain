-- ─── Each lead mailbox's own email signature, for its auto-replies ─────────
-- 2026-10-29. Auto-replies must end with the signature the mailbox already
-- uses in Outlook ("Thanks & Regards!", the ARAK logo, Customer Care &
-- Business Support, the disclaimer, the green banner). Outlook keeps
-- signatures where the API cannot read them, so
-- scripts/lead-qualifier/copy-signature.mjs copies it from an email or draft
-- in that mailbox: its <div id="Signature"> HTML plus the inline pictures
-- it points at.
--
-- reply_signature = { html, images: [{ cid, name, type, bytes (base64) }],
--                     copied_from, copied_at }
-- Empty means "not copied yet": the reply then ends with a plain
-- "Best Regards, / ARAK Lighting".
--
-- Read like the rest of the row (admins and sales seats); written only with
-- the service key. Applied by hand. Safe to re-run.

alter table public.lead_mailboxes add column if not exists reply_signature jsonb not null default '{}'::jsonb;
