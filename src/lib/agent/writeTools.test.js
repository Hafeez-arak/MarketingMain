import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WRITE_TOOLS, WRITE_TARGETS, OWNERSHIP_CHECKS,
  FORBIDDEN_WRITE_TABLES, FORBIDDEN_STATUSES, writeToolsReachingForbiddenStatus,
  MEMORY_SOURCES, AGENT_MEMORY_SOURCE, POST_SOURCES, AGENT_POST_SOURCE,
  POST_PLATFORMS, MEMORY_SCOPES,
} from './writeTools'
import { toolsFor, toolsExposingWorkspace, toolDefs, READ_TOOLS } from './tools'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('the agent cannot publish and cannot edit the Brand Brain', () => {
  it('there is no tool that publishes or schedules', () => {
    // Enforced by absence, not by instruction. AGENT.md §4: "not shouldn't,
    // can't, because the tool doesn't exist." Widening this later should look
    // like a permission change in a diff, which is why it is asserted here.
    const names = WRITE_TOOLS.map(t => t.name).join(' ')
    expect(names).not.toMatch(/publish|schedule|send|post_now|approve/i)
  })

  it('no write tool lands a row in a terminal or live status', () => {
    expect(writeToolsReachingForbiddenStatus()).toEqual([])
    for (const [name, target] of Object.entries(WRITE_TARGETS)) {
      expect(FORBIDDEN_STATUSES, name).not.toContain(target.status)
    }
  })

  it('every write tool lands as proposed or draft — nothing else', () => {
    for (const [name, target] of Object.entries(WRITE_TARGETS)) {
      expect(['proposed', 'draft'], name).toContain(target.status)
    }
  })

  it('no write tool targets a Brand Brain table', () => {
    // RESEARCH-AGENT.md §5a. What the brand IS stays human-authored,
    // permanently.
    for (const [name, target] of Object.entries(WRITE_TARGETS)) {
      expect(FORBIDDEN_WRITE_TABLES, name).not.toContain(target.table)
    }
  })

  it('the executors never write a Brand Brain table — checked against the source', () => {
    // The "one-line review check" RESEARCH-AGENT.md asks for, as a test rather
    // than a habit: grep the write executors for those table names and there
    // should never be a hit. A habit survives exactly as long as the person
    // who has it.
    const source = fs.readFileSync(path.join(repoRoot, 'api/agent/_writeTools.js'), 'utf8')
    for (const table of FORBIDDEN_WRITE_TABLES) {
      // Match a write target, i.e. the table named as a POST/PATCH path.
      const writePattern = new RegExp(`db\\(\\s*['"\`]${table}[?'"\`]`)
      expect(writePattern.test(source), `${table} must never be written`).toBe(false)
    }
  })
})

describe('writes are opt-in per surface', () => {
  it('the default belt is reads only', () => {
    // A tool the model can see is a tool it will eventually reach for. Chat
    // answering "why did this flop?" should not be filing proposals.
    const names = toolsFor().map(t => t.name)
    expect(names).toEqual(READ_TOOLS.map(t => t.name))
    expect(names).not.toContain('propose_rule')
  })

  it('asking for writes adds them and keeps the reads', () => {
    const names = toolsFor({ writes: true }).map(t => t.name)
    expect(names).toContain('get_competitors')
    expect(names).toContain('propose_rule')
    expect(names).toContain('draft_post')
  })
})

describe('write tools obey the same isolation rule as reads', () => {
  it('no write tool exposes a workspace parameter either', () => {
    // The rule that makes a hallucinated uuid harmless. It has to hold for the
    // whole belt, not just the half that was written first.
    expect(toolsExposingWorkspace(toolsFor({ writes: true }))).toEqual([])
  })

  it('every model-supplied foreign key is declared for an ownership check', () => {
    // The subtler hole writes have and reads do not: a plan_id the model
    // invented — or lifted off another tenant's page during a web search —
    // would attach a row to a workspace the caller cannot see. This asserts
    // that no *_id parameter slips in without a declared check.
    for (const tool of WRITE_TOOLS) {
      const idParams = Object.keys(tool.input_schema.properties)
        .filter(k => /_id$/.test(k))
      const checked = (OWNERSHIP_CHECKS[tool.name] || []).map(c => c.param)
      for (const param of idParams) {
        expect(checked, `${tool.name}.${param} needs an ownership check`).toContain(param)
      }
    }
  })

  it('a required foreign key is marked required so it cannot be omitted', () => {
    // plan_ideas.plan_id is NOT NULL in the database. Letting the model omit
    // it would turn a clear "call get_plans first" into a constraint violation.
    const check = OWNERSHIP_CHECKS.propose_idea.find(c => c.param === 'plan_id')
    expect(check.required).toBe(true)
    expect(WRITE_TOOLS.find(t => t.name === 'propose_idea').input_schema.required)
      .toContain('plan_id')
  })
})

describe('write tool definitions', () => {
  it('tell the model what happens to the row, not just what to send', () => {
    // A model that knows a rule steers every future caption proposes fewer and
    // better ones than a model told only that the field is a string.
    const rule = WRITE_TOOLS.find(t => t.name === 'propose_rule')
    expect(rule.description).toMatch(/proposed/i)
    expect(rule.description).toMatch(/EVERY future caption/i)

    const draft = WRITE_TOOLS.find(t => t.name === 'draft_post')
    expect(draft.description).toMatch(/not.*scheduled/i)
    expect(draft.description).toMatch(/not published/i)
  })

  it('serialise to the provider shape without our cost field', () => {
    for (const def of toolDefs(toolsFor({ writes: true }))) {
      expect(Object.keys(def).sort()).toEqual(['description', 'input_schema', 'name'])
    }
  })

  it('names stay unique across reads and writes', () => {
    const names = toolsFor({ writes: true }).map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('the values we write are values Postgres accepts', () => {
  // Every assertion here corresponds to a CHECK constraint in the database.
  // They exist because 'agent' was the obvious, honest value for `source` on
  // both brand_memory and generated_posts, neither column allows it, and every
  // unit test passed anyway — nothing in the suite touched Postgres, so the
  // failure only appeared when a real row was finally attempted.

  it('the agent memory source is one the CHECK allows', () => {
    expect(MEMORY_SOURCES).toContain(AGENT_MEMORY_SOURCE)
    expect(AGENT_MEMORY_SOURCE).not.toBe('agent')
  })

  it('the agent post source is one the CHECK allows', () => {
    expect(POST_SOURCES).toContain(AGENT_POST_SOURCE)
    expect(AGENT_POST_SOURCE).not.toBe('agent')
  })

  it('every scope the rule tool offers is a scope the column accepts', () => {
    // The tool's enum and the CHECK have to agree, or the model picks a value
    // that is valid to the API and rejected by the database.
    const offered = WRITE_TOOLS.find(t => t.name === 'propose_rule')
      .input_schema.properties.scope.enum
    for (const scope of offered) expect(MEMORY_SCOPES, scope).toContain(scope)
  })

  it('the platform list matches what generated_posts allows', () => {
    expect(POST_PLATFORMS).toEqual(['instagram', 'tiktok', 'snapchat', 'linkedin'])
  })

  it('draft_post validates the platform itself rather than letting Postgres 400', () => {
    // A model can recover from "use one of: instagram, tiktok…" and cannot
    // recover from a raw 23514 constraint violation.
    const source = fs.readFileSync(path.join(repoRoot, 'api/agent/_writeTools.js'), 'utf8')
    expect(source).toMatch(/POST_PLATFORMS\.includes\(platform\)/)
  })
})
