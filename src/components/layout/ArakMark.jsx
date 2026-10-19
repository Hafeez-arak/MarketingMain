// ─── Arak's mark ───────────────────────────────────────────────────────────
// The "A" with the pendant lamp from Arak's logo (brand-assets/arak-logo.png),
// cut out as white on transparent (public/brand/arak-mark.png), on a
// near-black rounded tile, the way Slack shows a workspace. Replaces the
// placeholder star (2026-10-19).

export function ArakMark({ size = 'w-9 h-9' }) {
  return (
    <span className={`${size} rounded-lg bg-stone-900 flex items-center justify-center flex-shrink-0`} title="Arak">
      <img src="/brand/arak-mark.png" alt="Arak" className="w-[62%] h-[62%] object-contain" draggable="false" />
    </span>
  )
}
