// ─── Things worth saying before Generate is pressed ────────────────────────
// Three briefs that read fine to a person and go wrong in a predictable way,
// each one a paid round that comes back not what was meant. None of them
// blocks anything — they are notes under the box, and Generate stays live.
//
//  · A link. Nothing in the pipeline opens a URL; the model just reads the
//    characters. The picture has to be attached to be seen.
//  · Several posts in one brief. Each Generate makes one design per model,
//    so "5 posts for Ramadan" comes back as one design trying to be five.
//  · Arabic text without the words. The model then invents Arabic, and
//    invented Arabic is the one thing the whole studio is built to avoid.

const URL_IN_TEXT = /\bhttps?:\/\/\S+|\bwww\.[^\s.]+\.\S+/i

const COUNT = '(?:[2-9]|1\\d|two|three|four|five|six|seven|eight|nine|ten|several|multiple|a few|a couple of|a series of|a set of)'
const THINGS = '(?:posts?|designs?|images?|pictures?|visuals?|graphics?|creatives?|variations?|versions?|slides?|stories)'
const SEVERAL_POSTS = new RegExp(`\\b${COUNT}\\s+(?:\\w+\\s+){0,2}?${THINGS}\\b`, 'i')
// "5 منشورات", "ثلاث تصاميم" — the Arabic plural forms, after a digit.
const SEVERAL_POSTS_AR = /[2-9٢-٩]\s*(?:منشورات|تصاميم|صور|بوستات)/

const ASKS_ARABIC_TEXT = [
  /\barabic\b[^.\n]{0,40}\b(text|title|headline|caption|words?|slogan|tagline|writing|lettering|typography|calligraphy|greeting|message|quote|phrase)\b/i,
  /\b(text|title|headline|caption|words?|slogan|tagline|writing|lettering|typography|calligraphy|greeting|message|quote|phrase)\b[^.\n]{0,25}\b(in )?arabic\b/i,
  /نص عربي|بالعربي|كتابة عربية|خط عربي/,
]
// Arabic letters between any pair of quote marks — the wording, given.
const QUOTED_ARABIC = /["“”«»'‘’][^"“”«»'‘’\n]*[؀-ۿ][^"“”«»'‘’\n]*["“”«»'‘’]/

export const WARNINGS = {
  link:     'Links aren\'t opened — attach the picture as a reference instead.',
  multiple: 'Each Generate makes one design per model — write one prompt per post.',
  arabic:   'Write the exact Arabic wording in quotes, or add text afterwards in the editor.',
}

// → [{ id, text }], in a stable order. `intent` is the composer's tab: the
// one-design-per-model note only means something where there are designs.
export function composerWarnings(prompt, { intent = 'image' } = {}) {
  const text = String(prompt || '')
  if (!text.trim()) return []
  const out = []
  if (URL_IN_TEXT.test(text)) out.push({ id: 'link', text: WARNINGS.link })
  if (intent === 'image' && (SEVERAL_POSTS.test(text) || SEVERAL_POSTS_AR.test(text))) {
    out.push({ id: 'multiple', text: WARNINGS.multiple })
  }
  if (ASKS_ARABIC_TEXT.some(r => r.test(text)) && !QUOTED_ARABIC.test(text)) {
    out.push({ id: 'arabic', text: WARNINGS.arabic })
  }
  return out
}
