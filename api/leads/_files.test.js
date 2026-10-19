import { describe, it, expect } from 'vitest'
import { filePath, linkToFile, sweepFiles, supabaseStorage, LINK_SECONDS } from './_files.js'

// Large attachments through a fake Storage, and the real Storage client
// against a fake fetch. Made-up ids only.

const WS = '11111111-1111-4111-8111-111111111111'
const LEAD = '22222222-2222-4222-8222-222222222222'

function fakeStorage({ expired = [], refuse = null } = {}) {
  const st = { files: {}, removed: [], signed: [] }
  st.storage = {
    async upload(path, bytes) { if (refuse) return refuse; st.files[path] = bytes; return { ok: true } },
    async sign(path, seconds, name) { if (!st.files[path]) return null; st.signed.push([path, seconds, name]); return `https://store.example/${path}?token=t&download=${encodeURIComponent(name)}` },
    async remove(paths) { st.removed.push(...paths); for (const p of paths) delete st.files[p]; return { ok: true } },
  }
  st.db = async (path) => (path === 'rpc/lead_files_expired' ? expired : [])
  return st
}

describe('a large attachment', () => {
  it('is fetched once, kept, and handed out as a ten-minute link', async () => {
    const st = fakeStorage()
    let fetched = 0
    const fetchBytes = async () => { fetched++; return { bytes: Buffer.from('zip') } }
    const args = { workspaceId: WS, leadId: LEAD, attachmentId: 'AAMk+/x==', name: 'Facade drawings.zip', contentType: 'application/zip', fetchBytes }
    const first = await linkToFile(st, args)
    expect(first).toEqual({ url: expect.stringContaining('download=Facade%20drawings.zip'), cached: false })
    const again = await linkToFile(st, args)
    expect(again.cached).toBe(true)
    expect(fetched).toBe(1)
    expect(st.signed[0][1]).toBe(LINK_SECONDS)
  })
  it('keeps the path plain whatever the names are', () => {
    expect(filePath(WS, LEAD, 'AAMk+/x==', 'مخطط نهائي.PDF')).toMatch(new RegExp(`^${WS}/${LEAD}/[0-9a-f]{24}/file\\.pdf$`))
    expect(filePath(WS, LEAD, 'x', 'no extension')).toMatch(/\/file\.bin$/)
  })
  it('says so when Storage will not take it, and passes on a mailbox error', async () => {
    const big = fakeStorage({ refuse: { ok: false, status: 413, error: 'too large' } })
    expect((await linkToFile(big, { workspaceId: WS, leadId: LEAD, attachmentId: 'a', name: 'x.zip', fetchBytes: async () => ({ bytes: Buffer.from('1') }) })).status).toBe(413)
    const gone = await linkToFile(fakeStorage(), { workspaceId: WS, leadId: LEAD, attachmentId: 'a', name: 'x.zip', fetchBytes: async () => ({ status: 502, error: 'Microsoft answered 503 for the attachment.' }) })
    expect(gone).toEqual({ status: 502, error: 'Microsoft answered 503 for the attachment.' })
  })
  it('clears the copies older than a day first, and never fails on it', async () => {
    const st = fakeStorage({ expired: ['old/1/file.zip', { lead_files_expired: 'old/2/file.pdf' }] })
    expect(await sweepFiles(st)).toEqual({ removed: 2 })
    expect(st.removed).toEqual(['old/1/file.zip', 'old/2/file.pdf'])
    const broken = { db: async () => { throw new Error('down') }, storage: st.storage }
    expect(await sweepFiles(broken)).toEqual({ removed: 0, error: 'down' })
  })
})

describe('the Storage client', () => {
  it('uploads with the service key, signs, and builds the download link', async () => {
    const calls = []
    const f = async (url, init) => {
      calls.push([init.method, url, init.headers])
      if (url.includes('/object/sign/')) return new Response(JSON.stringify({ signedURL: '/object/sign/lead-files/a/b/file.zip?token=abc' }), { status: 200 })
      return new Response('{}', { status: 200 })
    }
    const s = supabaseStorage({ url: 'https://proj.supabase.co/', key: 'svc', fetch: f })
    expect(await s.upload('a/b/file.zip', Buffer.from('x'), 'application/zip')).toEqual({ ok: true })
    expect(await s.sign('a/b/file.zip', 600, 'BOQ rev2.zip')).toBe('https://proj.supabase.co/storage/v1/object/sign/lead-files/a/b/file.zip?token=abc&download=BOQ%20rev2.zip')
    expect(calls[0]).toEqual(['POST', 'https://proj.supabase.co/storage/v1/object/lead-files/a/b/file.zip', expect.objectContaining({ Authorization: 'Bearer svc', 'x-upsert': 'true' })])
  })
  it('reads a size refusal as 413, and a missing file as no link', async () => {
    const s = supabaseStorage({ url: 'https://p.supabase.co', key: 'k', fetch: async (url) => (url.includes('/sign/')
      ? new Response('{"error":"not_found"}', { status: 400 })
      : new Response('{"message":"The object exceeded the maximum allowed size"}', { status: 400 })) })
    expect(await s.upload('p', Buffer.from('x'), 'x')).toMatchObject({ ok: false, status: 413 })
    expect(await s.sign('p', 600, 'x')).toBeNull()
  })
})
