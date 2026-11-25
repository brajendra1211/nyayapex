"""Matter workspace: team, discussion (team / client channels), documents & sharing, tasks & requests,
references, clients, activity, notifications."""

from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import current_user, member
from ..db import get_db
from ..models import (Activity, Case, ClientAccess, Document, MatterMember, MatterReference, Message, Notification,
                      Task, User)
from ..services import access, notify, otp, passwords
from .auth import ROLE_LABELS

router = APIRouter(prefix="/api", tags=["matters"])


def person(u: User | None) -> dict | None:
    if u is None:
        return None
    return {"id": u.id, "name": u.name or (u.email or u.phone or "User"), "kind": u.kind,
            "role_label": "Client" if u.kind == "client" else ROLE_LABELS.get(u.role or "", u.role)}


def matter_link(case_id: int) -> str:
    return f"/matter?id={case_id}"


def portal_link(case_id: int) -> str:
    return f"/portal/matter?id={case_id}"


def _manage(db: Session, user: User, case: Case) -> None:
    if not access.can_manage(db, user, case):
        raise HTTPException(403, "Only the matter lead, an AOR/senior or the account admin can do this.")


# ---------------------------------------------------------------- overview & team

@router.get("/matters/{case_id}")
def matter(case_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    team = db.query(MatterMember).filter(MatterMember.case_id == case.id).all()
    clients = db.query(ClientAccess).filter(ClientAccess.case_id == case.id, ClientAccess.revoked_at.is_(None)).all()
    can_manage = access.can_manage(db, user, case)
    out = {
        "case": {k: getattr(case, k) for k in ("id", "title", "diary_no", "case_type", "bench", "stage", "priority",
                                                "next_hearing", "limitation_expiry", "filing_status", "defects")},
        "can_manage": can_manage,
        "team": [{**person(m.user), "matter_role": m.role} for m in team if m.user],
        "clients": [{"id": c.id, "name": c.name, "phone": c.phone, "email": c.email,
                     "status": "active" if c.accepted_at else "invited"} for c in clients],
        "counts": {
            "documents": db.query(Document).filter(Document.case_id == case.id, Document.superseded.is_(False)).count(),
            "open_tasks": db.query(Task).filter(Task.case_id == case.id, Task.status == "open").count(),
            "references": db.query(MatterReference).filter(MatterReference.case_id == case.id).count(),
        },
    }
    if can_manage:
        on = {m.user_id for m in team}
        out["available"] = [person(u) for u in db.query(User).filter(User.workspace_id == case.workspace_id,
                                                                      User.onboarded.is_(True)) if u.id not in on]
    return out


class MemberIn(BaseModel):
    user_id: int
    role: Literal["lead", "member"] = "member"


@router.post("/matters/{case_id}/members")
def add_member(case_id: int, body: MemberIn, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    _manage(db, user, case)
    u = db.get(User, body.user_id)
    if not u or u.workspace_id != case.workspace_id:
        raise HTTPException(404, "Team member not found.")
    m = db.query(MatterMember).filter(MatterMember.case_id == case.id, MatterMember.user_id == u.id).first()
    if m:
        m.role = body.role
    else:
        db.add(MatterMember(case_id=case.id, user_id=u.id, role=body.role, added_by=user.id))
        notify.notify(db, [u], f"{user.name} added you to the matter \"{case.title}\"", case_id=case.id,
                      kind="assigned", link=matter_link(case.id), whatsapp=True)
    access.log(db, case, user, "member_added", member=u.name, role=body.role)
    db.commit()
    return {"ok": True}


@router.delete("/matters/{case_id}/members/{user_id}")
def remove_member(case_id: int, user_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    _manage(db, user, case)
    m = db.query(MatterMember).filter(MatterMember.case_id == case.id, MatterMember.user_id == user_id).first()
    if m:
        access.log(db, case, user, "member_removed", member=m.user.name if m.user else user_id)
        db.delete(m)
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- discussion

def _validate_attachments(db: Session, user: User, case: Case, items: list[dict], for_client: bool) -> list[dict]:
    out = []
    for a in items[:10]:
        kind = a.get("type")
        if kind in ("document", "judgment"):
            d = db.get(Document, int(a.get("id") or 0))
            if not d or (d.workspace_id not in (None, case.workspace_id)):
                raise HTTPException(400, "Attachment not found.")
            if for_client and d.workspace_id is not None and not d.shared_with_client:
                raise HTTPException(400, f"\"{d.filename}\" is not shared with the client. Share it first.")
            m = d.meta or {}
            out.append({"type": "judgment" if d.kind == "judgment" else "document", "id": d.id,
                        "label": (m.get("title") or d.filename)[:200],
                        "citation": m.get("neutral_citation") or m.get("scr_citation")})
        elif kind == "citation" and a.get("label"):
            out.append({"type": "citation", "label": str(a["label"])[:200]})
    return out


class MessageIn(BaseModel):
    channel: Literal["team", "client"] = "team"
    body: str = Field(min_length=1, max_length=5000)
    attachments: list[dict] = []


def message_dict(m: Message) -> dict:
    return {"id": m.id, "channel": m.channel, "body": m.body, "attachments": m.attachments or [],
            "author": person(m.author), "created_at": m.created_at}


@router.get("/matters/{case_id}/messages")
def messages(case_id: int, channel: Literal["team", "client"] = "team", user: User = Depends(member),
             db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    rows = db.query(Message).filter(Message.case_id == case.id, Message.channel == channel).order_by(Message.id).all()
    return [message_dict(m) for m in rows[-300:]]


@router.post("/matters/{case_id}/messages")
def post_message(case_id: int, body: MessageIn, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    if body.channel == "client":
        _manage(db, user, case)  # what the client hears comes from the lead / senior side
    m = Message(case_id=case.id, channel=body.channel, author_id=user.id, body=body.body.strip(),
                attachments=_validate_attachments(db, user, case, body.attachments, body.channel == "client"))
    db.add(m)
    db.flush()
    if body.channel == "team":
        mentioned = [u for u in access.matter_people(db, case) if u.name and f"@{u.name.split()[0].lower()}" in body.body.lower()]
        notify.notify(db, access.matter_people(db, case), f"{user.name} in \"{case.title}\": {body.body[:120]}",
                      case_id=case.id, kind="message", link=matter_link(case.id), exclude=user)
        notify.notify(db, mentioned, f"{user.name} mentioned you in \"{case.title}\"", case_id=case.id,
                      kind="mention", link=matter_link(case.id), whatsapp=True, exclude=user)
    else:
        notify.notify(db, access.matter_clients(db, case), f"New message from your advocate on \"{case.title}\"",
                      case_id=case.id, kind="message", link=portal_link(case.id), whatsapp=True)
    db.commit()
    db.refresh(m)
    return message_dict(m)


# ---------------------------------------------------------------- documents & sharing

def doc_brief(d: Document) -> dict:
    return {"id": d.id, "filename": d.filename, "pages": d.pages, "status": d.status,
            "shared_with_client": d.shared_with_client, "created_at": d.created_at,
            "version": d.version or 1, "version_note": d.version_note or "", "superseded": bool(d.superseded)}


@router.get("/matters/{case_id}/documents")
def matter_documents(case_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    docs = db.query(Document).filter(Document.case_id == case.id).order_by(Document.id.desc()).all()
    uploaders = {u.id: u for u in db.query(User).filter(User.id.in_({d.uploaded_by for d in docs if d.uploaded_by}))}
    # Latest version of each document, with its earlier versions underneath
    history: dict[int, list[dict]] = {}
    for d in docs:
        if d.superseded:
            history.setdefault(d.version_of or d.id, []).append({**doc_brief(d), "uploaded_by": person(uploaders.get(d.uploaded_by))})
    return [{**doc_brief(d), "uploaded_by": person(uploaders.get(d.uploaded_by)),
             "history": sorted(history.get(d.version_of or d.id, []), key=lambda x: -x["version"])}
            for d in docs if not d.superseded]


class ShareIn(BaseModel):
    shared_with_client: bool


@router.patch("/matters/{case_id}/documents/{doc_id}")
def share_document(case_id: int, doc_id: int, body: ShareIn, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    _manage(db, user, case)
    d = db.get(Document, doc_id)
    if not d or d.case_id != case.id:
        raise HTTPException(404, "Document not found on this matter.")
    if d.shared_with_client != body.shared_with_client:
        d.shared_with_client = body.shared_with_client
        access.log(db, case, user, "document_shared" if body.shared_with_client else "document_unshared", document=d.filename)
        if body.shared_with_client:
            notify.notify(db, access.matter_clients(db, case), f"A document was shared with you on \"{case.title}\"",
                          case_id=case.id, kind="document", link=portal_link(case.id), whatsapp=True)
    db.commit()
    return doc_brief(d)


class AttachIn(BaseModel):
    document_id: int


@router.post("/matters/{case_id}/documents/attach")
def attach_document(case_id: int, body: AttachIn, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    d = db.get(Document, body.document_id)
    if not d or d.workspace_id != case.workspace_id:
        raise HTTPException(404, "Document not found.")
    d.case_id = case.id
    access.log(db, case, user, "document_linked", document=d.filename)
    db.commit()
    return doc_brief(d)


# ---------------------------------------------------------------- tasks & requests

class TaskIn(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    details: str = ""
    kind: Literal["task", "document_request"] = "task"
    assignee_id: int | None = None
    for_client: bool = False
    due_date: date | None = None


def task_dict(t: Task) -> dict:
    return {"id": t.id, "title": t.title, "details": t.details, "kind": t.kind, "for_client": t.for_client,
            "assignee": person(t.assignee), "due_date": t.due_date, "status": t.status, "document_id": t.document_id,
            "created_at": t.created_at, "done_at": t.done_at}


@router.get("/matters/{case_id}/tasks")
def tasks(case_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    return [task_dict(t) for t in db.query(Task).filter(Task.case_id == case.id).order_by(Task.status.desc(), Task.due_date, Task.id)]


@router.post("/matters/{case_id}/tasks")
def create_task(case_id: int, body: TaskIn, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    assignee = None
    if body.for_client:
        _manage(db, user, case)
    elif body.assignee_id:
        assignee = db.get(User, body.assignee_id)
        if not assignee or assignee.workspace_id != case.workspace_id:
            raise HTTPException(404, "Assignee not found.")
    t = Task(case_id=case.id, title=body.title.strip(), details=body.details.strip(), kind=body.kind,
             assignee_id=assignee.id if assignee else None, for_client=body.for_client, due_date=body.due_date,
             created_by=user.id)
    db.add(t)
    db.flush()
    due = f" (due {body.due_date:%d %b})" if body.due_date else ""
    if body.for_client:
        notify.notify(db, access.matter_clients(db, case), f"Your advocate requested: {t.title}{due}", case_id=case.id,
                      kind="request", link=portal_link(case.id), whatsapp=True)
    elif assignee:
        notify.notify(db, [assignee], f"{user.name} assigned you \"{t.title}\"{due} on \"{case.title}\"", case_id=case.id,
                      kind="task", link=matter_link(case.id), whatsapp=True, exclude=user)
    access.log(db, case, user, "task_created", task=t.title, for_client=body.for_client)
    db.commit()
    db.refresh(t)
    return task_dict(t)


class TaskPatch(BaseModel):
    status: Literal["open", "done"]


@router.patch("/matters/{case_id}/tasks/{task_id}")
def update_task(case_id: int, task_id: int, body: TaskPatch, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    t = db.get(Task, task_id)
    if not t or t.case_id != case.id:
        raise HTTPException(404, "Task not found.")
    t.status, t.done_at = body.status, (datetime.utcnow() if body.status == "done" else None)
    access.log(db, case, user, f"task_{body.status}", task=t.title)
    db.commit()
    return task_dict(t)


# ---------------------------------------------------------------- references

class ReferenceIn(BaseModel):
    document_id: int | None = None
    citation: str = ""
    title: str = ""
    note: str = ""
    pages: str = ""


def ref_dict(r: MatterReference, d: Document | None) -> dict:
    m = (d.meta or {}) if d else {}
    return {"id": r.id, "document_id": r.document_id, "title": r.title or m.get("title") or (d.filename if d else ""),
            "citation": r.citation or m.get("neutral_citation") or m.get("scr_citation") or "",
            "decision_date": m.get("decision_date"), "source_url": m.get("source_url"), "note": r.note, "pages": r.pages,
            "created_at": r.created_at}


@router.get("/matters/{case_id}/references")
def references(case_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    refs = db.query(MatterReference).filter(MatterReference.case_id == case.id).order_by(MatterReference.id.desc()).all()
    docs = {d.id: d for d in db.query(Document).filter(Document.id.in_({r.document_id for r in refs if r.document_id}))}
    return [ref_dict(r, docs.get(r.document_id)) for r in refs]


@router.post("/matters/{case_id}/references")
def add_reference(case_id: int, body: ReferenceIn, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    d = None
    if body.document_id:
        d = db.get(Document, body.document_id)
        if not d or d.workspace_id not in (None, case.workspace_id):
            raise HTTPException(404, "Judgment not found.")
    elif not body.citation.strip():
        raise HTTPException(400, "Give a judgment or a citation.")
    if d and db.query(MatterReference).filter(MatterReference.case_id == case.id, MatterReference.document_id == d.id).first():
        raise HTTPException(409, "Already saved to this matter.")
    r = MatterReference(case_id=case.id, document_id=d.id if d else None, citation=body.citation.strip()[:120],
                        title=body.title.strip()[:300], note=body.note.strip(), pages=body.pages[:20], added_by=user.id)
    db.add(r)
    access.log(db, case, user, "reference_added", reference=r.title or r.citation or (d.filename if d else ""))
    db.commit()
    return ref_dict(r, d)


@router.delete("/matters/{case_id}/references/{ref_id}")
def delete_reference(case_id: int, ref_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    r = db.get(MatterReference, ref_id)
    if r and r.case_id == case.id:
        db.delete(r)
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- clients

class ClientIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str | None = None
    email: str | None = None


@router.post("/matters/{case_id}/clients")
def invite_client(case_id: int, body: ClientIn, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    _manage(db, user, case)
    if not (body.phone or body.email):
        raise HTTPException(400, "Enter the client's mobile number or email.")
    phone = otp.normalize_phone(body.phone) if body.phone else None
    email = passwords.normalize_email(body.email) if body.email else None
    existing = db.query(User).filter((User.phone == phone) if phone else (User.email == email)).first()
    if existing and existing.kind != "client" and existing.onboarded:
        raise HTTPException(409, "This number/email belongs to a professional Nyay Apex account, not a client.")
    q = db.query(ClientAccess).filter(ClientAccess.case_id == case.id,
                                      (ClientAccess.phone == phone) if phone else (ClientAccess.email == email))
    ca = q.first() or ClientAccess(case_id=case.id, phone=phone, email=email)
    ca.name, ca.invited_by, ca.revoked_at = body.name.strip(), user.id, None
    db.add(ca)
    if existing and existing.kind == "client" and existing.onboarded:  # already a portal user: link right away
        ca.user_id, ca.accepted_at = existing.id, datetime.utcnow()
        notify.notify(db, [existing], f"You now have access to \"{case.title}\" on Nyay Apex", case_id=case.id,
                      kind="access", link=portal_link(case.id), whatsapp=True)
    access.log(db, case, user, "client_invited", client=ca.name)
    db.commit()
    return {"id": ca.id, "status": "active" if ca.accepted_at else "invited",
            "message": "Client added." if ca.accepted_at else "Invited. The client joins by logging in with this mobile number / email."}


@router.delete("/matters/{case_id}/clients/{access_id}")
def revoke_client(case_id: int, access_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    _manage(db, user, case)
    ca = db.get(ClientAccess, access_id)
    if ca and ca.case_id == case.id and not ca.revoked_at:
        ca.revoked_at = datetime.utcnow()
        access.log(db, case, user, "client_revoked", client=ca.name)
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- activity

ACTION_TEXT = {
    "member_added": "added {member} to the team", "member_removed": "removed {member} from the team",
    "document_shared": "shared \"{document}\" with the client", "document_unshared": "stopped sharing \"{document}\"",
    "document_linked": "linked \"{document}\"", "document_uploaded": "uploaded \"{document}\"",
    "task_created": "created \"{task}\"", "task_done": "completed \"{task}\"", "task_open": "reopened \"{task}\"",
    "reference_added": "saved reference \"{reference}\"", "client_invited": "invited client {client}",
    "client_revoked": "removed client access for {client}", "hearing_changed": "changed next hearing to {to}",
    "case_updated": "updated the matter", "document_viewed": "viewed \"{document}\"",
    "document_version": "uploaded version {version} of \"{document}\"", "hearing_noted": "added the hearing note of {date} ({outcome})",
    "file_moved": "moved the physical file to {to}", "order_added": "added the order \"{document}\"", "document_opened": "opened \"{document}\"",
    "document_downloaded": "downloaded \"{document}\"", "document_queried": "asked a question on \"{document}\"",
}


@router.get("/matters/{case_id}/activity")
def activity(case_id: int, user: User = Depends(member), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    rows = db.query(Activity).filter(Activity.case_id == case.id).order_by(Activity.id.desc()).limit(200).all()
    users = {u.id: u for u in db.query(User).filter(User.id.in_({r.user_id for r in rows if r.user_id}))}
    out = []
    for r in rows:
        try:
            text_ = ACTION_TEXT.get(r.action, r.action).format(**{k: v for k, v in (r.detail or {}).items()})
        except (KeyError, IndexError):
            text_ = r.action
        out.append({"id": r.id, "who": person(users.get(r.user_id)), "text": text_, "at": r.created_at})
    return out


# ---------------------------------------------------------------- notifications (professionals and clients)

@router.get("/notifications")
def notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Notification).filter(Notification.user_id == user.id).order_by(Notification.id.desc()).limit(50).all()
    return {"unread": db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)).count(),
            "items": [{"id": n.id, "text": n.text, "link": n.link, "kind": n.kind, "read": n.read_at is not None,
                       "created_at": n.created_at} for n in rows]}


@router.post("/notifications/read")
def mark_read(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)) \
        .update({Notification.read_at: datetime.utcnow()})
    db.commit()
    return {"ok": True}
