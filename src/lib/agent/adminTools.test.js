import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ADMIN_TOOLS, ADMIN_TOOL_NAMES, ADMIN_OWNERSHIP_CHECKS, ADMIN_EDIT_TABLES, NEVER_EDITABLE_TABLES,
  SOURCE_TYPES, ADMIN_EDITS_PROMPT, mergeConfig, isAdminTool,
} from './adminTools'
import { toolsFor, toolsExposingWorkspace, toolDefs } from './tools'
import { volatileFragment } from './prompt'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

describe('the direct-edit belt is offered only to an admin chat', () => {
  it('no other surface sees it — the research run stays read-only', () => {
    // The run asks for writes and the web; neither may smuggle in edits.
    for (const flags of [{}, { writes: true }, { web: true }, { writes: true, web: true }]) {
      const names = toolsFor(flags).map(t => t.name)
      for (const admin of ADMIN_TOOL_NAMES) expect(names, JSON.stringify(flags)).not.toContain(admin)
    }
  })

  it('an admin gets the edits AND keeps the propose tools', () => {
    const names = toolsFor({ admin: true, web: true }).map(t => t.name)
    for (const admin of ADMIN_TOOL_NAMES) expect(names).toContain(admin)
    expect(names).toContain('draft_post')
    expect(names).toContain('add_agenda_item')
    expect(new Set(names).size).toBe(names.length)
  })

  it('the loop picks the belt from the verified session, not a free-standing flag', () => {
    // A caller cannot offer the belt without also opening the gate in runTool:
    // both read session.isAdmin.
    const loop = read('api/agent/_loop.js')
    expect(loop).toMatch(/admin: session\?\.isAdmin === true/)
    expect(loop).toMatch(/runTool\(workspaceId, use\.name, use\.input, session\)/)
  })

  it('only the chat endpoint builds an admin session, from callerIsAdmin(userId)', () => {
    const chat = read('api/agent/chat.js')
    expect(chat).toMatch(/const isAdmin = await callerIsAdmin\(userId\)/)
    expect(chat).toMatch(/session: \{ userId, chatId, isAdmin \}/)
    // Nothing in the body can set it.
    expect(chat).not.toMatch(/body\.is_admin|body\.isAdmin|body\.role/)
    for (const rel of ['api/agent/run.js', 'api/agent/lens.js', 'api/agent/synthesise.js', 'api/agent/discover.js']) {
      expect(read(rel), rel).not.toMatch(/isAdmin|admin:\s*true/)
    }
  })
})

describe('the same isolation rules as every other tool', () => {
  it('no admin tool takes a workspace id', () => {
    expect(toolsExposingWorkspace(ADMIN_TOOLS)).toEqual([])
  })

  it('every *_id parameter is declared for an ownership check', () => {
    for (const tool of ADMIN_TOOLS) {
      const idParams = Object.keys(tool.input_schema.properties).filter(k => /_id$/.test(k))
      const checked = (ADMIN_OWNERSHIP_CHECKS[tool.name] || []).map(c => c.param)
      for (const param of idParams) {
        expect(checked, `${tool.name}.${param} needs an ownership check`).toContain(param)
      }
    }
  })

  it('serialises to the provider shape and nothing else', () => {
    for (const def of toolDefs(ADMIN_TOOLS)) {
      expect(Object.keys(def).sort()).toEqual(['description', 'input_schema', 'name'])
    }
  })

  it('isAdminTool knows exactly the belt', () => {
    expect(isAdminTool('set_brand_field')).toBe(true)
    expect(isAdminTool('propose_rule')).toBe(false)
    expect(isAdminTool('get_posts')).toBe(false)
  })
})

describe('what stays out of reach, whoever asks', () => {
  it('no tool publishes, schedules, sends, approves or touches members', () => {
    const names = ADMIN_TOOL_NAMES.join(' ')
    expect(names).not.toMatch(/publish|schedule|send|approve|member|invite|role|cap|budget|credential|workspace/i)
  })

  it('the editable tables never include membership, roles, the ledger, the queue or credentials', () => {
    for (const t of NEVER_EDITABLE_TABLES) expect(ADMIN_EDIT_TABLES, t).not.toContain(t)
  })

  it('the executors only ever name editable tables as a write target', () => {
    const src = read('api/agent/_adminEdits.js')
    const targets = [...src.matchAll(/table: '([a-z_]+)'/g)].map(m => m[1])
    expect(targets.length).toBeGreaterThan(5)
    for (const t of targets) expect(ADMIN_EDIT_TABLES, t).toContain(t)
  })

  it('plan ideas cannot be approved from the chat', () => {
    const idea = ADMIN_TOOLS.find(t => t.name === 'edit_plan_idea')
    expect(idea.input_schema.properties.status.enum).not.toContain('approved')
  })
})

describe('the database agrees with the code', () => {
  it('the log table CHECK lists exactly ADMIN_EDIT_TABLES', () => {
    const sql = read('supabase/migrations/20261020_agent_admin_edits.sql')
    const check = sql.match(/table_name in \(([\s\S]*?)\)\)/)[1]
    const listed = [...check.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort()
    expect(listed).toEqual([...ADMIN_EDIT_TABLES].sort())
  })

  it('the log is read by members and written by nobody through the API', () => {
    const sql = read('supabase/migrations/20261020_agent_admin_edits.sql')
    expect(sql).toMatch(/enable row level security/)
    expect(sql).toMatch(/for select to authenticated/)
    expect(sql).not.toMatch(/for (insert|update|delete|all)/i)
  })

  it('source types match the research_agenda CHECK', () => {
    const sql = read('supabase/migrations/20261020_research_sources.sql')
    const check = sql.match(/source_type = any \(array\[([\s\S]*?)\]\)/)[1]
    const listed = [...check.matchAll(/'([a-z_]*)'/g)].map(m => m[1]).sort()
    expect(listed).toEqual([...SOURCE_TYPES].sort())
  })
})

describe('mergeConfig', () => {
  it('merges nested objects, replaces arrays and scalars, deletes on null', () => {
    const base = { summary: 'a', mix: { core: 60 }, segments: [{ key: 'x' }], share: { min: 5, max: 20, note: 'n' } }
    const out = mergeConfig(base, { mix: { core: 70 }, segments: [{ key: 'y' }], share: { max: 25 }, summary: null })
    expect(out).toEqual({ mix: { core: 70 }, segments: [{ key: 'y' }], share: { min: 5, max: 25, note: 'n' } })
  })

  it('never mutates its inputs', () => {
    const base = { mix: { core: 60 } }
    const patch = { mix: { core: 70 } }
    mergeConfig(base, patch)
    expect(base).toEqual({ mix: { core: 60 } })
    expect(patch).toEqual({ mix: { core: 70 } })
  })

  it('tolerates junk', () => {
    expect(mergeConfig(null, { a: 1 })).toEqual({ a: 1 })
    expect(mergeConfig({ a: 1 }, 'nope')).toEqual({ a: 1 })
  })
})

describe('the admin prompt', () => {
  it('is stable — nothing in it can break the cached prefix', () => {
    expect(volatileFragment(ADMIN_EDITS_PROMPT)).toBeNull()
  })

  it('asks for a yes before an overwrite or a delete, and names what stays out of reach', () => {
    expect(ADMIN_EDITS_PROMPT).toMatch(/wait for the person to say yes/i)
    expect(ADMIN_EDITS_PROMPT).toMatch(/confirmed: true/)
    expect(ADMIN_EDITS_PROMPT).toMatch(/publishing/)
    expect(ADMIN_EDITS_PROMPT).toMatch(/members, roles and invites/)
    expect(ADMIN_EDITS_PROMPT).toMatch(/research run stays read-only/)
  })
})
