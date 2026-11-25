"""Hearing workflow: cause-list listings, hearing notes, follow-up tasks, calendar feed, courtroom brief, chamber view."""

import hashlib
import re
import secrets
from urllib.parse import urlparse
import threading
from datetime import date, datetime, timedelta

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import String, cast
from sqlalchemy.orm import Session

from ..auth import member
from ..config import settings
from ..db import SessionLocal, get_db
from ..models import (Case, CauseListEntry, CauseListFile, CauseListMatch, Document, FileMovement, HearingNote,
                      MatterReference, Task, User)
from ..services import access, ai_log, causelist, llm, notify, orders, storage
from ..services.pipeline import enqueue
from ..services.retrieval import SearchFilters, search
from .cases import apply_changes, matter_user
from .matters import TaskIn, create_task, person

router = APIRouter(prefix="/api", tags=["hearings"])

OUTCOMES = ("", "adjourned", "notice issued", "heard - part heard", "heard - reserved", "admitted", "leave granted",
            "interim order", "disposed", "dismissed", "withdrawn", "not reached", "other")


# ---------------------------------------------------------------- matter hearings

def note_dict(n: HearingNote) -> dict:
    return {k: getattr(n, k) for k in ("id", "hearing_date", "court", "bench", "item_no", "outcome", "notes", "next_date",
                                       "dictated", "document_id", "created_at", "updated_at")} | {"author": person(n.author)}


@router.get("/matters/{case_id}/hearings")
def hearings(case_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    notes = db.query(HearingNote).filter(HearingNote.case_id == case.id).order_by(HearingNote.hearing_date.desc(), HearingNote.id.desc()).all()
    matches = db.query(CauseListMatch).filter(CauseListMatch.case_id == case.id).all()
    listings = sorted((causelist.entry_dict(m.entry) | {"matched_by": m.matched_by} for m in matches),
                      key=lambda x: (x["list_date"], x["kind"]), reverse=True)
    return {"notes": [note_dict(n) for n in notes], "listings": listings, "outcomes": OUTCOMES,
            "tracking": {"case_number": case.case_number, "diary_no": case.diary_no,
                         "keys": sorted(causelist.case_keys(case)), "last_read": _last_read(db)}}


class NoteIn(BaseModel):
    hearing_date: date
    court: str = Field("", max_length=120)
    bench: str = Field("", max_length=300)
    item_no: str = Field("", max_length=20)
    outcome: str = Field("", max_length=30)
    notes: str = Field("", max_length=20000)
    next_date: date | None = None
    dictated: bool = False
    document_id: int | None = None


@router.post("/matters/{case_id}/hearings")
def add_note(case_id: int, body: NoteIn, user: User = Depends(matter_user), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    if body.document_id and not db.query(Document.id).filter(Document.id == body.document_id, Document.case_id == case.id).first():
        raise HTTPException(400, "That order is not on this matter.")
    n = HearingNote(case_id=case.id, created_by=user.id, **body.model_dump())
    db.add(n)
    db.flush()
    access.log(db, case, user, "hearing_noted", date=f"{body.hearing_date:%d %b %Y}", outcome=body.outcome or "noted")
    if body.next_date and body.next_date != case.next_hearing:
        apply_changes(db, user, case, {"next_hearing": body.next_date}, note=" (hearing note)")
    notify.notify(db, access.matter_people(db, case), f"{user.name} added the hearing note of {body.hearing_date:%d %b} on \"{case.title}\"",
                  case_id=case.id, kind="hearing_note", link=f"/matter?id={case.id}", exclude=user)
    db.commit()
    db.refresh(n)
    return note_dict(n)


@router.patch("/matters/{case_id}/hearings/{note_id}")
def edit_note(case_id: int, note_id: int, body: NoteIn, user: User = Depends(matter_user), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    n = db.get(HearingNote, note_id)
    if not n or n.case_id != case.id:
        raise HTTPException(404, "Hearing note not found.")
    for k, v in body.model_dump().items():
        setattr(n, k, v)
    n.updated_at = datetime.utcnow()
    if body.next_date and body.next_date != case.next_hearing:
        apply_changes(db, user, case, {"next_hearing": body.next_date}, note=" (hearing note)")
    db.commit()
    return note_dict(n)


@router.delete("/matters/{case_id}/hearings/{note_id}")
def delete_note(case_id: int, note_id: int, user: User = Depends(matter_user), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    n = db.get(HearingNote, note_id)
    if n and n.case_id == case.id:
        if n.created_by != user.id and not access.can_manage(db, user, case):
            raise HTTPException(403, "Only the author or the matter lead can delete a hearing note.")
        db.delete(n)
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- orders

@router.post("/matters/{case_id}/orders")
async def add_order(case_id: int, background: BackgroundTasks, file: UploadFile | None = File(None), url: str = Form(""),
                    user: User = Depends(matter_user), db: Session = Depends(get_db)):
    """An order of the Court, by its sci.gov.in link (opened by the advocate) or as a PDF: kept on the matter, and read
    into a draft hearing note - date, court, item, coram, what was ordered, next date - for the advocate to check and save."""
    case = access.case_for(db, user, case_id)
    if url.strip():
        u = urlparse(url.strip())
        if u.scheme != "https" or u.hostname not in orders.ALLOWED_HOSTS:
            raise HTTPException(400, "Paste the order's PDF link from sci.gov.in, or upload the PDF.")
        try:
            r = httpx.get(url.strip(), headers=causelist.UA, follow_redirects=True, timeout=60)
        except httpx.HTTPError:
            raise HTTPException(400, "The Supreme Court site could not be reached. Download the order and upload it.")
        if r.status_code != 200 or not r.content.startswith(b"%PDF"):
            raise HTTPException(400, f"The Supreme Court site did not return the PDF (HTTP {r.status_code}). Download it and upload it instead.")
        data = r.content
    elif file:
        data = await file.read()
    else:
        raise HTTPException(400, "Paste the order's link or choose the PDF.")
    if len(data) > 30 * 1024 * 1024 or not data.startswith(b"%PDF"):
        raise HTTPException(400, "Upload the order as a PDF (up to 30 MB).")
    try:
        parsed = orders.parse_order(data)
    except Exception:
        raise HTTPException(400, "This PDF could not be read.")
    sha = hashlib.sha256(data).hexdigest()
    storage.write(data, sha, ".pdf")
    name = f"Order {parsed['order_date']:%d.%m.%Y}.pdf" if parsed["order_date"] else (file.filename if file else "Order.pdf")
    d = db.query(Document).filter(Document.case_id == case.id, Document.sha256 == sha).first()
    if not d:
        d = Document(workspace_id=case.workspace_id, case_id=case.id, filename=name, sha256=sha, uploaded_by=user.id, status="queued",
                     meta={"doc_type": "order", "source_url": url.strip() or None,
                           "order_date": parsed["order_date"].isoformat() if parsed["order_date"] else None})
        db.add(d)
        db.flush()
        enqueue(background, d, False)  # text for search only - no AI
        access.log(db, case, user, "order_added", document=name, document_id=d.id)
    db.commit()
    return {**parsed, "document_id": d.id, "filename": d.filename,
            "already_noted": db.query(HearingNote.id).filter(HearingNote.document_id == d.id).first() is not None}


# ---------------------------------------------------------------- follow-up tasks from a hearing note

ACTION_RULES = [  # what an order commonly directs -> a task (zero tokens)
    (r"counter[\s-]*affidavit|reply affidavit|\breply\b", "File counter affidavit / reply"),
    (r"rejoinder", "File rejoinder"),
    (r"written submissions?|synopsis", "File written submissions"),
    (r"additional documents?|\bannexures?\b", "File additional documents"),
    (r"notice (?:is )?issued|issue notice|dasti", "Serve notice and file proof of service"),
    (r"\bservice\b|serve", "Complete service and file proof of service"),
    (r"compilation|convenience compilation|paper ?books?", "Prepare and file the compilation"),
    (r"translation|translated", "File translations of vernacular documents"),
    (r"status report", "Obtain and file the status report"),
    (r"vakalatnama|memo of appearance", "File vakalatnama / memo of appearance"),
    (r"defects?", "Cure registry defects"),
    (r"certified cop", "Obtain certified copy"),
]
WITHIN_RE = re.compile(r"within\s+(\d{1,3}|one|two|three|four|six|eight)\s+(day|week|month)s?", re.I)
WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "six": 6, "eight": 8}

TASKS_SYSTEM = (
    "From an advocate's own note of a Supreme Court hearing, list the follow-up actions the note records or the order "
    "clearly directs (for example: file counter affidavit within four weeks; serve notice; inform the client of the next "
    "date). Only actions stated or plainly required by what is written. Do not predict the outcome of the case, assess "
    "chances, or suggest strategy. due_in_days is the period the note states, or null if none. for_client is true only "
    "for something the client must provide. At most 8 actions, each a short imperative title."
)
TASKS_SCHEMA = {
    "type": "object",
    "properties": {"tasks": {"type": "array", "items": {"type": "object", "properties": {
        "title": {"type": "string"}, "details": {"type": "string"}, "due_in_days": {"type": ["integer", "null"]},
        "for_client": {"type": "boolean"}}}}},
}


def _rule_tasks(n: HearingNote) -> list[dict]:
    text = f"{n.outcome}. {n.notes}"
    out = []
    m = WITHIN_RE.search(text)
    days = None
    if m:
        k = int(m.group(1)) if m.group(1).isdigit() else WORDS[m.group(1).lower()]
        days = k * {"day": 1, "week": 7, "month": 30}[m.group(2).lower()]
    for rx, title in ACTION_RULES:
        if re.search(rx, text, re.I) and title not in (t["title"] for t in out):
            out.append({"title": title, "details": "", "due_date": n.hearing_date + timedelta(days=days) if days else None,
                        "for_client": False, "source": "rule"})
    if n.next_date:
        out.append({"title": f"Prepare for the hearing on {n.next_date:%d %b %Y}", "details": "Update the brief and compilation.",
                    "due_date": max(n.hearing_date, n.next_date - timedelta(days=2)), "for_client": False, "source": "rule"})
        out.append({"title": f"Inform the client of the next date ({n.next_date:%d %b %Y})", "details": "",
                    "due_date": n.hearing_date + timedelta(days=1), "for_client": False, "source": "rule"})
    return out


class SuggestIn(BaseModel):
    ai: bool = False


@router.post("/matters/{case_id}/hearings/{note_id}/suggest-tasks")
def suggest_tasks(case_id: int, note_id: int, body: SuggestIn, user: User = Depends(matter_user), db: Session = Depends(get_db)):
    """Proposed follow-up tasks. Nothing is created until the advocate picks them (human in the loop)."""
    case = access.case_for(db, user, case_id)
    n = db.get(HearingNote, note_id)
    if not n or n.case_id != case.id:
        raise HTTPException(404, "Hearing note not found.")
    out = _rule_tasks(n)
    log_id = None
    if body.ai and n.notes.strip():
        if not settings.ai_enabled:
            raise HTTPException(503, "AI is not configured on this server.")
        res = llm.ask(db, feature="hearing_tasks", system=TASKS_SYSTEM, schema=TASKS_SCHEMA, max_tokens=1500, think=False,
                      user=f"Hearing on {n.hearing_date:%d %b %Y}. Outcome: {n.outcome or 'not stated'}. "
                           f"Next date: {n.next_date or 'not fixed'}.\nNote:\n{n.notes[:8000]}", workspace_id=user.workspace_id)
        log_id = ai_log.record(db, feature="hearing_tasks", output=res, user=user, case_id=case.id, prompt=f"Hearing note {n.id}")
        seen = {t["title"].lower() for t in out}
        for t in res.get("tasks", [])[:8]:
            if t["title"].lower() in seen:
                continue
            due = n.hearing_date + timedelta(days=t["due_in_days"]) if t.get("due_in_days") else None
            out.append({"title": t["title"][:300], "details": t.get("details", "")[:500], "due_date": due,
                        "for_client": bool(t.get("for_client")), "source": "ai"})
    open_titles = {t.title.lower() for t in db.query(Task).filter(Task.case_id == case.id, Task.status == "open")}
    for t in out:
        t["exists"] = t["title"].lower() in open_titles
    return {"suggestions": out, "ai_log_id": log_id}


class TasksIn(BaseModel):
    tasks: list[TaskIn] = Field(min_length=1, max_length=20)


@router.post("/matters/{case_id}/tasks/bulk")
def create_tasks(case_id: int, body: TasksIn, user: User = Depends(member), db: Session = Depends(get_db)):
    return [create_task(case_id, t, user, db) for t in body.tasks]


# ---------------------------------------------------------------- cause lists

def _last_read(db: Session) -> datetime | None:
    row = db.query(CauseListFile.fetched_at).order_by(CauseListFile.fetched_at.desc()).first()
    return row[0] if row else None


@router.get("/causelist/mine")
def my_listings(user: User = Depends(member), db: Session = Depends(get_db)):
    """Upcoming listings: matters in Nyay Apex, plus anything listed under the user's AOR code."""
    today = causelist.today_ist()
    visible = {c.id: c for c in db.query(Case).filter(access.visible_cases_filter(user))}
    matched = db.query(CauseListMatch).filter(CauseListMatch.case_id.in_(list(visible))).all() if visible else []
    linked = {}
    for m in matched:
        if m.entry.list_date >= today:
            linked.setdefault(m.entry_id, causelist.entry_dict(m.entry) | {"case_id": m.case_id, "case": visible[m.case_id].title})
    code = str((user.profile or {}).get("aor_code") or "").strip()
    aor = []
    if code.isdigit():
        q = causelist.visible_entries(db, user.workspace_id).filter(
            CauseListEntry.list_date >= today, cast(CauseListEntry.aor_codes, String).like(f'%"{code}"%'))
        aor = [causelist.entry_dict(e) for e in q.order_by(CauseListEntry.list_date).limit(200) if e.id not in linked]
    key = lambda x: (x["list_date"], x["kind"] != "daily", x["court"], x["item_no"])  # noqa: E731
    return {"matters": sorted(linked.values(), key=key), "aor_code": code or None, "aor_listings": sorted(aor, key=key),
            "last_read": _last_read(db), "source": causelist.INDEX_URL}


@router.post("/causelist/import")
async def import_list(file: UploadFile | None = File(None), url: str = Form(""), user: User = Depends(matter_user),
                      db: Session = Depends(get_db)):
    """Add a cause list: paste its sci.gov.in PDF link (read from the court, shared with everyone) or upload the PDF
    (matched only to this account's matters)."""
    data = await file.read() if file else None
    if data and len(data) > 40 * 1024 * 1024:
        raise HTTPException(413, "PDF larger than 40 MB.")
    if not url.strip() and not data:
        raise HTTPException(400, "Paste the PDF link or choose the PDF.")
    try:
        return causelist.import_list(db, user, url=url.strip() or None, data=data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # unreadable PDF
        raise HTTPException(400, f"Could not read this cause list: {str(e)[:200]}")


_sync_lock = threading.Lock()


def _sync_in_background() -> None:
    if not _sync_lock.acquire(blocking=False):
        return
    try:
        db = SessionLocal()
        try:
            causelist.sync(db)
        finally:
            db.close()
    finally:
        _sync_lock.release()


@router.post("/causelist/refresh")
def refresh(user: User = Depends(member), db: Session = Depends(get_db)):
    """Read the cause lists now (normally done by the scheduled job). At most once every 15 minutes."""
    last = _last_read(db)
    if _sync_lock.locked():
        return {"started": False, "message": "Already reading the cause lists - check again in a minute."}
    if last and datetime.utcnow() - last < timedelta(minutes=15):
        return {"started": False, "message": f"The lists were read at {last:%H:%M} UTC; new lists are checked every few hours."}
    threading.Thread(target=_sync_in_background, daemon=True).start()
    return {"started": True, "message": "Reading the published cause lists. Listings appear here in a minute or two."}


# ---------------------------------------------------------------- calendar feed (Google / Outlook / Apple subscribe)

class CalendarIn(BaseModel):
    regenerate: bool = False
    show_titles: bool | None = None


def _feed_url(user: User) -> str:
    return f"{settings.app_url.rstrip('/')}/api/calendar/{user.calendar_token}.ics"


@router.get("/calendar/link")
def calendar_link(user: User = Depends(member)):
    return {"url": _feed_url(user) if user.calendar_token else None,
            "show_titles": bool((user.profile or {}).get("calendar_titles"))}


@router.post("/calendar/link")
def set_calendar(body: CalendarIn, user: User = Depends(member), db: Session = Depends(get_db)):
    if body.regenerate or not user.calendar_token:
        user.calendar_token = secrets.token_urlsafe(24)
    if body.show_titles is not None:
        user.profile = {**(user.profile or {}), "calendar_titles": body.show_titles}
    db.commit()
    return calendar_link(user)


@router.delete("/calendar/link")
def stop_calendar(user: User = Depends(member), db: Session = Depends(get_db)):
    user.calendar_token = None
    db.commit()
    return {"url": None, "show_titles": bool((user.profile or {}).get("calendar_titles"))}


def _ics_text(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


@router.get("/calendar/{token}.ics")
def calendar_feed(token: str, db: Session = Depends(get_db)):
    """Hearings, limitation dates and the user's task due dates as an iCalendar feed. The secret link is the login, so
    by default events carry only the case number - matter names reach Google / Microsoft only if the user opts in."""
    user = db.query(User).filter(User.calendar_token == token).first() if len(token) > 20 else None
    if not user or not user.workspace_id:
        raise HTTPException(404, "Calendar not found.")
    titles = bool((user.profile or {}).get("calendar_titles"))
    cases = db.query(Case).filter(access.visible_cases_filter(user)).all()
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    host = re.sub(r"^https?://", "", settings.app_url).split("/")[0] or "nyayapex"

    def label(c: Case) -> str:
        return c.title if titles else (c.case_number or (f"Diary {c.diary_no}" if c.diary_no else f"Matter #{c.id}"))

    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nyay Apex//Hearings//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", "X-WR-CALNAME:Nyay Apex hearings", "X-WR-TIMEZONE:Asia/Kolkata", "REFRESH-INTERVAL;VALUE=DURATION:PT6H"]

    def add(uid: str, day: date, summary: str, desc: str, link: str) -> None:
        lines.extend(["BEGIN:VEVENT", f"UID:{uid}@{host}", f"DTSTAMP:{stamp}", f"DTSTART;VALUE=DATE:{day:%Y%m%d}",
                      f"DTEND;VALUE=DATE:{day + timedelta(days=1):%Y%m%d}", f"SUMMARY:{_ics_text(summary)}",
                      f"DESCRIPTION:{_ics_text(desc)}", f"URL:{link}", "TRANSP:TRANSPARENT", "END:VEVENT"])

    base = settings.app_url.rstrip("/")
    for c in cases:
        link = f"{base}/matter?id={c.id}"
        if c.next_hearing:
            add(f"hearing-{c.id}-{c.next_hearing:%Y%m%d}", c.next_hearing, f"Hearing: {label(c)}",
                (c.bench or "") + ("\n" if c.bench else "") + "Nyay Apex - open the matter for details.", link)
        if c.limitation_expiry:
            add(f"limitation-{c.id}", c.limitation_expiry, f"Limitation expires: {label(c)}", "Verify the computation before relying on it.", link)
    by_id = {c.id: c for c in cases}
    for t in db.query(Task).filter(Task.assignee_id == user.id, Task.status == "open", Task.due_date.isnot(None)):
        if t.case_id in by_id:
            add(f"task-{t.id}", t.due_date, f"Due: {t.title if titles else 'task'} - {label(by_id[t.case_id])}", "", f"{base}/matter?id={t.case_id}")
    lines.append("END:VCALENDAR")
    body = "\r\n".join(_fold(ln) for ln in lines) + "\r\n"
    return Response(body, media_type="text/calendar; charset=utf-8", headers={"Cache-Control": "private, max-age=900"})


def _fold(line: str) -> str:
    """RFC 5545: lines longer than 75 octets continue on the next line after a space."""
    raw = line.encode()
    if len(raw) <= 75:
        return line
    parts, cur = [], b""
    for ch in line:
        b = ch.encode()
        if len(cur) + len(b) > (75 if not parts else 74):
            parts.append(cur.decode())
            cur = b""
        cur += b
    parts.append(cur.decode())
    return "\r\n ".join(parts)


# ---------------------------------------------------------------- courtroom brief

@router.get("/matters/{case_id}/brief-pack")
def brief_pack(case_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    """Everything to have open at the hearing: details, today's listing, last hearing note, the record's brief, authorities."""
    case = access.case_for(db, user, case_id)
    docs = db.query(Document).filter(Document.case_id == case.id, Document.superseded.is_(False)).order_by(Document.id.desc()).all()
    briefs = [{"document_id": d.id, "filename": d.filename, "summary": (d.brief or {}).get("summary", ""),
               "core_issues": (d.brief or {}).get("core_issues", []), "questions_of_law": (d.brief or {}).get("questions_of_law", []),
               "hearing_points": (d.brief or {}).get("hearing_points", []), "contradictions": (d.brief or {}).get("contradictions", [])}
              for d in docs if d.brief]
    last = db.query(HearingNote).filter(HearingNote.case_id == case.id).order_by(HearingNote.hearing_date.desc(), HearingNote.id.desc()).first()
    today = causelist.today_ist()
    listing = [causelist.entry_dict(m.entry) for m in db.query(CauseListMatch).filter(CauseListMatch.case_id == case.id)
               if m.entry.list_date >= today]
    refs = db.query(MatterReference).filter(MatterReference.case_id == case.id).order_by(MatterReference.id.desc()).limit(20).all()
    rdocs = {d.id: d for d in db.query(Document).filter(Document.id.in_({r.document_id for r in refs if r.document_id}))}
    return {
        "case": {k: getattr(case, k) for k in ("id", "title", "case_type", "case_number", "diary_no", "bench", "stage", "next_hearing")},
        "listing": sorted(listing, key=lambda x: (x["list_date"], x["kind"] != "daily")),
        "last_note": note_dict(last) if last else None,
        "briefs": briefs, "documents": [{"id": d.id, "filename": d.filename, "pages": d.pages} for d in docs],
        "references": [{"title": r.title or ((rdocs[r.document_id].meta or {}).get("title") if r.document_id in rdocs else ""),
                        "citation": r.citation or ((rdocs[r.document_id].meta or {}).get("neutral_citation") if r.document_id in rdocs else ""),
                        "pages": r.pages, "note": r.note, "source_url": (rdocs[r.document_id].meta or {}).get("source_url") if r.document_id in rdocs else None}
                       for r in refs],
        "open_tasks": [{"title": t.title, "due_date": t.due_date} for t in
                       db.query(Task).filter(Task.case_id == case.id, Task.status == "open").order_by(Task.due_date).limit(10)],
    }


# ---------------------------------------------------------------- bench context

COMMON_SURNAMES = {"singh", "kumar", "rao", "sharma", "gupta", "reddy", "khanna", "das", "shah", "mishra", "misra", "nath",
                   "prasad", "chandra", "pandey", "verma", "jain", "iyer", "menon", "nair", "bose", "sen", "roy", "joseph"}


def _judges(bench: str) -> list[str]:
    """'Hon'ble Mr. Justice Joymalya Bagchi, Hon'ble Mrs. Justice V. Mohana' -> ['Joymalya Bagchi', 'V. Mohana']."""
    out = []
    for part in re.split(r",|&| and ", bench or ""):
        m = re.search(r"Justice\s+(.+)$", part.strip(), re.I)
        name = m.group(1).strip(" .") if m else ""
        if name and not name.lower().startswith(("the chief", "chief")):
            out.append(name)
    return out


@router.get("/matters/{case_id}/bench")
def bench_context(case_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    """For each judge on the bench: judgments in the library where that judge sat, on points like this matter's.
    Legal research only - no counts of outcomes, no tendencies, no prediction (SC AI Regulations, Regs 16 and 20)."""
    case = access.case_for(db, user, case_id)
    today = causelist.today_ist()
    listing = next((m.entry for m in db.query(CauseListMatch).filter(CauseListMatch.case_id == case.id)
                    if m.entry.list_date >= today and m.entry.bench), None)
    bench = (listing.bench if listing else "") or case.bench or ""
    docs = db.query(Document).filter(Document.case_id == case.id, Document.superseded.is_(False), Document.brief.isnot(None)).all()
    issues = " ".join(" ".join((d.brief or {}).get("core_issues", [])[:3]) for d in docs)[:400]
    query = f"{case.title} {issues}".strip()
    out = []
    for name in _judges(bench)[:5]:
        words = [w for w in re.findall(r"[A-Za-z]+", name) if len(w) > 1]
        if not words:
            continue
        key = " ".join(words[-2:]) if words[-1].lower() in COMMON_SURNAMES and len(words) > 1 else words[-1]
        hits = search(db, query, user.workspace_id, k=8, filters=SearchFilters(judge=key))
        seen, items = set(), []
        for p, _ in hits:
            d = db.get(Document, p.document_id)
            if d and d.kind == "judgment" and d.id not in seen:
                seen.add(d.id)
                m = d.meta or {}
                items.append({"id": d.id, "title": m.get("title") or d.filename, "year": (m.get("decision_date") or "")[:4],
                              "citation": m.get("neutral_citation") or m.get("scr_citation"), "source_url": m.get("source_url"),
                              "pages": [p.page_start, p.page_end]})
        out.append({"judge": name, "matched_as": key, "judgments": items[:4]})
    return {"bench": bench, "from_listing": bool(listing), "query": query, "judges": out,
            "note": "Judgments in the library where these judges sat, found for this matter's title and issues. "
                    "Research material only; no assessment of how a judge decides."}


# ---------------------------------------------------------------- chamber: registry queue, physical files, alerts

REGISTRY_STAGES = ("Drafting", "Filed", "Defects", "Listed")
DEFECT_CURE_DAYS = 28  # SC Rules 2013, Order XV r.5 - verify against the current rules and registry practice


class MoveIn(BaseModel):
    location: str = Field(min_length=2, max_length=120)
    holder: str = Field("", max_length=120)
    note: str = Field("", max_length=300)


@router.post("/matters/{case_id}/file-movements")
def move_file(case_id: int, body: MoveIn, user: User = Depends(matter_user), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    db.add(FileMovement(case_id=case.id, moved_by=user.id, **body.model_dump()))
    case.file_location = body.location.strip()
    access.log(db, case, user, "file_moved", to=body.location + (f" ({body.holder})" if body.holder else ""))
    db.commit()
    return file_history(case_id, user, db)


@router.get("/matters/{case_id}/file-movements")
def file_history(case_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    rows = db.query(FileMovement).filter(FileMovement.case_id == case.id).order_by(FileMovement.id.desc()).limit(100).all()
    users = {u.id: u for u in db.query(User).filter(User.id.in_({r.moved_by for r in rows}))} if rows else {}
    return {"current": case.file_location, "history": [
        {"id": r.id, "location": r.location, "holder": r.holder, "note": r.note, "moved_at": r.moved_at,
         "by": person(users.get(r.moved_by))} for r in rows]}


@router.get("/chamber")
def chamber(user: User = Depends(matter_user), db: Session = Depends(get_db)):
    today = causelist.today_ist()
    now = datetime.utcnow()
    cases = db.query(Case).filter(access.visible_cases_filter(user)).all()
    last_move = {}
    if cases:
        for m in db.query(FileMovement).filter(FileMovement.case_id.in_([c.id for c in cases])).order_by(FileMovement.id):
            last_move[m.case_id] = m
    queue, files, alerts = [], [], []
    for c in cases:
        days_in_stage = (now - (c.stage_since or c.created_at or now)).days
        row = {"id": c.id, "title": c.title, "case_type": c.case_type, "case_number": c.case_number, "diary_no": c.diary_no,
               "stage": c.stage, "days_in_stage": days_in_stage, "defects": c.defects, "filing_status": c.filing_status,
               "limitation_expiry": c.limitation_expiry, "next_hearing": c.next_hearing}
        if c.stage in REGISTRY_STAGES:
            queue.append(row)
        mv = last_move.get(c.id)
        files.append({"id": c.id, "title": c.title, "location": c.file_location, "holder": mv.holder if mv else "",
                      "since": mv.moved_at if mv else None, "next_hearing": c.next_hearing})
        # Filing alerts - facts and deadlines only, no prediction of what the registry will do
        if c.stage == "Defects" and c.defects:
            left = DEFECT_CURE_DAYS - days_in_stage
            alerts.append({"case_id": c.id, "title": c.title, "level": "bad" if left <= 7 else "warn",
                           "text": f"{c.defects} registry defect(s) open for {days_in_stage} days"
                                   + (f"; about {left} days left of the {DEFECT_CURE_DAYS}-day cure period (verify)" if left > 0
                                      else f"; the {DEFECT_CURE_DAYS}-day cure period has passed (verify)")})
        if c.stage == "Drafting" and c.limitation_expiry and c.limitation_expiry <= today + timedelta(days=15):
            d = (c.limitation_expiry - today).days
            alerts.append({"case_id": c.id, "title": c.title, "level": "bad" if d <= 5 else "warn",
                           "text": "Not filed yet; limitation " + ("expired" if d < 0 else f"expires in {d} day(s)")})
        if c.stage == "Filed" and not c.diary_no:
            alerts.append({"case_id": c.id, "title": c.title, "level": "warn", "text": "Filed but no diary number entered - cause-list tracking is off"})
        if c.next_hearing and today <= c.next_hearing <= today + timedelta(days=2) and not c.file_location:
            alerts.append({"case_id": c.id, "title": c.title, "level": "warn", "text": f"Hearing on {c.next_hearing:%d %b} - physical file location not recorded"})
    queue.sort(key=lambda r: (REGISTRY_STAGES.index(r["stage"]), -r["days_in_stage"]))
    files.sort(key=lambda r: (r["next_hearing"] is None, r["next_hearing"] or date.max))
    return {"queue": queue, "files": files, "alerts": sorted(alerts, key=lambda a: a["level"] != "bad"),
            "defect_cure_days": DEFECT_CURE_DAYS}
