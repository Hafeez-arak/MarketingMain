import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Re-opening files attached earlier in the chat ─────────────────────────
// Pinned: the thread and the company come from the session, never the model;
// a stored path outside this thread's folder is never fetched; a PDF comes
// back as its text in pages, an image as the image; and keeping a file never
// fails the answer.

process.env.SUPABASE_URL = 'https://sb.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'

const calls = []
let route = () => []
vi.mock('./_supabase.js', () => ({
  db: async (path, opts = {}) => {
    const call = { path: String(path), method: opts.method || 'GET', body: opts.body }
    calls.push(call)
    return route(call)
  },
}))

// Storage, as a map of path → bytes behind a fake fetch.
const store = new Map()
const fetched = []
let refuseUploads = false
vi.stubGlobal('fetch', async (url, opts = {}) => {
  const u = decodeURIComponent(String(url))
  fetched.push({ url: u, method: opts.method || 'GET' })
  const up = u.match(/\/storage\/v1\/object\/chat-files\/(.+)$/)
  if (opts.method === 'POST' && up) {
    if (refuseUploads) return new Response(JSON.stringify({ message: 'Bucket not found' }), { status: 404 })
    store.set(up[1], Buffer.from(opts.body))
    return new Response('{}', { status: 200 })
  }
  if (opts.method === 'DELETE') {
    for (const p of JSON.parse(opts.body).prefixes) store.delete(p)
    return new Response('[]', { status: 200 })
  }
  const get = u.match(/\/storage\/v1\/object\/authenticated\/chat-files\/(.+)$/)
  if (get && store.has(get[1])) return new Response(store.get(get[1]), { status: 200 })
  return new Response('not found', { status: 404 })
})

const { runTool } = await import('./_tools.js')
const { saveChatFiles, sweepOrphans } = await import('./_chatFiles.js')
const { toolResultBlock } = await import('../../src/lib/agent/loop.js')

const WS = 'ws-1'
const CHAT = 'chat-1'
const SESSION = { userId: 'u-1', chatId: CHAT, isAdmin: false }
const folder = `${WS}/chat/${CHAT}/`

/** One user message carrying the given stored attachments. */
const message = (attachments, created_at = '2026-11-01T10:00:00Z') => ({ attachments, created_at })

beforeEach(() => {
  calls.length = 0
  fetched.length = 0
  store.clear()
  refuseUploads = false
  route = () => []
})

describe('get_attachment — scoping', () => {
  it('needs a chat: no session, nothing read', async () => {
    const out = await runTool(WS, 'get_attachment', { name: 'x.pdf' }, {})
    expect(out.ok).toBe(false)
    expect(calls).toEqual([])
    expect(fetched).toEqual([])
  })

  it('reads this thread in this company, whatever the model passes', async () => {
    await runTool(WS, 'get_attachment', { name: 'x.pdf', chat_id: 'chat-other', workspace_id: 'ws-other' }, SESSION)
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toContain(`chat_id=eq.${CHAT}`)
    expect(calls[0].path).toContain(`workspace_id=eq.${WS}`)
    expect(calls[0].path).not.toContain('other')
  })

  it('never fetches a stored path from another thread or company', async () => {
    store.set('ws-2/chat/chat-9/k/text.txt', Buffer.from('secret'))
    store.set(`${WS}/chat/chat-9/k/file.jpg`, Buffer.from('secret'))
    route = () => [message([
      { name: 'theirs.pdf', kind: 'pdf', path: 'ws-2/chat/chat-9/k/file.pdf', text_path: 'ws-2/chat/chat-9/k/text.txt' },
      { name: 'sibling.jpg', kind: 'image', media_type: 'image/jpeg', path: `${WS}/chat/chat-9/k/file.jpg` },
      { name: 'climb.pdf', kind: 'pdf', path: `${folder}../../chat-9/k/file.pdf` },
    ])]
    for (const name of ['theirs.pdf', 'sibling.jpg', 'climb.pdf']) {
      const out = await runTool(WS, 'get_attachment', { name }, SESSION)
      expect(out.ok).toBe(false)
      expect(out.error).toMatch(/No attached file|No files/)
    }
    expect(fetched).toEqual([])
  })
})

describe('get_attachment — what comes back', () => {
  it('a PDF as its stored text, in pages the model can continue', async () => {
    const text = 'A'.repeat(50_000) + 'END'
    store.set(`${folder}k1/text.txt`, Buffer.from(text))
    route = () => [message([{ name: 'Newsletter Oct.pdf', kind: 'pdf', path: `${folder}k1/file.pdf`, text_path: `${folder}k1/text.txt`, pages: 6 }])]

    const first = await runTool(WS, 'get_attachment', { name: 'newsletter' }, SESSION)
    expect(first.ok).toBe(true)
    expect(first.blocks).toBeUndefined()
    expect(first.result).toMatchObject({ name: 'Newsletter Oct.pdf', pages: 6, offset: 0, chars: 50_003 })
    expect(first.result.text).toHaveLength(40_000)
    expect(first.result.more).toMatch(/offset 40000/)

    const rest = await runTool(WS, 'get_attachment', { name: 'newsletter', offset: 40_000 }, SESSION)
    expect(rest.result.text.endsWith('END')).toBe(true)
    expect(rest.result.more).toBeUndefined()
    // Only the text was read, never the PDF.
    expect(fetched.every(f => f.url.endsWith('text.txt'))).toBe(true)
  })

  it('an image as the image, after the JSON in the tool result', async () => {
    store.set(`${folder}k2/file.jpg`, Buffer.from('jpeg-bytes'))
    route = () => [message([{ name: 'site.jpg', kind: 'image', media_type: 'image/jpeg', path: `${folder}k2/file.jpg` }])]
    const out = await runTool(WS, 'get_attachment', {}, SESSION)
    expect(out.ok).toBe(true)
    const block = toolResultBlock('tu-1', out)
    expect(block.content[0].type).toBe('text')
    expect(JSON.parse(block.content[0].text).name).toBe('site.jpg')
    expect(block.content[1]).toEqual({
      type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('jpeg-bytes').toString('base64') },
    })
  })

  it('a scanned PDF with no text as the PDF itself', async () => {
    store.set(`${folder}k3/file.pdf`, Buffer.from('%PDF'))
    route = () => [message([{ name: 'scan.pdf', kind: 'pdf', media_type: 'application/pdf', path: `${folder}k3/file.pdf` }])]
    const out = await runTool(WS, 'get_attachment', { name: 'the pdf' }, SESSION)
    expect(out.ok).toBe(true)
    expect(out.blocks[0]).toMatchObject({ type: 'document', title: 'scan.pdf', source: { media_type: 'application/pdf' } })
  })

  it('lists the files when the name matches nothing', async () => {
    route = () => [message([
      { name: 'a.pdf', kind: 'pdf', path: `${folder}k/file.pdf` },
      { name: 'b.jpg', kind: 'image', path: `${folder}j/file.jpg` },
    ])]
    const out = await runTool(WS, 'get_attachment', { name: 'budget.xlsx' }, SESSION)
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/a\.pdf, b\.jpg/)
  })

  it('a plain tool result is unchanged: a JSON string', () => {
    expect(toolResultBlock('tu', { ok: true, result: { a: 1 } }).content).toBe('{"a":1}')
  })
})

describe('saveChatFiles', () => {
  const realPdf = () => {
    // A one-page PDF with a text layer, offsets computed.
    const stream = 'BT /F1 12 Tf 72 720 Td (Price is 42 SAR) Tj ET'
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    let out = '%PDF-1.4\n'
    const offs = []
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
    const x = out.length
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`
    return Buffer.from(out, 'latin1').toString('base64')
  }

  it('keeps each original in the thread folder and a PDF\'s text beside it', async () => {
    const saved = await saveChatFiles(WS, CHAT, [
      { name: 'n.pdf', media_type: 'application/pdf', kind: 'pdf', data: realPdf() },
      { name: 'p.jpg', media_type: 'image/jpeg', kind: 'image', data: Buffer.from('img').toString('base64') },
    ])
    expect(saved[0].path).toMatch(new RegExp(`^${folder}[0-9a-f-]{36}/file\\.pdf$`))
    expect(saved[0].text_path).toBe(saved[0].path.replace('file.pdf', 'text.txt'))
    expect(saved[0].pages).toBe(1)
    expect(store.get(saved[0].text_path).toString()).toMatch(/--- Page 1 ---\nPrice is 42 SAR/)
    expect(saved[1].path).toMatch(/\/file\.jpg$/)
    expect(saved[1].text_path).toBeUndefined()
    expect(store.get(saved[1].path).toString()).toBe('img')
  })

  it('a file storage refuses is not kept, and nothing throws', async () => {
    refuseUploads = true
    const saved = await saveChatFiles(WS, CHAT, [{ name: 'p.jpg', media_type: 'image/jpeg', kind: 'image', data: 'aW1n' }])
    expect(saved).toEqual([{}])
  })

  it('without a chat it keeps nothing', async () => {
    expect(await saveChatFiles(WS, '', [{ name: 'p.jpg', data: 'aW1n' }])).toEqual([{}])
    expect(fetched).toEqual([])
  })
})

describe('sweepOrphans', () => {
  it('removes what the database says has no chat left', async () => {
    store.set('ws-gone/chat/c/k/file.pdf', Buffer.from('x'))
    store.set(`${folder}k/file.pdf`, Buffer.from('y'))
    route = ({ path }) => (path === 'rpc/chat_files_orphaned' ? ['ws-gone/chat/c/k/file.pdf'] : [])
    expect(await sweepOrphans()).toEqual({ removed: 1 })
    expect([...store.keys()]).toEqual([`${folder}k/file.pdf`])
  })

  it('never throws when the function is not there yet', async () => {
    route = () => { throw new Error('Supabase 404') }
    expect((await sweepOrphans()).removed).toBe(0)
  })
})
