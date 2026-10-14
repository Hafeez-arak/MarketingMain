import { describe, it, expect, beforeEach } from 'vitest'
import { ensure, refresh, prime, invalidate, getEntry, isFresh, clearCache, subscribe } from './cache.js'
import { searchPattern } from './client.js'

const tick = () => new Promise(r => setTimeout(r, 0))

describe('email session cache', () => {
  beforeEach(() => clearCache())

  it('reads once, then answers from memory', async () => {
    let calls = 0
    const fetcher = async () => { calls++; return ['a'] }
    ensure('k', fetcher)
    expect(getEntry('k').data).toBeUndefined()
    await tick()
    expect(getEntry('k').data).toEqual(['a'])
    ensure('k', fetcher)
    await tick()
    expect(calls).toBe(1)
  })

  it('two readers of one key share one read', async () => {
    let calls = 0
    const fetcher = async () => { calls++; return 1 }
    ensure('k', fetcher); ensure('k', fetcher)
    await tick()
    expect(calls).toBe(1)
  })

  it('after invalidate, re-reads while keeping the old answer up', async () => {
    let n = 0
    const fetcher = async () => ++n
    ensure('k', fetcher); await tick()
    invalidate()
    expect(isFresh(getEntry('k'))).toBe(false)
    ensure('k', fetcher)
    expect(getEntry('k').data).toBe(1)      // still shown during the re-read
    await tick()
    expect(getEntry('k').data).toBe(2)
  })

  it('a failed read says so, and keeps the last good answer', async () => {
    ensure('k', async () => 'good'); await tick()
    await refresh('k', async () => { throw new Error('offline') })
    expect(getEntry('k')).toMatchObject({ data: 'good', error: 'offline' })
  })

  it('a first read that fails has no data, only the failure', async () => {
    ensure('k', async () => { throw new Error('503') }); await tick()
    expect(getEntry('k').data).toBeUndefined()
    expect(getEntry('k').error).toBe('503')
  })

  it('a slower, older read never overwrites a newer one', async () => {
    let release
    refresh('k', () => new Promise(r => { release = r }))
    await refresh('k', async () => 'new')
    release('old'); await tick()
    expect(getEntry('k').data).toBe('new')
  })

  it('prime puts a just-saved row in without a read', () => {
    prime('campaign:ws:1', { id: '1' })
    expect(isFresh(getEntry('campaign:ws:1'))).toBe(true)
  })

  it('tells subscribers when something changes', async () => {
    let seen = 0
    const off = subscribe(() => { seen++ })
    ensure('k', async () => 1); await tick()
    off()
    expect(seen).toBeGreaterThanOrEqual(2)   // started, landed
  })
})

describe('searchPattern', () => {
  it('quotes the text so commas and brackets cannot break the filter', () => {
    expect(searchPattern('  al, (x) ')).toBe('"*al, (x)*"')
  })
  it('drops the wildcard characters a person did not mean', () => {
    expect(searchPattern('50%*')).toBe('"*50*"')
  })
  it('escapes quotes and backslashes', () => {
    expect(searchPattern('a"b\\c')).toBe('"*a\\"b\\\\c*"')
  })
  it('is empty for nothing to search', () => {
    expect(searchPattern('  ')).toBe('')
    expect(searchPattern('%')).toBe('')
  })
})
