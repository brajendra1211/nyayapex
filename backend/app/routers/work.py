"""Drafting Assistant, Registry Compliance, AI usage."""

import io
import json
import re
import tempfile
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import member, require_types
from ..db import get_db
from ..models import AuditEvent, Case, Document, UsageLog, User
from ..services import ai_log, articles, limitation, llm
from ..services.format_check import check_pdf
from ..services.lint import lint
from ..services.prompts import DRAFT_SYSTEM, TEMPLATES

router = APIRouter(prefix="/api", tags=["work"])
# Drafting, filing and compliance are an advocate's work: not for individual (non-lawyer) accounts
professional = require_types("advocate", "firm", "corporate", "student")


# ---------- Drafting ----------

@router.get("/drafting/templates")
def templates(_: User = Depends(professional)):
    return [{"id": k, "label": v["label"], "sections": v["sections"]} for k, v in TEMPLATES.items()]


class DraftIn(BaseModel):
    template: str
    document_id: int | None = None
    facts: str = ""
    statutes: str = ""
    impugned_order: str = ""


@router.post("/drafting/generate")
def generate(body: DraftIn, user: User = Depends(professional), db: Session = Depends(get_db)):
    tpl = TEMPLATES.get(body.template)
    if not tpl:
        raise HTTPException(400, "Unknown template")

    material, d = [], None
    if body.document_id:
        d = db.get(Document, body.document_id)
        if not d or d.workspace_id != user.workspace_id or d.status != "done":
            raise HTTPException(400, "Selected document is not analysed yet.")
        # Compact facts only - not the raw record
        chron = "\n".join(f"{e['date'] or 'undated'}: {e['event']} [p.{e['pages'][0]}]" for e in (d.chronology or [])[:250])
        material.append(f"CHRONOLOGY FROM RECORD:\n{chron}")
        if d.brief:
            material.append("ISSUES: " + "; ".join(d.brief.get("core_issues", [])))
            material.append("QUESTIONS OF LAW (suggested): " + "; ".join(d.brief.get("questions_of_law", [])))
    if body.impugned_order:
        material.append(f"IMPUGNED ORDER: {body.impugned_order}")
    if body.facts:
        material.append(f"FACTS FROM ADVOCATE:\n{body.facts}")
    if body.statutes:
        material.append(f"RELEVANT STATUTES: {body.statutes}")
    if not material:
        raise HTTPException(400, "Provide facts or select an analysed document.")

    skeleton = "\n".join(tpl["sections"])
    text = llm.ask(db, feature="drafting", system=DRAFT_SYSTEM,
                   user=f"Petition type: {tpl['label']}\n\nSECTION SKELETON:\n{skeleton}\n\n" + "\n\n".join(material),
                   smart=True, effort="high", max_tokens=16000, workspace_id=user.workspace_id)
    if user.workspace.type == "student":
        text = "TRAINING DRAFT - FOR LEARNING ONLY - NOT FOR FILING\n\n" + text
    log_id = ai_log.record(db, feature="drafting", output=text, user=user, case_id=d.case_id if d else None,
                           document_id=d.id if d else None, prompt=f"{tpl['label']}: {body.facts or ''}"[:4000],
                           sources=[d.filename] if d else [])
    return {"draft": text, "ai_log_id": log_id, "flags": lint(text), "ai_generated": True,
            "disclaimer": "AI-generated first draft. Non-binding; the Advocate-on-Record must review, verify every fact and authority, and approve before filing."}


@router.post("/drafting/lint")
def lint_text(body: dict, _: User = Depends(professional)):
    return lint(body.get("text", ""))


class ArticlesIn(BaseModel):
    text: str = Field(max_length=400000)


@router.post("/drafting/articles")
def suggest_articles(body: ArticlesIn, _: User = Depends(professional)):
    return articles.suggest(body.text)


class ReadinessIn(BaseModel):
    text: str = Field(max_length=400000)
    acknowledged: list[str] = []  # risk flags the advocate has read and decided to keep ("line:match")
    reviewed: bool = False  # the advocate has read the whole draft and takes responsibility for it
    citations_checked: bool = False


PLACEHOLDER_RE = re.compile(r"\[(?:TO BE FILLED|VERIFY|DATE|NAME)[^\]]*\]", re.I)


def readiness(db: Session, user: User, body: ReadinessIn) -> dict:
    """A draft becomes filing-ready only when nothing is left open. Each check names what to fix."""
    from .research import TextIn, check_citations

    flags = lint(body.text)
    placeholders = PLACEHOLDER_RE.findall(body.text)
    kept = set(body.acknowledged)
    open_flags = [f for f in flags if f"{f['line']}:{f['match']}" not in kept and f["risk"] != "Placeholder left in draft"]
    cites = check_citations(TextIn(text=body.text), user, db) if body.text.strip() else {"total": 0, "unknown": 0}
    training = bool(user.workspace and user.workspace.type == "student")
    checks = [
        {"key": "placeholders", "ok": not placeholders, "label": "No [TO BE FILLED] placeholders left",
         "detail": f"{len(placeholders)} left: {', '.join(placeholders[:3])}" if placeholders else ""},
        {"key": "flags", "ok": not open_flags, "label": "Every risk flag fixed or consciously kept",
         "detail": f"{len(open_flags)} flag(s) still open" if open_flags else ""},
        {"key": "citations", "ok": body.citations_checked or cites["unknown"] == 0, "label": "Every authority verified",
         "detail": (f"{cites['unknown']} of {cites['total']} citation(s) not found in the library - check them against the "
                    "report and tick 'authorities checked'") if cites["unknown"] and not body.citations_checked else ""},
        {"key": "reviewed", "ok": body.reviewed, "label": "Read in full and approved by the advocate",
         "detail": "" if body.reviewed else "An AI draft is non-binding until an advocate reviews it"},
        {"key": "training", "ok": not training, "label": "Not a training draft",
         "detail": "Student accounts produce training drafts, never filing-ready ones" if training else ""},
    ]
    return {"ready": all(c["ok"] for c in checks), "checks": checks, "flags": len(flags),
            "citations": {"total": cites["total"], "unknown": cites["unknown"]}}


@router.post("/drafting/readiness")
def draft_readiness(body: ReadinessIn, user: User = Depends(professional), db: Session = Depends(get_db)):
    return readiness(db, user, body)


class ExportIn(ReadinessIn):
    title: str = Field("Draft", max_length=200)
    ai_log_id: int | None = None


@router.post("/drafting/export")
def export_draft(body: ExportIn, user: User = Depends(professional), db: Session = Depends(get_db)):
    """Word file of the draft. Unless every readiness check passes, every page is headed as a draft not for filing."""
    import docx
    from docx.shared import Pt

    r = readiness(db, user, body)
    d = docx.Document()
    d.styles["Normal"].font.name = "Times New Roman"
    d.styles["Normal"].font.size = Pt(14)
    if not r["ready"]:
        d.sections[0].header.paragraphs[0].text = "DRAFT - NOT FILING-READY (open checks in Nyay Apex)"
    for para in body.text.split("\n"):
        d.add_paragraph(para)
    buf = io.BytesIO()
    d.save(buf)
    db.add(AuditEvent(entity="draft", entity_id=body.ai_log_id or 0, user_id=user.id,
                      event="exported_ready" if r["ready"] else "exported_draft",
                      detail={"title": body.title, "checks": {c["key"]: c["ok"] for c in r["checks"]}, "chars": len(body.text)}))
    db.commit()
    name = re.sub(r"[^A-Za-z0-9 ._()-]", "", body.title)[:80] or "Draft"
    return Response(buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{name}{"" if r["ready"] else " - DRAFT"}.docx"',
                             "X-Report": json.dumps({"ready": r["ready"]})})


# ---------- Registry Compliance ----------

@router.post("/compliance/check")
async def compliance_check(file: UploadFile = File(...), case_id: int | None = Form(None),
                           user: User = Depends(professional), db: Session = Depends(get_db)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Upload the final paper-book as a PDF.")
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(await file.read())
        path = Path(tmp.name)
    try:
        report = check_pdf(path)
    finally:
        path.unlink(missing_ok=True)
    if case_id and (c := db.get(Case, case_id)) and c.workspace_id == user.workspace_id:
        c.filing_status, c.defects = report["status"], len(report["defects"])
        db.commit()
    return report


class LimitationIn(BaseModel):
    kind: str
    order_date: date
    copy_applied: date | None = None
    copy_ready: date | None = None
    filing_date: date | None = None
    case_id: int | None = None


@router.get("/compliance/limitation/types")
def limitation_types(_: User = Depends(professional)):
    return [{"id": k, **v} for k, v in limitation.PERIODS.items()]


@router.post("/compliance/limitation")
def limitation_calc(body: LimitationIn, user: User = Depends(professional), db: Session = Depends(get_db)):
    try:
        res = limitation.calculate(body.kind, body.order_date, body.copy_applied, body.copy_ready, body.filing_date)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if body.case_id and res.get("last_date") and (c := db.get(Case, body.case_id)) and c.workspace_id == user.workspace_id:
        c.limitation_expiry = date.fromisoformat(res["last_date"])
        db.commit()
    return res


# ---------- AI usage ----------

@router.get("/usage")
def usage(user: User = Depends(member), db: Session = Depends(get_db)):
    def rows(col):
        return [
            {"key": k, "calls": n, "input": i, "output": o, "cache_read": cr, "local_hits": lh, "cost_usd": round(cost, 4)}
            for k, n, i, o, cr, lh, cost in db.query(
                col, func.count(), func.sum(UsageLog.input_tokens), func.sum(UsageLog.output_tokens),
                func.sum(UsageLog.cache_read_tokens), func.sum(UsageLog.cached_locally), func.sum(UsageLog.cost_usd),
            ).filter(UsageLog.workspace_id == user.workspace_id).group_by(col).all()
        ]

    by_feature = rows(UsageLog.feature)
    docs = db.query(Document).filter(Document.workspace_id == user.workspace_id, Document.stats.isnot(None)).all()
    raw = sum((d.stats or {}).get("tokens_raw_est", 0) for d in docs)
    sent = sum((d.stats or {}).get("tokens_sent_est", 0) + (d.stats or {}).get("brief_input_tokens_est", 0) for d in docs)
    return {
        "by_feature": by_feature,
        "by_model": rows(UsageLog.model),
        "totals": {
            "cost_usd": round(sum(r["cost_usd"] for r in by_feature), 4),
            "calls": sum(r["calls"] for r in by_feature),
            "local_hits": sum(r["local_hits"] or 0 for r in by_feature),
            "cache_read": sum(r["cache_read"] or 0 for r in by_feature),
        },
        "documents": {"raw_tokens_est": raw, "sent_tokens_est": sent},
    }
