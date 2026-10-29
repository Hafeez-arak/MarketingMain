import { describe, it, expect, vi } from 'vitest'
import { search, searchPages, scoreText, hitsAll, groupResults, providersFor, recordItems, PROVIDERS, MODES } from './search'

const ADMIN = { isAccessAdmin: true, sections: null }
const SARA = { isAccessAdmin: false, sections: { marketing: 'work', insights: 'work', crm: 'view' } }
const NOBODY = { isAccessAdmin: false, sections: {} }
const provider = key => PROVIDERS.find(p => p.key === key)

/** A fake database: each search function answers with these rows. */
const ROWS = {
  shell_search_leads: [{ kind: 'lead', id: 'l1', title: 'Najd Towers', detail: 'Omar · 2026-10-20', meta: { stage: null, email: 'omar@example.com' }, rank: 1 }],
  shell_search_crm: [{ kind: 'opportunity', id: 'o1', title: 'Najd tower lobby', detail: 'L-1', meta: { status: 'open' }, rank: 2 }],
  shell_search_contacts: [
    { kind: 'org', id: 'c1', title: 'Najd Towers Development', title_ar: 'شركة أبراج نجد', detail: 'C-1', meta: {}, rank: 1 },
    { kind: 'person', id: 'p1', title: 'Yousef', title_ar: 'يوسف', detail: 'Manager · Najd', meta: { org_id: 'c1' }, rank: 3 },
    { kind: 'person', id: 'p2', title: 'Alone Person', detail: '', meta: { org_id: null }, rank: 3 },
  ],
  shell_search_hr: [{ kind: 'employee', id: 'e1', title: 'Noura Sample', title_ar: 'نورة عينة', detail: 'E-1', meta: {}, rank: 1 }],
  shell_search_tasks: [{ kind: 'task', id: 't1', title: 'Call Najd', meta: {}, rank: 2 }],
  shell_search_requests: [{ kind: 'request', id: 'r1', title: 'Najd report', meta: {}, rank: 1 }],
}
const fakeCall = () => vi.fn(async rpc => ROWS[rpc] || [])

describe('matching and ranking', () => {
  it('folds Arabic letter forms, as Contacts does', () => {
    expect(hitsAll('ابراج', ['شركة أبراج نجد'])).toBe(true)
    expect(hitsAll('نوره', ['نورة'])).toBe(true)
    expect(hitsAll('مصطفي', ['مصطفى'])).toBe(true)
  })

  it('needs every word of the query', () => {
    expect(hitsAll('najd lobby', ['Najd tower lobby'])).toBe(true)
    expect(hitsAll('najd hotel', ['Najd tower lobby'])).toBe(false)
  })

  it('ranks the exact name, then the start, then a word start, then anywhere', () => {
    expect(scoreText('leads', ['Leads'])).toBe(0)
    expect(scoreText('lea', ['Leads'])).toBe(1)
    expect(scoreText('acc', ['Target accounts'])).toBe(2)
    expect(scoreText('ead', ['Leads'])).toBe(3)
    expect(scoreText('zzz', ['Leads'])).toBe(4)
  })
})

describe('pages', () => {
  it('finds pages in either language whatever the app language', () => {
    expect(searchPages('leads', ADMIN, 'ar').map(r => r.to)).toContain('/sales/leads')
    expect(searchPages('العملاء', ADMIN, 'en').map(r => r.to)).toContain('/sales/leads')
  })

  it('shows titles in the app language', () => {
    const hit = searchPages('leads', ADMIN, 'ar').find(r => r.to === '/sales/leads')
    expect(hit.title).toBe('العملاء المحتملون')
    expect(hit.detail).toBe('المبيعات')
  })

  it('finds a page under its section name, after pages named for the query', () => {
    const res = searchPages('crm', ADMIN, 'en').map(r => r.to)
    expect(res[0]).toBe('/crm/settings') // "CRM settings": its own name starts with the query
    expect(res).toContain('/crm')
  })

  it('never offers a page the person may not visit', () => {
    const tos = searchPages('a', SARA, 'en').map(r => r.to)
    expect(tos.some(t => t.startsWith('/sales') || t.startsWith('/hr') || t.startsWith('/admin') || t.startsWith('/contacts'))).toBe(false)
    expect(searchPages('settings', SARA, 'en').map(r => r.to)).toContain('/crm/settings') // CRM settings is open to view
    expect(searchPages('access', SARA, 'en')).toEqual([])
  })

  it('leaves out pages reached only from inside a module', () => {
    expect(searchPages('opportunity', ADMIN, 'en').map(r => r.to)).not.toContain('/crm/lead')
  })

  it('offers the global pages to everyone', () => {
    expect(searchPages('tasks', NOBODY, 'en').map(r => r.to)).toEqual(['/tasks'])
  })
})

describe('access', () => {
  it('asks only the modules the person can open', () => {
    expect(providersFor(SARA).map(p => p.key)).toEqual(['crm', 'tasks', 'requests'])
    expect(providersFor(ADMIN).map(p => p.key)).toEqual(['sales', 'crm', 'catalog', 'contacts', 'hr', 'tasks', 'requests'])
    expect(providersFor(NOBODY).map(p => p.key)).toEqual(['tasks', 'requests'])
  })

  it('never calls the database for a module that is closed to them', async () => {
    const call = fakeCall()
    await search('najd', SARA, { call })
    expect(call.mock.calls.map(c => c[0]).sort()).toEqual(['shell_search_crm', 'shell_search_requests', 'shell_search_tasks'])
  })

  it('drops a result whose page the person may not visit', () => {
    const items = [{ group: 'organisations', to: '/contacts/org?id=1', title: 'x' }, { group: 'tasks', to: '/tasks?id=1', title: 'y' }]
    expect(groupResults(items, SARA).map(g => g.key)).toEqual(['tasks'])
  })
})

describe('search()', () => {
  it('returns groups in a fixed order with links to the right page', async () => {
    const { groups, failed } = await search('najd', ADMIN, { call: fakeCall(), lang: 'en' })
    expect(failed).toEqual([])
    expect(groups.map(g => g.key)).toEqual(['leads', 'opportunities', 'organisations', 'people', 'employees', 'tasks', 'requests'])
    const to = Object.fromEntries(groups.map(g => [g.key, g.items.map(i => i.to)]))
    expect(to.leads).toEqual(['/sales/leads?q=omar%40example.com'])
    expect(to.opportunities).toEqual(['/crm/lead?id=o1'])
    expect(to.organisations).toEqual(['/contacts/org?id=c1'])
    expect(to.people).toEqual(['/contacts/org?id=c1', '/contacts/people?q=Alone%20Person'])
    expect(to.tasks).toEqual(['/tasks?id=t1'])
    expect(to.requests).toEqual(['/requests?id=r1'])
  })

  it('opens a lead on the pipeline when it has a stage', () => {
    const [item] = recordItems(provider('sales'), [{ kind: 'lead', id: 'l9', title: 'X', meta: { stage: 'quoted' } }])
    expect(item.to).toBe('/sales/leads?view=pipeline&lead=l9')
  })

  it('puts pages first and shows the Arabic names in Arabic', async () => {
    const { groups } = await search('نور', ADMIN, { call: fakeCall(), lang: 'ar' })
    const emp = groups.find(g => g.key === 'employees')
    expect(emp.label).toBe('الموظفون')
    expect(emp.items[0].title).toBe('نورة عينة')
  })

  it('shows pages at once, before the database answers', async () => {
    const onPages = vi.fn()
    const waiting = []
    const call = vi.fn(() => new Promise(r => { waiting.push(r) }))
    const done = search('leads', ADMIN, { call, onPages })
    expect(onPages).toHaveBeenCalledTimes(1)
    expect(onPages.mock.calls[0][0][0].key).toBe('pages')
    expect(call).toHaveBeenCalled()
    waiting.forEach(r => r([]))
    await done
  })

  it('caps each group and keeps the database order within it', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ kind: 'task', id: `t${i}`, title: `Task ${i}`, rank: i % 2 }))
    const { groups } = await search('task', ADMIN, { call: async rpc => (rpc === 'shell_search_tasks' ? many : []) })
    const tasks = groups.find(g => g.key === 'tasks').items
    expect(tasks).toHaveLength(5)
    expect(tasks.map(t => t.title).slice(0, 3)).toEqual(['Task 0', 'Task 2', 'Task 4'])
  })

  it('says which modules failed instead of pretending there was nothing', async () => {
    const call = async rpc => { if (rpc === 'shell_search_crm') throw new Error('down'); return [] }
    const { failed } = await search('najd', SARA, { call })
    expect(failed).toEqual(['crm'])
  })

  it('does not ask the database for one letter, or for nothing', async () => {
    const call = fakeCall()
    await search('n', ADMIN, { call })
    await search('   ', ADMIN, { call })
    expect(call).not.toHaveBeenCalled()
  })

  it('has one mode today, the plain search', () => {
    expect(Object.keys(MODES)).toEqual(['search'])
  })
})
