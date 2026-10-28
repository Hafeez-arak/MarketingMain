import { SECTIONS, sectionsFor, sectionLevel, atLeast } from '../modules'

// ─── The left bar: which sections a person keeps pinned (v2 shell) ─────────
// 2026-10-28, docs/SHELL.md. The owner: not everyone has every module; the
// left bar keeps the ones that person uses most, and the grid button at its
// top opens Home, where every module they may open is a tile with a pin.
//
// Stored per person per company in public.shell_pins (one row, a list of
// section keys; migration 20261127_shell_1_pins). No row = never chosen.
// Pure: no React, no IO, so the rules are tested (pins.test.js).

/**
 * The pins of someone who never chose: the sections they work in or
 * manage (their own team's tools); all their sections if that leaves none.
 * The access admin manages everything, so gets everything.
 */
export function defaultPins(who = {}) {
  const mine = sectionsFor(who)
  const working = mine.filter(s => atLeast(sectionLevel(s.key, who), 'work'))
  return (working.length ? working : mine).map(s => s.key)
}

/**
 * The sections the rail draws: the person's sections (sectionsFor) that are
 * pinned, in the registry's order. `stored` is the saved list, or null when
 * they never chose. A pinned section they can no longer open is not drawn;
 * someone with one section always has it.
 */
export function railSections(who = {}, stored = null) {
  const mine = sectionsFor(who)
  if (mine.length === 1) return mine
  const pins = new Set(stored ?? defaultPins(who))
  return mine.filter(s => pins.has(s.key))
}

/** Is this section on the rail for this person? */
export const isPinned = (key, who = {}, stored = null) => railSections(who, stored).some(s => s.key === key)

/** Can the pin be changed? Not by someone whose only section it is. */
export const canPin = (who = {}) => sectionsFor(who).length > 1

/**
 * The list to save after pinning or unpinning `key`. Starts from the saved
 * list (keys of sections not open to them now are kept, so a grant that
 * comes back brings its pin back) or, the first time, from the defaults.
 * Only known section keys, each once, in the registry's order.
 */
export function togglePin(key, who = {}, stored = null) {
  const pins = new Set(stored ?? defaultPins(who))
  if (pins.has(key)) pins.delete(key)
  else pins.add(key)
  return SECTIONS.map(s => s.key).filter(k => pins.has(k))
}
