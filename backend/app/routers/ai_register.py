"""AI output register: every AI answer, who asked, what it was grounded on, and who verified it.

SC AI Regulations 2026 (draft): Reg 8(3) AI output is advisory and must be verified; Reg 9 auditability;
Reg 43(4) the Court may ask which AI system was used, the extent of assistance and how it was verified.
"""

import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Query, Session

from ..auth import member
from ..db import get_db
from ..models import AIOutput, Case, User
from ..services.access import FULL_ACCESS_ROLES

router = APIRouter(prefix="/api/ai-log", tags=["ai-register"])

FEATURE_LABELS = {"law_ask": "Bare acts: which section (AI)", "explain": "Document explained (simple words)", "research": "Research", "research_deep": "Research (deep)", "courtroom": "Courtroom", "doc_qa": "Document Q&A",
                  "doc_brief": "Record brief", "drafting": "Drafting", "filing": "Filing package"}


def sees_register(user: User) -> bool:
    """Chamber heads see the whole register; everyone else sees the AI answers they asked for."""
    ws = user.workspace
    return bool(ws) and (ws.type in ("advocate", "student", "individual") or user.role in FULL_ACCESS_ROLES)


def _query(db: Session, user: User, feature: str | None, case_id: int | None, unverified: bool) -> Query:
    q = db.query(AIOutput).filter(AIOutput.workspace_id == user.workspace_id)
    if not sees_register(user):
        q = q.filter(AIOutput.user_id == user.id)
    if feature:
        q = q.filter(AIOutput.feature.in_([feature, f"{feature}_deep"]))
    if case_id:
        q = q.filter(AIOutput.case_id == case_id)
    if unverified:
        q = q.filter(AIOutput.verified_at.is_(None))
    return q.order_by(AIOutput.id.desc())


def _names(db: Session, rows: list[AIOutput]) -> tuple[dict, dict]:
    uids = {r.user_id for r in rows if r.user_id} | {r.verified_by for r in rows if r.verified_by}
    cids = {r.case_id for r in rows if r.case_id}
    users = {u.id: u.name for u in db.query(User).filter(User.id.in_(uids))} if uids else {}
    cases = {c.id: c.title for c in db.query(Case).filter(Case.id.in_(cids))} if cids else {}
    return users, cases


def row_dict(r: AIOutput, users: dict, cases: dict) -> dict:
    return {"id": r.id, "feature": r.feature, "feature_label": FEATURE_LABELS.get(r.feature, r.feature), "model": r.model,
            "prompt": r.prompt, "output": r.output, "sources": r.sources or [], "cached": r.cached, "pii_masked": r.pii_masked,
            "asked_by": users.get(r.user_id), "case_id": r.case_id, "case_title": cases.get(r.case_id),
            "verified_by": users.get(r.verified_by), "verified_at": r.verified_at, "created_at": r.created_at}


@router.get("")
def register(feature: str | None = None, case_id: int | None = None, unverified: bool = False, limit: int = 100,
             user: User = Depends(member), db: Session = Depends(get_db)):
    q = _query(db, user, feature, case_id, unverified)
    total = q.count()
    rows = q.limit(min(max(limit, 1), 500)).all()
    users, cases = _names(db, rows)
    return {"total": total, "all_workspace": sees_register(user), "items": [row_dict(r, users, cases) for r in rows]}


@router.get("/export.csv")
def export_csv(feature: str | None = None, case_id: int | None = None, user: User = Depends(member),
               db: Session = Depends(get_db)):
    rows = _query(db, user, feature, case_id, False).limit(20000).all()
    users, cases = _names(db, rows)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "date", "feature", "AI model", "asked by", "matter", "question / instruction", "grounded on",
                "identifiers masked", "from cache", "verified by", "verified at", "output"])
    for r in rows:
        w.writerow([r.id, r.created_at, FEATURE_LABELS.get(r.feature, r.feature), r.model, users.get(r.user_id, ""),
                    cases.get(r.case_id, ""), r.prompt, " | ".join(r.sources or []), r.pii_masked, "yes" if r.cached else "no",
                    users.get(r.verified_by, ""), r.verified_at or "", r.output])
    return StreamingResponse(iter(["﻿" + buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="AI_output_register.csv"'})


class VerifyIn(BaseModel):
    verified: bool = True


@router.post("/{oid}/verify")
def verify(oid: int, body: VerifyIn, user: User = Depends(member), db: Session = Depends(get_db)):
    """'I have checked this AI answer against the sources' - recorded with name and time (Reg 8(3))."""
    r = db.get(AIOutput, oid)
    if not r or r.workspace_id != user.workspace_id or (r.user_id != user.id and not sees_register(user)):
        raise HTTPException(404, "Not found.")
    r.verified_by, r.verified_at = (user.id, datetime.utcnow()) if body.verified else (None, None)
    db.commit()
    return {"ok": True, "verified_by": user.name if body.verified else None, "verified_at": r.verified_at}
