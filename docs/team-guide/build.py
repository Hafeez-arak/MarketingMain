#!/usr/bin/env python3
"""Build the team guide PDFs from the markdown files next to this script.

    python3 docs/team-guide/build.py

Writes pdf/Marketing-App-Team-Guide.pdf (every part, with a cover and contents)
and one PDF per part. Needs Python's `markdown` package and Google Chrome.
"""
import html
import pathlib
import re
import subprocess
import tempfile

import markdown

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "pdf"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
AS_OF = "15 October 2026"

CSS = """
@page { size: A4; margin: 18mm 17mm 18mm 17mm; }
* { box-sizing: border-box; }
body { font-family: Inter, -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1b1e23;
       font-size: 10.5pt; line-height: 1.5; margin: 0; }
.eyebrow { font-size: 8.5pt; letter-spacing: .08em; text-transform: uppercase; color: #b07a1f;
           font-weight: 600; margin: 0 0 4pt; }
h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 4pt; letter-spacing: -.01em; }
.asof { color: #5d646e; font-size: 9pt; margin: 0 0 14pt; padding-bottom: 10pt;
        border-bottom: 2px solid #b07a1f; }
h2 { font-size: 13.5pt; margin: 18pt 0 6pt; padding-top: 2pt; break-after: avoid; }
p { margin: 0 0 7pt; }
h1 + .asof + p, .lead { font-size: 11.5pt; color: #2b3038; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
li { margin: 0 0 3pt; }
li > ul, li > ol { margin-top: 3pt; }
strong { font-weight: 600; }
em { color: #5d646e; font-style: normal; font-size: 9.5pt; }
code { font-family: "SF Mono", Menlo, monospace; font-size: 9pt; background: #f2f3f5;
       padding: 1pt 4pt; border-radius: 3pt; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 10pt; font-size: 9.5pt;
        break-inside: auto; }
tr { break-inside: avoid; }
th { text-align: left; background: #f4efe4; font-weight: 600; }
th, td { border: 1px solid #dcdfe4; padding: 5pt 7pt; vertical-align: top; }
img { width: 100%; margin: 4pt 0 6pt; }
.part { break-before: page; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
.cover h1 { font-size: 34pt; }
.cover .sub { font-size: 13pt; color: #2b3038; max-width: 130mm; margin: 6pt 0 16pt; }
.toc { list-style: none; padding: 0; margin: 10pt 0 0; font-size: 11pt; }
.toc li { padding: 6pt 0; border-bottom: 1px solid #e6e8eb; margin: 0; }
.toc .n { display: inline-block; width: 22pt; color: #b07a1f; font-weight: 600; }
.toc .d { color: #5d646e; font-size: 9.5pt; }
"""

PARTS = [
    ("00-start-here.md", "The monthly cycle, and where every page is"),
    ("01-brand-brain.md", "What the AI knows about the company"),
    ("02-research.md", "The weekly market report and What we learned"),
    ("03-content-planning.md", "A month of posts: ideas, pictures, captions, save"),
    ("04-creative-studio-and-media.md", "Making pictures and videos; the Media Library"),
    ("05-publishing-and-social.md", "Post Queue, calendar, social pages, composer, auto-replies"),
    ("06-analytics.md", "Social and website numbers, and the printable report"),
    ("07-email.md", "Newsletters and outreach"),
    ("08-dashboard-assistant-settings.md", "Getting in, Dashboard, Assistant, companies and access"),
]


def render(md_text):
    body = markdown.markdown(md_text, extensions=["tables", "sane_lists"])
    # The first heading becomes the page title block.
    return re.sub(
        r"<h1>(.*?)</h1>",
        lambda m: f'<p class="eyebrow">Marketing App Team Guide</p><h1>{m.group(1)}</h1>'
        f'<p class="asof">As of {AS_OF}</p>',
        body,
        count=1,
    )


def page(title, inner):
    return (f"<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(title)}</title>"
            f"<style>{CSS}</style></head><body>{inner}</body></html>")


def to_pdf(html_text, pdf_path):
    # Written next to cycle.svg so the diagram resolves.
    with tempfile.NamedTemporaryFile("w", suffix=".html", dir=HERE, delete=False, encoding="utf-8") as f:
        f.write(html_text)
        tmp = pathlib.Path(f.name)
    try:
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        f"--print-to-pdf={pdf_path}", tmp.as_uri()],
                       check=True, capture_output=True)
    finally:
        tmp.unlink()


def main():
    OUT.mkdir(exist_ok=True)
    sections = []
    for i, (name, _) in enumerate(PARTS):
        text = (HERE / name).read_text(encoding="utf-8")
        title = text.splitlines()[0].lstrip("# ").strip()
        body = render(text)
        sections.append((title, body))
        to_pdf(page(title, body), OUT / f"{i:02d} {title}.pdf")

    toc = "".join(
        f'<li><span class="n">{i}</span>{html.escape(t)} <span class="d">· {html.escape(PARTS[i][1])}</span></li>'
        for i, (t, _) in enumerate(sections))
    cover = (f'<section class="cover"><p class="eyebrow">Arak marketing app</p>'
             f'<h1>Marketing App Team Guide</h1>'
             f'<p class="sub">How the app works, page by page: the monthly cycle first, then one part per area. '
             f'Leads, Targets, Agent Brief and the sales screens are not covered.</p>'
             f'<p class="asof">As of {AS_OF}</p><ol class="toc">{toc}</ol></section>')
    full = cover + "".join(f'<section class="part">{b}</section>' for _, b in sections)
    to_pdf(page("Marketing App Team Guide", full), OUT / "Marketing-App-Team-Guide.pdf")
    for p in sorted(OUT.glob("*.pdf")):
        print(p.relative_to(HERE))


if __name__ == "__main__":
    main()
