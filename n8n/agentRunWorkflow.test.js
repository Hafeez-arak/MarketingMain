import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lensesFor } from '../src/lib/agent/lenses.js'
import { WEBHOOK_PATHS } from '../src/lib/n8nWebhookPaths.js'

// ─── The driver is a JSON file nothing else typechecks ─────────────────────
// api/agent/run.js, lens.js and synthesise.js all have tests. The thing that
// CALLS them in production is this workflow, and until now nothing checked it
// at all — it was verified once by reading it.
//
// That is the wrong place to have no coverage. Every failure this file can
// have is silent: a renamed node leaves a dangling `$('...')` that returns
// undefined rather than throwing, and a missing body field lands as a default
// on the other side. Neither shows up as a red build; both show up as a run
// that quietly did less than it was supposed to.

const here = path.dirname(fileURLToPath(import.meta.url))
// In workflows/ under the name it already has in n8n, so `redeploy.sh --all`
// updates it in place instead of importing a second copy with its own Monday
// schedule.
const workflow = JSON.parse(fs.readFileSync(path.join(here, 'workflows', 'Agent — weekly research run.json'), 'utf8'))

const nodes = workflow.nodes
const names = new Set(nodes.map(n => n.name))
const byName = name => nodes.find(n => n.name === name)
const httpNodes = nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest')

describe('the weekly run driver is wired to nodes that exist', () => {
  it('every connection points at a real node', () => {
    const dangling = []
    for (const [src, outs] of Object.entries(workflow.connections)) {
      if (!names.has(src)) dangling.push(`source ${src}`)
      for (const group of outs.main || []) {
        for (const c of group || []) if (!names.has(c.node)) dangling.push(`${src} -> ${c.node}`)
      }
    }
    expect(dangling).toEqual([])
  })

  it('every $(\'node\') reference inside a Code node resolves', () => {
    // The one that bites on a rename: n8n returns undefined for a missing
    // node rather than throwing, so the run continues with a silently empty
    // value and the mistake surfaces three steps later as something else.
    const dangling = []
    for (const n of nodes) {
      const blob = JSON.stringify(n.parameters || {})
      for (const [, ref] of blob.matchAll(/\$\('([^']+)'\)/g)) {
        if (!names.has(ref)) dangling.push(`${n.name} -> ${ref}`)
      }
    }
    expect(dangling).toEqual([])
  })
})

describe('cadence reaches every route, or two lenses silently stop existing', () => {
  // Rivals and Craft are monthly by design — their answers move quarterly and
  // asking weekly buys the same answer four times. But "monthly" only means
  // something if a monthly run can actually happen, and each route defaults to
  // weekly on its own when the field is absent. Three separate defaults is
  // three chances to demote a lens into never running.

  it('every route is sent a cadence', () => {
    // /run twice (the schedule and the Run button), then lens and synthesise.
    expect(httpNodes).toHaveLength(4)
    for (const n of httpNodes) {
      expect(n.parameters.jsonBody, n.name).toMatch(/cadence/)
    }
  })

  it('the lens and synthesise calls carry the cadence forward rather than re-deciding it', () => {
    // The lens route REFUSES a lens the run does not include. A monthly run
    // whose lens calls defaulted to weekly would be rejected one lens at a
    // time, and the error would read "this run does not include a rivals
    // lens" — which points at the lens set, not at the plumbing.
    for (const name of ['POST /api/agent/lens', 'POST /api/agent/synthesise']) {
      expect(byName(name).parameters.jsonBody, name).toMatch(/\$json\.cadence/)
    }
  })

  it('a monthly run is genuinely reachable from the schedule', () => {
    const code = byName('Which brands').parameters.jsCode
    expect(code).toMatch(/monthly/)
    // Not a literal 'weekly' with monthly only in a comment.
    expect(code).toMatch(/cadence\s*=/)
  })

  it('the monthly set is a superset of the weekly one, and holds the monthly-only lens', () => {
    const weekly = lensesFor({ cadence: 'weekly' }).map(l => l.key)
    const monthly = lensesFor({ cadence: 'monthly' }).map(l => l.key)
    for (const k of weekly) expect(monthly).toContain(k)
    // rivals went back to weekly on 2026-09-15 (competitor intel across
    // channels); craft is the lens that still only runs monthly.
    expect(monthly).toContain('craft')
    expect(weekly).not.toContain('craft')
  })
})

describe('the driver does not hardcode what the repo decides', () => {
  it('reads the lens list from the run response instead of listing it', () => {
    // Adding or demoting a lens must stay a code change in the repo, which is
    // tested, rather than an edit in the n8n UI, which is not.
    const code = byName('One item per lens').parameters.jsCode
    expect(code).toMatch(/next\?\.lenses/)
    for (const key of lensesFor({ cadence: 'monthly' }).map(l => l.key)) {
      expect(code).not.toMatch(new RegExp(`['"]${key}['"]`))
    }
  })

  it('does not assume how many lenses came back', () => {
    // The set is five on a weekly run and seven on a monthly one, decided by
    // sales motion and cadence. A node named or written for six is wrong on
    // both counts.
    const node = byName('Wait for every lens')
    expect(node).toBeTruthy()
    // Comments stripped first: this node's comment explains why it is NOT
    // named for a number, and matching that would fail the test for saying
    // the right thing.
    const code = node.parameters.jsCode.replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/\bsix\b/)
    expect(code).not.toMatch(/length\s*===\s*\d/)
  })
})

describe('the Run button reaches the same driver', () => {
  const webhook = nodes.find(n => n.type === 'n8n-nodes-base.webhook')
  const appRun = byName('POST /api/agent/run (app)')
  const next = name => (workflow.connections[name]?.main?.[0] || []).map(c => c.node)

  it('answers the path the app calls', () => {
    expect(webhook.parameters.path).toBe(WEBHOOK_PATHS.agentRun)
    expect(webhook.parameters.responseMode).toBe('responseNode')
  })

  it('checks the webhook secret before anything else', () => {
    expect(next(webhook.name)).toEqual(['Webhook Secret Guard'])
    expect(byName('Webhook Secret Guard').parameters.jsCode).toMatch(/N8N_WEBHOOK_SECRET/)
  })

  it('starts the run with the caller\'s own token, never the service secret', () => {
    // With the secret, the workspace_id in the request body would be taken on
    // trust and any signed-in user could run any workspace.
    const auth = appRun.parameters.headerParameters.parameters.find(h => h.name === 'Authorization').value
    expect(auth).toMatch(/\$json\.access_token/)
    expect(auth).not.toMatch(/AGENT_RUN_SECRET/)
  })

  it('answers the app once the run has started, then carries on into the lenses', () => {
    expect(next('POST /api/agent/run (app)')).toEqual(['Answer the app'])
    expect(next('Answer the app')).toEqual(['Did it start?'])
    expect(next('POST /api/agent/run')).toEqual(['Did it start?'])
  })

  it('never lets /run drive the lenses too, so nothing runs twice', () => {
    for (const n of httpNodes.filter(h => /\/api\/agent\/run$/.test(h.parameters.url))) {
      expect(n.parameters.jsonBody, n.name).toMatch(/drive:\s*false/)
    }
  })

  it('does not drive a run that someone else is already driving', () => {
    const cond = JSON.stringify(byName('Did it start?').parameters.conditions)
    expect(cond).toMatch(/already_running/)
  })

  it('reads the workspace from the run reply, not from a trigger that may not have run', () => {
    const code = byName('One item per lens').parameters.jsCode
    expect(code).not.toMatch(/\$\('Which brands'\)/)
    expect(code).not.toMatch(/\$\('From the app'\)/)
    expect(code).toMatch(/item\.json\.workspace_id/)
  })

  it('calls the agent container, not a hardcoded host', () => {
    for (const n of httpNodes) expect(n.parameters.url, n.name).toMatch(/^=\{\{ \$env\.AGENT_BASE_URL \}\}\/api\/agent\//)
  })

  it('waits longer for a lens and the brief than the agent lets them run', () => {
    const compose = fs.readFileSync(path.join(here, 'docker', 'docker-compose.yml'), 'utf8')
    const budget = key => Number(new RegExp(`${key}=(\\d+)`).exec(compose)?.[1])
    expect(budget('AGENT_LENS_BUDGET_MS')).toBeGreaterThan(0)
    expect(byName('POST /api/agent/lens').parameters.options.timeout).toBeGreaterThan(budget('AGENT_LENS_BUDGET_MS'))
    expect(byName('POST /api/agent/synthesise').parameters.options.timeout).toBeGreaterThan(budget('AGENT_SYNTHESISE_BUDGET_MS'))
  })
})

describe('a failed lens costs one lens, not the whole set', () => {
  // Run 4de11a81 (2026-09-14): one lens answered non-2xx on the first try, n8n
  // retried the lens NODE, and the retry re-sent all five — every lens billed
  // twice. Reproduced with a stand-in server: a single 500 in the batch
  // re-sends every request, including the ones that had already succeeded.
  const lens = byName('POST /api/agent/lens')

  it('never retries the lens step as a whole', () => {
    expect(lens.retryOnFail).not.toBe(true)
  })

  it('passes a failed lens on as its own item, so the brief still runs', () => {
    expect(lens.onError).toBe('continueRegularOutput')
  })

  it('names the lens behind an HTTP-level failure in the summary', () => {
    const code = byName('Wait for every lens').parameters.jsCode
    expect(code).toMatch(/\$\('One item per lens'\)/)
    expect(code).toMatch(/pairedItem/)
    expect(code).toMatch(/errors/)
  })
})
