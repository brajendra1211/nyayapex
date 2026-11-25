"""Build the Supreme Court paper-book (.docx) from a filing package, and an annexures PDF.

Layout follows the Registry checks in format_check.py: A4, Times New Roman 14, 1.5 spacing, ~4 cm side margins,
continuous page numbers. The index uses PAGEREF fields to bookmarks, so Word fills the real page numbers
when the document is opened (Word asks to "update fields" - answer Yes).
"""

import io
import re
import string
from datetime import date

import pymupdf
from docx import Document as Docx
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Mm, Pt

from . import filing_templates as T

FONT = "Times New Roman"


class _Safe(string.Formatter):
    """'{order_date}' -> value, or '________' when missing - a template never crashes on a blank field."""

    def get_value(self, key, args, kwargs):
        v = kwargs.get(key)
        return v if v not in (None, "") else "________"


def fill(template: str, values: dict) -> str:
    return _Safe().format(template, **values)


def fmt_date(iso: str | None) -> str:
    try:
        return date.fromisoformat(iso).strftime("%d.%m.%Y") if iso else ""
    except ValueError:
        return iso or ""


def values_for(pkg_inputs: dict, case, aor: dict) -> dict:
    i = pkg_inputs or {}
    opts = i.get("options") or {}
    pet = i.get("petitioners") or []
    dep = i.get("deponent") or {}
    return {
        "year": str(date.today().year), "order_date": fmt_date(i.get("order_date")),
        "high_court": i.get("high_court"), "case_below": i.get("case_below"), "held": i.get("held") or "________",
        "delay_days": opts.get("delay_days") or "___", "place": i.get("place") or "New Delhi",
        "deponent_name": dep.get("name"), "deponent_relation": dep.get("relation"), "deponent_age": dep.get("age"),
        "deponent_address": dep.get("address"), "deponent_capacity": dep.get("capacity") or "Petitioner",
        "client_names": ", ".join(p.get("name", "") for p in pet if p.get("name")) or None,
        "client_capacity": "Petitioner" + ("s" if len(pet) > 1 else ""),
        "aor_name": aor.get("name"), "aor_code": aor.get("aor_code"), "matter": case.title,
    }


# ---------------------------------------------------------------- low-level docx helpers

def _bookmark(paragraph, name: str, bid: int):
    start = OxmlElement("w:bookmarkStart")
    start.set(qn("w:id"), str(bid))
    start.set(qn("w:name"), name)
    end = OxmlElement("w:bookmarkEnd")
    end.set(qn("w:id"), str(bid))
    paragraph._p.insert(0, start)
    paragraph._p.append(end)


def _field(paragraph, instr: str, placeholder: str = "#"):
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), instr)
    r = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = placeholder
    r.append(t)
    fld.append(r)
    paragraph._p.append(fld)


class Builder:
    def __init__(self, draft: bool):
        self.doc = Docx()
        self._bid = 0
        sec = self.doc.sections[0]
        sec.page_width, sec.page_height = Mm(210), Mm(297)
        sec.left_margin = sec.right_margin = Cm(4)
        sec.top_margin = sec.bottom_margin = Cm(2)
        normal = self.doc.styles["Normal"]
        normal.font.name, normal.font.size = FONT, Pt(14)
        normal.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        normal.paragraph_format.line_spacing = 1.5
        normal.paragraph_format.space_after = Pt(6)
        foot = sec.footer.paragraphs[0]
        foot.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _field(foot, "PAGE", "1")
        if draft:
            h = sec.header.paragraphs[0]
            h.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = h.add_run("DRAFT - NOT YET APPROVED BY THE ADVOCATE-ON-RECORD - NOT FOR FILING")
            run.bold, run.font.size = True, Pt(10)
        # ask Word to refresh PAGE / PAGEREF fields on open
        upd = OxmlElement("w:updateFields")
        upd.set(qn("w:val"), "true")
        self.doc.settings.element.append(upd)
        self.first = True

    def new_part(self, bookmark: str | None = None):
        if not self.first:
            self.doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
        self.first = False
        self._pending_bookmark = bookmark

    def _mark(self, p):
        if getattr(self, "_pending_bookmark", None):
            self._bid += 1
            _bookmark(p, self._pending_bookmark, self._bid)
            self._pending_bookmark = None
        return p

    def center(self, text: str, bold: bool = True, size: int = 14, underline: bool = False, space_after: int = 6):
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(space_after)
        for i, line in enumerate(text.split("\n")):
            r = p.add_run(line)
            r.bold, r.underline, r.font.size = bold, underline, Pt(size)
            if i < len(text.split("\n")) - 1:
                r.add_break()
        return self._mark(p)

    def para(self, text: str, bold: bool = False, indent_cm: float = 0, number: str | None = None,
             align=WD_ALIGN_PARAGRAPH.JUSTIFY):
        p = self.doc.add_paragraph()
        p.alignment = align
        fmt = p.paragraph_format
        if number:
            fmt.left_indent, fmt.first_line_indent = Cm(indent_cm + 1.0), Cm(-1.0)
            p.add_run(f"{number}\t")
            fmt.tab_stops.add_tab_stop(Cm(indent_cm + 1.0))
        elif indent_cm:
            fmt.left_indent = Cm(indent_cm)
        lines = text.split("\n")
        for i, line in enumerate(lines):
            r = p.add_run(line)
            r.bold = bold
            if i < len(lines) - 1:
                r.add_break()
        return self._mark(p)

    def heading(self, text: str):
        return self.para(text, bold=True, align=WD_ALIGN_PARAGRAPH.LEFT)

    def right(self, text: str):
        return self.para(text, align=WD_ALIGN_PARAGRAPH.RIGHT)

    def table(self, rows: list[list], widths_cm: list[float], header: bool = True):
        t = self.doc.add_table(rows=0, cols=len(widths_cm))
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for ri, row in enumerate(rows):
            cells = t.add_row().cells
            for ci, val in enumerate(row):
                cells[ci].width = Cm(widths_cm[ci])
                p = cells[ci].paragraphs[0]
                p.paragraph_format.line_spacing = 1.15
                if callable(val):
                    val(p)
                else:
                    r = p.add_run(str(val))
                    r.font.size = Pt(12)
                    r.bold = header and ri == 0
        return t

    def save(self) -> bytes:
        buf = io.BytesIO()
        self.doc.save(buf)
        return buf.getvalue()


# ---------------------------------------------------------------- paper-book

def cause_title(b: Builder, proc: dict, v: dict, inputs: dict, sub: str | None = None):
    b.center("IN THE SUPREME COURT OF INDIA")
    b.center(proc["jurisdiction"], size=13)
    if sub:
        b.center(fill(sub, v), size=13)
        b.center("IN", bold=False, size=13)
    b.center(fill(proc["title"], v), size=13)
    b.center(proc["under"], bold=False, size=12)
    b.center(fill("(Arising out of the final judgment and order dated {order_date} passed by the High Court of "
                  "{high_court} in {case_below})", v), bold=False, size=12)
    b.para("IN THE MATTER OF:", bold=True)
    for side, label in (("petitioners", "PETITIONER"), ("respondents", "RESPONDENT")):
        people = inputs.get(side) or [{}]
        for i, x in enumerate(people, 1):
            num = f"{i}. " if len(people) > 1 else ""
            b.para(f"{num}{x.get('name') or '________'}{', ' + x['description'] if x.get('description') else ''}", indent_cm=0.5)
        b.right(f"... {label}{'S' if len(people) > 1 else ''}")
        if side == "petitioners":
            b.center("VERSUS", size=13)


def signature(b: Builder, v: dict, drawn_by: str | None):
    b.para("")
    b.para(fill("DRAWN BY: {drawn}", {"drawn": drawn_by}), align=WD_ALIGN_PARAGRAPH.LEFT)
    b.right(fill("FILED BY:\n{aor_name}\nAdvocate-on-Record for the {client_capacity}\nAOR Code: {aor_code}", v))
    b.para(fill("Place: {place}\nFiled on: ________", v), align=WD_ALIGN_PARAGRAPH.LEFT)


PARTS = [  # (bookmark, index label)
    ("bm_proforma", "Listing Proforma"), ("bm_synopsis", "Synopsis and List of Dates"),
    ("bm_impugned", "Copy of the impugned judgment and order dated {order_date}"),
    ("bm_petition", "Special Leave Petition with Affidavit"), ("bm_annexures", "Annexures"),
    ("bm_ia_cc", "Application for exemption from filing certified copy"), ("bm_ia_delay", "Application for condonation of delay"),
    ("bm_ia_stay", "Application for ex-parte ad-interim stay"), ("bm_ai", "Declaration regarding use of Artificial Intelligence"),
    ("bm_vakalat", "Vakalatnama and Memo of Appearance"),
]


def build_paper_book(pkg, case, aor: dict, approved: bool) -> bytes:
    inputs, content = pkg.inputs or {}, pkg.content or {}
    proc = T.PROCEEDINGS[pkg.proceeding]
    v = values_for(inputs, case, aor)
    opts = inputs.get("options") or {}
    annex = inputs.get("annexures") or []
    v["last_annexure"] = str(len(annex)) if annex else "___"
    include = {"bm_ia_cc": opts.get("ia_exemption_cc"), "bm_ia_delay": opts.get("ia_delay"), "bm_ia_stay": opts.get("ia_stay"),
               "bm_ai": bool(pkg.ai_sections)}
    parts = [(bm, fill(lbl, v)) for bm, lbl in PARTS if include.get(bm, True)]

    b = Builder(draft=not approved)

    # Index first (page numbers come from bookmarks)
    b.new_part()
    cause_title(b, proc, v, inputs)
    b.center("INDEX", underline=True)
    rows = [["S. No.", "Particulars", "Page No."]]
    for n, (bm, label) in enumerate(parts, 1):
        rows.append([str(n), label, (lambda bm_: (lambda p: _field(p, f"PAGEREF {bm_} \\h", "#")))(bm)])
        if bm == "bm_annexures":
            for a in annex:
                rows.append(["", f"   Annexure {a.get('label')}: {a.get('description')}", ""])
    b.table(rows, [1.6, 9.0, 2.4])

    # 1. Listing proforma [format to be verified]
    b.new_part("bm_proforma")
    b.center("LISTING PROFORMA")
    b.para("[VERIFY: use the Registry's current listing proforma; the fields below are the usual ones]", align=WD_ALIGN_PARAGRAPH.LEFT)
    b.table([["Field", "Particulars"],
             ["Nature of matter", proc["label"]],
             ["Petitioner(s)", v["client_names"] or "________"],
             ["Respondent(s)", ", ".join(r.get("name", "") for r in inputs.get("respondents") or []) or "________"],
             ["Court below", fill("High Court of {high_court}", v)],
             ["Case number below", fill("{case_below}", v)],
             ["Date of impugned order", v["order_date"] or "________"],
             ["Limitation", f"Delay of {v['delay_days']} days" if opts.get("ia_delay") else "Within limitation"],
             ["Interim relief sought", "Yes" if opts.get("ia_stay") else "No"],
             ["Advocate-on-Record", fill("{aor_name} (AOR Code {aor_code})", v)]], [5.5, 7.5])

    # 2. Synopsis & list of dates
    b.new_part("bm_synopsis")
    b.center("SYNOPSIS")
    for para_ in _paras(content.get("synopsis")):
        b.para(para_)
    b.center("LIST OF DATES AND EVENTS", underline=True)
    dates = [l for l in (content.get("list_of_dates") or []) if l.strip()]
    b.table([["Date", "Event"]] + [_split_date(l) for l in dates] if dates else [["Date", "Event"], ["", "________"]], [3.2, 9.8])

    # 3. Impugned judgment placeholder
    b.new_part("bm_impugned")
    b.center(fill("COPY OF THE IMPUGNED JUDGMENT AND ORDER DATED {order_date}", v))
    b.para("[Insert the copy of the impugned judgment here]", align=WD_ALIGN_PARAGRAPH.CENTER)

    # 4. Petition
    b.new_part("bm_petition")
    cause_title(b, proc, v, inputs)
    b.para(T.ADDRESS, align=WD_ALIGN_PARAGRAPH.LEFT)
    b.para(T.PETITION_OPENING, align=WD_ALIGN_PARAGRAPH.LEFT)
    n = 1
    b.para(fill(T.PARA_1, v), number=f"{n}.")
    n += 1
    b.para("QUESTIONS OF LAW", bold=True, number=f"{n}.")
    b.para("The following questions of law arise for consideration of this Hon'ble Court:", indent_cm=1.0)
    for i, q in enumerate(_items(content.get("questions_of_law")) or ["________"]):
        b.para(q, number=f"({chr(97 + i)})", indent_cm=1.0)
    n += 1
    first, *rest = fill(T.DECLARATION_NO_OTHER, {**v, "rule": proc["rule_no_other_petition"]}).split("\n", 1)
    b.para(first, bold=True, number=f"{n}.")
    b.para(rest[0] if rest else "", indent_cm=1.0)
    n += 1
    first, *rest = fill(T.DECLARATION_ANNEXURES, {**v, "rule": proc["rule_annexures"]}).split("\n", 1)
    b.para(first, bold=True, number=f"{n}.")
    b.para(rest[0] if rest else "", indent_cm=1.0)
    n += 1
    b.para("GROUNDS", bold=True, number=f"{n}.")
    b.para("Special leave to appeal is sought for on the following grounds, amongst others:", indent_cm=1.0)
    for i, g in enumerate(_items(content.get("grounds")) or ["________"]):
        b.para(g if g.lower().startswith("because") else f"Because {g[0].lower() + g[1:] if g else g}",
               number=f"{_alpha(i)}.", indent_cm=1.0)
    n += 1
    b.para("GROUNDS FOR INTERIM RELIEF", bold=True, number=f"{n}.")
    for g in _paras(content.get("interim_grounds")) or ["________"]:
        b.para(g, indent_cm=1.0)
    n += 1
    b.para("MAIN PRAYER", bold=True, number=f"{n}.")
    b.para("It is, therefore, most respectfully prayed that this Hon'ble Court may be pleased to:", indent_cm=1.0)
    for i, pr in enumerate(_items(content.get("main_prayer")) or [fill(x, v) for x in T.DEFAULT_MAIN_PRAYER]):
        b.para(fill(pr, v), number=f"({chr(97 + i)})", indent_cm=1.0)
    if opts.get("ia_stay"):
        n += 1
        b.para("PRAYER FOR INTERIM RELIEF", bold=True, number=f"{n}.")
        b.para("It is further prayed that this Hon'ble Court may be pleased to:", indent_cm=1.0)
        for i, pr in enumerate(_items(content.get("interim_prayer")) or [fill(x, v) for x in T.DEFAULT_INTERIM_PRAYER]):
            b.para(fill(pr, v), number=f"({chr(97 + i)})", indent_cm=1.0)
    b.center(T.CLOSING, size=13)
    signature(b, v, inputs.get("drawn_by"))

    b.new_part()
    b.center("CERTIFICATE")
    b.para(T.CERTIFICATE)
    b.right(fill("{aor_name}\nAdvocate-on-Record for the {client_capacity}", v))

    b.new_part()
    cause_title(b, proc, v, inputs)
    b.center("AFFIDAVIT")
    for i, a in enumerate(T.AFFIDAVIT):
        b.para(fill(a, v), number=None if i == 0 else f"{i}.")
    b.right("DEPONENT")
    b.para(fill(T.VERIFICATION, {**v, "n": str(len(T.AFFIDAVIT) - 1)}))
    b.right("DEPONENT")

    # 5. Annexures (separators; the documents themselves come from the annexures PDF)
    b.new_part("bm_annexures")
    b.center("ANNEXURES")
    for a in annex:
        b.para(f"ANNEXURE {a.get('label')}: True copy of {a.get('description')}", bold=True, align=WD_ALIGN_PARAGRAPH.LEFT)
    if not annex:
        b.para("[List the annexures in the filing wizard]", align=WD_ALIGN_PARAGRAPH.LEFT)

    # 6. Interlocutory applications
    def ia(bm, spec, body_paras, prayer):
        b.new_part(bm)
        cause_title(b, proc, v, inputs, sub="I.A. NO. ______ OF {year}")
        b.center(spec["title"])
        b.para(T.ADDRESS, align=WD_ALIGN_PARAGRAPH.LEFT)
        b.para(T.PETITION_OPENING.replace("petition", "application").replace("Petitioner", "Applicant/Petitioner"), align=WD_ALIGN_PARAGRAPH.LEFT)
        for k, text_ in enumerate(body_paras, 1):
            b.para(fill(text_, v), number=f"{k}.")
        b.para("PRAYER", bold=True)
        b.para("It is, therefore, most respectfully prayed that this Hon'ble Court may be pleased to:")
        for i, pr in enumerate(prayer):
            b.para(fill(pr, v), number=f"({chr(97 + i)})", indent_cm=1.0)
        b.center(T.CLOSING, size=13)
        signature(b, v, inputs.get("drawn_by"))

    if opts.get("ia_exemption_cc"):
        ia("bm_ia_cc", T.IA_EXEMPTION_CC, T.IA_EXEMPTION_CC["paras"], T.IA_EXEMPTION_CC["prayer"])
    if opts.get("ia_delay"):
        body = [T.IA_DELAY["lead"], *(_paras(content.get("delay_explanation")) or ["[Explain the cause of delay day by day]"]),
                T.IA_DELAY["close"]]
        ia("bm_ia_delay", T.IA_DELAY, body, T.IA_DELAY["prayer"])
    if opts.get("ia_stay"):
        body = [T.IA_STAY["lead"], *(_paras(content.get("interim_grounds")) or []), T.IA_STAY["close"]]
        ia("bm_ia_stay", T.IA_STAY, body, _items(content.get("interim_prayer")) or T.DEFAULT_INTERIM_PRAYER)

    # 7. AI disclosure (SC AI Regulations 2026, Reg. 43(3))
    if pkg.ai_sections:
        b.new_part("bm_ai")
        title, *body = fill(T.AI_DISCLOSURE, {**v, "ai_tool": f"Nyay Apex using {pkg.ai_model or 'Claude'}",
                                              "ai_parts": ", ".join(pkg.ai_sections)}).split("\n")
        b.center(title)
        for line in body:
            if line.strip():
                b.para(line)
        b.right(fill("{aor_name}\nAdvocate-on-Record", v))

    # 8. Vakalatnama + memo of appearance
    b.new_part("bm_vakalat")
    cause_title(b, proc, v, inputs)
    b.center("VAKALATNAMA")
    for i, line in enumerate(T.VAKALATNAMA):
        b.para(fill(line, v))
    b.para(fill("Signed by the {client_capacity}: ________________          Accepted: {aor_name}, Advocate-on-Record", v), align=WD_ALIGN_PARAGRAPH.LEFT)
    b.para("")
    b.center("MEMO OF APPEARANCE")
    b.para(fill(T.MEMO_OF_APPEARANCE, v), align=WD_ALIGN_PARAGRAPH.LEFT)
    b.right(fill("{aor_name}\nAdvocate-on-Record\nAOR Code: {aor_code}", v))
    return b.save()


def _paras(value) -> list[str]:
    if isinstance(value, list):
        return [x.strip() for x in value if str(x).strip()]
    return [x.strip() for x in re.split(r"\n\s*\n|\n", value or "") if x.strip()]


def _items(value) -> list[str]:
    return [re.sub(r"^\s*(\(?[a-z0-9]{1,3}[.)]|[-•])\s*", "", x).strip() for x in _paras(value)]


def _alpha(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def _split_date(line: str) -> list[str]:
    m = re.match(r"\s*([\d./-]{6,10}|[A-Za-z]+\s+\d{4}|undated)\s*[:\-–]\s*(.+)", line)
    return [m.group(1), m.group(2)] if m else ["", line]


# ---------------------------------------------------------------- annexures PDF

def build_annexures_pdf(items: list[tuple[str, str, bytes]]) -> bytes:
    """items: (label, description, pdf_bytes). Each annexure's first page is stamped 'ANNEXURE P-n'."""
    out = pymupdf.open()
    for label, desc, data in items:
        with pymupdf.open(stream=data, filetype="pdf") as src:
            start = out.page_count
            out.insert_pdf(src)
        first = out[start]
        r = first.rect
        box = pymupdf.Rect(r.width - 200, 18, r.width - 24, 52)
        first.draw_rect(box, color=(0, 0, 0), fill=(1, 1, 1), width=0.8)
        first.insert_textbox(box, f"ANNEXURE {label}", fontsize=13, fontname="tibo", align=1)
    for i, page in enumerate(out, 1):  # running page numbers for the annexure volume
        page.insert_text((page.rect.width / 2 - 10, page.rect.height - 16), str(i), fontsize=10, fontname="tiro")
    return out.tobytes()
