"""Chronology extraction with regex - zero tokens.

Indian records use day-first dates (12.03.2019, 12th March, 2019).
"""

import re
from datetime import date

from dateutil import parser as dparser

from .extract import Page

MONTHS = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
DATE_RE = re.compile(
    rf"""(
        \b\d{{1,2}}[./-]\d{{1,2}}[./-](?:19|20)\d{{2}}\b                      # 12.03.2019
      | \b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?{MONTHS}\.?,?\s+(?:19|20)\d{{2}}\b   # 12th March, 2019
      | \b{MONTHS}\.?\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{{2}}\b       # March 12, 2019
    )""",
    re.I | re.X,
)
# Sentence boundary: ". " followed by a capital/bracket, except after legal abbreviations / date digits
SENTENCE_SPLIT = re.compile(r"(?<=[.;])\s+(?=[A-Z(\[])")
ABBREV_END = re.compile(r"(?:\bv|\bvs|\bNo|\bNos|\bLtd|\bCo|\bDr|\bMr|\bMrs|\bSr|\bJr|\bSmt|\bShri|\bArt|\bSec|\bs|\bss|\bpara|\bp|\bpp|\bi\.e|\be\.g|\b\d{1,2}\.\d{1,2})\.$", re.I)
MAX_CONTEXT = 260


def flatten(text: str) -> str:
    """PDF lines wrap mid-sentence; join them so dates/citations split across lines are found."""
    return re.sub(r"\s*\n\s*", " ", text)


def sentences(text: str) -> list[str]:
    out: list[str] = []
    for piece in SENTENCE_SPLIT.split(flatten(text)):
        if out and ABBREV_END.search(out[-1]):
            out[-1] += " " + piece
        else:
            out.append(piece)
    return out


def _parse(raw: str) -> date | None:
    try:
        cleaned = re.sub(r"(?i)day\s+of", "", raw)
        d = dparser.parse(cleaned, dayfirst=True, fuzzy=True).date()
        if 1900 <= d.year <= date.today().year + 1:
            return d
    except (ValueError, OverflowError):
        pass
    return None


def extract_chronology(pages: list[Page]) -> list[dict]:
    events: dict[tuple, dict] = {}
    for p in pages:
        for sentence in sentences(p.text):
            for m in DATE_RE.finditer(sentence):
                d = _parse(m.group(0))
                if not d:
                    continue
                ctx = sentence.strip()
                if len(ctx) > MAX_CONTEXT:
                    s = max(0, m.start() - MAX_CONTEXT // 2)
                    ctx = "…" + sentence[s : s + MAX_CONTEXT].strip() + "…"
                key = (d, ctx[:80].lower())
                if key not in events:
                    events[key] = {"date": d.isoformat(), "event": ctx, "pages": [p.number], "source": "regex"}
                elif p.number not in events[key]["pages"]:
                    events[key]["pages"].append(p.number)
    return sorted(events.values(), key=lambda e: e["date"])
