import hashlib
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import member
from ..db import get_db
from sqlalchemy import or_, select

from ..models import Activity, AIOutput, Case, Chunk, Document, Passage, User
from ..services import access, storage
from ..services import ai_log, llm, passages
from ..services.pipeline import enqueue
from ..services.prompts import QA_SYSTEM
from ..services.retrieval import search

router = APIRouter(prefix="/api/documents", tags=["documents"])
ALLOWED = {".pdf", ".docx", ".txt"}
MAX_MB = 200


def doc_dict(d: Document, full: bool = False) -> dict:
    out = {k: getattr(d, k) for k in ("id", "case_id", "filename", "pages", "status", "error", "stats", "created_at",
                                      "version", "version_of", "version_note", "superseded")}
    if full:
        out.update(chronology=d.chronology or [], citations=d.citations or [], brief=d.brief)
    return out


@router.post("")
async def upload(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    case_id: int | None = Form(None),
    use_ai: bool = Form(True),
    use_batch: bool = Form(False),
    replaces_id: int | None = Form(None),
    version_note: str = Form(""),
    user: User = Depends(member),
    db: Session = Depends(get_db),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(400, f"Only {', '.join(sorted(ALLOWED))} files are supported.")
    data = await file.read()
    if len(data) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"File larger than {MAX_MB} MB.")

    if case_id:
        access.case_for(db, user, case_id)
    older = None
    if replaces_id:  # a revised version of a document already on file
        older = _own(db, replaces_id, user)
        case_id = older.case_id

    sha = hashlib.sha256(data).hexdigest()
    storage.write(data, sha, suffix)

    # Same file already analysed in this account => reuse results, zero tokens
    previous = db.query(Document).filter(Document.workspace_id == user.workspace_id, Document.sha256 == sha,
                                         Document.status == "done").first()
    doc = Document(workspace_id=user.workspace_id, case_id=case_id, filename=file.filename, sha256=sha, uploaded_by=user.id,
                   version_note=version_note.strip()[:300])
    if older:
        if older.sha256 == sha:
            raise HTTPException(409, "This is the same file as the current version.")
        root = older.version_of or older.id
        family = db.query(Document).filter((Document.id == root) | (Document.version_of == root)).all()
        doc.version_of, doc.version = root, max(d.version or 1 for d in family) + 1
        for d in family:
            d.superseded = True  # file, chronology and brief stay as history
        # Search reads only the latest version, so a revised record does not show up twice
        db.query(Passage).filter(Passage.document_id.in_([d.id for d in family])).delete(synchronize_session=False)
        if older.case_id:
            access.log(db, db.get(Case, older.case_id), user, "document_version", document=file.filename, version=doc.version)
    db.add(doc)
    db.commit()
    if previous and (previous.brief or not use_ai):
        doc.pages, doc.chronology, doc.citations, doc.brief = previous.pages, previous.chronology, previous.citations, previous.brief
        doc.stats = {**(previous.stats or {}), "reused_from": previous.id}
        doc.status = "done"
        db.add_all([Chunk(document_id=doc.id, idx=c.idx, page_start=c.page_start, page_end=c.page_end, text=c.text, facts=c.facts)
                    for c in previous.chunks])
        passages.copy(db, previous, doc)
        db.commit()
    else:
        enqueue(background, doc, use_ai, use_batch)
        db.commit()
    return doc_dict(doc)


@router.get("")
def list_documents(case_id: int | None = None, user: User = Depends(member), db: Session = Depends(get_db)):
    visible = select(Case.id).where(access.visible_cases_filter(user))
    q = db.query(Document).filter(Document.workspace_id == user.workspace_id,
                                  or_(Document.case_id.is_(None), Document.case_id.in_(visible)))
    if case_id:
        q = q.filter(Document.case_id == case_id)
    return [doc_dict(d) for d in q.order_by(Document.id.desc()).all()]


@router.get("/{doc_id}")
def get_document(doc_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    d = _own(db, doc_id, user)
    if d.status == "done":
        access.log_document(db, d, user, "document_opened", once_per_minutes=10)
        db.commit()
    out = doc_dict(d, full=True)
    brief_log = db.query(AIOutput.id).filter(AIOutput.document_id == d.id, AIOutput.feature == "doc_brief") \
        .order_by(AIOutput.id.desc()).first()
    out["brief_ai_log_id"] = brief_log[0] if brief_log else None
    return out


@router.delete("/{doc_id}")
def delete_document(doc_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    d = _own(db, doc_id, user)
    db.delete(d)
    db.commit()
    return {"ok": True}


class Question(BaseModel):
    question: str
    deep: bool = False


@router.post("/{doc_id}/ask")
def ask_document(doc_id: int, body: Question, user: User = Depends(member), db: Session = Depends(get_db)):
    d = _own(db, doc_id, user)
    access.log_document(db, d, user, "document_queried", question=body.question[:200])
    db.commit()
    hits = search(db, body.question, user.workspace_id, [doc_id], k=6)
    if not hits:
        return {"answer": "Not found in the uploaded record.", "sources": []}
    excerpts = "\n\n".join(f"[doc:{c.document_id} p.{c.page_start}-{c.page_end}]\n{c.text}" for c, _ in hits)
    answer = llm.ask(db, feature="doc_qa", system=QA_SYSTEM, user=f"Excerpts:\n{excerpts}\n\nQuestion: {body.question}",
                     smart=body.deep, effort="medium" if body.deep else "low", max_tokens=3000, workspace_id=user.workspace_id)
    log_id = ai_log.record(db, feature="doc_qa", output=answer, user=user, case_id=d.case_id, document_id=d.id,
                           prompt=body.question, sources=[f"{d.filename} p.{c.page_start}-{c.page_end}" for c, _ in hits])
    return {"answer": answer, "ai_log_id": log_id, "sources": [{"document_id": c.document_id, "pages": [c.page_start, c.page_end], "score": round(s, 2)} for c, s in hits]}


def _own(db: Session, doc_id: int, user: User) -> Document:
    d = db.get(Document, doc_id)
    if not d or d.workspace_id != user.workspace_id or (d.case_id and not access.can_see_case(db, user, db.get(Case, d.case_id))):
        raise HTTPException(404, "Document not found")
    return d


@router.get("/{doc_id}/versions")
def versions(doc_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    d = _own(db, doc_id, user)
    root = d.version_of or d.id
    rows = db.query(Document).filter((Document.id == root) | (Document.version_of == root)).order_by(Document.version.desc()).all()
    users = {u.id: u for u in db.query(User).filter(User.id.in_({r.uploaded_by for r in rows if r.uploaded_by}))}
    return [{**doc_dict(r), "uploaded_by": (users[r.uploaded_by].name if r.uploaded_by in users else None)} for r in rows]


@router.get("/{doc_id}/access")
def access_history(doc_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    """Who opened, downloaded or questioned this document, and when (all versions)."""
    d = _own(db, doc_id, user)
    root = d.version_of or d.id
    ids = [i for (i,) in db.query(Document.id).filter((Document.id == root) | (Document.version_of == root))]
    rows = db.query(Activity).filter(Activity.document_id.in_(ids)).order_by(Activity.id.desc()).limit(300).all()
    users = {u.id: u for u in db.query(User).filter(User.id.in_({r.user_id for r in rows if r.user_id}))}
    return [{"id": r.id, "action": r.action.removeprefix("document_"), "at": r.created_at, "document_id": r.document_id,
             "who": (users[r.user_id].name or "User") if r.user_id in users else "System",
             "client": users[r.user_id].kind == "client" if r.user_id in users else False,
             "question": (r.detail or {}).get("question")} for r in rows]


@router.get("/{doc_id}/file")
def download(doc_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    d = _own(db, doc_id, user)
    suffix = Path(d.filename).suffix.lower()
    if not storage.exists(d.sha256, suffix):
        raise HTTPException(410, "File no longer available.")
    access.log_document(db, d, user, "document_downloaded")
    db.commit()
    return storage.download(storage.read(d.sha256, suffix), d.filename)
