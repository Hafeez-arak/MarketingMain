import { describe, it, expect, beforeEach } from 'vitest'
import { freshDatabase } from '../email/_e2e/db.js'

// ─── Enquirers → "Previously contacted …" groups, on a real Postgres ────────
// The rule lives in SQL (a trigger on leads), so it is tested against the
// real migrations the email harness builds (the lead ones included).

const WS = '00000000-0000-0000-0000-000000000001'
const ARAK = 'Previously contacted Arak'
const CLB = 'Previously contacted CLB'
const BOX_SINCE = '2026-10-02T18:47:00Z'

let pg
const q = async (sql, params) => (await pg.query(sql, params)).rows

async function lead({ email, verdict = 'qualified', source = 'email', mailbox = 'info@arak-sa.com', at = '2026-08-01T09:00:00Z', name = 'Sara Al Qahtani', ref, ...rest }) {
  const cols = { workspace_id: WS, source, source_ref: ref || `${email}-${Math.random()}`, received_at: at, name, company: 'Hotel Co', email, verdict, mailbox, ...rest }
  const keys = Object.keys(cols)
  const [row] = await q(`insert into leads (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(cols))
  return row.id
}
const groupsOf = async email => (await q(`
  select g.name from email_group_members m join email_groups g on g.id = m.group_id
  join email_contacts c on c.id = m.contact_id where c.email = $1 order by 1`, [email])).map(r => r.name)
const contact = async email => (await q('select * from email_contacts where email = $1', [email]))[0]

beforeEach(async () => {
  pg = await freshDatabase()
  await pg.exec(`
    insert into public.workspaces (id, name) values ('${WS}', 'Arak');
    insert into lead_agent_settings (workspace_id, website_contact_group, website_consent_since) values ('${WS}', '${ARAK}', '${BOX_SINCE}');
    insert into lead_mailboxes (workspace_id, email, label, contact_group) values
      ('${WS}', 'a.rak@arak-sa.com', 'info@arak-sa.com', '${ARAK}'),
      ('${WS}', 'info@clb-sa.com', 'info@clb-sa.com', '${CLB}');`)
})

describe('previously contacted groups', () => {
  it('a real enquirer becomes a marketing contact in their mailbox\'s group', async () => {
    await lead({ email: ' Sara@Hotel.SA ', at: '2026-08-01T22:30:00Z' })
    expect(await groupsOf('sara@hotel.sa')).toEqual([ARAK])
    expect(await contact('sara@hotel.sa')).toMatchObject({
      audience: 'marketing', consent: 'business_contact', status: 'active', source: 'enquiry',
      first_name: 'Sara', last_name: 'Al Qahtani', company: 'Hotel Co',
      notes: 'Contacted us 2026-08-02 at info@arak-sa.com', // Riyadh date
    })
    const [g] = await q('select audience from email_groups where name = $1', [ARAK])
    expect(g.audience).toBe('marketing')
  })

  it('needs review joins; job seekers, vendors and errors never do', async () => {
    await lead({ email: 'maybe@co.sa', verdict: 'needs_review' })
    await lead({ email: 'cv@gmail.com', verdict: 'unqualified', category: 'job_or_recruitment' })
    await lead({ email: 'pending@co.sa', verdict: null, error: 'model failed' })
    expect(await groupsOf('maybe@co.sa')).toEqual([ARAK])
    expect(await contact('cv@gmail.com')).toBeUndefined()
    expect(await contact('pending@co.sa')).toBeUndefined()
  })

  it('CLB mail feeds the CLB group; one person can be in both', async () => {
    await lead({ email: 'buyer@co.sa', mailbox: 'info@clb-sa.com' })
    expect(await groupsOf('buyer@co.sa')).toEqual([CLB])
    await lead({ email: 'buyer@co.sa' })
    expect(await groupsOf('buyer@co.sa')).toEqual([ARAK, CLB])
  })

  it('the team overruling the agent takes them out, and back in', async () => {
    const id = await lead({ email: 'vendor@co.sa' })
    expect(await groupsOf('vendor@co.sa')).toEqual([ARAK])
    await q(`update leads set human_verdict = 'unqualified' where id = $1`, [id])
    expect(await groupsOf('vendor@co.sa')).toEqual([])
    expect(await contact('vendor@co.sa')).toBeTruthy() // the contact stays, only the group goes
    await q(`update leads set human_verdict = 'qualified' where id = $1`, [id])
    expect(await groupsOf('vendor@co.sa')).toEqual([ARAK])
  })

  it('one unqualified email does not undo another real enquiry', async () => {
    await lead({ email: 'mixed@co.sa' })
    await lead({ email: 'mixed@co.sa', verdict: 'unqualified' })
    expect(await groupsOf('mixed@co.sa')).toEqual([ARAK])
  })

  it('a duplicate follows the lead it repeats, even from another address', async () => {
    const original = await lead({ email: 'pm@co.sa', verdict: 'needs_review' })
    await lead({ email: 'colleague@co.sa', verdict: 'duplicate', duplicate_of: original })
    expect(await groupsOf('colleague@co.sa')).toEqual([ARAK])
    await q(`update leads set human_verdict = 'unqualified' where id = $1`, [original])
    expect(await groupsOf('colleague@co.sa')).toEqual([])
  })

  it('website: before the box anyone counts; after it only a ticked box', async () => {
    await lead({ email: 'old@co.sa', source: 'website_form', mailbox: '', at: '2026-09-20T10:00:00Z' })
    await lead({ email: 'unticked@co.sa', source: 'website_form', mailbox: '', at: '2026-10-05T10:00:00Z' })
    expect(await groupsOf('old@co.sa')).toEqual([ARAK])
    expect(await contact('unticked@co.sa')).toBeUndefined()

    // Ticked: websiteSignup records the opt-in (the lead may come first or second).
    await q(`insert into email_contacts (workspace_id, email, consent, source) values ($1, 'ticked@co.sa', 'opted_in', 'website')`, [WS])
    await lead({ email: 'ticked@co.sa', source: 'website_form', mailbox: '', at: '2026-10-05T10:00:00Z' })
    expect(await groupsOf('ticked@co.sa')).toEqual([ARAK])
    expect((await contact('ticked@co.sa')).consent).toBe('opted_in')

    await lead({ email: 'late@co.sa', source: 'website_form', mailbox: '', at: '2026-10-05T10:00:00Z' })
    await q(`insert into email_contacts (workspace_id, email, consent, source) values ($1, 'late@co.sa', 'opted_in', 'website')`, [WS])
    await q(`select sync_lead_contact($1, 'late@co.sa')`, [WS]) // what websiteSignup calls
    expect(await groupsOf('late@co.sa')).toEqual([ARAK])
  })

  it('a ticked box on an unqualified website enquiry joins nothing', async () => {
    await q(`insert into email_contacts (workspace_id, email, consent, source) values ($1, 'seller@co.sa', 'opted_in', 'website')`, [WS])
    await lead({ email: 'seller@co.sa', source: 'website_form', mailbox: '', verdict: 'unqualified', at: '2026-10-05T10:00:00Z' })
    expect(await groupsOf('seller@co.sa')).toEqual([])
  })

  it('never touches an unsubscribed, bounced or spam-reporting contact', async () => {
    for (const status of ['unsubscribed', 'bounced', 'complained']) {
      const email = `${status}@co.sa`
      await q(`insert into email_contacts (workspace_id, email, status) values ($1, $2, $3)`, [WS, email, status])
      await lead({ email })
      expect(await groupsOf(email)).toEqual([])
      expect((await contact(email)).status).toBe(status)
    }
  })

  it('a cold prospect who writes in moves to marketing and their outreach stops', async () => {
    const [c] = await q(`insert into email_contacts (workspace_id, email, audience, consent) values ($1, 'prospect@co.sa', 'cold', 'none') returning id`, [WS])
    const [cold] = await q(`insert into email_groups (workspace_id, name, audience) values ($1, 'Riyadh hotels', 'cold') returning id`, [WS])
    await q('insert into email_group_members (group_id, contact_id, workspace_id) values ($1, $2, $3)', [cold.id, c.id, WS])
    const [camp] = await q(`insert into email_campaigns (workspace_id, audience, name) values ($1, 'cold', 'Hotels') returning id`, [WS])
    await q(`insert into email_sends (workspace_id, campaign_id, contact_id, email, status, due_at) values ($1, $2, $3, 'prospect@co.sa', 'queued', now())`, [WS, camp.id, c.id])

    await lead({ email: 'prospect@co.sa' })
    expect(await contact('prospect@co.sa')).toMatchObject({ audience: 'marketing', consent: 'business_contact' })
    expect(await groupsOf('prospect@co.sa')).toEqual([ARAK])
    expect((await q('select status, error from email_sends'))[0]).toEqual({ status: 'cancelled', error: 'Contacted us with an enquiry' })
  })

  it('skips our own addresses and senders that are not an address', async () => {
    await lead({ email: 'hani@arak-sa.com' })
    await lead({ email: 'info@clb-sa.com' })
    await lead({ email: 'not an address' })
    expect(await q('select email from email_contacts')).toEqual([])
  })

  it('a source with no group feeds nothing; the repair call fills it in later', async () => {
    await q(`update lead_mailboxes set contact_group = '' where email = 'info@clb-sa.com'`)
    await lead({ email: 'buyer@co.sa', mailbox: 'info@clb-sa.com' })
    expect(await contact('buyer@co.sa')).toBeUndefined()
    await q(`update lead_mailboxes set contact_group = $1 where email = 'info@clb-sa.com'`, [CLB])
    expect((await q('select sync_lead_contacts_all($1) n', [WS]))[0].n).toBe(1)
    expect(await groupsOf('buyer@co.sa')).toEqual([CLB])
  })

  it('a deleted lead takes its contact out of the group', async () => {
    const id = await lead({ email: 'gone@co.sa' })
    await q('delete from leads where id = $1', [id])
    expect(await groupsOf('gone@co.sa')).toEqual([])
  })
})
