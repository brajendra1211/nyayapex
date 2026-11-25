"""Filing package wizard (SLP paper-book) + AI accountability (audit trail, verification gate, AI incidents).

SC AI Regulations 2026 (draft): Reg 8 - AI output is advisory and must be verified; Reg 39 - AI incident reporting;
Reg 43 - disclosure of AI assistance in filings and the ability to show what AI did and how it was verified.
"""

import json
import re
import tempfile
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..auth import member, require_types
from ..config import settings
from ..db import get_db
from ..models import AIIncident, AIOutput, AuditEvent, Case, Document, FilingPackage, MatterMember, MatterReference, UsageLog, User
from ..services import access, ai_log, compilation, filing_docx, llm, storage
from ..services.format_check import check_pdf
from ..services import filing_templates as T
from ..services.citations import find_citations
from .auth import platform_admin

router = APIRouter(prefix="/api", tags=["filing"])
# Drafting, filing and compliance are an advocate's work: not for individual (non-lawyer) accounts
professional = require_types("advocate", "firm", "corporate", "student")

SECTIONS = ("synopsis", "list_of_dates", "questions_of_law", "grounds", "interim_grounds", "main_prayer",
            "interim_prayer", "delay_explanation")
SECTION_LABELS = {"synopsis": "Synopsis", "list_of_dates": "List of Dates", "questions_of_law": "Questions of Law",
                  "grounds": "Grounds", "interim_grounds": "Grounds for Interim Relief", "main_prayer": "Main Prayer",
                  "interim_prayer": "Interim Prayer", "delay_explanation": "Explanation of Delay"}

FILING_SYSTEM = (
    "You draft the narrative parts of a Special Leave Petition (Civil) before the Supreme Court of India, as a first "
    "draft for an Advocate-on-Record. Use ONLY the facts, dates and issues supplied. Never invent facts, dates, page "
    "numbers, case names or citations; where something is missing write [TO BE FILLED: what is needed]. Formal, precise "
    "Indian legal drafting; no rhetorical overstatement. Questions of law: framed as 'Whether ...?'. Grounds: each a "
    "separate ground beginning 'Because'. Synopsis: 3-6 short paragraphs telling the story and the error in the impugned "
    "judgment. Delay explanation: only if a delay is stated, day-by-day reasons from the facts, else empty."
)
FILING_SCHEMA = {
    "type": "object",
    "properties": {
        "synopsis": {"type": "array", "items": {"type": "string"}},
        "questions_of_law": {"type": "array", "items": {"type": "string"}},
        "grounds": {"type": "array", "items": {"type": "string"}},
        "interim_grounds": {"type": "array", "items": {"type": "string"}},
        "delay_explanation": {"type": "array", "items": {"type": "string"}},
    },
}


def audit(db: Session, pkg: FilingPackage, user: User | None, event: str, **detail):
    db.add(AuditEvent(entity="filing_package", entity_id=pkg.id, case_id=pkg.case_id, user_id=user.id if user else None,
                      event=event, detail=detail))


def _pkg(db: Session, user: User, pid: int) -> tuple[FilingPackage, Case]:
    pkg = db.get(FilingPackage, pid)
    if not pkg:
        raise HTTPException(404, "Filing package not found.")
    return pkg, access.case_for(db, user, pkg.case_id)


def _aor(db: Session, case: Case, fallback: User) -> dict:
    """The AOR who files: the matter lead if they are an AOR, else any AOR on the matter, else the current user."""
    members = db.query(MatterMember).filter(MatterMember.case_id == case.id).order_by(MatterMember.role).all()
    for m in members:
        u = m.user
        if u and (u.profile or {}).get("is_aor"):
            return {"id": u.id, "name": u.name, "aor_code": (u.profile or {}).get("aor_code")}
    return {"id": fallback.id, "name": fallback.name, "aor_code": (fallback.profile or {}).get("aor_code")}


def pkg_dict(db: Session, pkg: FilingPackage, case: Case, user: User) -> dict:
    events = db.query(AuditEvent).filter(AuditEvent.entity == "filing_package", AuditEvent.entity_id == pkg.id) \
        .order_by(AuditEvent.id.desc()).limit(100).all()
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_({e.user_id for e in events if e.user_id} | {pkg.approved_by or 0}))}
    return {
        "id": pkg.id, "case_id": case.id, "case_title": case.title, "proceeding": pkg.proceeding,
        "proceeding_label": T.PROCEEDINGS[pkg.proceeding]["label"], "inputs": pkg.inputs or {}, "content": pkg.content or {},
        "ai_sections": pkg.ai_sections or [], "ai_model": pkg.ai_model, "checks": pkg.checks or {},
        "checklist": [{"key": k, "label": l} for k, l in T.CHECKLIST], "status": pkg.status, "version": pkg.version,
        "approved_by": names.get(pkg.approved_by), "approved_at": pkg.approved_at,
        "can_approve": access.can_manage(db, user, case), "aor": _aor(db, case, user), "verify_note": T.VERIFY_NOTE,
        "section_labels": SECTION_LABELS, "can_convert": bool(compilation.docx_to_pdf_available()),
        "audit": [{"event": e.event, "who": names.get(e.user_id), "detail": e.detail, "at": e.created_at} for e in events],
    }


def _prefill(db: Session, case: Case) -> tuple[dict, dict]:
    parts = re.split(r"\s+(?:v\.|vs\.?|versus)\s+", case.title, maxsplit=1, flags=re.I)
    inputs = {
        "petitioners": [{"name": parts[0].strip(), "description": "", "status_below": ""}],
        "respondents": [{"name": parts[1].strip() if len(parts) > 1 else "", "description": "", "status_below": ""}],
        "high_court": "", "case_below": "", "order_date": "", "held": "", "place": "New Delhi", "drawn_by": "",
        "deponent": {"name": parts[0].strip(), "relation": "", "age": "", "address": "", "capacity": "Petitioner"},
        "options": {"ia_exemption_cc": True, "ia_stay": False, "ia_delay": False, "delay_days": 0},
        "annexures": [],
    }
    if case.limitation_expiry and case.limitation_expiry < date.today():
        inputs["options"].update(ia_delay=True, delay_days=(date.today() - case.limitation_expiry).days)
    docs = db.query(Document).filter(Document.case_id == case.id, Document.status != "failed").order_by(Document.id).all()
    for i, d in enumerate([d for d in docs if d.filename.lower().endswith(".pdf")], 1):  # annexures need the file, not the analysis
        inputs["annexures"].append({"label": f"P-{i}", "description": Path(d.filename).stem.replace("_", " "), "document_id": d.id})
    chron = next((d.chronology for d in reversed(docs) if d.chronology), None) or []
    content = {k: [] for k in SECTIONS}
    content["list_of_dates"] = [f"{filing_docx.fmt_date(e.get('date')) or 'Undated'}: {e.get('event')}" for e in chron[:80]]
    content["main_prayer"] = list(T.DEFAULT_MAIN_PRAYER)
    content["interim_prayer"] = list(T.DEFAULT_INTERIM_PRAYER)
    return inputs, content


# ---------------------------------------------------------------- package CRUD

@router.get("/matters/{case_id}/filing")
def list_packages(case_id: int, user: User = Depends(professional), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    rows = db.query(FilingPackage).filter(FilingPackage.case_id == case.id).order_by(FilingPackage.id.desc()).all()
    return [{"id": p.id, "proceeding_label": T.PROCEEDINGS[p.proceeding]["label"], "status": p.status, "version": p.version,
             "updated_at": p.updated_at} for p in rows]


class NewPackage(BaseModel):
    proceeding: Literal["slp_civil"] = "slp_civil"


@router.post("/matters/{case_id}/filing")
def create_package(case_id: int, body: NewPackage, user: User = Depends(professional), db: Session = Depends(get_db)):
    case = access.case_for(db, user, case_id)
    inputs, content = _prefill(db, case)
    pkg = FilingPackage(case_id=case.id, proceeding=body.proceeding, inputs=inputs, content=content, created_by=user.id)
    db.add(pkg)
    db.flush()
    audit(db, pkg, user, "created", proceeding=body.proceeding)
    access.log(db, case, user, "case_updated")
    db.commit()
    return pkg_dict(db, pkg, case, user)


@router.get("/filing/{pid}")
def get_package(pid: int, user: User = Depends(professional), db: Session = Depends(get_db)):
    pkg, case = _pkg(db, user, pid)
    return pkg_dict(db, pkg, case, user)


class PackagePatch(BaseModel):
    inputs: dict | None = None
    content: dict | None = None


@router.patch("/filing/{pid}")
def update_package(pid: int, body: PackagePatch, user: User = Depends(professional), db: Session = Depends(get_db)):
    pkg, case = _pkg(db, user, pid)
    changed = []
    if body.inputs is not None:
        pkg.inputs = body.inputs
        flag_modified(pkg, "inputs")
        changed.append("details")
    if body.content is not None:
        old = pkg.content or {}
        edited = [k for k in SECTIONS if body.content.get(k) != old.get(k)]
        pkg.content = {**old, **{k: body.content.get(k) for k in SECTIONS if k in body.content}}
        flag_modified(pkg, "content")
        changed += [SECTION_LABELS[k] for k in edited]
    if changed:
        if pkg.status == "approved":  # any change after approval needs a fresh verification
            pkg.status, pkg.approved_by, pkg.approved_at, pkg.checks = "draft", None, None, {}
            pkg.version += 1
            audit(db, pkg, user, "approval_revoked", reason="edited after approval")
        pkg.updated_at = datetime.utcnow()
        audit(db, pkg, user, "edited", sections=changed)
    db.commit()
    return pkg_dict(db, pkg, case, user)


@router.delete("/filing/{pid}")
def delete_package(pid: int, user: User = Depends(professional), db: Session = Depends(get_db)):
    pkg, case = _pkg(db, user, pid)
    if not access.can_manage(db, user, case):
        raise HTTPException(403, "Only the matter lead / AOR can delete a filing package.")
    db.delete(pkg)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- AI drafting of narrative sections

class GenerateIn(BaseModel):
    extra_facts: str = Field("", max_length=8000)
    sections: list[str] = ["synopsis", "questions_of_law", "grounds", "interim_grounds", "delay_explanation"]


@router.post("/filing/{pid}/generate")
def generate(pid: int, body: GenerateIn, user: User = Depends(professional), db: Session = Depends(get_db)):
    pkg, case = _pkg(db, user, pid)
    i, c = pkg.inputs or {}, pkg.content or {}
    docs = db.query(Document).filter(Document.case_id == case.id, Document.status == "done").all()
    brief = next((d.brief for d in reversed(docs) if d.brief), None) or {}
    opts = i.get("options") or {}
    material = [
        f"Matter: {case.title}",
        f"Impugned judgment: dated {i.get('order_date') or '[unknown]'} by the High Court of {i.get('high_court') or '[unknown]'} "
        f"in {i.get('case_below') or '[unknown]'}. What it held: {i.get('held') or '[not stated]'}",
        "List of dates:\n" + "\n".join((c.get("list_of_dates") or [])[:80]),
    ]
    if brief:
        material.append("Issues from the record: " + "; ".join(brief.get("core_issues", [])))
        material.append("Suggested questions of law: " + "; ".join(brief.get("questions_of_law", [])))
    if opts.get("ia_delay"):
        material.append(f"There is a delay of {opts.get('delay_days')} days in filing.")
    else:
        material.append("There is no delay; leave delay_explanation empty.")
    if opts.get("ia_stay"):
        material.append("Interim stay is sought.")
    if body.extra_facts.strip():
        material.append("Facts and instructions from the advocate:\n" + body.extra_facts.strip())

    before = db.query(func.coalesce(func.max(UsageLog.id), 0)).filter(UsageLog.workspace_id == case.workspace_id).scalar()
    out = llm.ask(db, feature="filing", system=FILING_SYSTEM, user="\n\n".join(material), smart=True, effort="medium",
                  max_tokens=12000, schema=FILING_SCHEMA, workspace_id=case.workspace_id)
    log_id = ai_log.record(db, feature="filing", output=out, user=user, case_id=case.id,
                           prompt=body.extra_facts or "(from list of dates and record brief)",
                           sources=[x for x in ("list of dates", "record brief" if brief else None) if x])
    cost = db.query(func.coalesce(func.sum(UsageLog.cost_usd), 0.0)).filter(
        UsageLog.workspace_id == case.workspace_id, UsageLog.id > before).scalar()

    wanted = [s for s in body.sections if s in FILING_SCHEMA["properties"]]
    new_content = {**c}
    for s in wanted:
        if out.get(s):
            new_content[s] = out[s]
    pkg.content = new_content
    flag_modified(pkg, "content")
    pkg.ai_sections = sorted(set(pkg.ai_sections or []) | {SECTION_LABELS[s] for s in wanted if out.get(s)})
    flag_modified(pkg, "ai_sections")
    pkg.ai_model = settings.model_smart
    if pkg.status == "approved":
        pkg.status, pkg.approved_by, pkg.approved_at, pkg.checks = "draft", None, None, {}
        pkg.version += 1
    pkg.updated_at = datetime.utcnow()
    audit(db, pkg, user, "ai_generated", model=settings.model_smart, sections=[SECTION_LABELS[s] for s in wanted],
          cost_usd=round(cost, 4), ai_log_id=log_id, inputs_used=["list of dates", "record brief" if brief else None,
                                                 "advocate's facts" if body.extra_facts.strip() else None])
    db.commit()
    return {**pkg_dict(db, pkg, case, user), "cost_usd": round(cost, 4)}


# ---------------------------------------------------------------- verification gate (Reg 8 / 43)

@router.post("/filing/{pid}/check-citations")
def check_citations(pid: int, user: User = Depends(professional), db: Session = Depends(get_db)):
    from ..services import citation_intel

    pkg, case = _pkg(db, user, pid)
    text_ = "\n".join(str(x) for k in SECTIONS for x in ((pkg.content or {}).get(k) or []))
    seen, items = set(), []
    for c in find_citations(text_):
        k = citation_intel.key(c["citation"])
        if k in seen:
            continue
        seen.add(k)
        items.append(citation_intel.quick(db, c["citation"], case.workspace_id) or {"citation": c["citation"], "status": "unknown"})
    summary = {s: sum(i["status"] == s for i in items) for s in ("verified", "cited", "unknown")}
    audit(db, pkg, user, "citations_checked", total=len(items), **summary)
    db.commit()
    return {"total": len(items), **summary, "items": items}


class ChecksIn(BaseModel):
    checks: dict[str, bool]


@router.post("/filing/{pid}/checks")
def set_checks(pid: int, body: ChecksIn, user: User = Depends(professional), db: Session = Depends(get_db)):
    pkg, case = _pkg(db, user, pid)
    valid = {k for k, _ in T.CHECKLIST}
    pkg.checks = {**(pkg.checks or {}), **{k: bool(v) for k, v in body.checks.items() if k in valid}}
    flag_modified(pkg, "checks")
    audit(db, pkg, user, "checklist", **{k: v for k, v in body.checks.items() if k in valid})
    db.commit()
    return pkg_dict(db, pkg, case, user)


@router.post("/filing/{pid}/approve")
def approve(pid: int, user: User = Depends(professional), db: Session = Depends(get_db)):
    pkg, case = _pkg(db, user, pid)
    if not access.can_manage(db, user, case):
        raise HTTPException(403, "Only the AOR / senior / matter lead can approve a filing for export.")
    missing = [label for k, label in T.CHECKLIST if not (pkg.checks or {}).get(k) and not (k == "ai" and not pkg.ai_sections)]
    if missing:
        raise HTTPException(400, "Complete the verification checklist first: " + "; ".join(missing))
    pkg.status, pkg.approved_by, pkg.approved_at = "approved", user.id, datetime.utcnow()
    audit(db, pkg, user, "approved", version=pkg.version, ai_sections=pkg.ai_sections)
    access.log(db, case, user, "case_updated")
    db.commit()
    return pkg_dict(db, pkg, case, user)


# ---------------------------------------------------------------- exports

def _safe_name(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")[:60] or "matter"


@router.get("/filing/{pid}/docx")
def export_docx(pid: int, user: User = Depends(professional), db: Session = Depends(get_db)):
    pkg, case = _pkg(db, user, pid)
    approved = pkg.status == "approved"
    data = filing_docx.build_paper_book(pkg, case, _aor(db, case, user), approved)
    audit(db, pkg, user, "exported", format="docx", approved=approved, version=pkg.version)
    db.commit()
    name = f"{_safe_name(case.title)}_SLP_v{pkg.version}{'' if approved else '_DRAFT'}.docx"
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _annexure_items(db: Session, pkg: FilingPackage, case: Case) -> list[tuple[str, str, bytes]]:
    items = []
    for a in (pkg.inputs or {}).get("annexures") or []:
        d = db.get(Document, a.get("document_id") or 0)
        if not d or d.case_id != case.id or not d.filename.lower().endswith(".pdf"):
            continue
        if storage.exists(d.sha256, ".pdf"):
            items.append((a.get("label") or "", a.get("description") or "", storage.read(d.sha256, ".pdf")))
    return items


@router.get("/filing/{pid}/annexures")
def export_annexures(pid: int, user: User = Depends(professional), db: Session = Depends(get_db)):
    pkg, case = _pkg(db, user, pid)
    items = _annexure_items(db, pkg, case)
    if not items:
        raise HTTPException(400, "No PDF annexures linked. Upload the documents to the matter and pick them in the wizard.")
    data = filing_docx.build_annexures_pdf(items)
    audit(db, pkg, user, "exported", format="annexures_pdf", count=len(items))
    db.commit()
    return Response(data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{_safe_name(case.title)}_Annexures.pdf"'})


def _head(db: Session, case: Case, user: User, pkg: FilingPackage | None = None) -> dict:
    """Cause-title data for generated PDF pages: from the filing package when there is one, else the matter title."""
    pkg = pkg or db.query(FilingPackage).filter(FilingPackage.case_id == case.id).order_by(FilingPackage.id.desc()).first()
    year = date.today().year
    if pkg:
        i, proc = pkg.inputs or {}, T.PROCEEDINGS[pkg.proceeding]
        parties = {k: [p.get("name") or "________" for p in i.get(k) or []] for k in ("petitioners", "respondents")}
        jurisdiction, title = proc["jurisdiction"], proc["title"].format(year=year)
    else:
        parts = re.split(r"\s+(?:v\.|vs\.?|versus)\s+", case.title, maxsplit=1, flags=re.I)
        parties = {"petitioners": [parts[0]], "respondents": [parts[1] if len(parts) > 1 else "________"]}
        jurisdiction, title = "CIVIL APPELLATE JURISDICTION", f"{case.case_type} NO. ______ OF {year}"
    aor = _aor(db, case, user)
    return {"parties": parties, "jurisdiction": jurisdiction, "proceeding_title": title,
            "aor_name": aor["name"], "aor_code": aor["aor_code"]}


def _pdf_response(data: bytes, name: str, report: dict) -> Response:
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{name}"', "X-Report": json.dumps(report, default=str)})


@router.post("/filing/{pid}/final-pdf")
async def final_pdf(pid: int, petition: UploadFile | None = File(None), user: User = Depends(professional),
                    db: Session = Depends(get_db)):
    """One filing-ready PDF: petition (+ IAs etc.) with the impugned judgment and annexures spliced in, a fresh
    index with real page numbers, continuous numbering, bookmarks - then the Registry format check on the result."""
    pkg, case = _pkg(db, user, pid)
    approved = pkg.status == "approved"
    if petition is not None:
        data = await petition.read()
        if not data.startswith(b"%PDF"):
            raise HTTPException(400, "Upload the paper-book saved from Word as PDF (File -> Save As -> PDF).")
    else:
        data = compilation.docx_to_pdf(filing_docx.build_paper_book(pkg, case, _aor(db, case, user), approved))
        if data is None:
            raise HTTPException(400, "Word-to-PDF conversion is not available on this server. Open the downloaded Word "
                                     "file, finish it, save it as PDF and upload that PDF here.")
    inputs = pkg.inputs or {}
    impugned = None
    if (iid := inputs.get("impugned_document_id")) and (d := db.get(Document, iid)) and d.case_id == case.id:
        impugned, _ = compilation.document_pdf(db, d)
    try:
        out, report = compilation.assemble_paper_book(data, inputs, bool(pkg.ai_sections), impugned,
                                                      _annexure_items(db, pkg, case), _head(db, case, user, pkg),
                                                      draft=not approved)
    except Exception as e:
        raise HTTPException(400, f"Could not read that PDF: {e}")
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(out)
    try:
        check = check_pdf(Path(tmp.name))
    finally:
        Path(tmp.name).unlink(missing_ok=True)
    report.update(approved=approved, compliance=check["status"],
                  defects=[{"severity": x["severity"], "issue": x["issue"]} for x in check["defects"]][:12])
    audit(db, pkg, user, "exported", format="final_pdf", approved=approved, version=pkg.version, pages=report["pages"],
          compliance=check["status"])
    db.commit()
    return _pdf_response(out, f"{_safe_name(case.title)}_PaperBook_v{pkg.version}{'' if approved else '_DRAFT'}.pdf", report)


class CompItem(BaseModel):
    reference_id: int | None = None
    document_id: int | None = None
    relied_pages: str = Field("", max_length=200)
    highlights: list[str] = Field(default_factory=list, max_length=30)


class CompilationIn(BaseModel):
    side: Literal["Petitioner", "Respondent", "Appellant", "Applicant"] = "Petitioner"
    volume: str = Field("VOLUME I", max_length=40)
    items: list[CompItem] = Field(min_length=1, max_length=60)


@router.post("/matters/{case_id}/compilation")
def build_compilation(case_id: int, body: CompilationIn, user: User = Depends(professional), db: Session = Depends(get_db)):
    """Compilation of judgments for the Bench (references pinned to the matter and/or the matter's own PDFs)."""
    case = access.case_for(db, user, case_id)
    items = []
    for it in body.items:
        title, citation, doc = "", "", None
        if it.reference_id:
            ref = db.get(MatterReference, it.reference_id)
            if not ref or ref.case_id != case.id:
                raise HTTPException(404, "Reference not found on this matter.")
            doc = db.get(Document, ref.document_id) if ref.document_id else None
            title, citation = ref.title, ref.citation
            if not doc:
                raise HTTPException(400, f"'{ref.title or ref.citation}' is a citation only, with no judgment in the library.")
        elif it.document_id:
            doc = db.get(Document, it.document_id)
            if not doc or doc.case_id != case.id:
                raise HTTPException(404, "Document not found on this matter.")
        else:
            raise HTTPException(400, "Each item needs a reference or a document.")
        m = doc.meta or {}
        title = title or m.get("title") or Path(doc.filename).stem
        citation = citation or " | ".join(x for x in (m.get("neutral_citation"), m.get("scr_citation")) if x)
        pdf, original = compilation.document_pdf(db, doc)
        items.append({"title": title, "citation": citation, "pdf": pdf, "original": original,
                      "relied_pages": compilation.parse_pages(it.relied_pages), "highlights": it.highlights})
    head = {**_head(db, case, user), "side": body.side, "volume": body.volume}
    out, report = compilation.build_compilation(head, items)
    db.add(AuditEvent(entity="compilation", entity_id=case.id, case_id=case.id, user_id=user.id, event="exported",
                      detail={"items": len(items), "text_copies": sum(not r["original"] for r in report)}))
    db.commit()
    return _pdf_response(out, f"{_safe_name(case.title)}_Compilation.pdf", {"items": report})


# ---------------------------------------------------------------- AI incident reporting (Reg 39)

class IncidentIn(BaseModel):
    feature: str = Field(max_length=40)
    category: Literal["wrong_citation", "fabricated", "wrong_fact", "harmful", "other"]
    description: str = Field(min_length=5, max_length=3000)
    excerpt: str = Field("", max_length=4000)
    context: dict = {}
    ai_output_id: int | None = None


@router.post("/ai-incidents")
def report_incident(body: IncidentIn, user: User = Depends(member), db: Session = Depends(get_db)):
    out = db.get(AIOutput, body.ai_output_id) if body.ai_output_id else None
    if out and out.workspace_id != user.workspace_id:
        out = None
    db.add(AIIncident(workspace_id=user.workspace_id, user_id=user.id, feature=body.feature, category=body.category,
                      description=body.description, excerpt=body.excerpt or (out.output[:4000] if out else ""),
                      context=body.context, ai_output_id=out.id if out else None))
    db.commit()
    return {"ok": True, "message": "Thank you - the report was logged for review."}


def _incident_rows(db: Session) -> list[dict]:
    rows = db.query(AIIncident).order_by(AIIncident.id.desc()).limit(500).all()
    uids = {r.user_id for r in rows} | {r.reviewed_by for r in rows if r.reviewed_by}
    users = {u.id: u.name for u in db.query(User).filter(User.id.in_(uids))} if uids else {}
    outs = {o.id: o for o in db.query(AIOutput).filter(AIOutput.id.in_({r.ai_output_id for r in rows if r.ai_output_id}))}
    return [{"id": r.id, "feature": r.feature, "category": r.category, "description": r.description, "excerpt": r.excerpt,
             "context": r.context, "status": r.status, "reported_by": users.get(r.user_id), "created_at": r.created_at,
             "cause": r.cause, "consequences": r.consequences, "remedial_measures": r.remedial_measures,
             "reviewed_by": users.get(r.reviewed_by), "reviewed_at": r.reviewed_at, "ai_output_id": r.ai_output_id,
             "ai_model": outs[r.ai_output_id].model if r.ai_output_id in outs else None,
             "ai_prompt": outs[r.ai_output_id].prompt if r.ai_output_id in outs else None} for r in rows]


@router.get("/admin/ai-incidents")
def list_incidents(_: User = Depends(platform_admin), db: Session = Depends(get_db)):
    return _incident_rows(db)


@router.get("/admin/ai-incidents.csv")
def incidents_csv(_: User = Depends(platform_admin), db: Session = Depends(get_db)):
    """Reg 39(1): type, cause, manner of occurrence, consequences and remedial measures of every AI incident."""
    import csv
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "reported on", "feature", "type", "manner of occurrence (report)", "cause", "consequences",
                "remedial measures", "status", "reported by", "reviewed by", "reviewed on", "AI model", "AI output id"])
    for r in _incident_rows(db):
        w.writerow([r["id"], r["created_at"], r["feature"], r["category"], r["description"], r["cause"], r["consequences"],
                    r["remedial_measures"], r["status"], r["reported_by"], r["reviewed_by"] or "", r["reviewed_at"] or "",
                    r["ai_model"] or "", r["ai_output_id"] or ""])
    return Response("﻿" + buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="AI_incident_register.csv"'})


class IncidentUpdate(BaseModel):
    status: Literal["open", "reviewed", "resolved"] | None = None
    cause: str | None = Field(None, max_length=4000)
    consequences: str | None = Field(None, max_length=4000)
    remedial_measures: str | None = Field(None, max_length=4000)


@router.patch("/admin/ai-incidents/{iid}")
def update_incident(iid: int, body: IncidentUpdate, admin: User = Depends(platform_admin), db: Session = Depends(get_db)):
    r = db.get(AIIncident, iid)
    if not r:
        raise HTTPException(404, "Not found.")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(r, k, v)
    if body.status in ("reviewed", "resolved") and body.status == "resolved" and not (r.cause and r.remedial_measures):
        raise HTTPException(400, "Record the cause and the remedial measures before marking the incident resolved.")
    r.reviewed_by, r.reviewed_at = admin.id, datetime.utcnow()
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- AI-use disclosure report (Reg 43(4))

FIXED_PARTS = ["Cause title", "Listing proforma", "Main and interim prayers (default wording)", "Certificate", "Affidavit and verification",
               "I.A. texts (exemption, delay, stay)", "Vakalatnama and memo of appearance", "Index"]
EVENT_TEXT = {"created": "Package created", "edited": "Edited by advocate", "ai_generated": "AI drafted sections",
              "citations_checked": "Citations checked against library", "checklist": "Verification checklist updated",
              "approved": "Approved for filing", "approval_revoked": "Approval withdrawn (edited after approval)",
              "exported": "Exported"}


@router.get("/filing/{pid}/disclosure")
def disclosure_report(pid: int, user: User = Depends(professional), db: Session = Depends(get_db)):
    """What the Court may ask under Reg 43(4): the AI system used, the nature and extent of its assistance, and the
    steps taken to verify it - built from the audit trail, so it can be produced on request."""
    import html as h

    pkg, case = _pkg(db, user, pid)
    events = db.query(AuditEvent).filter(AuditEvent.entity == "filing_package", AuditEvent.entity_id == pkg.id) \
        .order_by(AuditEvent.id).all()
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_({e.user_id for e in events if e.user_id}))}
    ist = ZoneInfo("Asia/Kolkata")  # timestamps are stored in UTC; Indian courts read IST
    when = lambda e: e.created_at.replace(tzinfo=timezone.utc).astimezone(ist).strftime("%d.%m.%Y %H:%M IST") if e.created_at else ""
    ai_runs = [e for e in events if e.event == "ai_generated"]
    first_ai = ai_runs[0].id if ai_runs else None
    edits_after = [e for e in events if e.event == "edited" and first_ai and e.id > first_ai]
    cite = next((e for e in reversed(events) if e.event == "citations_checked"), None)
    approved = next((e for e in reversed(events) if e.event == "approved"), None)
    ticks = {}
    for e in events:
        if e.event == "checklist":
            for k, v in (e.detail or {}).items():
                ticks[k] = (v, names.get(e.user_id, ""), when(e))
    models = sorted({(e.detail or {}).get("model") for e in ai_runs if (e.detail or {}).get("model")})
    aor = _aor(db, case, user)

    def li(items):
        return "<ul>" + "".join(f"<li>{h.escape(str(i))}</li>" for i in items) + "</ul>" if items else "<p>None.</p>"

    body = [f"<h1>DISCLOSURE OF USE OF ARTIFICIAL INTELLIGENCE</h1>",
            f"<p class='c'>(Prepared for production on request under Regulation 43(4), draft Regulations for Use of Artificial "
            f"Intelligence in Courts, 2026)</p>",
            f"<p><b>Matter:</b> {h.escape(case.title)}<br><b>Filing:</b> {h.escape(T.PROCEEDINGS[pkg.proceeding]['label'])} - paper-book "
            f"version {pkg.version}<br><b>Status:</b> {'Approved' if pkg.status == 'approved' else 'Draft - not yet approved'}"
            f"<br><b>Report generated:</b> {datetime.now(ist):%d.%m.%Y %H:%M} IST by {h.escape(user.name)}</p>",
            "<h2>1. AI system used</h2>"]
    if not ai_runs:
        body.append("<p>No artificial-intelligence drafting was used for this filing. Template text, citation checks and "
                    "formatting are rule-based software, not AI.</p>")
    else:
        body.append(li([f"Provider: Anthropic PBC - Claude, model(s): {', '.join(models) or '-'}",
                        "Accessed through the Nyay Apex platform (cloud API). Under the provider's commercial API terms, "
                        "request data is not used to train its models.",
                        f"Personal identifiers (phone, e-mail, Aadhaar, PAN) "
                        f"{'were masked before any text was sent to the AI provider' if settings.ai_mask_pii else 'were NOT masked'}.",
                        "Purpose: first draft of narrative sections only. The AI made no decision and predicted no outcome."]))
        body.append("<h2>2. Nature and extent of AI assistance</h2>")
        body.append("<table><tr><th>When</th><th>By</th><th>Sections drafted by AI</th><th>Material given to the AI</th></tr>" + "".join(
            f"<tr><td>{when(e)}</td><td>{h.escape(names.get(e.user_id, ''))}</td>"
            f"<td>{h.escape(', '.join((e.detail or {}).get('sections') or []))}</td>"
            f"<td>{h.escape(', '.join(x for x in ((e.detail or {}).get('inputs_used') or []) if x))}</td></tr>" for e in ai_runs) + "</table>")
        body.append("<p><b>Parts written without AI</b> (fixed templates and the advocate's own entries):</p>" + li(FIXED_PARTS))
        body.append("<p><b>Changes made by the advocate after the AI draft:</b></p>" + li(
            [f"{when(e)} - {names.get(e.user_id, '')}: {', '.join((e.detail or {}).get('sections') or [])}" for e in edits_after]))
    body.append(f"<h2>{3 if ai_runs else 2}. Steps taken to verify</h2>")
    body.append("<p><b>Citation check:</b> " + (
        f"{cite.detail.get('total', 0)} authorities found; {cite.detail.get('verified', 0)} matched to the Supreme Court judgment "
        f"library, {cite.detail.get('cited', 0)} found cited in other judgments, {cite.detail.get('unknown', 0)} not found "
        f"(checked {when(cite)} by {h.escape(names.get(cite.user_id, ''))})." if cite else "not run.") + "</p>")
    body.append("<table><tr><th>Verification item</th><th>Confirmed</th><th>By / when</th></tr>" + "".join(
        f"<tr><td>{h.escape(label)}</td><td class='c'>{'Yes' if ticks.get(k, (False,))[0] else 'No'}</td>"
        f"<td>{h.escape(ticks[k][1] + ' ' + ticks[k][2]) if k in ticks else '-'}</td></tr>"
        for k, label in T.CHECKLIST if k != "ai" or ai_runs) + "</table>")
    body.append("<p><b>Approval:</b> " + (f"approved for filing by {h.escape(names.get(approved.user_id, ''))} on {when(approved)} "
                                         f"(version {(approved.detail or {}).get('version')})." if approved and pkg.status == "approved"
                                         else "not approved.") + "</p>")
    body.append("<h2>Complete activity record</h2><table><tr><th>When</th><th>Who</th><th>Event</th></tr>" + "".join(
        f"<tr><td>{when(e)}</td><td>{h.escape(names.get(e.user_id, ''))}</td><td>{h.escape(EVENT_TEXT.get(e.event, e.event))}</td></tr>"
        for e in events) + "</table>")
    body.append(f"<p>&nbsp;</p><p class='r'>{h.escape(aor['name'] or '________')}<br>Advocate-on-Record<br>"
                f"AOR Code: {h.escape(aor['aor_code'] or '________')}</p>")
    data = compilation.html_to_pdf("".join(body))
    audit(db, pkg, user, "exported", format="ai_disclosure_report")
    db.commit()
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{_safe_name(case.title)}_AI_Disclosure.pdf"'})
