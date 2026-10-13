// ─── The search a lens keeps going with once web_search is spent ───────────
// Each lens gets a few of Claude's own web searches (budget.searches in
// lenses.js). On 2026-10-13 every searching lens used all six and stopped, and
// the brief said so: "Armada, Spectra Electricals and Lumiere were not
// re-checked." The owner's call: when those run out, carry on through
// Firecrawl (Tavily behind it, api/agent/_web.js) rather than stop. Those
// searches draw on free tiers, not the Anthropic bill.
//
// No search budget here, on purpose. What stays is a guard against a loop
// that has stopped listening, and the lens's own clock: a lens stopped
// mid-search reports nothing at all, so it is told to answer while there is
// still time to write the answer.
//
// Pure: no network. The calling lives in api/agent/_lenses.js.

/** Not a budget: a runaway guard. A lens that needs more is not converging. */
export const BACKUP_CALLS_PER_LENS = 30

/** Writing the findings takes a minute or more; no new search inside this. */
export const WRAP_UP_MS = 90_000

/**
 * Same names as the chat's web tools (tools.js WEB_TOOLS), worded for a lens:
 * a backup to web_search, not a replacement for it.
 */
export const BACKUP_TOOLS = [
  {
    name: 'search_web',
    description:
      'Backup web search (Firecrawl, Tavily behind it). Use it once web_search reports that its ' +
      'limit is reached (max_uses_exceeded), and for anything web_search could not find: tender ' +
      'portals, PDFs, competitor websites. It has no fixed limit this pass. Returns titles, URLs ' +
      'and snippets; read_page the ones that matter. A specific query (a company name plus what ' +
      'you want to know) beats a general one.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', description: 'How many results. Default 5, max 10.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_page',
    description:
      'Read one web page as markdown (Firecrawl, Tavily behind it). Use it for a URL from ' +
      'search_web, or when web_fetch has reached its limit. Long pages are truncated. A failure ' +
      'comes back as an error, which means the page could not be read, not that it is empty.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'The full URL, including https://' },
      },
      required: ['url'],
    },
  },
]

export const BACKUP_NAMES = new Set(BACKUP_TOOLS.map(t => t.name))

/**
 * Appended to a lens prompt when the backup is on. Without it a lens told
 * "you have 6 searches" plans to six and reports the rest as not checked.
 */
export const BACKUP_PROMPT =
  '\n\nSEARCH BACKUP: when web_search or web_fetch says its limit is reached, carry on with ' +
  'search_web and read_page. Cover everything this question asks for (every name on a list, ' +
  'every source it names) rather than reporting what was left unchecked. If a backup tool ' +
  'tells you to stop, write your answer with what you have.'

/**
 * May the lens make another backup call? Null when yes; otherwise the message
 * the model gets back instead of a result, which tells it to answer.
 *
 * @param {{used:number, msLeft:number|null}} state  msLeft null = no deadline
 */
export function backupGate({ used = 0, msLeft = null } = {}) {
  if (msLeft !== null && msLeft < WRAP_UP_MS) {
    return 'No more searching: this pass is nearly out of time. Write your answer now with what you have found.'
  }
  if (used >= BACKUP_CALLS_PER_LENS) {
    return `No more searching: ${BACKUP_CALLS_PER_LENS} backup searches and reads this pass. Write your answer now with what you have found.`
  }
  return null
}
