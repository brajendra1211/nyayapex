"""Citation detection + normalisation for SCC / AIR / MANU / SCR / neutral citations. Zero tokens.

Cross-reporter mapping (SCC <-> AIR <-> MANU) needs a licensed corpus/index;
until the corpus decision (PRD section 14) is made, we only detect & normalise.
"""

import re

PATTERNS: list[tuple[str, re.Pattern, str]] = [
    # (2017) 10 SCC 1
    ("SCC", re.compile(r"\(\s*((?:19|20)\d{2})\s*\)\s*(\d{1,2})\s*S\.?\s*C\.?\s*C\.?\s+(\d{1,4})", re.I), "({0}) {1} SCC {2}"),
    # 2023 SCC OnLine SC 123
    ("SCC OnLine", re.compile(r"\b((?:19|20)\d{2})\s+SCC\s+On\s*Line\s+(SC|[A-Z][A-Za-z&]{1,6})\s+(\d{1,6})", re.I), "{0} SCC OnLine {1} {2}"),
    # AIR 1973 SC 1461
    ("AIR", re.compile(r"\bA\.?\s*I\.?\s*R\.?\s+((?:19|20)\d{2})\s+(SC|S\.C\.|[A-Z][A-Za-z]{1,10})\s+(\d{1,5})", re.I), "AIR {0} {1} {2}"),
    # MANU/SC/0445/1973
    ("MANU", re.compile(r"\bMANU\s*/\s*([A-Z]{2,4})\s*/\s*(\d{3,5})\s*/\s*((?:19|20)\d{2})", re.I), "MANU/{0}/{1}/{2}"),
    # [1973] Supp SCR 1  |  (1973) 4 SCR 225
    ("SCR", re.compile(r"[\[(]\s*((?:19|20)\d{2})\s*[\])]\s*(Supp\.?\s*|\d{1,2}\s+)?S\.?\s*C\.?\s*R\.?\s+(\d{1,4})", re.I), "[{0}] {1}SCR {2}"),
    # 2024 INSC 123 (Supreme Court neutral citation)
    ("INSC", re.compile(r"\b((?:19|20)\d{2})\s+INSC\s+(\d{1,5})\b", re.I), "{0} INSC {1}"),
]

CASE_NAME_RE = re.compile(
    r"([A-Z][\w.&' ]{2,80}?)\s+(?:v\.|vs\.?|versus)\s+([A-Z][\w.&' ]{2,80}?)(?=[,;(\[]|\s+(?:AIR|MANU|\(|\[|\d{4}))"
)


CONNECTORS = {"of", "and", "the", "for", "&"}


def _party(name: str) -> str:
    """'Reliance is placed on Union of India' -> 'Union of India' (keep the trailing run of name-like words)."""
    words = name.split()
    keep: list[str] = []
    for w in reversed(words):
        if w[:1].isupper() or w.lower() in CONNECTORS or w[:1] == "(":
            keep.append(w)
        else:
            break
    while keep and keep[-1].lower() in CONNECTORS:  # don't start with "of"/"and"
        keep.pop()
    return " ".join(reversed(keep))


def _fmt(reporter: str, template: str, groups: tuple) -> str:
    g = [x.strip() if x else "" for x in groups]
    if reporter == "AIR" and g[1].replace(".", "").upper() == "SC":
        g[1] = "SC"
    if reporter == "MANU":
        g[0] = g[0].upper()
    if reporter == "SCR":  # Supreme Court Reports are cited with the year in square brackets
        year, vol, page = g
        if vol.lower().startswith("supp"):
            return f"[{year}] Supp SCR {page}"
        return f"[{year}] {vol} SCR {page}" if vol else f"[{year}] SCR {page}"
    return template.format(*g)


def find_citations(text: str, page: int | None = None) -> list[dict]:
    text = re.sub(r"\s*\n\s*", " ", text)  # citations often wrap across PDF lines
    found = []
    for reporter, pattern, template in PATTERNS:
        for m in pattern.finditer(text):
            before = text[max(0, m.start() - 160) : m.start()]
            names = list(CASE_NAME_RE.finditer(before + " " + m.group(0)))
            # the name must sit right before this citation, not belong to an earlier one in the window
            names = [n for n in names if len(before) - n.end() <= 12]
            case_name = ""
            if names and (left := _party(names[-1].group(1))):
                case_name = f"{left} v. {names[-1].group(2).strip()}"
            found.append(
                {
                    "citation": _fmt(reporter, template, m.groups()),
                    "reporter": reporter,
                    "case_name": case_name,
                    "raw": m.group(0),
                    "page": page,
                    "offset": m.start(),
                }
            )
    return found


def extract_document_citations(pages) -> list[dict]:
    by_cite: dict[str, dict] = {}
    for p in pages:
        for c in find_citations(p.text, p.number):
            entry = by_cite.setdefault(
                c["citation"], {"citation": c["citation"], "reporter": c["reporter"], "case_name": c["case_name"], "pages": []}
            )
            if not entry["case_name"] and c["case_name"]:
                entry["case_name"] = c["case_name"]
            if p.number not in entry["pages"]:
                entry["pages"].append(p.number)
    return sorted(by_cite.values(), key=lambda c: -len(c["pages"]))


def normalize(raw: str) -> dict | None:
    hits = find_citations(raw)
    return {k: hits[0][k] for k in ("citation", "reporter", "case_name")} if hits else None


TREATMENT_WORDS = {
    "Overruled": re.compile(r"\boverrul(?:ed|ing)\b", re.I),
    "Doubtful": re.compile(r"\b(?:doubted|per incuriam|referred to a larger bench|reconsider)", re.I),
    "Distinguished": re.compile(r"\bdistinguish(?:ed|able|ing)\b", re.I),
    "Good Law": re.compile(r"\b(?:followed|affirmed|relied (?:up)?on|approved|reiterated)\b", re.I),
}
