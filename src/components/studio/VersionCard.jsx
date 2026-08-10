
// ─── The session's opening brief ───────────────────────────────────────────
// Shown once above both lanes, so the split reads as one brief taken two
// ways rather than the same sentence printed twice.
//
// The VersionCard that used to live here went with the 2026-08-10 lane
// rebuild: a lane is now one fixed frame plus a filmstrip (see
// BranchChat.jsx), so there is no longer a stack of per-version cards.

// What the person asked for, as their own turn in the conversation.
export function PromptBubble({ text, note, referenceUrl }) {
  if (!text && !note && !referenceUrl) return null
  return (
    <div className="space-y-1.5">
      {text && (
        <div className="flex justify-end">
          <div className="max-w-[85%] bg-stone-800 text-white px-3.5 py-2">
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{text}</p>
            {note && <p className="text-[11px] text-stone-300 mt-1.5 leading-snug">On the reference: {note}</p>}
          </div>
        </div>
      )}
      {referenceUrl && (
        <div className="flex justify-end">
          <img src={referenceUrl} alt="Reference" className="w-14 h-14 object-cover border border-border" />
        </div>
      )}
    </div>
  )
}
