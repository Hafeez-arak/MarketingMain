import { describe, it, expect } from 'vitest'
import { explainFailure, canRetryWithoutBrand } from './failureText'

// ─── A failed card, in plain words ─────────────────────────────────────────
// The raw strings below are the real ones: read off failed creative_versions
// rows, or quoted where the workflows record which provider said what.

const FAL_NO_OUTPUT = '[{"loc":["body"],"msg":"The model did not generate the expected output for this prompt. This may occur for several reasons, including unsafe content, a prompt that is incompatible with the selected media type (e.g., prompting for an image with a video model).","type":"no_media_generated"}]'
const SEEDANCE_LIKENESS = '[{"loc":["body","image_urls"],"msg":"The images or videos provided may contain likenesses of real people or other private information that cannot be processed.","type":"content_policy_violation","url":"https://docs.fal.ai/errors"}]'

describe('explainFailure', () => {
  it('turns fal\'s "no output" JSON into a sentence, and keeps the raw text', () => {
    const f = explainFailure(FAL_NO_OUTPUT)
    expect(f.kind).toBe('no_output')
    expect(f.message).toBe('The model didn\'t make a picture from this. Rewording it, or simply trying again, usually works.')
    expect(f.message).not.toMatch(/[{[]/)
    expect(f.raw).toBe(FAL_NO_OUTPUT)
    expect(explainFailure('Nano Banana 2.1 returned no image').kind).toBe('no_output')
    expect(explainFailure('fal returned no video URL (request abc)', { media: 'video' }).message).toMatch(/a clip/)
  })

  it('names the real-person refusal for what it is', () => {
    const f = explainFailure(SEEDANCE_LIKENESS, { media: 'video' })
    expect(f.kind).toBe('likeness')
    expect(f.message).toMatch(/real people/)
  })

  it('says the credit ran out, not "403"', () => {
    expect(explainFailure('User is locked. Reason: TOP_UP').message)
      .toBe('Image generation is paused — the studio\'s credit has run out. Tell your admin.')
    expect(explainFailure('User is locked. Reason: Exhausted balance.', { media: 'video' }).message)
      .toBe('Video generation is paused — the studio\'s credit has run out. Tell your admin.')
  })

  it('covers a content refusal, sign-in, timeouts and the network', () => {
    expect(explainFailure('HTTP 422: {"detail":"the input cannot be processed"}').kind).toBe('refused')
    expect(explainFailure('Request failed with status code 403').kind).toBe('auth')
    expect(explainFailure('HTTP 401: {"detail":"No user found for Key"}').kind).toBe('auth')
    expect(explainFailure('Gave up waiting on fal after 20 minutes with no result (request x)').kind).toBe('timeout')
    expect(explainFailure('connect ETIMEDOUT 1.2.3.4:443').kind).toBe('timeout')
    expect(explainFailure('getaddrinfo ENOTFOUND fal.run').kind).toBe('network')
    expect(explainFailure('connect ECONNREFUSED 35.224.27.103:443').kind).toBe('network')
    expect(explainFailure('Webhook returned 504').kind).toBe('timeout')
  })

  it('shows a sentence our own workflow wrote as it is', () => {
    const f = explainFailure('A reel needs at least two clips.')
    expect(f).toEqual({ kind: 'plain', message: 'A reel needs at least two clips.', raw: '' })
  })

  it('falls back to a plain generic sentence, raw text behind Details', () => {
    const f = explainFailure('fal reported FAILED (request 0c7e)')
    expect(f.kind).toBe('unknown')
    expect(f.message).toMatch(/^Something went wrong/)
    expect(f.raw).toBe('fal reported FAILED (request 0c7e)')
  })

  it('never shows an empty card', () => {
    expect(explainFailure('').message).toMatch(/no reason came back/)
    expect(explainFailure(null).message).toMatch(/no reason came back/)
  })
})

describe('canRetryWithoutBrand', () => {
  const gemini = { provider: 'gemini', kind: 'generate', parent_version_id: null }
  const noOutput = explainFailure(FAL_NO_OUTPUT)

  it('offers it on a Gemini round-0 generate that made nothing', () => {
    expect(canRetryWithoutBrand(gemini, noOutput, true)).toBe(true)
  })

  it('not when there is no brand block to leave out', () => {
    expect(canRetryWithoutBrand(gemini, noOutput, false)).toBe(false)
  })

  it('not on ChatGPT, an edit, or a different failure', () => {
    expect(canRetryWithoutBrand({ ...gemini, provider: 'openai' }, noOutput, true)).toBe(false)
    expect(canRetryWithoutBrand({ ...gemini, kind: 'edit', parent_version_id: 'p' }, noOutput, true)).toBe(false)
    expect(canRetryWithoutBrand(gemini, explainFailure('User is locked. Reason: TOP_UP'), true)).toBe(false)
  })
})
