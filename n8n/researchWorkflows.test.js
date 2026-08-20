import { describe, it, expect } from 'vitest'
import { loadCodeNode, runCodeNode, StubPostgrest, STUB_SUPABASE } from './workflowHarness'

// ─── Research: Resolve Handles ─────────────────────────────────────────────
// The whole Instagram side of the research agent rests on one question:
// "is this account really that competitor?" Get it wrong and a week of real
// numbers is attached to the wrong company, which is the kind of wrong that
// does not look wrong — it looks like a report.
//
// So these tests are mostly about REFUSAL. Resolving Technolight correctly is
// one test; the other eight are about not resolving something when the
// evidence is thin, not overwriting a human, and not letting one rival's
// failure cost the others their results.
//
// Runs the generated Code nodes, not a copy — regenerate (python3
// gen_workflows.py) before running these if you touched the Python.

const ENV = {
  META_IG_TOKEN: 'stub-token',
  META_IG_USER_ID: '17841436113014751',
  TAVILY_API_KEY: 'stub-tavily',
  SUPABASE_URL: STUB_SUPABASE,
  SUPABASE_KEY: 'stub-service-key',
}

const SEED = loadCodeNode('Arak Lighting – Research Resolve', 'Resolve: Seed Agenda')
const FIND = loadCodeNode('Arak Lighting – Research Resolve', 'Resolve: Find Handles')

const WS = 'ws1'

// A cooperative web + Graph. `accounts` maps a handle to what
// business_discovery returns; anything not in it answers the way Meta answers
// for a handle that does not exist or is not a professional account.
function world({ searchHits = [], accounts = {}, searchFails = false } = {}) {
  const routes = [
    ['api.tavily.com/search', async () => {
      if (searchFails) return { statusCode: 500, body: { error: 'rate limited' } }
      return { statusCode: 200, body: { results: searchHits } }
    }],
    ['graph.facebook.com', async ({ url }) => {
      // encodeURIComponent leaves ( and ) alone, so the handle arrives in
      // literal parens. Accepting both spellings keeps this stub honest if
      // the encoding ever changes rather than silently matching nothing —
      // which is exactly how this stub was wrong the first time, and made
      // four "not found" assertions pass for the wrong reason.
      const m = /username(?:\(|%28)([A-Za-z0-9._]+)/.exec(url)
      const handle = m && m[1]
      const acct = handle && accounts[handle]
      if (!acct) return { statusCode: 400, body: { error: { message: 'Invalid user id', type: 'OAuthException' } } }
      return { statusCode: 200, body: { business_discovery: { id: `ig_${handle}`, username: handle, ...acct } } }
    }],
  ]
  return routes
}

const hit = (url, content = '') => ({ url, content, title: '' })

const agendaRow = (over = {}) => ({
  id: 'a1', workspace_id: WS, kind: 'competitor', subject: 'Technolight',
  status: 'active', ig_handle: '', ig_status: 'unresolved', ig_confidence: null,
  source_row_id: null, why: '', ...over,
})

async function seed(body, tables = {}) {
  const pg = new StubPostgrest(tables)
  const { out } = await runCodeNode(SEED, { env: ENV, input: { body }, postgrest: pg })
  return { out, pg }
}

async function find(input, tables, routes) {
  const pg = new StubPostgrest(tables)
  const { out } = await runCodeNode(FIND, { env: ENV, input, postgrest: pg, routes })
  return { out, pg }
}

describe('Resolve: Seed Agenda', () => {
  it('seeds a competitor from the Brand Brain as active, not proposed', async () => {
    // A human already decided this rival matters by typing it into the Brand
    // Brain. Arriving as 'proposed' would make them approve it twice.
    const { out, pg } = await seed({
      workspace_id: WS,
      competitors: [{ name: 'Technolight', positioning: 'Architectural lighting supplier' }],
    })
    const rows = pg.tables.research_agenda
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      workspace_id: WS, kind: 'competitor', subject: 'Technolight',
      status: 'active', created_by: 'human',
    })
    expect(out.proceed).toBe(true)
    expect(out.work).toHaveLength(1)
  })

  it('does not seed a competitor it has already seen, whatever the casing', async () => {
    const { out, pg } = await seed(
      { workspace_id: WS, competitors: [{ name: 'TECHNOLIGHT' }] },
      { research_agenda: [agendaRow()] },
    )
    expect(pg.tables.research_agenda).toHaveLength(1)
    expect(out.work).toHaveLength(1)
    expect(out.work[0].agenda_id).toBe('a1')
  })

  it('never re-resolves a handle a person set by hand', async () => {
    const { out } = await seed(
      { workspace_id: WS, competitors: [{ name: 'Technolight' }] },
      { research_agenda: [agendaRow({ ig_status: 'human_set', ig_handle: 'thereal' })] },
    )
    expect(out.proceed).toBe(false)
    expect(out.skipped).toBe(true)
  })

  it('leaves an already-resolved handle alone unless force is asked for', async () => {
    const tables = { research_agenda: [agendaRow({ ig_status: 'resolved', ig_handle: 'technolight' })] }
    const quiet = await seed({ workspace_id: WS, competitors: [{ name: 'Technolight' }] }, tables)
    expect(quiet.out.proceed).toBe(false)

    const forced = await seed({ workspace_id: WS, competitors: [{ name: 'Technolight' }], force: true }, tables)
    expect(forced.out.proceed).toBe(true)
    expect(forced.out.work).toHaveLength(1)
  })

  it('refuses to guess when the Meta credentials are missing', async () => {
    // Without a token there is no way to VERIFY a candidate, and an
    // unverified handle is exactly what must never be written.
    const pg = new StubPostgrest({})
    const { out } = await runCodeNode(SEED, {
      env: { ...ENV, META_IG_TOKEN: '' },
      input: { body: { workspace_id: WS, competitors: [{ name: 'Technolight' }] } },
      postgrest: pg,
    })
    expect(out.proceed).toBe(false)
    expect(out.reason).toMatch(/refusing to guess/i)
  })

  it('says so plainly when the brand has no competitors listed', async () => {
    const { out } = await seed({ workspace_id: WS, competitors: [] })
    expect(out.proceed).toBe(false)
    expect(out.reason).toMatch(/no competitors listed/i)
  })
})

describe('Resolve: Find Handles', () => {
  const workFor = (over = {}) => ({
    workspace_id: WS,
    work: [{ agenda_id: 'a1', name: 'Technolight', positioning: 'Architectural lighting', website: '', ...over }],
  })

  it('resolves a strong match and stamps it verified', async () => {
    const routes = world({
      searchHits: [hit('https://www.instagram.com/technolight/')],
      accounts: { technolight: { name: 'Technolight KSA', biography: 'Architectural lighting, Riyadh', website: 'https://technolight-ksa.com', followers_count: 24000 } },
    })
    const tables = { research_agenda: [agendaRow()] }
    const { out, pg } = await find(workFor(), tables, routes)

    expect(out.resolved).toBe(1)
    const row = pg.tables.research_agenda[0]
    expect(row.ig_status).toBe('resolved')
    expect(row.ig_handle).toBe('technolight')
    expect(row.ig_user_id).toBe('ig_technolight')
    expect(row.ig_verified_at).toBeTruthy()
    expect(Number(row.ig_confidence)).toBeGreaterThanOrEqual(0.7)
  })

  it('treats a matching website domain as conclusive on its own', async () => {
    // The account is named nothing like the rival, but its bio links to the
    // rival's own domain. That is their account.
    const routes = world({
      searchHits: [hit('https://www.instagram.com/tl_projects/')],
      accounts: { tl_projects: { name: 'TL Projects', biography: 'Projects', website: 'http://www.technolight-ksa.com/', followers_count: 4000 } },
    })
    const { out, pg } = await find(
      workFor({ website: 'https://technolight-ksa.com/' }),
      { research_agenda: [agendaRow()] }, routes,
    )
    expect(out.resolved).toBe(1)
    expect(pg.tables.research_agenda[0].ig_handle).toBe('tl_projects')
  })

  it('will not resolve a near-name — it suggests and waits for a human', async () => {
    // The live Aqeeq workspace has both "Ozee" and "Ozeyl". This is the exact
    // shape of the mistake that would attach one rival's numbers to another.
    const routes = world({
      searchHits: [hit('https://www.instagram.com/ozee_app/')],
      accounts: { ozee_app: { name: 'Ozee App', biography: 'Home services', website: '', followers_count: 900 } },
    })
    const { out, pg } = await find(
      { workspace_id: WS, work: [{ agenda_id: 'a1', name: 'Ozee', positioning: 'Home services app', website: '' }] },
      { research_agenda: [agendaRow({ subject: 'Ozee' })] }, routes,
    )
    expect(out.resolved).toBe(0)
    expect(out.suggested).toBe(1)
    const row = pg.tables.research_agenda[0]
    expect(row.ig_status).toBe('unresolved')       // the load-bearing assertion
    expect(row.ig_handle).toBe('ozee_app')          // kept only as a suggestion
    expect(row.ig_verified_at).toBeNull()
  })

  it('rejects a tiny lookalike account', async () => {
    const routes = world({
      searchHits: [hit('https://www.instagram.com/technolight/')],
      accounts: { technolight: { name: 'technolight', biography: '', website: '', followers_count: 12 } },
    })
    const { out, pg } = await find(workFor(), { research_agenda: [agendaRow()] }, routes)
    expect(out.resolved).toBe(0)
    expect(pg.tables.research_agenda[0].ig_status).not.toBe('resolved')
  })

  it('ignores instagram.com post and reel URLs as candidates', async () => {
    const routes = world({
      searchHits: [hit('https://www.instagram.com/p/Cxyz123/'), hit('https://www.instagram.com/reel/Cabc/')],
      accounts: {},
    })
    const { out, pg } = await find(workFor(), { research_agenda: [agendaRow()] }, routes)
    expect(out.outcomes[0].candidates).toEqual([])
    expect(pg.tables.research_agenda[0].ig_status).toBe('not_found')
  })

  it('records not_found when nothing plausible exists, rather than failing', async () => {
    const routes = world({ searchHits: [hit('https://example.com/about')], accounts: {} })
    const { out, pg } = await find(workFor(), { research_agenda: [agendaRow()] }, routes)
    expect(out.ok).toBe(true)
    expect(out.not_found).toBe(1)
    expect(pg.tables.research_agenda[0].ig_status).toBe('not_found')
  })

  it('survives a private or non-professional account without failing the run', async () => {
    // business_discovery answers with an error for these, which is a rejected
    // candidate — most guesses should come back this way.
    const routes = world({
      searchHits: [hit('https://www.instagram.com/someprivateperson/')],
      accounts: {},
    })
    const { out } = await find(workFor(), { research_agenda: [agendaRow()] }, routes)
    expect(out.ok).toBe(true)
    expect(out.outcomes[0].result).toBe('not_found')
  })

  it('lets one rival fail without costing the others their results', async () => {
    const routes = world({
      searchHits: [hit('https://www.instagram.com/technolight/')],
      accounts: { technolight: { name: 'Technolight KSA', biography: 'lighting', website: '', followers_count: 24000 } },
    })
    const { out } = await find(
      { workspace_id: WS, work: [
        { agenda_id: 'missing', name: 'Nobody', positioning: '', website: '' },
        { agenda_id: 'a1', name: 'Technolight', positioning: 'Architectural lighting', website: '' },
      ] },
      { research_agenda: [agendaRow()] }, routes,
    )
    expect(out.ok).toBe(true)
    expect(out.outcomes).toHaveLength(2)
    expect(out.resolved).toBe(1)
  })

  it('keeps going when the search itself fails', async () => {
    const routes = world({ searchFails: true, accounts: {} })
    const { out } = await find(workFor(), { research_agenda: [agendaRow()] }, routes)
    expect(out.ok).toBe(true)
    expect(out.outcomes[0].search_error).toBeTruthy()
    expect(out.outcomes[0].result).toBe('not_found')
  })

  it('scopes every write to the workspace as well as the row id', async () => {
    // RLS here is per-user, not per-workspace, and this runs on the service
    // key — so the filter IS the isolation.
    const routes = world({
      searchHits: [hit('https://www.instagram.com/technolight/')],
      accounts: { technolight: { name: 'Technolight KSA', biography: 'lighting', website: '', followers_count: 24000 } },
    })
    const { pg } = await find(workFor(), { research_agenda: [agendaRow()] }, routes)
    const patches = pg.log.filter(c => c.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(patches[0].query).toContain(`workspace_id=eq.${WS}`)
  })
})
