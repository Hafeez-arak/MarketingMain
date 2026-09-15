import { useEffect, useCallback } from 'react'

// ─── Turning a page into a PDF ─────────────────────────────────────────────
// Separate from ReportShell.jsx only because that file exports components and
// react-refresh requires a component file to export nothing else. The two
// hooks here are the whole of the "download" mechanism.
//
// ── WHY THE PRINT DIALOG AND NOT A PDF LIBRARY ──
//
// "Download PDF" calls window.print() and the person chooses "Save as PDF".
// That is a deliberate trade, and the reason is Arabic: these reports quote
// post captions, Arak's are frequently Arabic, and jsPDF cannot shape Arabic
// glyphs at all while html2canvas rasterises the page into a bitmap with no
// selectable text and a multi-megabyte file. The browser's own PDF writer
// does correct bidi and shaping, embeds the webfont, keeps the text
// selectable and searchable, and adds nothing to the bundle.
//
// The cost is one extra click in a dialog — and useReportFilename below spends
// most of that cost back by opening the dialog with the right name in it.

/**
 * Name the PDF before the dialog opens.
 *
 * Every browser derives the suggested filename from document.title, and this
 * app's title is the same string on every route — so without this, every
 * report a person saves is called "Arak Marketing.pdf" and silently offers to
 * overwrite the last one. Restored on the way out, so the tab does not keep
 * the report's name after navigating back.
 */
export function useReportFilename(name) {
  useEffect(() => {
    if (!name) return undefined
    const previous = document.title
    document.title = name
    return () => { document.title = previous }
  }, [name])
}

/** Opens the print dialog, where "Save as PDF" is the destination. */
export function usePrint() {
  return useCallback(() => {
    // A frame first. print() snapshots the document synchronously, and a
    // button pressed inside React can still be mid-commit — on a slow machine
    // that snapshot catches the pre-update DOM.
    requestAnimationFrame(() => window.print())
  }, [])
}
