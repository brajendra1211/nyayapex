"""Bare-act library: statute text section by section, old<->new criminal-law mapping, and statute references found
in case papers. Pure Python, zero tokens - the law is shown verbatim, never written by AI.

Sources (official only):
- Acts as published in the Gazette of India / India Code PDFs -> parse_act_pdf()
- IPC <-> BNS correspondence: tables in the BPR&D (Ministry of Home Affairs) "Handbook on the Bharatiya Nyaya Sanhita,
  2023" -> parse_bprd_bns_tables()
- CrPC <-> BNSS, IEA <-> BSA: matched by text similarity once both texts are imported (flagged as auto, to verify).
"""

import re
from dataclasses import dataclass, field
from datetime import date
from difflib import SequenceMatcher

import pymupdf

NEW_CRIMINAL_LAWS_FROM = date(2024, 7, 1)  # BNS / BNSS / BSA in force; IPC / CrPC / IEA repealed (with savings)

# code -> (title, act no., kind, replaced_by / replaces)
CATALOGUE = {
    "COI": {"title": "The Constitution of India", "act": "", "unit": "Article", "unit_short": "Art."},
    "BNS": {"title": "The Bharatiya Nyaya Sanhita, 2023", "act": "Act 45 of 2023", "unit": "Section", "unit_short": "S.",
            "replaces": "IPC", "in_force_from": NEW_CRIMINAL_LAWS_FROM},
    "BNSS": {"title": "The Bharatiya Nagarik Suraksha Sanhita, 2023", "act": "Act 46 of 2023", "unit": "Section", "unit_short": "S.",
             "replaces": "CRPC", "in_force_from": NEW_CRIMINAL_LAWS_FROM},
    "BSA": {"title": "The Bharatiya Sakshya Adhiniyam, 2023", "act": "Act 47 of 2023", "unit": "Section", "unit_short": "S.",
            "replaces": "IEA", "in_force_from": NEW_CRIMINAL_LAWS_FROM},
    "IPC": {"title": "The Indian Penal Code, 1860", "act": "Act 45 of 1860", "unit": "Section", "unit_short": "S.",
            "replaced_by": "BNS", "repealed_from": NEW_CRIMINAL_LAWS_FROM},
    "CRPC": {"title": "The Code of Criminal Procedure, 1973", "act": "Act 2 of 1974", "unit": "Section", "unit_short": "S.",
             "replaced_by": "BNSS", "repealed_from": NEW_CRIMINAL_LAWS_FROM},
    "IEA": {"title": "The Indian Evidence Act, 1872", "act": "Act 1 of 1872", "unit": "Section", "unit_short": "S.",
            "replaced_by": "BSA", "repealed_from": NEW_CRIMINAL_LAWS_FROM},
}


def sort_key(number: str) -> int:
    """'103' -> 103000, '120B' -> 120002, '21A' -> 21001: keeps 120A/120B between 120 and 121."""
    m = re.match(r"(\d+)([A-Z]*)", number.upper())
    if not m:
        return 10**9
    letters = sum((ord(c) - 64) * 27 ** i for i, c in enumerate(reversed(m[2])))
    return int(m[1]) * 1000 + letters


def base_number(ref: str) -> str:
    """'318(4)' -> '318', '137(1)(a).' -> '137', '120-B' -> '120B'."""
    m = re.match(r"\s*(\d+)\s*-?\s*([A-Z]{0,3})", ref.upper())
    return f"{m[1]}{m[2]}" if m else ref.strip()


# ---------------------------------------------------------------- Act PDF -> sections

@dataclass
class Section:
    number: str
    title: str = ""
    lines: list[str] = field(default_factory=list)
    chapter: str = ""
    chapter_title: str = ""
    page: int = 0

    @property
    def text(self) -> str:
        out = re.sub(r"[ \t]+", " ", "\n".join(self.lines)).strip()
        return re.sub(r"(\w)-\n(\w)", r"\1\2", out)


SECTION_START = re.compile(r"^(\d{1,3}[A-Z]{0,3})\.\s*(?=[(A-Z“\"‘'])(.*)$")
INLINE_TITLE = re.compile(r"^(.{3,200}?)\.\s*[—–-]{1,2}\s*(.*)$")  # India Code style: "302. Punishment for murder.—Whoever ..."
CHAPTER = re.compile(r"^CHAPTER\s+([IVXLC]+[A-Z]?)\b\.?\s*(.*)$")
STOP = re.compile(r"^(THE\s+(FIRST\s+)?SCHEDULE|FIRST SCHEDULE|THE SCHEDULE|STATEMENT OF OBJECTS)\b")


def _lines(doc: pymupdf.Document):
    """(page, x, y, size, bold, text) for every text line, header/footer bands removed."""
    for pno, page in enumerate(doc):
        h = page.rect.height
        for b in page.get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                spans = [s for s in l["spans"] if s["text"].strip()]
                if not spans:
                    continue
                text = " ".join("".join(s["text"] for s in l["spans"]).split())
                x, y = l["bbox"][0], l["bbox"][1]
                if y < 72 or y > h - 40:  # running heads ("Sec. 1] THE GAZETTE OF INDIA ...") and page numbers
                    continue
                bold = "bold" in spans[0]["font"].lower() or bool(spans[0]["flags"] & 16)
                yield pno, x, y, spans[0]["size"], bold, text


def parse_act_pdf(data: bytes) -> list[Section]:
    """Split an Act (Gazette or India Code layout) into sections. Gazette PDFs carry the section title as a marginal
    note on the right; India Code PDFs carry it inline before '.—'."""
    doc = pymupdf.open(stream=data, filetype="pdf")
    rows = list(_lines(doc))
    started = False
    body_x = min((r[1] for r in rows if SECTION_START.match(r[5])), default=100)
    width = doc[0].rect.width
    margin_x = width * 0.78
    sections: list[Section] = []
    chapter, chapter_title, want_title = "", "", False
    notes: list[list] = []  # marginal notes: [page, first-line y, last-line y, text]
    last_num = 0

    for pno, x, y, size, bold, text in rows:
        if not started:
            if re.match(r"^(BE it enacted|WE, THE PEOPLE)", text, re.I) or (SECTION_START.match(text) and bold and text.startswith("1.")):
                started = True
            if not started:
                continue
        if STOP.match(text.upper()) and sections:
            break
        if size < 9.5 and (x >= margin_x or x < body_x - 50):  # marginal note: right margin on odd pages, left on even
            if re.match(r"^\d+ of \d{4}\.?$", text):  # footnote-style reference to an earlier Act
                continue
            if notes and notes[-1][0] == pno and 0 <= y - notes[-1][2] < 13:
                notes[-1][2], notes[-1][3] = y, notes[-1][3] + " " + text
            else:
                notes.append([pno, y, y, text])
            continue
        if m := CHAPTER.match(text):
            chapter, chapter_title, want_title = m[1], m[2].strip(), not m[2].strip()
            continue
        if want_title and text.isupper():
            chapter_title, want_title = text.title(), False
            continue
        want_title = False
        m = SECTION_START.match(text)
        if m and (bold or x < body_x + 30):
            n = int(re.match(r"\d+", m[1])[0])
            if 0 < n - last_num <= 3 or (n == last_num and re.search(r"[A-Z]$", m[1])):
                last_num = n
                sec = Section(number=m[1], chapter=chapter, chapter_title=chapter_title, page=pno + 1)
                rest = m[2]
                if t := INLINE_TITLE.match(rest):
                    if len(t[1]) < 160 and not re.match(r"^\(\d", rest):
                        sec.title, rest = t[1].strip(), t[2]
                sec.lines.append(rest)
                sec._y = (pno, y)  # type: ignore[attr-defined]
                sections.append(sec)
                continue
        if sections:
            indent = x > body_x + 15
            if indent or re.match(r"^(\(\w+\)|Explanation|Illustration|Provided|Exception)", text):
                sections[-1].lines.append(text)
            else:
                sections[-1].lines[-1] += " " + text

    # A marginal note starts level with the first line of its section (same page)
    for pno, y, _, note in notes:
        best = min((s for s in sections if getattr(s, "_y", (None,))[0] == pno),
                   key=lambda s: abs(s._y[1] - y), default=None)  # type: ignore[attr-defined]
        if best and abs(best._y[1] - y) < 14 and not best.title:  # type: ignore[attr-defined]
            best.title = re.sub(r"\s*-\s+", "-", note).rstrip(".").strip()
    return sections


# ---------------------------------------------------------------- IPC <-> BNS (BPR&D handbook tables)

NUM_CELL = re.compile(r"^(\d{1,3}[A-Z]{0,3}(?:\s*\([0-9a-z]+\))*)\.?\s*(.*)$")


def parse_bprd_bns_tables(data: bytes) -> list[dict]:
    """Correspondence tables (IPC section | BNS section) printed chapter by chapter in the BPR&D handbook.
    Returns [{ipc, ipc_title, bns, bns_ref, bns_title}] - bns_ref keeps the sub-section, e.g. '318(4)'.
    Each BNS cell is printed vertically centred against its IPC row, so it is matched to the IPC row whose span
    contains it; rows marked 'New Section' (BNS only) are skipped."""
    doc = pymupdf.open(stream=data, filetype="pdf")
    pairs: list[dict] = []
    for pno, page in enumerate(doc):
        lines = []
        for b in page.get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                text = " ".join("".join(s["text"] for s in l["spans"]).split())
                if text and 45 < l["bbox"][1] < page.rect.height - 60:  # drop running head and page number
                    lines.append((l["bbox"][0], l["bbox"][1], text))
        w = page.rect.width
        mid = w * 0.38
        numbered = lambda l: re.match(r"^\d{1,3}[A-Z]{0,3}\s?(\(\w+\))*\.?(\s|$|(?=[A-Z]))", l[2])
        left = sorted([l for l in lines if l[0] < mid], key=lambda l: l[1])
        right = sorted([l for l in lines if mid <= l[0] < w * 0.75], key=lambda l: l[1])
        lnum, rnum = [l for l in left if numbered(l)], [l for l in right if numbered(l)]
        if len(lnum) < 2 or len(rnum) < 2:
            continue
        left_x = min(l[0] for l in lnum)
        right_x = min(l[0] for l in rnum)
        col = lambda l, x0: abs(l[0] - x0) < 10
        # IPC rows: numbered cells or "New Section" markers in the left column, with their vertical span
        heads = [l for l in left if col(l, left_x) and (numbered(l) or l[2].lower().startswith("new section"))]
        rows = []
        for i, (x, y, text) in enumerate(heads):
            nxt = heads[i + 1][1] if i + 1 < len(heads) else 10**6
            cont = [l for l in left if col(l, left_x) and y < l[1] < nxt and not numbered(l) and not l[2].isupper()]
            end_y, prev = y, y
            for c in cont:  # contiguous continuation lines only
                if c[1] - prev > 16:
                    break
                end_y = prev = c[1]
            title = " ".join(c[2] for c in cont if c[1] <= end_y)
            m = NUM_CELL.match(text)
            rows.append({"y0": y, "y1": end_y, "ipc": base_number(m[1]) if numbered((x, y, text)) else None,
                         "ipc_title": ((m[2] if m else "") + " " + title).strip(), "next": nxt})
        # A row printed on one line ("148. Rioting, armed with deadly weapon. 191(3).") carries its BNS cell at the end
        for r in rows:
            if r["ipc"] and (m := re.search(r"\s(\d{1,3}[A-Z]?(?:\s?\(\w+\))+)\.?$", r["ipc_title"])):
                pairs.append({"ipc": r["ipc"], "ipc_title": r["ipc_title"][:m.start()].strip(), "bns": base_number(m[1]),
                              "bns_ref": re.sub(r"\s+", "", m[1]), "bns_title": "", "relation": "corresponds", "page": pno + 1})
        rheads = [l for l in right if col(l, right_x) and (numbered(l) or l[2].lower().startswith(("deleted", "omitted", "repealed")))]
        for j, (x, y, text) in enumerate(rheads):
            cand = [r for r in rows if r["y0"] - 8 <= y <= r["y1"] + 6]
            if not cand:
                continue
            row = min(cand, key=lambda r: abs(r["y0"] - y))
            if not row["ipc"]:
                continue  # new BNS section, no IPC counterpart
            if not numbered((x, y, text)):  # "Deleted" in the BNS column
                pairs.append({"ipc": row["ipc"], "ipc_title": row["ipc_title"], "bns": None, "bns_ref": None, "bns_title": "",
                              "relation": "deleted", "page": pno + 1})
                continue
            rm = NUM_CELL.match(text)
            r_next = rheads[j + 1][1] if j + 1 < len(rheads) else 10**6
            more = [l[2] for l in right if col(l, right_x) and y < l[1] < min(r_next, row["next"]) and not numbered(l) and not l[2].isupper()]
            pairs.append({"ipc": row["ipc"], "ipc_title": row["ipc_title"], "bns": base_number(rm[1]),
                          "bns_ref": re.sub(r"\s+", "", rm[1]), "bns_title": " ".join([rm[2], *more]).strip() if rm[2] else "",
                          "relation": "corresponds", "page": pno + 1})
    seen, out = set(), []
    num = lambda v: int(re.match(r"\d+", v)[0]) if v and re.match(r"\d+", v) else 0
    for p in pairs:
        # body-text headings of the handbook are in capitals; table cells are not. Numbers must exist in each code.
        if p["ipc_title"][:25].isupper() or not 0 < num(p["ipc"]) <= 511 or (p["bns"] and not 0 < num(p["bns"]) <= 358):
            continue
        k = (p["ipc"], p["bns_ref"])
        if k not in seen:
            seen.add(k)
            out.append(p)
    return out


# ---------------------------------------------------------------- auto-match old <-> new by text (to verify)

def _norm(t: str) -> str:
    return re.sub(r"[^a-z0-9 ]", " ", t.lower())


def auto_match(old: list[tuple[str, str, str]], new: list[tuple[str, str, str]], threshold: float = 0.55) -> list[dict]:
    """old/new: (number, title, text). For each new section the most similar old one (title + opening words)."""
    out = []
    old_idx = [(n, t, _norm(f"{t} {x[:600]}")) for n, t, x in old]
    for n, t, x in new:
        key = _norm(f"{t} {x[:600]}")
        best, score = None, 0.0
        for on, ot, ok in old_idx:
            s = SequenceMatcher(None, key, ok, autojunk=False).quick_ratio()
            if s > score - 0.05:
                s = SequenceMatcher(None, key, ok, autojunk=False).ratio()
                if s > score:
                    best, score = (on, ot), s
        if best and score >= threshold:
            out.append({"old": best[0], "old_title": best[1], "new": n, "new_title": t, "score": round(score, 3)})
    return out


# ---------------------------------------------------------------- references in case papers

ACT_ALIASES = {
    "IPC": r"I\.?\s?P\.?\s?C\.?|Indian Penal Code|Penal Code",
    "CRPC": r"Cr\.?\s?P\.?\s?C\.?|Code of Criminal Procedure|Criminal Procedure Code",
    "IEA": r"(?:Indian\s+)?Evidence Act|I\.?\s?E\.?\s?A\.?",
    "BNS": r"B\.?\s?N\.?\s?S\.?(?!\s?S)|Bharatiya Nyaya Sanhita|Nyaya Sanhita",
    "BNSS": r"B\.?\s?N\.?\s?S\.?\s?S\.?|Bharatiya Nagarik Suraksha Sanhita|Nagarik Suraksha Sanhita",
    "BSA": r"B\.?\s?S\.?\s?A\.?|Bharatiya Sakshya Adhiniyam|Sakshya Adhiniyam",
}
_ACT = "|".join(f"(?P<{k}>{v})" for k, v in ACT_ALIASES.items())
_NUMS = r"\d{1,3}\s?-?\s?[A-Z]{0,2}(?:\s?\(\w{1,4}\))*"
SECTION_REF = re.compile(
    rf"\b(?:u/s\.?|under\s+sections?|sections?|secs?\.?|ss\.?|s\.)\s*(?P<nums>{_NUMS}(?:\s*(?:,|/|&|and|r/w|read\s+with)\s*{_NUMS})*)"
    rf"\s*(?:of\s+the\s+|of\s+|,\s*)?(?:{_ACT})", re.I)
ARTICLE_REF = re.compile(r"\bArt(?:icle|s?\.)?s?\s+(?P<nums>\d{1,3}[A-Z]?(?:\s?\(\w{1,3}\))*(?:\s*(?:,|/|&|and)\s*\d{1,3}[A-Z]?(?:\s?\(\w{1,3}\))*)*)"
                         r"(?:\s+of\s+the\s+Constitution)?", re.I)


def find_references(text: str) -> list[tuple[str, str]]:
    """[(code, base section number)] in order of appearance, e.g. 'u/s 302/34 IPC' -> [('IPC','302'), ('IPC','34')]."""
    out = []
    for m in SECTION_REF.finditer(text):
        code = next(k for k in ACT_ALIASES if m.group(k))
        for n in re.findall(_NUMS, m["nums"]):
            out.append((code, base_number(n.replace(" ", ""))))
    for m in ARTICLE_REF.finditer(text):
        for n in re.findall(r"\d{1,3}[A-Z]?", re.sub(r"\([^)]*\)", "", m["nums"])):  # 19(1)(a) -> 19
            out.append(("COI", n.upper()))
    return out


SHORT_REF = re.compile(r"\s*(?:(IPC|CRPC|CR\.?P\.?C\.?|IEA|BNS|BNSS|BSA)\s*(\d{1,3}[A-Z]?)|(\d{1,3}[A-Z]?)\s*(IPC|CRPC|CR\.?P\.?C\.?|IEA|BNS|BNSS|BSA))\s*")
ARTICLE_SHORT = re.compile(r"\s*ART(?:ICLE|\.)?\s*(\d{1,3}[A-Z]?)\s*")


def parse_provisions(text: str) -> list[tuple[str, str]]:
    """Full references in running text, plus short forms typed in a search box: "IPC 302", "302 IPC", "Art 21"."""
    refs = list(dict.fromkeys(find_references(text)))
    up = text.upper()
    if m := SHORT_REF.fullmatch(up):
        c = (m[1] or m[4]).replace(".", "")
        refs.insert(0, ("CRPC" if c.startswith("CR") else c, m[2] or m[3]))
    elif m := ARTICLE_SHORT.fullmatch(up):
        refs.insert(0, ("COI", m[1]))
    return list(dict.fromkeys(refs))


def applicable_code(code: str, offence_date: date | None) -> str:
    """Which code governs on a date: IPC before 1 July 2024, BNS from then (same for CrPC/BNSS, IEA/BSA).
    Procedure (BNSS) and evidence (BSA) for proceedings after that date follow their own saving clauses - shown as a note."""
    info = CATALOGUE.get(code, {})
    if not offence_date:
        return code
    if info.get("replaced_by") and offence_date >= NEW_CRIMINAL_LAWS_FROM:
        return info["replaced_by"]
    if info.get("replaces") and offence_date < NEW_CRIMINAL_LAWS_FROM:
        return info["replaces"]
    return code
