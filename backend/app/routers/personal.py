"""Individual accounts: a person (not an advocate) following their own case.

Plain-language tools on top of the same matters, documents and research as the professional panels:
a home page, and "explain this document in simple words". Information, never legal advice or a forecast.
"""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import require_types
from ..db import get_db
from ..models import Case, Chunk, Document, HearingNote, Task, User
from ..services import access, ai_log, llm
from ..services.prompts import CITIZEN_EXPLAIN_SYSTEM
from .cases import case_dict

router = APIRouter(prefix="/api/personal", tags=["personal"])
individual = require_types("individual")
LANG_NAME = {"en": "English", "hi": "Hindi (Devanagari script; keep names, numbers and section numbers as written)"}
EXPLAIN_CHARS = 60000  # about 25-30 pages; longer documents are explained from their opening part


@router.get("/home")
def home(user: User = Depends(individual), db: Session = Depends(get_db)):
    cases = db.query(Case).filter(access.visible_cases_filter(user)).order_by(Case.next_hearing.is_(None), Case.next_hearing).all()
    ids = [c.id for c in cases]
    today = date.today()
    tasks = (db.query(Task).filter(Task.case_id.in_(ids), Task.status == "open")
             .order_by(Task.due_date.is_(None), Task.due_date).limit(20).all()) if ids else []
    titles = {c.id: c.title for c in cases}
    upcoming = sorted(
        [{"date": c.next_hearing, "kind": "hearing", "text": f"Next date in court: {c.title}", "case_id": c.id}
         for c in cases if c.next_hearing and today <= c.next_hearing <= today + timedelta(days=90)]
        + [{"date": t.due_date, "kind": "task", "text": t.title, "case_id": t.case_id}
           for t in tasks if t.due_date and t.due_date <= today + timedelta(days=90)],
        key=lambda x: x["date"])
    docs = (db.query(Document).filter(Document.workspace_id == user.workspace_id, Document.superseded.isnot(True))
            .order_by(Document.id.desc()).limit(6).all())
    last_notes = {}
    if ids:
        for n in db.query(HearingNote).filter(HearingNote.case_id.in_(ids)).order_by(HearingNote.hearing_date.desc()):
            last_notes.setdefault(n.case_id, {"date": n.hearing_date, "outcome": n.outcome, "notes": n.notes[:200]})
    return {
        "cases": [case_dict(c) | {"last_note": last_notes.get(c.id)} for c in cases],
        "upcoming": upcoming[:12],
        "tasks": [{"id": t.id, "title": t.title, "due_date": t.due_date, "case_id": t.case_id, "case": titles.get(t.case_id)} for t in tasks],
        "documents": [{"id": d.id, "filename": d.filename, "status": d.status, "case_id": d.case_id, "created_at": d.created_at,
                       "case": titles.get(d.case_id)} for d in docs],
    }


class ExplainIn(BaseModel):
    document_id: int
    lang: Literal["en", "hi"] = "en"
    detailed: bool = False


@router.post("/explain")
def explain(body: ExplainIn, user: User = Depends(individual), db: Session = Depends(get_db)):
    d = db.get(Document, body.document_id)
    if not d or d.workspace_id != user.workspace_id or (d.case_id and not access.can_see_case(db, user, db.get(Case, d.case_id))):
        raise HTTPException(404, "Document not found.")
    if d.status in ("queued", "processing"):
        raise HTTPException(409, "The document is still being read. Try again in a minute.")
    chunks = db.query(Chunk).filter(Chunk.document_id == d.id).order_by(Chunk.idx).all()
    text, used = "", 0
    for c in chunks:
        if used + len(c.text) > EXPLAIN_CHARS:
            break
        text += f"[p.{c.page_start}] {c.text}\n"
        used += len(c.text)
    if len(text.strip()) < 40:
        raise HTTPException(422, "No readable text was found in this file. If it is a photo or a scanned copy, "
                                 "type the important parts into 'Ask about the law', or upload a typed/PDF copy.")
    partial = used < sum(len(c.text) for c in chunks)
    access.log_document(db, d, user, "document_explained", lang=body.lang)
    answer = llm.ask(db, feature="explain", system=CITIZEN_EXPLAIN_SYSTEM.format(lang=LANG_NAME[body.lang]),
                     user=f"Document: {d.filename}\n\n{text}", smart=body.detailed, effort="medium" if body.detailed else "low",
                     max_tokens=4000, workspace_id=user.workspace_id)
    log_id = ai_log.record(db, feature="explain", output=answer, user=user, case_id=d.case_id, document_id=d.id,
                           prompt=f"Explain {d.filename} ({body.lang})", sources=[d.filename])
    return {"answer": answer, "ai_log_id": log_id, "partial": partial, "pages": d.pages, "ai_generated": True,
            "disclaimer": "AI explanation of your document, for understanding only. It is not legal advice and may contain "
                          "mistakes: check the original document and confirm with an advocate before acting on it."}
