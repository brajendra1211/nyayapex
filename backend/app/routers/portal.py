"""Client portal: a client sees only matters they were invited to, documents explicitly shared with them,
requests addressed to them, and the client channel of the discussion. Never internal team messages or
unreviewed AI output."""

import hashlib
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..models import Case, ClientAccess, Document, MatterMember, Message, Task, User, Workspace
from ..services import access, notify, storage
from ..services.pipeline import enqueue
from .matters import matter_link, message_dict, person, task_dict

router = APIRouter(prefix="/api/portal", tags=["portal"])
ALLOWED = {".pdf", ".docx", ".jpg", ".jpeg", ".png"}
MAX_MB = 50


def client_user(user: User = Depends(current_user)) -> User:
    if user.kind != "client" or not user.onboarded:
        raise HTTPException(403, "Client portal only.")
    return user


def _leads(db: Session, case: Case) -> list[User]:
    ids = [m.user_id for m in db.query(MatterMember).filter(MatterMember.case_id == case.id, MatterMember.role == "lead")]
    return db.query(User).filter(User.id.in_(ids)).all()


@router.get("/matters")
def my_matters(user: User = Depends(client_user), db: Session = Depends(get_db)):
    from datetime import datetime

    from .auth import client_invites_for

    # Invitations sent after the client's first login are picked up here
    for ca in client_invites_for(db, user):
        ca.user_id, ca.accepted_at = user.id, datetime.utcnow()
    db.commit()
    rows = db.query(ClientAccess).filter(ClientAccess.user_id == user.id, ClientAccess.accepted_at.isnot(None),
                                         ClientAccess.revoked_at.is_(None)).all()
    out = []
    for ca in rows:
        c = ca.case
        ws = db.get(Workspace, c.workspace_id)
        out.append({"id": c.id, "title": c.title, "case_type": c.case_type, "diary_no": c.diary_no, "stage": c.stage,
                    "next_hearing": c.next_hearing, "firm": ws.name if ws else "",
                    "advocates": [person(u)["name"] for u in _leads(db, c)],
                    "open_requests": db.query(Task).filter(Task.case_id == c.id, Task.for_client.is_(True), Task.status == "open").count()})
    return sorted(out, key=lambda m: (m["next_hearing"] is None, m["next_hearing"] or ""))


@router.get("/matters/{case_id}")
def matter(case_id: int, user: User = Depends(client_user), db: Session = Depends(get_db)):
    c = access.client_case(db, user, case_id)
    ws = db.get(Workspace, c.workspace_id)
    docs = db.query(Document).filter(Document.case_id == c.id, Document.shared_with_client.is_(True)).order_by(Document.id.desc())
    reqs = db.query(Task).filter(Task.case_id == c.id, Task.for_client.is_(True)).order_by(Task.status.desc(), Task.due_date)
    return {
        "case": {"id": c.id, "title": c.title, "case_type": c.case_type, "diary_no": c.diary_no, "stage": c.stage,
                 "bench": c.bench, "next_hearing": c.next_hearing},
        "firm": ws.name if ws else "", "advocates": [person(u) for u in _leads(db, c)],
        "documents": [{"id": d.id, "filename": d.filename, "pages": d.pages, "created_at": d.created_at,
                       "from_me": d.uploaded_by == user.id} for d in docs],
        "requests": [task_dict(t) for t in reqs],
    }


@router.get("/matters/{case_id}/messages")
def messages(case_id: int, user: User = Depends(client_user), db: Session = Depends(get_db)):
    c = access.client_case(db, user, case_id)
    rows = db.query(Message).filter(Message.case_id == c.id, Message.channel == "client").order_by(Message.id).all()
    return [message_dict(m) for m in rows[-300:]]


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


@router.post("/matters/{case_id}/messages")
def post_message(case_id: int, body: MessageIn, user: User = Depends(client_user), db: Session = Depends(get_db)):
    c = access.client_case(db, user, case_id)
    m = Message(case_id=c.id, channel="client", author_id=user.id, body=body.body.strip(), attachments=[])
    db.add(m)
    db.flush()
    team = access.matter_people(db, c)
    notify.notify(db, team, f"Client {user.name} wrote on \"{c.title}\": {body.body[:100]}", case_id=c.id,
                  kind="client_message", link=matter_link(c.id))
    notify.notify(db, _leads(db, c), f"New client message on \"{c.title}\"", case_id=c.id, kind="client_message_wa",
                  link=matter_link(c.id), whatsapp=True)
    db.commit()
    db.refresh(m)
    return message_dict(m)


@router.post("/matters/{case_id}/documents")
async def upload(case_id: int, background: BackgroundTasks, file: UploadFile = File(...), task_id: int | None = Form(None),
                 user: User = Depends(client_user), db: Session = Depends(get_db)):
    c = access.client_case(db, user, case_id)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(400, "Upload a PDF, Word document or photo (JPG/PNG).")
    data = await file.read()
    if len(data) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"File larger than {MAX_MB} MB.")
    sha = hashlib.sha256(data).hexdigest()
    storage.write(data, sha, suffix)
    task = db.get(Task, task_id) if task_id else None
    if task and (task.case_id != c.id or not task.for_client):
        raise HTTPException(404, "Request not found.")
    doc = Document(workspace_id=c.workspace_id, case_id=c.id, filename=file.filename or f"upload{suffix}", sha256=sha,
                   uploaded_by=user.id, shared_with_client=True, status="done" if suffix in (".jpg", ".jpeg", ".png") else "queued")
    db.add(doc)
    db.flush()
    if task:
        task.status, task.document_id = "done", doc.id
    access.log(db, c, user, "document_uploaded", document=doc.filename)
    notify.notify(db, access.matter_people(db, c), f"Client {user.name} uploaded \"{doc.filename}\" on \"{c.title}\"",
                  case_id=c.id, kind="client_upload", link=matter_link(c.id))
    if doc.status == "queued":
        enqueue(background, doc, False)  # free Python extraction only - no AI on client uploads
    db.commit()
    return {"id": doc.id, "filename": doc.filename}


@router.get("/documents/{doc_id}/file")
def download(doc_id: int, user: User = Depends(client_user), db: Session = Depends(get_db)):
    d = db.get(Document, doc_id)
    if not d or not d.case_id or not d.shared_with_client:
        raise HTTPException(404, "Document not found.")
    access.client_case(db, user, d.case_id)
    suffix = Path(d.filename).suffix.lower()
    if not storage.exists(d.sha256, suffix):
        raise HTTPException(410, "File no longer available.")
    access.log_document(db, d, user, "document_downloaded")
    db.commit()
    return storage.download(storage.read(d.sha256, suffix), d.filename)
