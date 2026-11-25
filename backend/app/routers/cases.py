from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import member, require_types
from ..config import settings
from ..db import get_db
from ..models import Case, CauseListMatch, Document, MatterMember, Task, UsageLog, User
from ..services import access, causelist, notify

# Students practise on the tools but don't hold live client matters
matter_user = require_types("advocate", "firm", "corporate", "individual")

router = APIRouter(prefix="/api", tags=["cases"])


class CaseIn(BaseModel):
    title: str
    diary_no: str | None = None
    case_type: str = "SLP (C)"
    bench: str | None = None
    stage: str = "Drafting"
    priority: str = "Normal"
    next_hearing: date | None = None
    limitation_expiry: date | None = None
    filing_status: str = "NOT READY"
    defects: int = 0
    case_number: str | None = None
    details: dict | None = None


class CasePatch(BaseModel):
    title: str | None = None
    diary_no: str | None = None
    case_type: str | None = None
    bench: str | None = None
    stage: str | None = None
    priority: str | None = None
    next_hearing: date | None = None
    limitation_expiry: date | None = None
    filing_status: str | None = None
    defects: int | None = None
    case_number: str | None = None
    details: dict | None = None


CASE_FIELDS = ("id", "title", "diary_no", "case_number", "case_type", "bench", "stage", "priority", "next_hearing",
               "limitation_expiry", "filing_status", "defects", "file_location", "stage_since", "details", "created_at")


def case_dict(c: Case) -> dict:
    return {k: getattr(c, k) for k in CASE_FIELDS}


def apply_changes(db: Session, user: User | None, c: Case, changes: dict, note: str = "") -> None:
    """Update a matter; a new hearing date reaches the team and the client, a new case/diary number is looked up in the
    cause lists already read, and a stage change restarts the registry-queue clock."""
    old_hearing, old_stage = c.next_hearing, c.stage
    old_keys = causelist.case_keys(c)
    for k, v in changes.items():
        setattr(c, k, v)
    if c.stage != old_stage:
        c.stage_since = datetime.utcnow()
    if causelist.case_keys(c) != old_keys:
        causelist.rematch_case(db, c)
    if c.next_hearing != old_hearing:
        when = c.next_hearing.strftime("%d %b %Y") if c.next_hearing else "not fixed"
        access.log(db, c, user, "hearing_changed", to=when + note)
        # PRD 6.8: a hearing change reaches everyone on the matter without re-entry
        notify.notify(db, access.matter_people(db, c), f"Next hearing in \"{c.title}\" is now {when}", case_id=c.id,
                      kind="hearing", link=f"/matter?id={c.id}", whatsapp=True, exclude=user)
        notify.notify(db, access.matter_clients(db, c), f"Next hearing in your matter \"{c.title}\" is {when}",
                      case_id=c.id, kind="hearing", link=f"/portal/matter?id={c.id}", whatsapp=True)
    else:
        access.log(db, c, user, "case_updated")


@router.get("/health")
def health():
    return {"ok": True, "ai_enabled": settings.ai_enabled, "models": {"bulk": settings.model_bulk, "smart": settings.model_smart}}


@router.get("/cases")
def list_cases(user: User = Depends(matter_user), db: Session = Depends(get_db)):
    rows = db.query(Case).filter(access.visible_cases_filter(user)).order_by(Case.next_hearing.is_(None), Case.next_hearing).all()
    return [case_dict(c) for c in rows]


def _clean_details(d: dict | None) -> dict | None:
    """Free-form case details (individual accounts): short strings and one list of questions, nothing large."""
    if d is None:
        return None
    out = {}
    for k, v in list(d.items())[:40]:
        if not isinstance(k, str) or len(k) > 40:
            continue
        if isinstance(v, str):
            out[k] = v[:4000]
        elif isinstance(v, bool) or v is None:
            out[k] = v
        elif isinstance(v, list):
            out[k] = [x for x in v if isinstance(x, (str, dict))][:100]
    if len(str(out)) > 60000:
        raise HTTPException(400, "Case details are too long.")
    return out


@router.post("/cases")
def create_case(body: CaseIn, user: User = Depends(matter_user), db: Session = Depends(get_db)):
    body.details = _clean_details(body.details)
    c = Case(**body.model_dump(), workspace_id=user.workspace_id, stage_since=datetime.utcnow())
    db.add(c)
    db.flush()
    causelist.rematch_case(db, c)
    db.add(MatterMember(case_id=c.id, user_id=user.id, role="lead", added_by=user.id))  # creator leads the matter
    access.log(db, c, user, "case_updated")
    db.commit()
    return case_dict(c)


@router.patch("/cases/{case_id}")
def update_case(case_id: int, body: CasePatch, user: User = Depends(matter_user), db: Session = Depends(get_db)):
    c = access.case_for(db, user, case_id)
    changes = body.model_dump(exclude_unset=True)
    if "details" in changes:
        changes["details"] = _clean_details(changes["details"])
    apply_changes(db, user, c, changes)
    db.commit()
    return case_dict(c)


class BulkIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=200)
    stage: str | None = None
    priority: str | None = None
    bench: str | None = None
    next_hearing: date | None = None
    clear_hearing: bool = False
    filing_status: Literal["READY", "AT RISK", "NOT READY"] | None = None


@router.post("/cases/bulk")
def bulk_update(body: BulkIn, user: User = Depends(matter_user), db: Session = Depends(get_db)):
    """Same change on many matters at once (e.g. all matters of a court adjourned to one date)."""
    changes = {k: v for k, v in body.model_dump(exclude={"ids", "clear_hearing"}).items() if v is not None}
    if body.clear_hearing:
        changes["next_hearing"] = None
    if not changes:
        raise HTTPException(400, "Choose at least one change.")
    cases = [access.case_for(db, user, i) for i in dict.fromkeys(body.ids)]  # 404 if any is not visible
    for c in cases:
        apply_changes(db, user, c, changes, note=" (bulk update)" if "next_hearing" in changes else "")
    db.commit()
    return {"updated": len(cases)}


@router.delete("/cases/{case_id}")
def delete_case(case_id: int, user: User = Depends(matter_user), db: Session = Depends(get_db)):
    c = access.case_for(db, user, case_id)
    if user.role in ("clerk", "paralegal", "junior") or not access.can_manage(db, user, c):
        raise HTTPException(403, "Ask the matter lead or an admin to delete matters.")
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.get("/dashboard")
def dashboard(user: User = Depends(member), db: Session = Depends(get_db)):
    ws = user.workspace_id
    today = date.today()
    cases = db.query(Case).filter(access.visible_cases_filter(user)).all()
    upcoming = sorted([c for c in cases if c.next_hearing and c.next_hearing >= today], key=lambda c: c.next_hearing)
    expiring = sorted([c for c in cases if c.limitation_expiry and today <= c.limitation_expiry <= today + timedelta(days=30)],
                      key=lambda c: c.limitation_expiry)
    status_counts = {s: sum(1 for c in cases if c.filing_status == s) for s in ("READY", "AT RISK", "NOT READY")}
    usage = db.query(func.coalesce(func.sum(UsageLog.cost_usd), 0.0), func.count(UsageLog.id),
                     func.coalesce(func.sum(UsageLog.cached_locally), 0)).filter(UsageLog.workspace_id == ws).one()
    return {
        "counts": {
            "active_matters": len(cases),
            "hearings_7d": sum(1 for c in upcoming if c.next_hearing <= today + timedelta(days=7)),
            "limitation_30d": len(expiring),
            "open_defects": sum(c.defects for c in cases),
            "documents": db.query(Document).filter(Document.workspace_id == ws).count(),
            "tracked": sum(1 for c in cases if c.case_number or c.diary_no),
        },
        "filing_status": status_counts,
        "stages": {s: n for s, n in db.query(Case.stage, func.count()).filter(access.visible_cases_filter(user)).group_by(Case.stage).all()},
        "upcoming_hearings": [case_dict(c) for c in upcoming[:8]],
        "limitation_alerts": [{**case_dict(c), "days_left": (c.limitation_expiry - today).days} for c in expiring[:8]],
        "listings": _listings(db, user, today),
        "my_tasks": [{"id": t.id, "title": t.title, "due_date": t.due_date, "case_id": t.case_id,
                      "case": next((c.title for c in cases if c.id == t.case_id), "")}
                     for t in db.query(Task).filter(Task.assignee_id == user.id, Task.status == "open",
                                                    Task.case_id.in_([c.id for c in cases]))
                     .order_by(Task.due_date.is_(None), Task.due_date).limit(8)],
        "recent_documents": [
            {"id": d.id, "filename": d.filename, "status": d.status, "pages": d.pages, "created_at": d.created_at}
            for d in db.query(Document).filter(Document.workspace_id == ws).order_by(Document.id.desc()).limit(5)
        ],
        "ai": {"cost_usd": round(usage[0], 4), "calls": usage[1], "local_cache_hits": usage[2], "enabled": settings.ai_enabled},
    }


def _listings(db: Session, user: User, today: date) -> list[dict]:
    """Upcoming cause-list listings of the matters this person can see."""
    rows = db.query(CauseListMatch).join(Case, Case.id == CauseListMatch.case_id)         .filter(access.visible_cases_filter(user)).all()
    out = [{**causelist.entry_dict(m.entry), "case_id": m.case_id, "case": db.get(Case, m.case_id).title}
           for m in rows if m.entry.list_date >= today]
    return sorted(out, key=lambda x: (x["list_date"], x["kind"] != "daily", x["court"], x["item_no"]))[:12]
