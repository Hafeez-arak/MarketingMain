// ─── What a version is called on screen ────────────────────────────────────
// The familiar name first, the actual model in brackets after it. This used to
// be "ChatGPT" and "Gemini" alone, on the reasoning that the model ids meant
// nothing to the person choosing — true, but it left the opposite problem: the
// two lanes are a comparison of two SPECIFIC models, and when one of them is
// swapped for a newer version the label says nothing changed. Leading with the
// team's own word keeps the screen readable; the bracket says what is actually
// being compared, and has to be updated whenever genGemini/genOpenAI in the
// Creative Generate workflow point somewhere new.
export const PROVIDER_LABEL = {
  openai: 'ChatGPT (GPT Image 2)',
  gemini: 'Gemini (Nano Banana 2)',
  seedance: 'Video',
  manual: 'Your edit',
}

const KIND_LABEL = { edit: 'Edit', overlay: 'Edited', video: 'Video' }

export function labelFor(version) {
  if (!version) return ''
  // A generated candidate is named by the model that made it — that IS the
  // comparison. Later steps are named by what they did rather than by model:
  // each lane is now edited by its OWN model, so repeating the provider on
  // every edit card would just restate the lane header on every row.
  if (version.kind === 'generate') return PROVIDER_LABEL[version.provider] || ''
  return KIND_LABEL[version.kind] || PROVIDER_LABEL[version.provider] || ''
}
