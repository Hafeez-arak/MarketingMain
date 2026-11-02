// ─── Which model answers a chat question ───────────────────────────────────
// The owner's split (2026-11-02): Haiku for the easy half — numbers, lookups,
// "what did Instagram do", "assign this", "file it" — and Sonnet for anything
// that needs judgement: advice, strategy, decisions, analysing what someone
// attached, writing something that will be published, and every turn where
// the person pushed back ("do better", "this is weak").
//
// Decided in three steps, cheapest first:
//
//   1. Rules in code. Free and instant. They only ever send a question UP to
//      Sonnet, never down — a rule that wrongly says "hard" costs a cent, one
//      that wrongly says "easy" costs a bad answer.
//   2. Sticky Sonnet. If Sonnet answered this thread under five minutes ago,
//      its prompt cache is still warm, and reading Sonnet's warm cache costs
//      the same per token as Haiku's fresh input. Switching down would buy
//      nothing on the prefix and could lose the thread of a hard conversation.
//   3. A tiny Haiku call that sorts what is left. It runs while the thread and
//      brand context load, so the person waits no longer than before.
//
// Anything that fails along the way answers on Sonnet. Failing expensive-side
// is the point: the whole saving is on the easy questions, and a hard one
// answered badly is the outcome the owner asked to avoid.

export const TIERS = { easy: 'chat_easy', hard: 'chat' }

// Sonnet's prompt cache lives five minutes after its last use.
export const STICKY_MS = 5 * 60 * 1000

// Past this the prompt is a document, not a question — a pasted email or
// newsletter, which the owner wants analysed on Sonnet.
export const LONG_QUESTION_CHARS = 1_200

// Haiku bills a whole request at five times the rate once the prompt passes
// 100,000 tokens. Well before that line the question goes to Sonnet, which
// has no such step.
export const HAIKU_PROMPT_CEILING = 80_000

// Each list is checked against the question in lower case. Arabic has no case
// and no reliable word boundary in a JS regex, so it is matched as substrings.
const PUSHBACK_EN = /\b(not good|no good|not great|do better|be better|try again|that'?s wrong|you'?re wrong|wrong answer|incorrect|not right|not accurate|too weak|weak|bad answer|not helpful|doesn'?t make sense|not what i (asked|meant|wanted)|useless|disappoint|not convinc|too generic|too big)/
const PUSHBACK_AR = ['ضعيف', 'غير مناسب', 'خطأ', 'خاطئ', 'غلط', 'غير صحيح', 'ليس صحيح', 'مو صحيح', 'حاول مرة', 'أفضل من هذا', 'افضل من هذا', 'سيء', 'سيئ', 'مو زين', 'غير مقنع', 'لا يعني']

const JUDGEMENT_EN = /\b(should (we|i|they)|what (should|would you|do you (suggest|recommend|think))|recommend|suggest|advice|advise|strateg|plan for|decide|decision|how (can|could|do|should) we|how to (improve|grow|increase|fix)|improve|prioriti[sz]|focus on|worth it|is (this|it|that) (good|enough|worth|right)|make sure|why (is|are|did|do|does|has|have)|compare|versus|pros and cons|opportunit|risk|forecast|predict)/
const JUDGEMENT_AR = ['ماذا نفعل', 'ماذا يجب', 'ماذا تقترح', 'هل يجب', 'هل نقوم', 'هل ننصح', 'ما رأيك', 'رأيك', 'اقترح', 'تقترح', 'انصح', 'تنصح', 'نصيحة', 'استراتيج', 'خطة', 'خطه', 'كيف نحسن', 'كيف يمكن', 'كيف نزيد', 'لماذا', 'قرار', 'أولوي', 'اولوي', 'نركز', 'تحليل', 'حلل', 'قارن', 'مقارنة', 'فرص', 'مخاطر']

const WRITING_EN = /\b(caption|write|draft|rewrite|reword|copy for|post about|carousel|reel|newsletter|email to|reply to|translate|analy[sz]e|analysis|review|assess|evaluate|audit)/
const WRITING_AR = ['اكتب', 'أكتب', 'صياغة', 'صياغه', 'اعد كتابه', 'أعد كتابة', 'اعد كتابة', 'منشور', 'كابشن', 'ترجم', 'رد على', 'راجع', 'قيم', 'قيّم']

const hasAny = (text, list) => list.some(w => text.includes(w))

/**
 * The reason a question must go to Sonnet, from the words alone — or '' when
 * the rules have nothing to say and the next step decides.
 *
 * @param {object} args
 * @param {string} args.question
 * @param {Array}  [args.attachments]  validated attachments on this turn
 * @param {number} [args.promptTokens] rough size of the whole request
 */
export function ruleReason({ question = '', attachments = [], promptTokens = 0 } = {}) {
  const q = String(question || '').toLowerCase()
  if (attachments.length) return 'attachment'
  if (q.length > LONG_QUESTION_CHARS) return 'long_paste'
  if (promptTokens > HAIKU_PROMPT_CEILING) return 'large_prompt'
  if (PUSHBACK_EN.test(q) || hasAny(q, PUSHBACK_AR)) return 'pushback'
  if (JUDGEMENT_EN.test(q) || hasAny(q, JUDGEMENT_AR)) return 'judgement'
  if (WRITING_EN.test(q) || hasAny(q, WRITING_AR)) return 'writing'
  return ''
}

/**
 * Is Sonnet's cache for this thread still warm?
 *
 * @param {{model?:string, created_at?:string}|null} last  the thread's last chat answer, from the ledger
 * @param {number} now  epoch ms
 */
export function stickyToSonnet(last, now = Date.now()) {
  if (!last?.model || !String(last.model).includes('sonnet')) return false
  const at = Date.parse(last.created_at || '')
  return Number.isFinite(at) && now - at >= 0 && now - at < STICKY_MS
}

// ── The sorting call ──
// Short on purpose: the rules above already caught the obvious hard cases, so
// what reaches this call is mostly the grey middle.
export const ROUTE_PROMPT = [
  'You sort questions sent to a company assistant into EASY or HARD.',
  '',
  'EASY: looking up facts or numbers ("how did our last post do?", "how many leads this week?",',
  '"what is scheduled for Thursday?"), status checks, short factual follow-ups, greetings,',
  'and simple actions the person spells out ("assign this to Ammar", "file it", "add that to the',
  'agenda", "mark it done").',
  '',
  'HARD: anything that needs judgement — advice, strategy, what to do or decide, whether',
  'something is good enough, explaining why, comparing options, analysing a document or a',
  'situation, writing anything that will be published or sent, and any message where the person',
  'is unhappy with an earlier answer.',
  '',
  'If unsure, answer HARD. The question may be in Arabic or English.',
].join('\n')

export const ROUTE_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['tier'],
    properties: { tier: { type: 'string', enum: ['easy', 'hard'] } },
  },
}

/** What the sorting call reads: the last answer (trimmed) and the question. */
export function routeInput({ question = '', lastAnswer = '' } = {}) {
  const prev = String(lastAnswer || '').trim().slice(0, 600)
  return [
    prev ? `The assistant's previous answer began:\n"""${prev}"""\n` : '',
    `The new message:\n"""${String(question || '').slice(0, 2_000)}"""`,
  ].filter(Boolean).join('\n')
}

/** The tier out of the sorting call's text, or 'hard' for anything unreadable. */
export function parseTier(text) {
  try {
    return JSON.parse(String(text || ''))?.tier === 'easy' ? 'easy' : 'hard'
  } catch {
    return 'hard'
  }
}

/**
 * The whole decision. `classify` is the sorting call, injected so this stays
 * testable; it is only called when the rules and the sticky check say nothing.
 *
 * @returns {Promise<{tier:'easy'|'hard', job:string, reason:string}>}
 */
export async function chooseTier({
  question, attachments = [], promptTokens = 0, last = null, now = Date.now(), classify = null,
}) {
  const done = (tier, reason) => ({ tier, job: TIERS[tier], reason })
  const rule = ruleReason({ question, attachments, promptTokens })
  if (rule) return done('hard', rule)
  if (stickyToSonnet(last, now)) return done('hard', 'sticky')
  if (typeof classify !== 'function') return done('hard', 'no_classifier')
  try {
    const tier = await classify()
    return tier === 'easy' ? done('easy', 'classified') : done('hard', 'classified')
  } catch {
    return done('hard', 'classifier_failed')
  }
}
