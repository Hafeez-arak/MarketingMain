// ─── Pages that are built but hidden ───────────────────────────────────────
// The owner hides a page without removing it (2026-10-29: "dont remove it
// but hide it"). A hidden page has no menu link, and its address sends
// everyone, admins included, to the home page. Its code, data and the
// server actions behind it stay as they are; set it to true to bring it back.

/** Admin → Agent Brief (/agent-brief): the research agent's searches and ICPs. Hidden since 2026-10-29. */
export const SHOW_AGENT_BRIEF = false
