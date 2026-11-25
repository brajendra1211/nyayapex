"""Registry format checker for PDF pleadings - pure Python, zero tokens.

RULES below reflect common Supreme Court e-filing practice (A4, Times New Roman 14,
1.5 spacing, page numbering, indexed annexures). The Registry issues circulars that
change these from time to time - VERIFY RULES AGAINST THE CURRENT CIRCULAR before pilot.
"""

import re
from collections import Counter
from pathlib import Path

import pymupdf as fitz

RULES = {
    "page_size_pt": (595, 842),  # A4
    "page_size_tolerance": 6,
    "body_font_size": 14,
    "body_font_tolerance": 0.6,
    "quote_font_size_min": 12,
    "font_family_hint": ("times", "tnr"),
    "margin_lr_min_pt": 113,  # ~4 cm
    "margin_tb_min_pt": 56,  # ~2 cm
    "required_sections": {
        "index": r"\bINDEX\b",
        "synopsis / list of dates": r"\bSYNOPSIS\b|\bLIST\s+OF\s+DATES\b",
        "prayer": r"\bPRAYER\b",
        "affidavit": r"\bAFFIDAVIT\b",
    },
    "annexure_marker": r"\bANNEXURE\s*[-–]?\s*[PR]\s*[-–]?\s*\d+",
}

SEVERITY_ORDER = {"critical": 3, "major": 2, "minor": 1}


def _defect(code: str, severity: str, issue: str, fix: str, pages: list[int] | None = None) -> dict:
    return {"code": code, "severity": severity, "issue": issue, "fix": fix, "pages": (pages or [])[:20]}


def check_pdf(path: Path) -> dict:
    defects: list[dict] = []
    sizes: Counter[float] = Counter()
    fonts: Counter[str] = Counter()
    bad_size_pages, margin_pages, no_number_pages, blank_pages = [], [], [], []
    full_text = []

    with fitz.open(path) as doc:
        total = doc.page_count
        for i, page in enumerate(doc, start=1):
            w, h = page.rect.width, page.rect.height
            tol = RULES["page_size_tolerance"]
            if abs(w - RULES["page_size_pt"][0]) > tol or abs(h - RULES["page_size_pt"][1]) > tol:
                bad_size_pages.append(i)

            text = page.get_text("text")
            full_text.append(text)
            if not text.strip():
                blank_pages.append(i)
                continue

            data = page.get_text("dict")
            x0s, x1s, y0s, y1s = [], [], [], []
            for block in data["blocks"]:
                for line in block.get("lines", []):
                    for span in line["spans"]:
                        if not span["text"].strip():
                            continue
                        n = len(span["text"])
                        sizes[round(span["size"] * 2) / 2] += n
                        fonts[span["font"].lower()] += n
                        x0, y0, x1, y1 = span["bbox"]
                        x0s.append(x0), x1s.append(x1), y0s.append(y0), y1s.append(y1)
            if x0s:
                left, right = min(x0s), w - max(x1s)
                top, bottom = min(y0s), h - max(y1s)
                if left < RULES["margin_lr_min_pt"] * 0.8 or right < RULES["margin_lr_min_pt"] * 0.5:
                    margin_pages.append(i)
                elif top < RULES["margin_tb_min_pt"] * 0.5 or bottom < RULES["margin_tb_min_pt"] * 0.3:
                    margin_pages.append(i)

            lines = [l.strip() for l in text.splitlines() if l.strip()]
            edge = lines[:2] + lines[-2:]
            if not any(re.fullmatch(r"[-–]?\s*\d{1,4}\s*[-–]?", l) for l in edge):
                no_number_pages.append(i)

    body_size = sizes.most_common(1)[0][0] if sizes else 0
    body_font = fonts.most_common(1)[0][0] if fonts else ""
    joined = "\n".join(full_text)

    if bad_size_pages:
        defects.append(_defect("PAGE_SIZE", "critical", f"{len(bad_size_pages)} page(s) are not A4.",
                               "Re-export these pages on A4 (210 × 297 mm).", bad_size_pages))
    if body_size and abs(body_size - RULES["body_font_size"]) > RULES["body_font_tolerance"]:
        defects.append(_defect("FONT_SIZE", "major", f"Body text is {body_size} pt; expected {RULES['body_font_size']} pt.",
                               f"Set body text to {RULES['body_font_size']} pt (quotations/footnotes may be {RULES['quote_font_size_min']} pt)."))
    if body_font and not any(h in body_font for h in RULES["font_family_hint"]):
        defects.append(_defect("FONT_FAMILY", "minor", f"Dominant font is '{body_font}'.",
                               "Use Times New Roman for the body of the pleading."))
    if margin_pages:
        defects.append(_defect("MARGINS", "major", f"Text runs into the margin on {len(margin_pages)} page(s).",
                               "Keep ~4 cm left/right and ~2 cm top/bottom margins; re-flow the affected pages.", margin_pages))
    if total and len(no_number_pages) > total * 0.2:
        defects.append(_defect("PAGINATION", "major", f"{len(no_number_pages)} page(s) have no visible page number.",
                               "Paginate the complete paper-book continuously, including annexures.", no_number_pages))
    if blank_pages:
        defects.append(_defect("BLANK_PAGES", "minor", f"{len(blank_pages)} blank or image-only page(s).",
                               "Remove blank pages, or OCR scanned pages so text is searchable.", blank_pages))
    for name, pattern in RULES["required_sections"].items():
        if not re.search(pattern, joined, re.I):
            defects.append(_defect(f"MISSING_{name.split()[0].upper()}", "critical", f"No '{name}' section found.",
                                   f"Add the {name} in the prescribed place in the paper-book."))
    annexures = sorted(
        {f"{m.group(1).upper()}-{m.group(2)}" for m in re.finditer(r"\bANNEXURE\s*[-–]?\s*([PR])\s*[-–]?\s*(\d+)", joined, re.I)},
        key=lambda a: (a[0], int(a[2:])),
    )
    if not annexures:
        defects.append(_defect("ANNEXURE_MARKING", "major", "No annexures marked as ANNEXURE P-1, P-2 …",
                               "Mark each annexure (P-1, P-2 … for petitioner) and list it in the index with page numbers."))

    worst = max((SEVERITY_ORDER[d["severity"]] for d in defects), default=0)
    status = "NOT READY" if worst == 3 else "AT RISK" if worst == 2 else "READY"
    return {
        "status": status,
        "pages": total,
        "body_font_size": body_size,
        "body_font": body_font,
        "annexures_found": annexures,
        "defects": sorted(defects, key=lambda d: -SEVERITY_ORDER[d["severity"]]),
        "note": "Rule-based check. Verify against the current SC Registry circular; this is not a substitute for scrutiny.",
    }
