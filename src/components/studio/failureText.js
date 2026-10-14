// ─── A failed card, in plain words ─────────────────────────────────────────
// The workflows write the provider's REAL message onto a failed row, on
// purpose: "Request failed with status code 403" told nobody that fal's
// balance had run out (see errText in gen_workflows.py). But the real message
// is written for engineers — a marketer was shown
//   [{"loc":["body"],"msg":"The model did not generate the expected output…
// on the card itself. So the raw text stays on the row and behind a Details
// toggle, and the card leads with what it means and what to do.
//
// Matched in order, most specific first: a locked fal account answers 403,
// so the balance check has to win over the generic sign-in one.

const RULES = [
  {
    kind: 'balance',
    test: /user is locked|exhausted balance|top_?up|insufficient (balance|credit|funds)|out of credit/i,
    text: media => `${media === 'video' ? 'Video' : 'Image'} generation is paused — the studio's credit has run out. Tell your admin.`,
  },
  {
    // Seedance (and fal's other video models) refuse a start frame that shows
    // a recognisable person: "may contain likenesses of real people".
    kind: 'likeness',
    test: /likeness|real (people|person)|public figure|celebrit/i,
    text: () => 'The model won\'t work from pictures of real people. Use a picture without a recognisable face in it.',
  },
  {
    // fal's 422 from Nano Banana when it produced nothing — often, measured,
    // because the brand block read as a copywriting job rather than a picture.
    kind: 'no_output',
    test: /did not generate the expected output|cannot be processed as the requested output type|returned no (image|video)|edit returned no image|returned no video url/i,
    text: media => `The model didn't make ${media === 'video' ? 'a clip' : 'a picture'} from this. Rewording it, or simply trying again, usually works.`,
  },
  {
    kind: 'refused',
    test: /content_policy|content policy|safety|flagged|unsafe|moderation|cannot be processed|could not be processed|unprocessable|\b422\b/i,
    text: () => 'The model turned this request down. Try describing it differently.',
  },
  {
    kind: 'auth',
    test: /\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid (api )?key|authentication|no user found for key/i,
    text: () => 'The studio couldn\'t sign in to the image service. Tell your admin.',
  },
  {
    kind: 'timeout',
    test: /timed? ?out|timeout|gave up waiting|\b504\b/i,
    text: () => 'This took too long and was stopped. Try again.',
  },
  {
    kind: 'network',
    test: /enotfound|econnrefused|econnreset|eai_again|getaddrinfo|socket hang up|failed to fetch|networkerror|could not reach/i,
    text: () => 'The studio couldn\'t reach the service. Try again in a moment.',
  },
  {
    kind: 'not_set_up',
    test: /webhook not configured|isn't set up yet/i,
    text: () => 'This part of the studio isn\'t set up yet. Tell your admin.',
  },
]

// A sentence our own workflows already wrote for people — "A reel needs at
// least two clips.", "The trim ends before it starts." — is shown as it is.
// Anything with brackets, status codes or vendor and plumbing words is not.
const ENGINEERING = /[{}[\]<>]|\b(fal|http|https|request|webhook|json|api|null|undefined|status code|bytes|econn\w*)\b/i
function isPlain(text) {
  return text.length <= 160 && /^[A-Z]/.test(text) && /[.!]$/.test(text) && !ENGINEERING.test(text)
}

const GENERIC = 'Something went wrong making this. Try again — if it keeps failing, tell your admin.'

// → { kind, message, raw }. `raw` is the untouched text for the Details
// toggle; it is '' when the message IS the raw text, so there is nothing
// extra to reveal. `media` is 'image' | 'video' and only changes the wording.
export function explainFailure(raw, { media = 'image' } = {}) {
  const text = String(raw || '').trim()
  if (!text) return { kind: 'unknown', message: 'This didn\'t finish, and no reason came back. Try again.', raw: '' }
  for (const rule of RULES) {
    if (rule.test.test(text)) return { kind: rule.kind, message: rule.text(media), raw: text }
  }
  if (isPlain(text)) return { kind: 'plain', message: text, raw: '' }
  return { kind: 'unknown', message: GENERIC, raw: text }
}

// The one failure a brand-free retry can actually fix: Nano Banana making
// nothing from a round-0 brief. Only a generate round sends the brand block
// (an edit never does), and only when there was a block to leave out.
export function canRetryWithoutBrand(version, failure, hasBrand) {
  return !!hasBrand &&
    failure?.kind === 'no_output' &&
    version?.provider === 'gemini' &&
    version?.kind === 'generate' &&
    !version?.parent_version_id
}
