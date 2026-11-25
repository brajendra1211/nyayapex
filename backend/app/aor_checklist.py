"""AOR verification checklist: every legal rule, period and fixed text the app relies on, in one Word file.

The values are read from the live code, so re-run after any change:
    python -m app.aor_checklist            -> ../docs/AOR_Verification_Checklist.docx

An Advocate-on-Record ticks each row (or writes the correction); corrections are then made in the module named
in the "Where" column. Nothing here is legal advice - it is the list of things the software assumes.
"""

import re
from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

from .services import filing_docx, format_check, limitation, lint, prompts
from .services import filing_templates as T

OUT = Path(__file__).resolve().parents[2] / "docs" / "AOR_Verification_Checklist.docx"
NAVY, AMBER = RGBColor(0x1F, 0x2A, 0x44), RGBColor(0x9A, 0x5B, 0x00)

# Questions we already know are open - shown first so the AOR starts with them.
OPEN_QUESTIONS = [
    ("Rule number for the 'no other petition' declaration in an SLP (Civil)",
     "Filing module and drafting template: Order XXI Rule 3(2). Earlier drafting templates said Order XXII. "
     "Our understanding: Order XXI = SLP (civil), Order XXII = SLP (criminal).", "filing_templates.py, prompts.py"),
    ("Rule number for the 'annexures are true copies' declaration", "Order XXI Rule 4", "filing_templates.py"),
    ("Statutory basis shown for the 90-day SLP limitation", limitation.PERIODS["slp_judgment"]["basis"]
     + " (the Order/Rule cited may be wrong - see question 1)", "limitation.py"),
    ("Listing Proforma", "A generic list of usual fields. Needs the Registry's current proforma.", "filing_docx.py"),
    ("AI-use declaration wording", "Placeholder until Annexure I of the SC AI Regulations 2026 is notified.", "filing_templates.py"),
    ("Vakalatnama", "Generic wording; chamber format, stamp / welfare-fund requirements and attestation to be confirmed.",
     "filing_templates.py"),
    ("Page margins", f"Left/right {format_check.RULES['margin_lr_min_pt'] / 28.35:.1f} cm, top/bottom "
     f"{format_check.RULES['margin_tb_min_pt'] / 28.35:.1f} cm (checker and generator). Confirm against the current e-filing circular.",
     "format_check.py, filing_docx.py"),
]


class Doc:
    def __init__(self):
        self.d = Document()
        s = self.d.sections[0]
        s.orientation, s.page_width, s.page_height = WD_ORIENT.LANDSCAPE, Cm(29.7), Cm(21)
        s.left_margin = s.right_margin = Cm(1.8)
        s.top_margin = s.bottom_margin = Cm(1.6)
        st = self.d.styles["Normal"]
        st.font.name, st.font.size = "Calibri", Pt(10.5)
        st.paragraph_format.space_after = Pt(4)
        for name, size in (("Heading 1", 15), ("Heading 2", 12)):
            h = self.d.styles[name]
            h.font.name, h.font.size, h.font.color.rgb, h.font.bold = "Calibri", Pt(size), NAVY, True
            h.paragraph_format.space_before, h.paragraph_format.space_after = Pt(14), Pt(6)
        self.n = 0
        footer = s.footer.paragraphs[0]
        footer.text = "Nyay Apex · AOR verification checklist · page "
        run = footer.add_run()
        for tag, text in (("begin", None), (None, "PAGE"), ("end", None)):
            el = OxmlElement("w:fldChar" if tag else "w:instrText")
            if tag:
                el.set(qn("w:fldCharType"), tag)
            else:
                el.text = text
            run._r.append(el)

    def h1(self, t):
        self.d.add_heading(t, level=1)

    def p(self, t, bold=False, italic=False, color=None, size=None):
        para = self.d.add_paragraph()
        r = para.add_run(t)
        r.bold, r.italic = bold, italic
        if color:
            r.font.color.rgb = color
        if size:
            r.font.size = Pt(size)
        return para

    def table(self, head, rows, widths, verify_cols=True):
        cols = ["#"] + head + (["OK?", "Correct value / remarks"] if verify_cols else [])
        widths = widths + ([1.4, 6.0] if verify_cols else [])
        t = self.d.add_table(rows=1, cols=len(cols))
        t.style, t.alignment = "Table Grid", WD_TABLE_ALIGNMENT.CENTER
        for i, h in enumerate(cols):
            c = t.rows[0].cells[i]
            c.text = ""
            r = c.paragraphs[0].add_run(h)
            r.bold, r.font.color.rgb, r.font.size = True, RGBColor(0xFF, 0xFF, 0xFF), Pt(10)
            shade = OxmlElement("w:shd")
            shade.set(qn("w:val"), "clear"), shade.set(qn("w:fill"), "1F2A44")
            c._tc.get_or_add_tcPr().append(shade)
        tr = t.rows[0]._tr.get_or_add_trPr()
        rep = OxmlElement("w:tblHeader")
        rep.set(qn("w:val"), "true")
        tr.append(rep)
        for row in rows:
            self.n += 1
            cells = t.add_row().cells
            vals = [str(self.n)] + [str(x) for x in row] + (["☐", ""] if verify_cols else [])
            for c, v in zip(cells, vals):
                c.text = ""
                para = c.paragraphs[0]
                for k, part in enumerate(re.split(r"(\[VERIFY[^\]]*\])", v)):
                    if part:
                        r = para.add_run(part)
                        r.font.size = Pt(9.5)
                        if k % 2:
                            r.bold, r.font.color.rgb = True, AMBER
        for row in t.rows:
            for c, w in zip(row.cells, [0.9] + widths):
                c.width = Cm(w)
        self.d.add_paragraph()


def _plain(s: str) -> str:
    return s.replace("\n", " / ")


def build() -> Path:
    doc = Doc()
    d = doc.d
    title = d.add_paragraph()
    r = title.add_run("Nyay Apex - AOR Verification Checklist")
    r.bold, r.font.size, r.font.color.rgb = True, Pt(22), NAVY
    doc.p(f"Generated {date.today():%d %B %Y} from the live code. Re-generate after any change: python -m app.aor_checklist",
          italic=True, size=9.5)
    doc.p("Why this exists: the software applies Supreme Court rules, limitation periods and fixed petition text that were "
          "written from common practice, not from a verified source. Before any real filing, an Advocate-on-Record must "
          "confirm every row below against the Supreme Court Rules, 2013, the Limitation Act, 1963 and the Registry's current "
          "circulars. Tick “OK?” when correct; otherwise write the correct value. The developer then changes the module named "
          "in the “Where” column. Items shown in amber already carry a [VERIFY] mark in the app.")
    doc.p("Number of items: see the last row number. Estimated time: 60-90 minutes.", italic=True)

    doc.h1("A. Open questions - please answer these first")
    doc.table(["Question", "What the app does now", "Where"], OPEN_QUESTIONS, [7.0, 9.5, 3.4])

    doc.h1("B. Registry format rules (Registry Compliance checker)")
    R = format_check.RULES
    doc.table(["Rule", "Current value", "Where"], [
        ("Page size", f"A4 ({R['page_size_pt'][0]} x {R['page_size_pt'][1]} pt, tolerance {R['page_size_tolerance']} pt)", "format_check.py"),
        ("Body font size", f"{R['body_font_size']} pt (tolerance {R['body_font_tolerance']} pt)", "format_check.py"),
        ("Minimum size for quotations / footnotes", f"{R['quote_font_size_min']} pt", "format_check.py"),
        ("Font family", "Times New Roman (detected by name: " + ", ".join(R["font_family_hint"]) + ")", "format_check.py"),
        ("Left / right margin (minimum)", f"{R['margin_lr_min_pt']} pt ≈ {R['margin_lr_min_pt'] / 28.35:.1f} cm", "format_check.py"),
        ("Top / bottom margin (minimum)", f"{R['margin_tb_min_pt']} pt ≈ {R['margin_tb_min_pt'] / 28.35:.1f} cm", "format_check.py"),
        ("Line spacing", "1.5 (used when generating; not measured by the checker)", "filing_docx.py"),
        ("Sections that must be present", ", ".join(R["required_sections"]), "format_check.py"),
        ("Annexure marking", "ANNEXURE P-1, P-2 … (petitioner) / R-1 … (respondent)", "format_check.py"),
        ("Page numbering", "Every page numbered; checker flags missing numbers", "format_check.py"),
    ], [6.0, 10.5, 3.4])

    doc.h1("C. Limitation periods (Limitation calculator)")
    rows = [(p["label"], f"{p['days']} days" if p["days"] else "No fixed period", p["basis"], "limitation.py")
            for p in limitation.PERIODS.values()]
    rows += [
        ("Day of the order", "Excluded from the count", "Limitation Act s. 12(1)", "limitation.py"),
        ("Time to obtain certified copy", "Excluded: from date applied to date ready, both days counted", "Limitation Act s. 12(2)", "limitation.py"),
        ("Last day a holiday", "Only warned - SC holiday calendar not built in; filing on next working day treated as valid",
         "Limitation Act s. 4", "limitation.py"),
    ]
    doc.table(["Proceeding", "Period", "Statutory basis shown", "Where"], rows, [5.0, 3.0, 8.5, 2.5])

    doc.h1("D. SLP (Civil) paper-book - order of parts and layout")
    doc.table(["Part (in order)", "Included when", "Where"],
              [(re.sub(r"\{\w+\}", "…", lbl), {"bm_ia_cc": "Exemption I.A. selected", "bm_ia_delay": "Delay I.A. selected",
                                                "bm_ia_stay": "Stay I.A. selected", "bm_ai": "Any section drafted with AI"}.get(bm, "Always"),
                "filing_docx.py") for bm, lbl in [("bm_index", "Index")] + filing_docx.PARTS] +
              [("Cause title", T.PROCEEDINGS["slp_civil"]["jurisdiction"] + " / " + T.PROCEEDINGS["slp_civil"]["title"] + " / "
                + T.PROCEEDINGS["slp_civil"]["under"], "Every part", "filing_templates.py"),
               ("Generated layout", "A4, Times New Roman 14, 1.5 spacing, margins 4 cm left/right and 2 cm top/bottom, page "
                "number in footer, DRAFT header until approved", "", "filing_docx.py"),
               ("Final PDF pagination", "One continuous sequence: the new index is page 1, then every page including the impugned "
                "judgment and annexures, numbered bottom-right. [VERIFY: whether the Registry wants index/proforma/synopsis "
                "numbered separately (A, B, C ...)]", "Final PDF", "compilation.py"),
               ("Compilation of judgments", "Cover with cause title, index (S.No., particulars, relied pages, page no.), "
                "official copy of each judgment, relied pages marked in the margin, quoted passages highlighted, page numbers "
                "bottom-right so the judgment's own numbers stay visible", "On request", "compilation.py")],
              [8.0, 8.0, 3.0])

    doc.h1("E. Fixed petition text (never written by AI)")
    doc.p("{placeholders} are filled from the matter. Please read each text in full.", italic=True)
    texts = [
        ("Address to the Court", T.ADDRESS), ("Opening", T.PETITION_OPENING), ("Paragraph 1", T.PARA_1),
        ("Declaration: no other petition", T.DECLARATION_NO_OTHER.replace("{rule}", T.PROCEEDINGS["slp_civil"]["rule_no_other_petition"])),
        ("Declaration: annexures", T.DECLARATION_ANNEXURES.replace("{rule}", T.PROCEEDINGS["slp_civil"]["rule_annexures"])),
        *[(f"Default main prayer ({i})", x) for i, x in enumerate(T.DEFAULT_MAIN_PRAYER, 1)],
        *[(f"Default interim prayer ({i})", x) for i, x in enumerate(T.DEFAULT_INTERIM_PRAYER, 1)],
        ("Closing", T.CLOSING), ("Certificate", T.CERTIFICATE),
        *[(f"Affidavit para {i}", x) for i, x in enumerate(T.AFFIDAVIT)],
        ("Verification", T.VERIFICATION),
        ("I.A. exemption - title", T.IA_EXEMPTION_CC["title"]),
        *[(f"I.A. exemption para {i}", x) for i, x in enumerate(T.IA_EXEMPTION_CC["paras"], 1)],
        *[(f"I.A. exemption prayer ({i})", x) for i, x in enumerate(T.IA_EXEMPTION_CC["prayer"], 1)],
        ("I.A. delay - title", T.IA_DELAY["title"]), ("I.A. delay - first para", T.IA_DELAY["lead"]),
        ("I.A. delay - last para", T.IA_DELAY["close"]),
        *[(f"I.A. delay prayer ({i})", x) for i, x in enumerate(T.IA_DELAY["prayer"], 1)],
        ("I.A. stay - title", T.IA_STAY["title"]), ("I.A. stay - first para", T.IA_STAY["lead"]), ("I.A. stay - last para", T.IA_STAY["close"]),
        *[(f"Vakalatnama ({i})", x) for i, x in enumerate(T.VAKALATNAMA, 1)],
        ("Memo of appearance", T.MEMO_OF_APPEARANCE), ("AI-use declaration", T.AI_DISCLOSURE),
    ]
    doc.table(["Text", "Current wording"], [(k, _plain(v)) for k, v in texts], [4.5, 15.4])

    doc.h1("F. Advocate's verification checklist (shown before approval)")
    doc.table(["Item", "Wording"], T.CHECKLIST, [3.0, 16.9])

    doc.h1("G. AI drafting skeletons (Drafting Assistant)")
    doc.p("The AI fills these headings in order. Check the headings, their order and the rule numbers.", italic=True)
    doc.table(["Document", "Sections (in order)"],
              [(t["label"], " | ".join(t["sections"])) for t in prompts.TEMPLATES.values()], [4.5, 15.4])

    doc.h1("H. Draft risk flags (Drafting lint)")
    doc.table(["Flag", "Advice shown to the drafter"], [(name, advice) for _, name, advice in lint.RULES], [5.0, 14.9])

    doc.h1("Sign-off")
    doc.table(["Field", "Entry"], [("Verified by (AOR name)", ""), ("AOR code", ""), ("Date", ""),
                                   ("Rows needing change (numbers)", ""), ("Signature", "")], [6.0, 13.9], verify_cols=False)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    d.save(OUT)
    return OUT


if __name__ == "__main__":
    print(build())
