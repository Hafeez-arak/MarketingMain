// Prints what the Agent Brief page will show: every lens and its prompt.
// Read only, no model call. Run: node --env-file=<.env> scripts/preview-lenses.mjs <workspace id>
import { previewLenses } from '../api/agent/_investigate.js'

const out = await previewLenses(process.argv[2])
for (const l of out.lenses) {
  console.log(l.key, l.cadence, l.searches, l.runs ? 'runs' : `skipped: ${l.why_not}`, l.prompt ? `${l.prompt.length} chars` : (l.computed ? 'computed' : `NO PROMPT ${l.error}`))
}
console.log('marketing ICP chars', out.marketingIcp.icp_summary.length, 'sales ICP segments', out.salesIcp?.segments?.length)
