"""Supreme Court orders ("Record of Proceedings") -> a hearing note the advocate reviews. Zero tokens.

Reads what the order itself says: date, court and item, coram, the operative part, and the next date ("List on
12.01.2027", "List after four weeks"). Nothing is saved as the matter's next hearing until the advocate saves the note.
"""

import re
from datetime import date, timedelta

import pymupdf

ALLOWED_HOSTS = ("api.sci.gov.in", "main.sci.gov.in", "www.sci.gov.in", "sci.gov.in", "scr.sci.gov.in", "cdnbbsr.s3waas.gov.in")
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "ten": 10, "twelve": 12}
DMY = r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})"
LONG = r"(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9}),?\s+(\d{4})"
OUTCOMES = [  # what the order records -> the hearing note's outcome
    (r"\bdismissed\b", "dismissed"), (r"\bdisposed of\b", "disposed"), (r"\bwithdrawn\b", "withdrawn"),
    (r"leave (?:is )?granted", "leave granted"), (r"\badmit(?:ted)?\b", "admitted"), (r"issue notice|notice (?:is )?issued", "notice issued"),
    (r"judgment (?:is )?reserved|reserved for (?:judgment|orders)", "heard - reserved"), (r"part[- ]heard", "heard - part heard"),
    (r"adjourn", "adjourned"), (r"not reached", "not reached"),
]


def _date(d: str, m: str, y: str) -> date | None:
    try:
        month = int(m) if m.isdigit() else MONTHS.get(m[:3].lower())
        return date(int(y), month, int(d)) if month else None
    except ValueError:
        return None


def _flat(t: str) -> str:
    t = re.sub(r"(?<=\b[A-Z]) (?=[A-Z]\b)", "", t)  # "S U P R E M E" -> "SUPREME", "O R D E R" -> "ORDER"
    return re.sub(r"[ \t]+", " ", t)


def parse_order(data: bytes) -> dict:
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        raw = "\n".join(p.get_text() for p in doc)
    t = _flat(raw)
    one = " ".join(t.split())
    out: dict = {"order_date": None, "next_date": None, "court": "", "item_no": "", "bench": "", "outcome": "", "notes": "",
                 "record_of_proceedings": "RECORD OF PROCEEDINGS" in one.upper()}
    if m := re.search(r"Date\s*:\s*" + DMY, one, re.I):
        out["order_date"] = _date(*m.groups())
    if m := re.search(r"COURT\s*NO\.?\s*:?\s*(\d+)", one, re.I):
        out["court"] = f"Court No. {m.group(1)}"
    if m := re.search(r"ITEM\s*NO\.?\s*:?\s*([\d.]+)", one, re.I):
        out["item_no"] = m.group(1).rstrip(".")
    if m := re.search(r"CORAM\s*:?\s*(.+?)(?=\(?\s*(?:IN CHAMBERS|For Petitioner|For Appellant|For the Petitioner|UPON hearing|Counsel for|$))", one, re.I):
        judges = re.findall(r"HON'?BLE\s+(?:THE\s+)?(?:MR\.?|MRS\.?|MS\.?|DR\.?)?\s*(?:CHIEF\s+)?JUSTICE\s+([A-Z][A-Z.\s]+?)(?=\s+HON'?BLE|\s*$)", m.group(1).upper())
        out["bench"] = ", ".join("Justice " + j.strip().title() for j in judges)[:300]
    body = re.split(r"\bO\s?R\s?D\s?E\s?R\b", one, maxsplit=1)
    operative = body[1] if len(body) > 1 else one
    operative = re.split(r"\(\s*[A-Z][A-Za-z .]+\)\s*(?:COURT MASTER|ASSISTANT REGISTRAR|BRANCH OFFICER)|COURT MASTER|\(Signed", operative, maxsplit=1)[0]
    out["notes"] = operative.strip(" :-")[:4000]
    low = operative.lower()
    for rx, label in OUTCOMES:
        if re.search(rx, low):
            out["outcome"] = label
            break
    base = out["order_date"]
    for rx in (r"list(?:ed)?\b[^.]{0,60}?\bon\s+" + DMY, r"list(?:ed)?\b[^.]{0,60}?\bon\s+" + LONG, r"returnable on\s+" + DMY, r"returnable on\s+" + LONG):
        if m := re.search(rx, operative, re.I):
            out["next_date"] = _date(*m.groups())
            break
    if not out["next_date"] and base:
        if m := re.search(r"(?:list|returnable)[^.]{0,40}?\b(?:after|in|within)\s+(\d{1,2}|" + "|".join(WORDS) + r")\s+(week|month)s?", operative, re.I):
            n = int(m.group(1)) if m.group(1).isdigit() else WORDS[m.group(1).lower()]
            out["next_date"] = base + timedelta(days=n * (7 if m.group(2).lower() == "week" else 30))
            out["next_date_is_estimate"] = True  # "after four weeks": the registry fixes the actual date
    return out
