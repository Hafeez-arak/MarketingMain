import { describe, it, expect } from 'vitest'
import { companyFolders, listFolder, collectCompanyFiles, removeCompanyFiles, countFiles } from './workspaceFiles.js'

const WS = '57ea6bde-ddb3-4e49-ad45-4402bdac6998'
const OTHER = '00000000-0000-0000-0000-000000000001'

// A fake of supabase-js storage over a flat { bucket: [path] } map, listing
// one level at a time the way the real one does (folders have id: null).
function fakeStorage(objects, { failList, failRemove, silentlySkip } = {}) {
  const removed = []
  return {
    removed,
    from(bucket) {
      return {
        async list(prefix, { limit, offset }) {
          if (failList === bucket) return { data: null, error: { message: 'boom' } }
          const level = new Map()
          for (const p of objects[bucket] || []) {
            if (!p.startsWith(prefix + '/')) continue
            const [head, ...rest] = p.slice(prefix.length + 1).split('/')
            level.set(head, rest.length ? { name: head, id: null } : { name: head, id: 'x' })
          }
          return { data: [...level.values()].slice(offset, offset + limit), error: null }
        },
        async remove(paths) {
          if (failRemove === bucket) return { data: null, error: { message: 'nope' } }
          const kept = silentlySkip ? paths.filter(p => !p.includes(silentlySkip)) : paths
          removed.push(...kept.map(p => `${bucket}:${p}`))
          return { data: kept.map(name => ({ name })), error: null }
        },
      }
    },
  }
}

function fakeClient(objects, sessions, opts) {
  const storage = fakeStorage(objects, opts)
  return {
    storage,
    from(table) {
      expect(table).toBe('creative_sessions')
      return { select: () => ({ eq: (col, val) => {
        expect(col).toBe('workspace_id')
        return Promise.resolve({ data: sessions.filter(s => s.workspace_id === val), error: null })
      } }) }
    },
  }
}

const OBJECTS = {
  'brand-assets': [`${WS}/logo/a.png`, `${WS}/fitted/b.jpg`, `${OTHER}/logo/keep.png`],
  'media-library': [`${WS}/m.gif`],
  'creative-studio': [`${WS}/up.png`, 'sess-1/render.mp4', 'sess-other/keep.mp4', `${OTHER}/keep.png`],
  'schedule-uploads': [`references/${WS}/r.png`, `references/${OTHER}/keep.png`, 'instagram/2026-05-14/keep.jpg'],
  'hr-papers': [`${WS}/emp1/a.pdf`, `${OTHER}/emp9/keep.pdf`],
  'company-documents': [`${WS}/doc1/v.pdf`, `${OTHER}/doc9/keep.pdf`],
  'instagram-posts': ['1778675656016-.webp'],
}
const SESSIONS = [{ id: 'sess-1', workspace_id: WS }, { id: 'sess-other', workspace_id: OTHER }]

describe('workspaceFiles', () => {
  it('refuses to build folders without a workspace id (an empty prefix is the whole bucket)', () => {
    expect(() => companyFolders('')).toThrow()
    expect(() => companyFolders(undefined)).toThrow()
  })

  it('lists nested folders', async () => {
    const st = fakeStorage(OBJECTS)
    expect((await listFolder(st, 'brand-assets', WS)).sort()).toEqual([`${WS}/fitted/b.jpg`, `${WS}/logo/a.png`])
  })

  it('pages past 1,000 entries', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => `${WS}/f${i}.png`)
    const st = fakeStorage({ 'media-library': many })
    expect(await listFolder(st, 'media-library', WS)).toHaveLength(2500)
  })

  it("collects only this company's files, including its studio session folders", async () => {
    const files = await collectCompanyFiles(fakeClient(OBJECTS, SESSIONS), WS)
    expect(files).toEqual({
      'brand-assets': expect.arrayContaining([`${WS}/logo/a.png`, `${WS}/fitted/b.jpg`]),
      'media-library': [`${WS}/m.gif`],
      'creative-studio': [`${WS}/up.png`, 'sess-1/render.mp4'],
      'schedule-uploads': [`references/${WS}/r.png`],
      'hr-papers': [`${WS}/emp1/a.pdf`],
      'company-documents': [`${WS}/doc1/v.pdf`],
    })
    expect(countFiles(files)).toBe(8)
    expect(JSON.stringify(files)).not.toContain('keep')
  })

  it('throws when a bucket cannot be listed, so the company is not deleted blind', async () => {
    await expect(collectCompanyFiles(fakeClient(OBJECTS, SESSIONS, { failList: 'creative-studio' }), WS)).rejects.toThrow(/creative-studio/)
  })

  it('removes everything it collected', async () => {
    const client = fakeClient(OBJECTS, SESSIONS)
    const files = await collectCompanyFiles(client, WS)
    expect(await removeCompanyFiles(client.storage, files)).toEqual({ removed: 8, failed: 0 })
    expect(client.storage.removed).toHaveLength(8)
  })

  it('counts failures instead of throwing, including deletes storage silently skipped', async () => {
    const client = fakeClient(OBJECTS, SESSIONS, { failRemove: 'brand-assets', silentlySkip: 'm.gif' })
    const files = await collectCompanyFiles(client, WS)
    expect(await removeCompanyFiles(client.storage, files)).toEqual({ removed: 5, failed: 3 })
  })
})
