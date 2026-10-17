import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ADMIN_OWNERSHIP_CHECKS } from '../../src/lib/agent/adminTools.js'

// ─── Direct edits, against a scripted database ─────────────────────────────
// Runs the real runTool → _adminEdits path with PostgREST replaced by a fake
// that records every call. No network. What is pinned here:
//   • a non-admin cannot direct-edit, and nothing is written when they try
//   • every model-supplied id is checked against the session's workspace
//   • every edit writes an audit row, and an edit whose audit row fails is
//     put back
//   • undo refuses to overwrite a newer change

const calls = []
let route = () => []
vi.mock('./_supabase.js', () => ({
  db: async (path, opts = {}) => {
    const call = { path: String(path), method: opts.method || 'GET', body: opts.body }
    calls.push(call)
    return route(call)
  },
}))

const { runTool } = await import('./_tools.js')

const WS = 'ws-1'
const ADMIN = { userId: 'u-admin', chatId: 'c-1', isAdmin: true }
const MEMBER = { userId: 'u-member', chatId: 'c-1', isAdmin: false }
const writes = () => calls.filter(c => c.method !== 'GET')

beforeEach(() => { calls.length = 0; route = () => [] })

describe('the admin gate', () => {
  it('a non-admin cannot direct-edit, and nothing is read or written', async () => {
    for (const session of [MEMBER, {}, undefined, { isAdmin: 'true' }, { isAdmin: 1 }]) {
      calls.length = 0
      const out = await runTool(WS, 'edit_agenda_item', { action: 'create', kind: 'source', subject: 'etimad.sa' }, session)
      expect(out.ok, JSON.stringify(session)).toBe(false)
      expect(out.error).toMatch(/only available to workspace admins/)
      expect(calls).toEqual([])
    }
  })

  it('a non-admin cannot read the admin-only views either', async () => {
    const out = await runTool(WS, 'get_edit_log', {}, MEMBER)
    expect(out.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('the model cannot grant itself admin through its arguments', async () => {
    const out = await runTool(WS, 'edit_icp', { patch: { summary: 'x' }, isAdmin: true, confirmed: true }, MEMBER)
    expect(out.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('a non-admin keeps the propose tools, now including sources', async () => {
    route = ({ method, path }) => {
      if (method === 'GET' && path.startsWith('research_agenda')) return []
      if (method === 'POST') return [{ id: 'new-1' }]
      return []
    }
    const out = await runTool(WS, 'add_agenda_item',
      { kind: 'source', subject: 'etimad.sa', why: 'tenders', source_type: 'tender_portal', tier: 1 }, MEMBER)
    expect(out.ok).toBe(true)
    const post = writes()[0]
    expect(post.body).toMatchObject({ workspace_id: WS, kind: 'source', status: 'proposed', created_by: 'agent', source_type: 'tender_portal', tier: 1 })
  })
})

describe('ownership checks on every id an admin tool accepts', () => {
  const sample = {
    edit_brand_structure: { target: 'field', action: 'update', label: 'x' },
    edit_directory_row: { action: 'update', data: { a: 'b' } },
    edit_rule: { action: 'accept' },
    edit_agenda_item: { action: 'activate' },
    edit_plan_idea: { action: 'update', title: 'x' },
    edit_draft: { caption: 'x' },
    undo_edit: {},
  }

  for (const [tool, checks] of Object.entries(ADMIN_OWNERSHIP_CHECKS)) {
    for (const check of checks) {
      it(`${tool}.${check.param} from another workspace is refused before anything is written`, async () => {
        // The ownership query finds nothing: the id is not in THIS workspace.
        route = () => []
        const out = await runTool(WS, tool, { ...sample[tool], [check.param]: 'foreign-id' }, ADMIN)
        expect(out.ok).toBe(false)
        expect(out.error).toMatch(/exists in this workspace/)
        expect(writes()).toEqual([])
        const probe = calls.find(c => c.path.startsWith(`${check.table}?id=eq.foreign-id`))
        expect(probe, 'the check must query the declared table').toBeTruthy()
        expect(probe.path).toContain(`workspace_id=eq.${WS}`)
      })
    }
  }
})

describe('every direct edit is audited', () => {
  it('adding a source writes the row, then an audit row with who, what and after', async () => {
    route = ({ method, path }) => {
      if (method === 'GET' && path.startsWith('research_agenda')) return []
      if (method === 'POST' && path === 'research_agenda') return [{ id: 'src-1', kind: 'source', subject: 'etimad.sa' }]
      if (method === 'POST' && path === 'agent_edit_log') return [{ id: 'log-1' }]
      return []
    }
    const out = await runTool(WS, 'edit_agenda_item',
      { action: 'create', kind: 'source', subject: 'etimad.sa', why: 'government tenders', source_type: 'tender_portal', tier: 1 }, ADMIN)
    expect(out.ok).toBe(true)
    expect(out.result.edit_id).toBe('log-1')

    const [row, log] = writes()
    expect(row.path).toBe('research_agenda')
    expect(row.body).toMatchObject({ workspace_id: WS, kind: 'source', status: 'active', created_by: 'human', source_type: 'tender_portal', tier: 1 })
    expect(log.path).toBe('agent_edit_log')
    expect(log.body).toMatchObject({
      workspace_id: WS, user_id: 'u-admin', chat_id: 'c-1', tool: 'edit_agenda_item',
      table_name: 'research_agenda', row_id: 'src-1', action: 'create', before: null,
    })
    expect(log.body.after).toMatchObject({ id: 'src-1' })
  })

  it('an update logs only the touched columns, before and after', async () => {
    const prior = { id: 'r-1', workspace_id: WS, rule: 'Old', status: 'proposed', scope: 'caption' }
    route = ({ method, path }) => {
      if (method === 'GET' && path.startsWith('brand_memory?id=eq.r-1')) return [prior]
      if (method === 'PATCH') return [{ ...prior, status: 'active' }]
      if (method === 'POST' && path === 'agent_edit_log') return [{ id: 'log-2' }]
      return []
    }
    const out = await runTool(WS, 'edit_rule', { action: 'accept', rule_id: 'r-1' }, ADMIN)
    expect(out.ok).toBe(true)
    const patch = writes().find(c => c.method === 'PATCH')
    expect(patch.path).toBe(`brand_memory?id=eq.r-1&workspace_id=eq.${WS}`)
    expect(patch.body).toEqual({ status: 'active' })
    const log = writes().find(c => c.path === 'agent_edit_log')
    expect(log.body.before).toEqual({ status: 'proposed' })
    expect(log.body.after).toEqual({ status: 'active' })
  })

  it('if the audit row cannot be written, the change is put back', async () => {
    route = ({ method, path }) => {
      if (method === 'GET' && path.startsWith('research_agenda')) return []
      if (method === 'POST' && path === 'research_agenda') return [{ id: 'src-9' }]
      if (method === 'POST' && path === 'agent_edit_log') throw new Error('Supabase 404: relation "agent_edit_log" does not exist')
      return []
    }
    const out = await runTool(WS, 'edit_agenda_item', { action: 'create', kind: 'question', subject: 'Who is tendering?' }, ADMIN)
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/reverted and nothing changed/)
    const del = writes().find(c => c.method === 'DELETE')
    expect(del.path).toBe(`research_agenda?id=eq.src-9&workspace_id=eq.${WS}`)
  })
})

describe('confirm before overwriting', () => {
  it('replacing existing Brand Brain text without confirmed is refused and shows the current text', async () => {
    route = ({ method, path }) => {
      if (path.startsWith('brand_fields')) return [{ id: 'f-1', key: 'positioning', label: 'Positioning', storage_column: 'positioning' }]
      if (method === 'GET' && path.startsWith('brand_profile')) return [{ id: 'p-1', workspace_id: WS, positioning: 'Old line', custom_fields: {} }]
      return []
    }
    const out = await runTool(WS, 'set_brand_field', { field_key: 'positioning', value: 'New line', mode: 'replace' }, ADMIN)
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/confirmed: true/)
    expect(out.error).toContain('Old line')
    expect(writes()).toEqual([])
  })

  it('with confirmed it writes the right column and logs the old value', async () => {
    route = ({ method, path }) => {
      if (path.startsWith('brand_fields')) return [{ id: 'f-1', key: 'positioning', label: 'Positioning', storage_column: 'positioning' }]
      if (method === 'GET' && path.startsWith('brand_profile')) return [{ id: 'p-1', workspace_id: WS, positioning: 'Old line', custom_fields: {} }]
      if (method === 'PATCH') return [{ id: 'p-1', workspace_id: WS, positioning: 'New line', updated_at: 'now' }]
      if (path === 'agent_edit_log') return [{ id: 'log-3' }]
      return []
    }
    const out = await runTool(WS, 'set_brand_field', { field_key: 'positioning', value: 'New line', mode: 'replace', confirmed: true }, ADMIN)
    expect(out.ok).toBe(true)
    const patch = writes().find(c => c.method === 'PATCH')
    expect(patch.path).toBe(`brand_profile?workspace_id=eq.${WS}`)
    expect(patch.body.positioning).toBe('New line')
    const log = writes().find(c => c.path === 'agent_edit_log')
    expect(log.body.before.positioning).toBe('Old line')
    expect(log.body.table_name).toBe('brand_profile')
  })
})

describe('edit_icp', () => {
  it('merges into the stored config and stores the normalised shape', async () => {
    const prior = { workspace_id: WS, config: { summary: 'Hotels', mix: { core: 60 }, regions: ['riyadh'] } }
    route = ({ method, path }) => {
      if (method === 'GET' && path.startsWith('sales_icp')) return [prior]
      if (method === 'PATCH') return [{ ...prior, config: {} }]
      if (path === 'agent_edit_log') return [{ id: 'log-4' }]
      return []
    }
    const out = await runTool(WS, 'edit_icp', { patch: { mix: { core: 70 } }, confirmed: true }, ADMIN)
    expect(out.ok).toBe(true)
    const patch = writes().find(c => c.method === 'PATCH')
    expect(patch.body.config.mix).toEqual({ core: 70, broader: 30 })
    expect(patch.body.config.summary).toBe('Hotels')
    expect(patch.body.config.regions).toEqual(['riyadh'])
    expect(patch.body.updated_by).toBe('u-admin')
  })

  it('a key the ICP does not know is reported, not silently dropped', async () => {
    route = ({ method, path }) => (method === 'GET' && path.startsWith('sales_icp') ? [{ workspace_id: WS, config: {} }] : [])
    const out = await runTool(WS, 'edit_icp', { patch: { favourite_colour: 'blue' }, confirmed: true }, ADMIN)
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/does not have "favourite_colour"/)
    expect(writes()).toEqual([])
  })
})

describe('drafts that have gone anywhere are out of reach', () => {
  it('a scheduled post cannot be edited', async () => {
    route = ({ path }) => (path.startsWith('generated_posts')
      ? [{ id: 'p-9', workspace_id: WS, status: 'scheduled', publish_status: 'scheduled', scheduled_publish_at: '2026-11-01T09:00:00Z' }]
      : [])
    const out = await runTool(WS, 'edit_draft', { post_id: 'p-9', caption: 'new' }, ADMIN)
    expect(out.ok).toBe(false)
    expect(writes()).toEqual([])
  })
})

describe('undo', () => {
  const entry = {
    id: 'log-5', workspace_id: WS, table_name: 'brand_memory', row_id: 'r-1', action: 'update',
    before: { status: 'proposed' }, after: { status: 'active' },
  }

  it('puts the row back and logs the undo', async () => {
    route = ({ method, path }) => {
      if (method === 'GET' && path.startsWith('agent_edit_log')) return [entry]
      if (method === 'GET' && path.startsWith('brand_memory')) return [{ id: 'r-1', workspace_id: WS, status: 'active' }]
      if (method === 'POST' && path === 'agent_edit_log') return [{ id: 'log-6' }]
      return []
    }
    const out = await runTool(WS, 'undo_edit', { edit_id: 'log-5' }, ADMIN)
    expect(out.ok).toBe(true)
    const restore = writes().find(c => c.method === 'PATCH' && c.path.startsWith('brand_memory'))
    expect(restore.path).toBe(`brand_memory?id=eq.r-1&workspace_id=eq.${WS}`)
    expect(restore.body).toEqual({ status: 'proposed' })
    const log = writes().find(c => c.method === 'POST' && c.path === 'agent_edit_log')
    expect(log.body).toMatchObject({ action: 'undo', undoes: 'log-5', user_id: 'u-admin' })
  })

  it('refuses when the row has been changed since', async () => {
    route = ({ method, path }) => {
      if (method === 'GET' && path.startsWith('agent_edit_log')) return [entry]
      if (method === 'GET' && path.startsWith('brand_memory')) return [{ id: 'r-1', workspace_id: WS, status: 'retired' }]
      return []
    }
    const out = await runTool(WS, 'undo_edit', { edit_id: 'log-5' }, ADMIN)
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/changed again since/)
    expect(writes()).toEqual([])
  })

  it('refuses a log row naming a table outside the allow-list', async () => {
    route = ({ method, path }) => (method === 'GET' && path.startsWith('agent_edit_log')
      ? [{ ...entry, table_name: 'workspace_members' }] : [])
    const out = await runTool(WS, 'undo_edit', { edit_id: 'log-5' }, ADMIN)
    expect(out.ok).toBe(false)
    expect(writes()).toEqual([])
  })
})
