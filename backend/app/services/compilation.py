"""PDF assembly - pure Python (PyMuPDF), zero tokens.

1. Compilation of judgments for the Bench: cover, index, every judgment (official PDF), relied-upon pages marked,
   chosen passages highlighted, bookmarks, continuous page numbers.
2. Final paper-book: the petition PDF (saved from the generated Word file) + impugned judgment + annexures spliced
   in at their places, a fresh index with the real page numbers, continuous numbering.
"""

import html
import re
import shutil
import subprocess
import tempfile
import textwrap
from pathlib import Path

import pymupdf
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Chunk, Document
from . import corpus, storage
from . import filing_templates as T

A4 = pymupdf.paper_rect("a4")
INDEX_ROWS_PER_PAGE = 16


# ---------------------------------------------------------------- sources

def document_pdf(db: Session, doc: Document) -> tuple[bytes, bool]:
    """(pdf bytes, is_original). Uploaded files and cached judgments are read from disk; library judgments are
    downloaded once from their official source; failing that a plain-text copy is rendered (flagged)."""
    if storage.exists(doc.sha256, ".pdf"):
        return storage.read(doc.sha256, ".pdf"), True
    url = (doc.meta or {}).get("source_url")
    if url:
        try:
            data = corpus.fetch_pdf(url)
            storage.write(data, doc.sha256, ".pdf")
            return data, True
        except Exception:
            pass
    return _text_pdf(db, doc), False


def _text_pdf(db: Session, doc: Document) -> bytes:
    out = pymupdf.open()
    lines = ["TEXT COPY - the official PDF could not be fetched. Replace with the certified/official copy before filing.", ""]
    for c in db.query(Chunk).filter(Chunk.document_id == doc.id).order_by(Chunk.idx):
        for para in c.text.split("\n"):
            lines += textwrap.wrap(para, 95) or [""]
    for start in range(0, max(len(lines), 1), 55):
        page = out.new_page(width=A4.width, height=A4.height)
        for i, line in enumerate(lines[start:start + 55]):
            page.insert_text((60, 70 + i * 13), line, fontsize=10, fontname="tiro")
    return out.tobytes()


def parse_pages(spec: str | None) -> list[int]:
    """'12-14, 20' -> [12, 13, 14, 20] (1-based page numbers of the judgment PDF)."""
    pages: set[int] = set()
    for part in re.split(r"[,\s]+", spec or ""):
        if m := re.fullmatch(r"(\d+)(?:[-–](\d+))?", part):
            a, b = int(m[1]), int(m[2] or m[1])
            pages.update(range(min(a, b), min(max(a, b), min(a, b) + 200) + 1))
    return sorted(pages)


# ---------------------------------------------------------------- shared drawing helpers

def _html_page(doc: pymupdf.Document, body: str, at: int | None = None) -> pymupdf.Page:
    page = doc.new_page(pno=-1 if at is None else at, width=A4.width, height=A4.height)
    css = ("* {font-family: serif;} body {font-size: 12pt;} h1 {font-size: 14pt; text-align: center; margin: 4pt 0;}"
           " p {margin: 3pt 0;} .c {text-align: center;} .r {text-align: right;}"
           " table {border-collapse: collapse; width: 100%; font-size: 11pt;} td, th {border: 1px solid #000; padding: 4pt;}"
           " th {background: #eee;}")
    page.insert_htmlbox(pymupdf.Rect(72, 60, A4.width - 72, A4.height - 60), body, css=css, scale_low=0.5)
    return page


def _number_pages(doc: pymupdf.Document, first: int, start_no: int = 1):
    for i in range(first, doc.page_count):
        p = doc[i]
        r = p.rect
        # Bottom-right corner: the judgment's own page number (bottom centre) stays visible for citation.
        label = str(i - first + start_no)
        width = pymupdf.get_text_length(label, fontname="tibo", fontsize=11)
        p.draw_rect(pymupdf.Rect(r.width - 30 - width, r.height - 31, r.width - 18, r.height - 14), color=None, fill=(1, 1, 1))
        p.insert_text((r.width - 24 - width, r.height - 18), label, fontsize=11, fontname="tibo")


def _stamp(page: pymupdf.Page, text: str, color=(0, 0, 0)):
    r = page.rect
    box = pymupdf.Rect(r.width - 210, 16, r.width - 22, 44)
    page.draw_rect(box, color=color, fill=(1, 1, 1), width=0.8)
    page.insert_textbox(box, text, fontsize=11, fontname="tibo", color=color, align=1)


def _watermark(doc: pymupdf.Document):
    for p in doc:
        r = p.rect
        p.insert_text((r.width * 0.18, r.height * 0.62), "DRAFT - NOT VERIFIED", fontsize=46, fontname="tibo",
                      color=(0.85, 0.2, 0.2), fill_opacity=0.18, stroke_opacity=0.18,
                      morph=(pymupdf.Point(r.width * 0.18, r.height * 0.62), pymupdf.Matrix(-35)))


def _cause_title_html(parties: dict, jurisdiction: str, proceeding_title: str) -> str:
    pet = "<br>".join(html.escape(p) for p in parties.get("petitioners") or ["________"])
    res = "<br>".join(html.escape(p) for p in parties.get("respondents") or ["________"])
    return (f"<p class='c'><b>IN THE SUPREME COURT OF INDIA</b></p><p class='c'>{html.escape(jurisdiction)}</p>"
            f"<p class='c'>{html.escape(proceeding_title)}</p><p><b>IN THE MATTER OF:</b></p>"
            f"<p>{pet}</p><p class='r'>... PETITIONER(S)</p><p class='c'>VERSUS</p><p>{res}</p><p class='r'>... RESPONDENT(S)</p>")


# ---------------------------------------------------------------- 1. compilation of judgments

def build_compilation(head: dict, items: list[dict], draft: bool = False) -> tuple[bytes, list[dict]]:
    """head: parties, jurisdiction, proceeding_title, side, volume, aor_name, aor_code.
    items: title, citation, pdf (bytes), original (bool), relied_pages [int], highlights [str].
    Returns (pdf, per-item report)."""
    out = pymupdf.open()
    n_index = max(1, -(-len(items) // INDEX_ROWS_PER_PAGE))
    # Compilation page numbering starts at the first judgment page.
    starts, cursor = [], 1
    for it in items:
        with pymupdf.open(stream=it["pdf"], filetype="pdf") as src:
            it["page_count"] = src.page_count
        starts.append(cursor)
        cursor += it["page_count"]

    side = head.get("side") or "Petitioner"
    _html_page(out, _cause_title_html(head["parties"], head["jurisdiction"], head["proceeding_title"]) +
               f"<p>&nbsp;</p><h1>COMPILATION OF JUDGMENTS<br>ON BEHALF OF THE {html.escape(side.upper())}</h1>"
               f"<p class='c'>{html.escape(head.get('volume') or 'VOLUME I')}</p><p>&nbsp;</p>"
               f"<p class='r'>FILED BY:<br><b>{html.escape(head.get('aor_name') or '________')}</b><br>"
               f"Advocate-on-Record for the {html.escape(side)}<br>AOR Code: {html.escape(head.get('aor_code') or '________')}</p>")

    for chunk_no in range(n_index):
        rows = []
        for i, it in enumerate(items[chunk_no * INDEX_ROWS_PER_PAGE:(chunk_no + 1) * INDEX_ROWS_PER_PAGE],
                               chunk_no * INDEX_ROWS_PER_PAGE):
            relied = [starts[i] + p - 1 for p in it["relied_pages"] if 1 <= p <= it["page_count"]]
            rows.append(f"<tr><td class='c'>{i + 1}.</td><td>{html.escape(it['title'])}"
                        f"{'<br><i>' + html.escape(it['citation']) + '</i>' if it.get('citation') else ''}"
                        f"{'' if it['original'] else '<br><b>[text copy - attach official copy]</b>'}</td>"
                        f"<td class='c'>{_ranges(relied) or '-'}</td>"
                        f"<td class='c'>{starts[i]}-{starts[i] + it['page_count'] - 1}</td></tr>")
        _html_page(out, (f"<h1>INDEX</h1>" if chunk_no == 0 else "<h1>INDEX (contd.)</h1>") +
                   "<table><tr><th>S.No.</th><th>Particulars</th><th>Relied at page(s)</th><th>Page No.</th></tr>"
                   + "".join(rows) + "</table>")

    report, toc = [], []
    for i, it in enumerate(items):
        first = out.page_count
        with pymupdf.open(stream=it["pdf"], filetype="pdf") as src:
            # Highlight the chosen passages on the relied-upon pages (whole judgment if none are given)
            scope = [src[p - 1] for p in it["relied_pages"] if 1 <= p <= src.page_count] or list(src)
            phrases = [h.strip() for h in it.get("highlights") or [] if len(h.strip()) >= 8]
            missing = []
            for phrase in phrases:
                hits = 0
                for page in scope:
                    if quads := page.search_for(phrase, quads=True):
                        page.add_highlight_annot(quads)
                        hits += 1
                if not hits:
                    missing.append(phrase[:60])
            out.insert_pdf(src, annots=True)
        _stamp(out[first], f"S.No. {i + 1}")
        for p in it["relied_pages"]:
            if 1 <= p <= it["page_count"]:
                pg = out[first + p - 1]
                r = pg.rect
                pg.draw_rect(pymupdf.Rect(14, 60, 20, r.height - 60), color=None, fill=(0.8, 0.1, 0.1), fill_opacity=0.8)
                pg.insert_text((24, 52), "RELIED UPON", fontsize=9, fontname="tibo", color=(0.8, 0.1, 0.1))
        toc.append([1, f"{i + 1}. {it['title'][:90]}", first + 1])
        report.append({"title": it["title"], "pages": it["page_count"], "original": it["original"],
                       "highlights": len(phrases), "highlights_not_found": missing})
    _number_pages(out, 1 + n_index)
    out.set_toc([[1, "Index", 2]] + toc)
    if draft:
        _watermark(out)
    return out.tobytes(garbage=3, deflate=True), report


def _ranges(nums: list[int]) -> str:
    out, nums = [], sorted(set(nums))
    for n in nums:
        if out and n == out[-1][1] + 1:
            out[-1][1] = n
        else:
            out.append([n, n])
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in out)


# ---------------------------------------------------------------- 2. final paper-book PDF

def docx_to_pdf(docx: bytes) -> bytes | None:
    """Convert with LibreOffice when it is installed (server); None otherwise (upload the PDF saved from Word)."""
    exe = docx_to_pdf_available()
    if not exe:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "paperbook.docx"
        src.write_bytes(docx)
        subprocess.run([exe, "--headless", "--convert-to", "pdf", "--outdir", tmp, str(src)], check=True, timeout=180,
                       capture_output=True)
        return (Path(tmp) / "paperbook.pdf").read_bytes()


# Headings that open each part of the generated paper-book, in order (index label, marker text).
def _part_markers(inputs: dict, has_ai: bool) -> list[tuple[str, str]]:
    o = inputs.get("options") or {}
    parts = [("Listing Proforma", "LISTING PROFORMA"), ("Synopsis and List of Dates", "SYNOPSIS"),
             ("Copy of the impugned judgment and order", "COPY OF THE IMPUGNED JUDGMENT"),
             ("Special Leave Petition with Affidavit", "MOST RESPECTFULLY SHOWETH"), ("Annexures", "ANNEXURES")]
    if o.get("ia_exemption_cc", True):
        parts.append(("Application for exemption from filing certified copy", T.IA_EXEMPTION_CC["title"]))
    if o.get("ia_delay"):
        parts.append(("Application for condonation of delay", T.IA_DELAY["title"]))
    if o.get("ia_stay"):
        parts.append(("Application for ex-parte ad-interim stay", T.IA_STAY["title"]))
    if has_ai:
        parts.append(("Declaration regarding use of Artificial Intelligence", "DECLARATION REGARDING USE OF ARTIFICIAL INTELLIGENCE"))
    parts.append(("Vakalatnama and Memo of Appearance", "VAKALATNAMA"))
    return parts


def _norm(s: str) -> str:
    # Case-sensitive on purpose: part headings are in capitals, while the old index lists the same names in title case.
    return re.sub(r"\s+", " ", s)


# Parts that do not open with a cause title (so never step back to a previous page for them)
NO_CAUSE_TITLE = {"LISTING PROFORMA", "SYNOPSIS", "COPY OF THE IMPUGNED JUDGMENT", "ANNEXURES"}


def _find_from(doc: pymupdf.Document, marker: str, start: int) -> int | None:
    m = _norm(marker)
    for i in range(start, doc.page_count):
        if m in _norm(doc[i].get_text()):
            # A part opens with its cause title; if that spilled onto the previous page, start there.
            if marker not in NO_CAUSE_TITLE and i > start and "IN THE SUPREME COURT OF INDIA" not in _norm(doc[i].get_text()) \
                    and "IN THE SUPREME COURT OF INDIA" in _norm(doc[i - 1].get_text()):
                return i - 1
            return i
    return None


def _strip_page_numbers(doc: pymupdf.Document):
    """Remove the Word footer page numbers - they are wrong once other documents are spliced in."""
    for page in doc:
        r = page.rect
        hit = False
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                text = "".join(s["text"] for s in line["spans"]).strip()
                bbox = pymupdf.Rect(line["bbox"])
                if bbox.y0 > r.height - 70 and re.fullmatch(r"(?:Page\s*)?\d{1,4}(?:\s*of\s*\d+)?", text, re.I):
                    page.add_redact_annot(bbox, fill=(1, 1, 1))
                    hit = True
        if hit:
            page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE)


def assemble_paper_book(petition_pdf: bytes, inputs: dict, has_ai: bool, impugned: bytes | None,
                        annexures: list[tuple[str, str, bytes]], head: dict, draft: bool) -> tuple[bytes, dict]:
    doc = pymupdf.open(stream=petition_pdf, filetype="pdf")
    _strip_page_numbers(doc)
    notes: list[str] = []

    # Impugned judgment replaces its placeholder page
    imp_at = _find_from(doc, "COPY OF THE IMPUGNED JUDGMENT", 0)
    if impugned and imp_at is not None:
        with pymupdf.open(stream=impugned, filetype="pdf") as src:
            n = src.page_count
            doc.insert_pdf(src, start_at=imp_at + 1)
        for rect in doc[imp_at].search_for("[Insert the copy of the impugned judgment here]"):
            doc[imp_at].add_redact_annot(rect, fill=(1, 1, 1))
        doc[imp_at].apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE)
        notes.append(f"Impugned judgment inserted ({n} pages).")
    elif not impugned:
        notes.append("No impugned judgment selected - the placeholder page is still in the PDF.")

    # Annexures go right after the annexure list
    if annexures:
        at = _find_from(doc, "ANNEXURES", (imp_at or 0))
        if at is None:
            notes.append("Annexure list page not found - annexures appended at the end of the petition.")
            at = doc.page_count - 1
        else:
            while at + 1 < doc.page_count and re.search(r"ANNEXURE\s+P-\d+:", doc[at + 1].get_text()):
                at += 1
        for label, _, data in annexures:
            with pymupdf.open(stream=data, filetype="pdf") as src:
                first = at + 1
                doc.insert_pdf(src, start_at=first)
                at += src.page_count
            _stamp(doc[first], f"ANNEXURE {label}")
        notes.append(f"{len(annexures)} annexure(s) inserted.")

    # Fresh index with real page numbers; old index pages (before the listing proforma) are replaced.
    markers = _part_markers(inputs, has_ai)
    first_part = _find_from(doc, markers[0][1], 0) or 1
    starts, cursor = [], first_part
    for label, marker in markers:
        p = _find_from(doc, marker, cursor)
        if p is None:
            notes.append(f"'{label}' not found - left out of the index.")
            continue
        starts.append((label, p))
        cursor = p
    for _ in range(first_part):
        doc.delete_page(0)
    # Printed page number of an old 0-based page once one new index page replaces the `first_part` old ones
    def num(p: int) -> int:
        return p - first_part + 2

    last = doc.page_count + 1
    rows = []
    for i, (label, p) in enumerate(starts):
        end = num(starts[i + 1][1]) - 1 if i + 1 < len(starts) else last
        rows.append(f"<tr><td class='c'>{i + 1}.</td><td>{html.escape(label)}</td><td class='c'>{num(p)}-{end}</td></tr>")
    _html_page(doc, _cause_title_html(head["parties"], head["jurisdiction"], head["proceeding_title"]) +
               "<h1>INDEX</h1><table><tr><th>S.No.</th><th>Particulars</th><th>Page No.</th></tr>" + "".join(rows) + "</table>",
               at=0)
    _number_pages(doc, 0)
    doc.set_toc([[1, "Index", 1]] + [[1, label, num(p)] for label, p in starts])
    if draft:
        _watermark(doc)
    return doc.tobytes(garbage=3, deflate=True), {"pages": doc.page_count, "notes": notes}


def docx_to_pdf_available() -> str | None:
    return settings.soffice_path or shutil.which("soffice") or shutil.which("libreoffice")


REPORT_CSS = ("* {font-family: serif;} body {font-size: 11pt;} h1 {font-size: 14pt; text-align: center;}"
              " h2 {font-size: 12pt; margin: 12pt 0 4pt;} p {margin: 4pt 0;} .c {text-align: center;} .r {text-align: right;}"
              " table {border-collapse: collapse; width: 100%; font-size: 10pt;} td, th {border: 1px solid #000; padding: 3pt;}"
              " th {background: #eee;} ul {margin: 2pt 0;}")


def html_to_pdf(body: str, css: str = REPORT_CSS) -> bytes:
    """Flow HTML over as many numbered A4 pages as it needs."""
    import io

    buf = io.BytesIO()
    story = pymupdf.Story(body, user_css=css)
    writer = pymupdf.DocumentWriter(buf)
    more = True
    while more:
        dev = writer.begin_page(A4)
        more, _ = story.place(pymupdf.Rect(60, 56, A4.width - 60, A4.height - 56))
        story.draw(dev)
        writer.end_page()
    writer.close()
    doc = pymupdf.open(stream=buf.getvalue(), filetype="pdf")
    _number_pages(doc, 0)
    return doc.tobytes(garbage=3, deflate=True)
