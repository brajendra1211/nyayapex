"""Public judgment library: import a judgment by link, library stats."""

from datetime import datetime

import hashlib
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import member
from ..db import get_db
from ..models import Document, User
from ..services import corpus, storage, tribunal
from .auth import platform_admin

router = APIRouter(prefix="/api/corpus", tags=["corpus"])


def judgment_dict(d: Document) -> dict:
    m = d.meta or {}
    return {"id": d.id, "title": m.get("title") or d.filename, "scr_citation": m.get("scr_citation"),
            "neutral_citation": m.get("neutral_citation"), "decision_date": m.get("decision_date"),
            "judges": m.get("judges"), "disposal": m.get("disposal"), "source_url": m.get("source_url"),
            "pages": d.pages, "passages": (d.stats or {}).get("passages"), "members": m.get("members"),
            "created_at": d.created_at, **tribunal.label(m)}


class UrlIn(BaseModel):
    url: str


@router.post("/import-url")
def import_url(body: UrlIn, user: User = Depends(member), db: Session = Depends(get_db)):
    url = body.url.strip()
    try:
        data = corpus.fetch_pdf(url)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(502, "Could not download the PDF from that link. Try again.")

    from ..services.extract import extract_pdf_bytes

    try:
        first = extract_pdf_bytes(data)[0].text
    except Exception:
        raise HTTPException(400, "That PDF could not be read.")
    meta = corpus.meta_from_first_page(first, url)
    meta.update(imported_by=user.id, imported_at=datetime.utcnow().isoformat(timespec="seconds"))
    key = f"insc:{meta['neutral_citation']}" if meta.get("neutral_citation") else None
    doc, created = corpus.ingest(db, data, meta, key)
    return {"created": created, "judgment": judgment_dict(doc),
            "message": "Added to the shared judgment library." if created else "Already in the library."}


@router.get("/stats")
def stats(_: User = Depends(member), db: Session = Depends(get_db)):
    q = db.query(Document).filter(Document.kind == "judgment")
    recent = q.order_by(Document.id.desc()).limit(5).all()
    return {"judgments": q.with_entities(func.count(Document.id)).scalar() or 0,
            "recent": [judgment_dict(d) for d in recent], "attribution": corpus.ATTRIBUTION}


# ---------------------------------------------------------------- tribunal orders (platform admins add them)

MAX_ORDER_MB = 40
DATE_ISO = re.compile(r"^(19|20)\d{2}-\d{2}-\d{2}$")


@router.get("/forums")
def forums(_: User = Depends(member), db: Session = Depends(get_db)):
    """Courts and tribunals in the library, with how many judgments / orders each has."""
    counts = dict(db.execute(text("SELECT coalesce(meta->>'forum', 'SC'), count(*) FROM documents WHERE kind = 'judgment' "
                                  "GROUP BY 1")).all())
    return [{"code": k, "name": v["name"], "short": v["short"], "benches": v["benches"], "binding": v["binding"],
             "count": counts.get(k, 0)} for k, v in tribunal.FORUMS.items()]


def _missing(m: dict) -> list[str]:
    return [f for f, ok in (("case number", m.get("case_no")), ("parties", m.get("title")), ("date", m.get("decision_date")),
                            ("bench", m.get("bench"))) if not ok]


@router.post("/tribunal")
async def add_tribunal_order(
    file: UploadFile = File(...),
    forum: str = Form(...),
    bench: str = Form(""),
    case_no: str = Form(""),
    title: str = Form(""),
    decision_date: str = Form(""),
    source_url: str = Form(""),
    user: User = Depends(platform_admin),
    db: Session = Depends(get_db),
):
    """One NCLT / NCLAT order (PDF) into the shared library. Details not given are read from the order; check them after."""
    if forum not in tribunal.TRIBUNALS:
        raise HTTPException(400, f"Forum must be one of {', '.join(tribunal.TRIBUNALS)}.")
    if bench and bench not in tribunal.FORUMS[forum]["benches"]:
        raise HTTPException(400, "Unknown bench for this tribunal.")
    if decision_date and not DATE_ISO.match(decision_date):
        raise HTTPException(400, "Date must be YYYY-MM-DD.")
    if source_url and not re.match(r"^https://(www\.)?(nclt\.gov\.in|nclat\.nic\.in)/", source_url):
        raise HTTPException(400, "Source link must be on nclt.gov.in or nclat.nic.in.")
    data = await file.read()
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, f"{file.filename}: not a PDF.")
    if len(data) > MAX_ORDER_MB * 1024 * 1024:
        raise HTTPException(413, f"{file.filename}: larger than {MAX_ORDER_MB} MB.")

    from ..services.extract import extract_pdf_bytes

    try:
        pages = extract_pdf_bytes(data)
    except Exception:
        raise HTTPException(400, f"{file.filename}: the PDF could not be read.")
    head = "\n".join(p.text for p in pages[:3])
    if len(head.strip()) < 200:
        raise HTTPException(422, f"{file.filename}: no text found (a scanned copy?). Only text PDFs can be added for now.")
    meta = tribunal.meta_from_text(head, forum, bench)
    for k, v in (("case_no", case_no), ("title", title), ("decision_date", decision_date), ("source_url", source_url)):
        if v.strip():
            meta[k] = " ".join(v.split())
    meta.update(imported_by=user.id, imported_at=datetime.utcnow().isoformat(timespec="seconds"), stored=True, original_name=file.filename)
    sha = hashlib.sha256(data).hexdigest()
    storage.write(data, sha, ".pdf")  # kept (encrypted) so readers can open the order itself
    key = f"{forum}:{tribunal.norm_case_no(meta['case_no'])}:{meta['decision_date']}" if meta.get("case_no") and meta.get("decision_date") else None
    doc, created = corpus.ingest(db, data, meta, key)
    if created and not meta.get("source_url"):
        doc.meta = {**meta, "source_url": f"/api/corpus/{doc.id}/file"}
        db.commit()
    return {"created": created, "judgment": judgment_dict(doc), "check": _missing(doc.meta or {}),
            "message": "Added to the library." if created else "Already in the library."}


@router.get("/tribunal")
def list_tribunal_orders(forum: str = "", q: str = "", limit: int = 50, offset: int = 0,
                         _: User = Depends(platform_admin), db: Session = Depends(get_db)):
    qs = db.query(Document).filter(Document.kind == "judgment", Document.meta["forum"].as_string().in_(tribunal.TRIBUNALS))
    if forum in tribunal.TRIBUNALS:
        qs = qs.filter(Document.meta["forum"].as_string() == forum)
    if q.strip():
        like = "%" + q.strip().replace("%", "") + "%"
        qs = qs.filter(Document.meta["title"].as_string().ilike(like) | Document.meta["case_no"].as_string().ilike(like))
    total = qs.count()
    rows = qs.order_by(Document.id.desc()).offset(max(0, offset)).limit(min(max(1, limit), 200)).all()
    return {"total": total, "items": [judgment_dict(d) | {"check": _missing(d.meta or {})} for d in rows]}


class OrderMetaIn(BaseModel):
    title: str | None = Field(None, max_length=250)
    case_no: str | None = Field(None, max_length=200)
    bench: str | None = None
    decision_date: str | None = None
    members: str | None = Field(None, max_length=300)


def _tribunal_doc(db: Session, doc_id: int) -> Document:
    d = db.get(Document, doc_id)
    if not d or d.kind != "judgment" or tribunal.forum_of(d.meta) not in tribunal.TRIBUNALS:
        raise HTTPException(404, "Tribunal order not found.")
    return d


@router.patch("/tribunal/{doc_id}")
def edit_tribunal_order(doc_id: int, body: OrderMetaIn, _: User = Depends(platform_admin), db: Session = Depends(get_db)):
    d = _tribunal_doc(db, doc_id)
    m = dict(d.meta or {})
    changes = body.model_dump(exclude_unset=True)
    if (b := changes.get("bench")) and b not in tribunal.FORUMS[m["forum"]]["benches"]:
        raise HTTPException(400, "Unknown bench for this tribunal.")
    if (dt := changes.get("decision_date")) and not DATE_ISO.match(dt):
        raise HTTPException(400, "Date must be YYYY-MM-DD.")
    for k, v in changes.items():
        m[k] = " ".join(v.split()) if isinstance(v, str) and v.strip() else None
    d.meta = m
    if m.get("title"):
        d.filename = m["title"][:300]
    db.commit()
    return judgment_dict(d) | {"check": _missing(m)}


@router.delete("/tribunal/{doc_id}")
def delete_tribunal_order(doc_id: int, _: User = Depends(platform_admin), db: Session = Depends(get_db)):
    d = _tribunal_doc(db, doc_id)
    try:
        db.execute(text("DELETE FROM documents WHERE id = :i"), {"i": d.id})  # passages and citation links go with it
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This order is referenced elsewhere (e.g. saved to a matter) and cannot be deleted.")
    return {"ok": True}


@router.get("/{doc_id}/file")
def library_file(doc_id: int, _: User = Depends(member), db: Session = Depends(get_db)):
    """The stored PDF of a library order that was uploaded (Supreme Court judgments open at their source link instead)."""
    d = db.get(Document, doc_id)
    if not d or d.kind != "judgment" or not (d.meta or {}).get("stored"):
        raise HTTPException(404, "File not found.")
    try:
        data = storage.read(d.sha256, ".pdf")
    except FileNotFoundError:
        raise HTTPException(404, "File not found.")
    name = re.sub(r"[^A-Za-z0-9 ._-]+", "", (d.meta or {}).get("case_no") or f"order-{d.id}")[:80] or f"order-{d.id}"
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{name}.pdf"'})
