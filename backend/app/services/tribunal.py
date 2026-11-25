"""Tribunal orders in the shared judgment library (phase 1: NCLT and NCLAT).

Library judgments carry meta["forum"]: "SC" (default when missing), "NCLAT" or "NCLT", plus meta["bench"] and meta["case_no"].
Orders are added by a platform admin as PDFs; NCLT's own order search is behind a CAPTCHA and is not automated.
Both tribunals allow reproduction free of charge if reproduced accurately and the source is prominently acknowledged.
"""

import re

FORUMS = {
    "SC": {"name": "Supreme Court of India", "short": "Supreme Court", "binding": True, "benches": []},
    "NCLAT": {"name": "National Company Law Appellate Tribunal", "short": "NCLAT", "binding": False,
              "site": "https://nclat.nic.in", "benches": ["Principal Bench, New Delhi", "Chennai Bench"]},
    "NCLT": {"name": "National Company Law Tribunal", "short": "NCLT", "binding": False, "site": "https://nclt.gov.in",
             "benches": ["Principal Bench, New Delhi", "New Delhi", "Ahmedabad", "Allahabad", "Amaravati", "Bengaluru", "Chandigarh",
                         "Chennai", "Cuttack", "Guwahati", "Hyderabad", "Indore", "Jaipur", "Kochi", "Kolkata", "Mumbai"]},
}
TRIBUNALS = [k for k in FORUMS if k != "SC"]

ATTRIBUTION = {
    "NCLAT": "Order of the National Company Law Appellate Tribunal (nclat.nic.in), reproduced under its copyright policy.",
    "NCLT": "Order of the National Company Law Tribunal (nclt.gov.in), reproduced under its copyright policy.",
}

# Case numbers as the orders print them
CASE_NO_RES = [
    # NCLAT: "Company Appeal (AT) (Insolvency) No. 45 of 2022", "Comp. App. (AT) (Ins.) No. 1234 of 2023", "Company Appeal (AT) (CH) (Ins) No. 12/2024"
    re.compile(r"\b(?:Company|Comp\.?)\s*App(?:eal|\.)?\s*\(\s*AT\s*\)(?:\s*\(\s*(?:CH|Chennai)\s*\))?(?:\s*\(\s*(?:Insolvency|Ins\.?)\s*\))?"
               r"\s*No\.?\s*\d{1,5}\s*(?:of|/)\s*(?:19|20)\d{2}\b", re.I),
    # NCLT: "CP (IB) No. 123/MB/2021", "C.P. (IB) No. 1234/ND/2020", "IA No. 45/2022 in CP(IB) 12/KB/2021", "CP (CAA) No. 7/ALD/2023"
    # also "Company Petition (IB) No. 1057/MB-IV/2021", "I.A. No. 34 of 2024"
    re.compile(r"\b(?:Company\s+Petition|C\.?\s?P\.?|I\.?\s?A\.?|M\.?\s?A\.?|T\.?\s?P\.?)\s*(?:\(\s*(?:IB|CAA|CA|AA)\s*\))?\s*(?:No\.?)?\s*\d{1,5}"
               r"\s*(?:/\s*(?:[A-Z]{1,5}(?:-[IVX]+)?\s*/\s*)?|\s+of\s+)(?:19|20)\d{2}\b", re.I),
]
DATE_RES = [
    re.compile(r"(?:Date of (?:Judgment|Order|Pronouncement|Decision)|Pronounced on|Order (?:pronounced|delivered) on|Date)\s*[:\-–]?\s*"
               r"(\d{1,2})(?:st|nd|rd|th)?[./\- ](\d{1,2}|[A-Za-z]{3,9})[.,/\- ]+((?:19|20)\d{2})", re.I),
]
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def norm_case_no(s: str) -> str:
    """For matching: "CP (IB) No. 123/MB/2021" -> "cp ib 123 mb 2021"."""
    s = re.sub(r"\bno\b\.?", " ", s.lower())
    return " ".join(re.findall(r"[a-z]+|\d+", s))


def find_case_numbers(text_: str) -> list[str]:
    out = []
    for rx in CASE_NO_RES:
        out += [" ".join(m.group(0).split()) for m in rx.finditer(text_ or "")]
    return list(dict.fromkeys(out))


def _date(text_: str) -> str | None:
    for rx in DATE_RES:
        if m := rx.search(text_):
            d, mo, y = m.group(1), m.group(2), m.group(3)
            mo_n = int(mo) if mo.isdigit() else MONTHS.get(mo[:3].lower())
            if mo_n and 1 <= mo_n <= 12 and 1 <= int(d) <= 31:
                return f"{int(y):04d}-{mo_n:02d}-{int(d):02d}"
    return None


def _parties(lines: list[str]) -> str | None:
    """'X ... Appellant' / 'Versus' / 'Y ... Respondent' -> 'X v. Y' (best effort; the admin can correct it)."""
    for i, l in enumerate(lines[:80]):
        if re.fullmatch(r"(?:versus|vs\.?|v/s\.?|v\.)", l.strip(), re.I):
            before = [x for x in lines[max(0, i - 6):i] if not re.search(r"appellant|petitioner|applicant|no\.|tribunal|bench|in the matter", x, re.I)]
            after = [x for x in lines[i + 1:i + 7] if not re.search(r"respondent|no\.|tribunal|bench|present|coram", x, re.I)]
            a = re.sub(r"[.…\s]+$", "", before[-1]) if before else ""
            b = re.sub(r"[.…\s]+$", "", after[0]) if after else ""
            a = re.sub(r"\s*\.{2,}.*$", "", a)
            b = re.sub(r"\s*\.{2,}.*$", "", b)
            if a and b:
                return f"{a} v. {b}"[:250]
    return None


def meta_from_text(text_: str, forum: str, bench: str = "") -> dict:
    """Best-effort header parse of a tribunal order: case number, parties, date. The admin checks it before it is relied on."""
    lines = [l.strip() for l in (text_ or "").splitlines() if l.strip()]
    nums = find_case_numbers(text_[:6000] if text_ else "")
    meta = {"forum": forum, "court": FORUMS[forum]["name"], "bench": bench or None, "case_no": nums[0] if nums else None,
            "other_case_nos": nums[1:6], "decision_date": _date(text_[:8000] if text_ else ""), "title": _parties(lines),
            "source": "upload", "source_name": FORUMS[forum]["name"], "attribution": ATTRIBUTION.get(forum)}
    if m := re.search(r"Coram\s*[:\-]?\s*(.{5,300}?)(?:\n\s*\n|For (?:the )?(?:Appellant|Petitioner|Applicant))", text_ or "", re.I | re.S):
        meta["members"] = " ".join(m.group(1).split())[:300]
    return meta


def forum_of(meta: dict | None) -> str:
    return (meta or {}).get("forum") or "SC"


def label(meta: dict | None) -> dict:
    """What the user is shown next to a judgment: forum, bench and whether it binds."""
    f = forum_of(meta)
    info = FORUMS.get(f, FORUMS["SC"])
    return {"forum": f, "forum_name": info["name"], "bench": (meta or {}).get("bench"), "case_no": (meta or {}).get("case_no"),
            "arising_from": (meta or {}).get("arising_from"),
            "binding_note": None if info["binding"] else
            f"{info['short']} order: persuasive, not a binding precedent for the Supreme Court or High Courts. Check whether it was appealed."}
