"""Supreme Court cause lists -> matters. Zero tokens.

The cause-list page on sci.gov.in links every published list as a plain PDF (daily lists per court, and the tentative
advance list). Only those public links are read. The page's search form is CAPTCHA-protected and is never used.

A matter is found by its registry case number ("SLP(C) No. 30665/2026") or diary number ("34272/2026"), never by party
names, so a listing is never attached to the wrong matter. Listings for an AOR code are shown to that AOR as well,
including matters not entered in Nyay Apex.
"""

import hashlib
import logging
import re
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pymupdf
from sqlalchemy.orm import Session

from ..models import Case, CauseListEntry, CauseListFile, CauseListMatch, User
from . import access, notify

log = logging.getLogger(__name__)

INDEX_URL = "https://www.sci.gov.in/cause-list/"
PDF_RE = re.compile(r"https://api\.sci\.gov\.in/jonew/cl/(advance/)?(\d{4}-\d{2}-\d{2})/[A-Za-z0-9_]+\.pdf")
UA = {"User-Agent": "NyayApex/1.0 (cause-list reader; contact noreply@nyayapex.ai)"}
IST = ZoneInfo("Asia/Kolkata")
KEEP_DAYS = 14
MAX_FILES_PER_RUN = 40

ITEM_RE = re.compile(r"^(\d{1,4}(?:\.\d{1,3})?)(?:\s+Connected)?$")
CASE_LINE_RE = re.compile(r"^(?P<type>Diary|[A-Z][A-Za-z.() ]{0,40}?)\s*No\.\s*(?P<rest>.*)$")
NUM_RE = re.compile(r"(\d{1,7})(?:\s*-\s*(\d{1,7}))?\s*(?:/|-|\s+of\s+)\s*((?:19|20)\d{2})", re.I)
AOR_RE = re.compile(r"[A-Za-z.)\]]\s*-\s*(\d{2,5})\b")
DATE_RE = re.compile(r"(\d{2})-(\d{2})-(\d{4})")

# How advocates write a case type -> how the cause list prints it (letters only, lower case)
TYPE_ALIASES = {
    "civilappeal": "ca", "criminalappeal": "crla", "crlappeal": "crla", "slp": "slpc", "slpcivil": "slpc",
    "specialleavepetitionc": "slpc", "specialleavepetitioncivil": "slpc", "slpcriminal": "slpcrl", "slpcrlmp": "slpcrl",
    "specialleavepetitioncrl": "slpcrl", "specialleavepetitioncriminal": "slpcrl", "writpetitionc": "wpc",
    "writpetitioncivil": "wpc", "wpcivil": "wpc", "writpetitioncrl": "wpcrl", "writpetitioncriminal": "wpcrl",
    "wpcriminal": "wpcrl", "transferpetitionc": "tpc", "transferpetitioncivil": "tpc", "tpcivil": "tpc",
    "transferpetitioncrl": "tpcrl", "tpcriminal": "tpcrl", "reviewpetitionc": "rpc", "rpcivil": "rpc",
    "reviewpetitioncrl": "rpcrl", "contemptpetitionc": "conmtpetc", "contemptpetitioncivil": "conmtpetc",
    "diaryno": "diary",
}


def today_ist() -> date:
    return datetime.now(IST).date()


def _type_key(raw: str) -> str:
    t = re.sub(r"[^a-z]", "", raw.lower().replace(" no", "").replace("no.", ""))
    return TYPE_ALIASES.get(t, t)


def keys_for(type_text: str, number_text: str) -> list[str]:
    """'SLP(C)', '19741-19746/2026' -> ['slpc:19741:2026', ..., 'slpc:19746:2026']."""
    t = _type_key(type_text)
    m = NUM_RE.search(number_text)
    if not t or not m:
        return []
    a, b, year = int(m.group(1)), int(m.group(2) or m.group(1)), m.group(3)
    if b < a or b - a > 60:
        b = a
    return [f"{t}:{n}:{year}" for n in range(a, b + 1)]


def case_keys(case: Case) -> dict[str, str]:
    """Keys under which this matter can appear in a cause list -> how it was matched."""
    out: dict[str, str] = {}
    if case.case_number:
        cn = case.case_number.strip()
        m = re.match(r"^\s*([A-Za-z][A-Za-z.() ]*?)\s*(?:No\.?)?\s*(?=\d)", cn)
        for k in keys_for(m.group(1) if m else case.case_type or "", cn):
            out[k] = "case_number"
    if case.diary_no:
        for k in keys_for("Diary", case.diary_no):
            out[k] = "diary_no"
    return out


# ---------------------------------------------------------------- reading the lists

def list_links(client: httpx.Client, since: date) -> list[tuple[str, date, str]]:
    r = client.get(INDEX_URL, timeout=40)
    r.raise_for_status()  # the court's site may refuse automated readers (403); lists can then be added by link or upload
    html = r.text
    out = {}
    for m in PDF_RE.finditer(html):
        d = date.fromisoformat(m.group(2))
        if d >= since:
            out[m.group(0)] = (m.group(0), d, "advance" if m.group(1) else "daily")
    return sorted(out.values(), key=lambda x: (x[1], x[2], x[0]))


def parse_pdf(data: bytes, kind: str) -> list[dict]:
    """Items of one cause-list PDF: court, bench, item no., case no., keys, parties, AOR codes."""
    items: list[dict] = []
    benches: dict[str, str] = {}
    cur: dict | None = None
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        for pno, page in enumerate(doc, start=1):
            lines = [ln.strip() for ln in page.get_text().splitlines() if ln.strip()]
            court = ""
            for i, ln in enumerate(lines[:8]):
                if ln.startswith(("DAILY CAUSE LIST", "MISCELLANEOUS MATTERS", "REGULAR HEARING MATTERS")) and i + 1 < len(lines):
                    nxt = lines[i + 1]
                    if "COURT" in nxt.upper() or "REGISTRAR" in nxt.upper() or "CHAMBER" in nxt.upper():
                        court = nxt
                    break
            if court and court not in benches:
                judges = [ln for ln in lines[:40] if ln.upper().startswith("HON'BLE")]
                benches[court] = ", ".join(j.title().replace("Hon'Ble", "Hon'ble") for j in judges)[:400]
            i = 0
            while i < len(lines):
                ln = lines[i]
                m = ITEM_RE.match(ln)
                case_line = lines[i + 1] if i + 1 < len(lines) else ""
                cm = CASE_LINE_RE.match(case_line) if m else None
                if m and cm and not case_line.startswith("IA No"):
                    rest = cm.group("rest")
                    j = i + 2
                    if not NUM_RE.search(rest) and j < len(lines):  # "C.A. No." / "3098-3099/2023" on two lines
                        rest = f"{rest} {lines[j]}".strip()
                        j += 1
                    cur = {"item_no": m.group(1), "case_no": f"{cm.group('type').strip()} No. {rest}".strip(),
                           "case_keys": keys_for(cm.group("type"), rest), "court": court or (cur or {}).get("court", ""),
                           "page": pno, "body": []}
                    cur["bench"] = benches.get(cur["court"], "")
                    items.append(cur)
                    i = j
                    continue
                if cur is not None and not ln.startswith(("DAILY CAUSE LIST", "SUPREME COURT OF INDIA")) and ln != court:
                    cur["body"].append(ln)
                i += 1
    for it in items:
        body = it.pop("body")
        text = " ".join(body)
        # "[R-10]" / "[P-1]" say whom the advocate appears for; they are not AOR codes
        it["aor_codes"] = sorted(set(AOR_RE.findall(re.sub(r"\[[A-Z]+-?\d*\]", " ", text))))
        it["parties"] = _parties(body)
        it["remarks"] = text[:900]
    return items


def _parties(body: list[str]) -> str:
    """'PETITIONER v. RESPONDENT' from an item's lines (best effort, display only)."""
    if "Versus" not in body:
        return ""
    v = body.index("Versus")

    def name(lines: list[str]) -> str:
        out = []
        for ln in lines:
            if AOR_RE.search(ln) or ln.startswith(("[", "PETITIONER-IN-PERSON", "{", "IA No", "FOR ")) or re.fullmatch(r"[IVXL]+(-[A-Z])?|PIL-W", ln):
                if out:
                    break
                continue
            out.append(ln)
        return " ".join(out)[:200]

    return f"{name(body[:v])} v. {name(body[v + 1:])}".strip()


# ---------------------------------------------------------------- matching

def _describe(e: CauseListEntry) -> str:
    where = ", ".join(x for x in (e.court.title() if e.court else "", f"item {e.item_no}" if e.item_no else "") if x)
    if e.kind == "advance":
        return f"likely to be listed on {e.list_date:%d %b %Y} (advance list, tentative){' - ' + where if where else ''}"
    return f"listed on {e.list_date:%d %b %Y}{' in ' + where if where else ''} (daily cause list)"


def match_cases(db: Session, entries: list[CauseListEntry], workspace_id: int | None = None) -> int:
    """Attach new entries to matters with the same case/diary number; notify and update the next hearing.
    A list uploaded by one account (workspace_id) is matched only to that account's matters."""
    index: dict[str, list[CauseListEntry]] = {}
    for e in entries:
        for k in e.case_keys or []:
            index.setdefault(k, []).append(e)
    if not index:
        return 0
    found = 0
    q = db.query(Case).filter((Case.case_number.isnot(None)) | (Case.diary_no.isnot(None)))
    if workspace_id is not None:
        q = q.filter(Case.workspace_id == workspace_id)
    for case in q:
        for key, how in case_keys(case).items():
            for e in index.get(key, []):
                if db.query(CauseListMatch.id).filter(CauseListMatch.case_id == case.id, CauseListMatch.entry_id == e.id).first():
                    continue
                db.add(CauseListMatch(case_id=case.id, entry_id=e.id, matched_by=how))
                found += 1
                text = f"\"{case.title}\" is {_describe(e)}"
                notify.notify(db, access.matter_people(db, case), text, case_id=case.id, kind="listing",
                              link=f"/matter?id={case.id}", whatsapp=True)
                if e.kind == "daily" and e.list_date >= today_ist() and case.next_hearing != e.list_date:
                    case.next_hearing = e.list_date
                    if e.court:
                        case.bench = f"{e.court.title()}{' - ' + e.bench if e.bench else ''}"[:200]
                    access.log(db, case, None, "hearing_changed", to=f"{e.list_date:%d %b %Y} (from the cause list)")
                    notify.notify(db, access.matter_clients(db, case), f"Your matter \"{case.title}\" is listed on {e.list_date:%d %b %Y}",
                                  case_id=case.id, kind="hearing", link=f"/portal/matter?id={case.id}")
    return found


def sync(db: Session, client: httpx.Client | None = None) -> dict:
    """Read new or changed cause lists from today on, match matters, drop lists older than KEEP_DAYS."""
    own = client is None
    client = client or httpx.Client(headers=UA, follow_redirects=True, timeout=90)
    report = {"files": 0, "changed": 0, "entries": 0, "matches": 0, "errors": []}
    try:
        today = today_ist()
        try:
            links = list_links(client, today)
        except httpx.HTTPError as e:
            report["errors"].append(f"cause-list page: {e}")
            links = []
        report["files"] = len(links)
        for url, d, kind in links[:MAX_FILES_PER_RUN]:
            f = db.query(CauseListFile).filter(CauseListFile.url == url).first()
            try:
                r = client.get(url)
                r.raise_for_status()
                if not r.content.startswith(b"%PDF"):
                    raise ValueError("not a PDF")
            except Exception as e:  # keep going; the next run retries
                report["errors"].append(f"{url}: {e}")
                continue
            sha = hashlib.sha256(r.content).hexdigest()
            if f and f.sha256 == sha:
                continue
            if f:  # republished (corrected / supplementary): replace its entries
                db.query(CauseListEntry).filter(CauseListEntry.file_id == f.id).delete()
            else:
                f = CauseListFile(url=url, list_date=d, kind=kind)
                db.add(f)
            try:
                items = parse_pdf(r.content, kind)
            except Exception as e:
                f.error, f.sha256 = str(e)[:500], sha
                db.commit()
                report["errors"].append(f"{url}: {e}")
                continue
            f.sha256, f.items, f.error, f.fetched_at = sha, len(items), "", datetime.utcnow()
            db.flush()
            rows = [CauseListEntry(file_id=f.id, list_date=d, kind=kind, **it) for it in items]
            db.add_all(rows)
            db.flush()
            report["matches"] += match_cases(db, rows)
            report["changed"] += 1
            report["entries"] += len(rows)
            db.commit()
            time.sleep(1)  # be gentle with the court's server
        old = [i for (i,) in db.query(CauseListFile.id).filter(CauseListFile.list_date < today - timedelta(days=KEEP_DAYS))]
        if old:
            db.query(CauseListEntry).filter(CauseListEntry.file_id.in_(old)).delete(synchronize_session=False)
            db.query(CauseListFile).filter(CauseListFile.id.in_(old)).delete(synchronize_session=False)
            db.commit()
    finally:
        if own:
            client.close()
    return report


def visible_entries(db: Session, workspace_id: int | None):
    """Entries from court-downloaded lists plus lists this account uploaded."""
    mine = db.query(CauseListFile.id).filter((CauseListFile.workspace_id.is_(None)) | (CauseListFile.workspace_id == workspace_id))
    return db.query(CauseListEntry).filter(CauseListEntry.file_id.in_(mine))


def rematch_case(db: Session, case: Case) -> int:
    """After a case/diary number is entered or changed: look for it in the lists already read."""
    keys = case_keys(case)
    if not keys:
        return 0
    entries = [e for e in visible_entries(db, case.workspace_id).filter(CauseListEntry.list_date >= today_ist())
               if set(e.case_keys or []) & keys.keys()]
    n = 0
    for e in entries:
        if not db.query(CauseListMatch.id).filter(CauseListMatch.case_id == case.id, CauseListMatch.entry_id == e.id).first():
            db.add(CauseListMatch(case_id=case.id, entry_id=e.id, matched_by=keys[next(k for k in e.case_keys if k in keys)]))
            n += 1
            if e.kind == "daily" and case.next_hearing != e.list_date:
                case.next_hearing = e.list_date
    return n


HEADER_DATE_RE = re.compile(r"(?:DATED\s*:?|LISTED ON)\s*(\d{2})-(\d{2})-(\d{4})")


def read_header(data: bytes) -> tuple[date, str]:
    """List date and kind from the first page of a cause-list PDF."""
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        first = doc[0].get_text() if doc.page_count else ""
    m = HEADER_DATE_RE.search(first)
    if "SUPREME COURT OF INDIA" not in first.upper() or not m:
        raise ValueError("This does not look like a Supreme Court cause list (no list date on the first page).")
    return date(int(m.group(3)), int(m.group(2)), int(m.group(1))), "advance" if "ADVANCE LIST" in first.upper() else "daily"


def import_list(db: Session, user: User, *, url: str | None = None, data: bytes | None = None) -> dict:
    """Add one cause list by its official link (downloaded from the court, shared) or as an uploaded PDF (this account only)."""
    m = None
    if url:
        m = PDF_RE.fullmatch(url.strip())
        if not m:
            raise ValueError("Paste the PDF link from sci.gov.in -> Cause List (it starts with https://api.sci.gov.in/jonew/cl/).")
        with httpx.Client(headers=UA, follow_redirects=True, timeout=90) as client:
            r = client.get(url.strip())
        if r.status_code != 200 or not r.content.startswith(b"%PDF"):
            raise ValueError(f"The court's server did not return the PDF (HTTP {r.status_code}). Download it and upload the file instead.")
        data, ws, key = r.content, None, url.strip()
    else:
        if not data or not data.startswith(b"%PDF"):
            raise ValueError("Upload the cause list as a PDF.")
        ws, key = user.workspace_id, f"upload:{user.workspace_id}:{hashlib.sha256(data).hexdigest()}"
    list_date, kind = read_header(data)
    if m and m.group(1):
        kind = "advance"
    sha = hashlib.sha256(data).hexdigest()
    f = db.query(CauseListFile).filter(CauseListFile.url == key).first()
    if f and f.sha256 == sha:
        return {"list_date": f.list_date, "kind": f.kind, "items": f.items, "matches": 0, "already": True, "shared": ws is None}
    if f:
        db.query(CauseListEntry).filter(CauseListEntry.file_id == f.id).delete()
    else:
        f = CauseListFile(url=key, list_date=list_date, kind=kind, workspace_id=ws, added_by=user.id)
        db.add(f)
    items = parse_pdf(data, kind)
    f.sha256, f.items, f.error, f.fetched_at = sha, len(items), "", datetime.utcnow()
    db.flush()
    rows = [CauseListEntry(file_id=f.id, list_date=list_date, kind=kind, **it) for it in items]
    db.add_all(rows)
    db.flush()
    found = match_cases(db, rows, workspace_id=ws)
    db.commit()
    return {"list_date": list_date, "kind": kind, "items": len(items), "matches": found, "already": False, "shared": ws is None}


def entry_dict(e: CauseListEntry) -> dict:
    return {"id": e.id, "list_date": e.list_date, "kind": e.kind, "court": e.court.title() if e.court else "", "bench": e.bench,
            "item_no": e.item_no, "case_no": e.case_no, "parties": e.parties, "remarks": e.remarks[:400],
            "page": e.page, "description": _describe(e)}
