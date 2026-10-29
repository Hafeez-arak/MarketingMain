// ─── Requests and tagging, from the chat ───────────────────────────────────
// 2026-10-18, PR 2 of docs/CEO-ASSISTANT-PLAN.md. Definitions only (pure
// data), executors in api/agent/_requests.js.
//
// A request is what "this isn't good, change it" becomes when the assistant
// cannot make the change itself, or when the person tags a colleague. It has
// an owner and a status, so "what happened to my request?" has an answer.
//
// Offered on the chat surface to every member. Who may move a request is
// checked in the executor: an admin, the person who asked, or the person it
// is assigned to, the same rule as the requests_update RLS policy.
//
// Notifications are not sent from here. A trigger on the requests table
// writes them, so the chat and the Requests page notify identically.

// 'free' as a literal for the same reason as companyTools.js: tools.js
// imports this module.
const FREE = 'free'

export const REQUEST_KINDS = ['improvement', 'bug', 'content', 'question', 'task']
export const REQUEST_STATUSES = ['new', 'in_progress', 'done', 'declined']

export const REQUEST_TOOLS = [
  {
    name: 'file_request',
    cost: FREE,
    description:
      'Put a request on the Requests board when the person asks for something you cannot do ' +
      'yourself: a change to how the app works, a new report or page, a bug, or anything they ' +
      'say should be fixed or improved that is not an edit you can make. Also when they say ' +
      '"make this a request" or "note this for the team". Do NOT use it for things you can just ' +
      'answer or edit. Write the title as the change wanted, and keep their exact words in ' +
      'details. Then tell them it is on the board and who will see it.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The change wanted, in under 80 characters, e.g. "Add a monthly sales report".' },
        details: { type: 'string', description: 'What they said, in their words, plus anything from this conversation the builder needs.' },
        kind: { type: 'string', enum: REQUEST_KINDS, description: 'improvement (change or new feature), bug (something broken), content (a post, caption, design), question, or task.' },
        page: { type: 'string', description: 'The page they were on, from the page context, e.g. "/analytics".' },
      },
      required: ['title', 'details'],
    },
  },
  {
    name: 'tag_person',
    cost: FREE,
    description:
      'Give a piece of work to a named colleague when the person tags them ("@Shadia redo this", ' +
      '"ask Junaid to fix the report"). Only people on the tag list can be tagged; the result ' +
      'names who is allowed if the name does not match. Write a brief the colleague can act on ' +
      'without reading this conversation: what is wanted, why, which item, by when if they said.',
    input_schema: {
      type: 'object',
      properties: {
        person: { type: 'string', description: 'The colleague\'s name as the person said it, e.g. "Shadia".' },
        title: { type: 'string', description: 'The work, in under 80 characters.' },
        brief: { type: 'string', description: 'Clear instructions for the colleague, written by you.' },
        details: { type: 'string', description: 'What the person said, in their words.' },
        kind: { type: 'string', enum: REQUEST_KINDS, description: 'Usually content or task.' },
        page: { type: 'string', description: 'The page they were on, from the page context.' },
      },
      required: ['person', 'title', 'brief'],
    },
  },
  {
    name: 'get_requests',
    cost: FREE,
    description:
      'Requests on the board with their status, who has them, the closing note and history. Use ' +
      'for "what happened to my request about X?", "what is still open?", "what has Shadia ' +
      'done?". Give the real status and the note; never guess progress.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'One request by id, e.g. the one the person opened you from. Ignores scope.' },
        scope: { type: 'string', enum: ['mine', 'assigned_to_me', 'open', 'all'], description: 'mine = asked by the person in this chat (default); assigned_to_me; open = not done or declined; all.' },
        search: { type: 'string', description: 'Words to look for in the title or details.' },
        limit: { type: 'integer', description: 'Max rows. Default 15, max 50.' },
      },
      required: [],
    },
  },
  {
    name: 'update_request',
    cost: FREE,
    description:
      'Move a request when the person asks: mark it in progress, done or declined, add a note, ' +
      'attach a link (such as a pull request), or reassign it to someone on the tag list. Only ' +
      'an administrator, the person who asked, or the person it is assigned to may change it. ' +
      'The asker is notified automatically.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The request id, from get_requests.' },
        status: { type: 'string', enum: REQUEST_STATUSES },
        note: { type: 'string', description: 'What was done or why not. Shown to the asker.' },
        link: { type: 'string', description: 'A link to the result, e.g. a pull request.' },
        assign_to: { type: 'string', description: 'A colleague\'s name from the tag list.' },
        comment: { type: 'string', description: 'A comment on the request without changing its status.' },
      },
      required: ['id'],
    },
  },
]

const NAMES = new Set(REQUEST_TOOLS.map(t => t.name))
export const isRequestTool = name => NAMES.has(name)

/**
 * Match a spoken name against the tag list: exact name, then first name, then
 * a unique prefix. Returns the person, or null with the list so the model can
 * tell the person who is allowed.
 */
export function matchPerson(spoken, people = []) {
  const want = String(spoken || '').replace(/^@/, '').trim().toLowerCase()
  if (!want) return null
  const first = n => String(n || '').trim().toLowerCase().split(/\s+/)[0]
  const exact = people.filter(p => String(p.name || '').trim().toLowerCase() === want)
  if (exact.length === 1) return exact[0]
  const byFirst = people.filter(p => first(p.name) === first(want))
  if (byFirst.length === 1) return byFirst[0]
  const byPrefix = people.filter(p => String(p.name || '').toLowerCase().startsWith(want))
  return byPrefix.length === 1 ? byPrefix[0] : null
}

/** The prompt lines for requests. Stable text, cached prefix. */
export const REQUESTS_PROMPT = [
  'Requests and tagging:',
  '- When the person asks for something you cannot do yourself (a change to the app,',
  '  a new report, a bug), or says something is not good and the fix is not an edit',
  '  you can make, offer to put it on the Requests board, or file it straight away if',
  '  they asked for it to be done. Then say who will see it.',
  '- "@Name" in a message means they are tagging a colleague: use tag_person and write',
  '  a brief the colleague can act on alone. Only people on the tag list can be tagged;',
  '  never offer to tag anyone else. For anyone else, offer a request on the board.',
  '- When they ask what happened to something they asked for, check get_requests and',
  '  give the real status and note.',
].join('\n')
