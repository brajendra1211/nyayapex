"""Who can see which matter.

Professionals: same workspace AND (a "full access" role, or the firm allows everyone, or they're on the matter team).
Clients: only matters they were invited to and accepted (ClientAccess, not revoked).
"""

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import Activity, Case, ClientAccess, Document, MatterMember, User

FULL_ACCESS_ROLES = {"owner", "aor", "senior", "gc", "counsel"}


def sees_all_matters(user: User) -> bool:
    ws = user.workspace
    if ws is None:
        return False
    if ws.type in ("advocate", "student", "individual") or user.role in FULL_ACCESS_ROLES:
        return True
    return (ws.details or {}).get("junior_scope", "assigned") == "all"


def visible_cases_filter(user: User):
    """SQLAlchemy filter for Case rows this professional may see."""
    base = Case.workspace_id == user.workspace_id
    if sees_all_matters(user):
        return base
    mine = select(MatterMember.case_id).where(MatterMember.user_id == user.id)
    return base & Case.id.in_(mine)


def can_see_case(db: Session, user: User, case: Case | None) -> bool:
    if case is None or case.workspace_id != user.workspace_id:
        return False
    if sees_all_matters(user):
        return True
    return db.query(MatterMember.id).filter(MatterMember.case_id == case.id, MatterMember.user_id == user.id).first() is not None


def case_for(db: Session, user: User, case_id: int) -> Case:
    case = db.get(Case, case_id)
    if not can_see_case(db, user, case):
        raise HTTPException(404, "Matter not found.")
    return case


def can_manage(db: Session, user: User, case: Case) -> bool:
    """Add/remove team, invite clients, share with client: full-access roles or the matter lead."""
    if user.role in FULL_ACCESS_ROLES or (user.workspace and user.workspace.type in ("advocate", "individual")):
        return True
    return db.query(MatterMember.id).filter(MatterMember.case_id == case.id, MatterMember.user_id == user.id,
                                            MatterMember.role == "lead").first() is not None


def client_case(db: Session, user: User, case_id: int) -> Case:
    ok = db.query(ClientAccess.id).filter(ClientAccess.case_id == case_id, ClientAccess.user_id == user.id,
                                          ClientAccess.accepted_at.isnot(None), ClientAccess.revoked_at.is_(None)).first()
    if not ok:
        raise HTTPException(404, "Matter not found.")
    return db.get(Case, case_id)


def matter_people(db: Session, case: Case) -> list[User]:
    """Team members on the matter, plus full-access people in the workspace (they see every matter)."""
    ids = {m.user_id for m in db.query(MatterMember).filter(MatterMember.case_id == case.id)}
    full = db.query(User).filter(User.workspace_id == case.workspace_id,
                                 or_(User.role.in_(FULL_ACCESS_ROLES), User.id.in_(ids))).all()
    return [u for u in full if u.onboarded]


def matter_clients(db: Session, case: Case) -> list[User]:
    rows = db.query(ClientAccess).filter(ClientAccess.case_id == case.id, ClientAccess.user_id.isnot(None),
                                         ClientAccess.accepted_at.isnot(None), ClientAccess.revoked_at.is_(None)).all()
    return [db.get(User, r.user_id) for r in rows]


def log(db: Session, case: Case | None, user: User | None, action: str, *, document_id: int | None = None, **detail) -> None:
    db.add(Activity(workspace_id=case.workspace_id if case else (user.workspace_id if user else None),
                    case_id=case.id if case else None, user_id=user.id if user else None, action=action,
                    document_id=document_id, detail=detail))


def log_document(db: Session, d: Document, user: User | None, action: str, *, once_per_minutes: int = 0, **detail) -> None:
    """Every opening, download or question on a private document is recorded (PRD 8: audit log of document access).
    once_per_minutes: skip a repeat of the same action by the same person within that window (page refreshes)."""
    if once_per_minutes and user:
        since = datetime.utcnow() - timedelta(minutes=once_per_minutes)
        if db.query(Activity.id).filter(Activity.document_id == d.id, Activity.user_id == user.id, Activity.action == action,
                                        Activity.created_at >= since).first():
            return
    case = db.get(Case, d.case_id) if d.case_id else None
    db.add(Activity(workspace_id=d.workspace_id, case_id=case.id if case else None, user_id=user.id if user else None,
                    action=action, document_id=d.id, detail={"document": d.filename, **detail}))
