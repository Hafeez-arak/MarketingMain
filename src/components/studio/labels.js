// ─── What a version is called on screen ────────────────────────────────────
// Provider names are deliberately the marketing team's words, not ours: they
// asked for "ChatGPT" and "Gemini", and relabelling those to gpt-image-2 and
// nano-banana-2 would make the comparison meaningless to the person choosing.
export const PROVIDER_LABEL = { openai: 'ChatGPT', gemini: 'Gemini', seedance: 'Video', manual: 'Your edit' }

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
