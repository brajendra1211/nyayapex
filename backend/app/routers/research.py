"""Legal Research, Precedent Validator, Courtroom Assistant, Citation Manager.

Research runs over the library of judgments uploaded to Document Intelligence.
Hooking up the full SC corpus is pending the build-vs-license decision (PRD section 14).
"""

import csv
import io
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import member, require_types
from ..config import settings
from ..db import get_db
from collections import Counter

from sqlalchemy import text

from .. import citegraph
from ..db import IS_PG
from ..models import CitationEdge, Document, SavedCitation, UsageLog, User
from ..services import access, ai_log, citation_intel, legal_hindi, llm, tribunal
from ..services.citations import TREATMENT_WORDS, find_citations, normalize
from ..services.prompts import CITIZEN_RESEARCH_SYSTEM, COURTROOM_SYSTEM, RESEARCH_SYSTEM
from ..services.retrieval import SearchFilters, passages_citing, provision_variants, search
from .law import lookup_references

router = APIRouter(prefix="/api", tags=["research"])


def _excerpts(db: Session, hits) -> str:
    labels = _label(db, hits)
    return "\n\n".join(f"[{labels[c.id]} p.{c.page_start}-{c.page_end}]\n{c.text[:3500]}" for c, _ in hits)


def _snippet(body: str, terms: list[str], size: int = 420) -> str:
    """The part of the passage where the searched words are, not just its opening."""
    body = re.sub(r"\[p\.\d+\]\s*", "", body).strip()
    low = body.lower()
    at = min((i for i in (low.find(t) for t in terms) if i >= 0), default=0)
    start = max(0, at - 120)
    if start:
        space = body.find(" ", start)
        start = space + 1 if 0 <= space < at else start
    return ("… " if start else "") + body[start:start + size].strip() + (" …" if start + size < len(body) else "")


def _search_terms(query: str) -> list[str]:
    return [t for t in dict.fromkeys(re.findall(r"[a-z0-9]{3,}", query.lower()))
            if t not in {"the", "and", "for", "with", "that", "this", "from", "was", "are", "can", "when", "what", "under", "section", "article"}][:12]


def _sources(db: Session, hits, query: str = "") -> list[dict]:
    terms = _search_terms(query)
    docs = {d.id: d for d in db.query(Document).filter(Document.id.in_({c.document_id for c, _ in hits}))}
    out = []
    for c, s in hits:
        d = docs.get(c.document_id)
        m = (d.meta or {}) if d else {}
        out.append({
            "document_id": c.document_id, "document": m.get("title") or (d.filename if d else ""),
            "library": "public" if d and d.workspace_id is None else "private",
            "scr_citation": m.get("scr_citation"), "neutral_citation": m.get("neutral_citation"),
            "decision_date": m.get("decision_date"), "source_url": m.get("source_url"),
            "pages": [c.page_start, c.page_end], "score": round(s, 2),
            "snippet": _snippet(c.text, terms),
            "judges": m.get("judges"),
            "citations": [x["citation"] for x in find_citations(c.text)][:5],
            "matched_by": getattr(c, "matched_by", []),
            **(tribunal.label(m) if d and d.kind == "judgment" else {}),
        })
    return out


def _label(db: Session, hits) -> dict[int, str]:
    """Excerpt labels Claude cites: case name + citation for library judgments, doc:ID otherwise."""
    docs = {d.id: d for d in db.query(Document).filter(Document.id.in_({c.document_id for c, _ in hits}))}
    labels = {}
    for c, _ in hits:
        d = docs.get(c.document_id)
        m = (d.meta or {}) if d else {}
        cite = m.get("neutral_citation") or m.get("scr_citation")
        if d and d.kind == "judgment" and tribunal.forum_of(m) != "SC":
            labels[c.id] = f"{m.get('title') or d.filename}, {tribunal.forum_of(m)} {m.get('case_no') or ''} ({m.get('decision_date') or 'date n/a'})".replace("  ", " ")
        else:
            labels[c.id] = f"{m.get('title')}, {cite}" if d and d.kind == "judgment" and cite else f"doc:{c.document_id}"
    return labels


class ResearchQuery(BaseModel):
    query: str
    deep: bool = False
    ai: bool = True
    year_from: int | None = Field(None, ge=1900, le=2100)
    year_to: int | None = Field(None, ge=1900, le=2100)
    judge: str = Field("", max_length=80)
    party: str = Field("", max_length=120)
    provision: str = Field("", max_length=80)
    sort: Literal["relevance", "newest", "oldest"] = "relevance"
    limit: int | None = Field(None, ge=1, le=30)
    lang: Literal["en", "hi"] = "en"  # answer language (plain-language answers for individual accounts)
    forum: Literal["", "SC", "NCLAT", "NCLT"] = ""  # only judgments of this court / tribunal


LANG_NAME = {"en": "English", "hi": "Hindi (Devanagari script; keep section numbers, case names and citations as written)"}


def _is_individual(user: User) -> bool:
    return bool(user.workspace and user.workspace.type == "individual")


@router.post("/research")
def research(body: ResearchQuery, user: User = Depends(member), db: Session = Depends(get_db)):
    query = " ".join(body.query.split())  # same question, same prompt -> local cache hit, 0 tokens
    filters = SearchFilters(body.year_from, body.year_to, body.judge, body.party, body.provision, body.forum)
    # Provisions named in the question ("438 CrPC", "Article 21"): verbatim text from the bare-act library
    expanded, english = legal_hindi.expand(query)  # Hindi / Hinglish legal terms -> the judgments' English words
    statutes = lookup_references(db, expanded, limit=3)
    # Old and new law are searched together: most case law on BNS 103 is written under IPC 302
    also = [f"{'Article' if c == 'COI' else 'Section'} {n} {c}" for s in statutes
            for c, n in provision_variants(db, f"{s['code']} {s['number']}" if s["code"] != "COI" else f"Article {s['number']}")[:3]
            if (c, n) != (s["code"], s["number"])]
    limit = body.limit or settings.research_sources
    # Date order is taken across the best 30 matches, not only the few that will be shown
    hits = search(db, " ".join([query, *also]), user.workspace_id, k=limit if body.sort == "relevance" else 30, filters=filters)
    sources = _sources(db, hits, query)
    if body.sort != "relevance":
        sources.sort(key=lambda s: s.get("decision_date") or "", reverse=body.sort == "newest")
        sources = sources[:limit]
    result = {"sources": sources, "statutes": statutes, "terms": _search_terms(expanded), "also_searched": english, "answer": None, "cost_usd": None,
              "filters_applied": filters.active()}
    if hits and body.ai:
        to_ai = hits[:settings.research_passages_to_ai]
        law_text = "".join(f"[{x['code']} s.{x['number']}{' - ' + x['title'] if x['title'] else ''}]\n{x['text'][:2500]}\n\n"
                           for x in statutes if x.get("text"))
        before = _last_usage_id(db, user.workspace_id)
        result["answer"] = llm.ask(
            db, feature="research_deep" if body.deep else "research",
            system=(CITIZEN_RESEARCH_SYSTEM.format(words=settings.research_answer_words, lang=LANG_NAME[body.lang]) if _is_individual(user)
                    else RESEARCH_SYSTEM.format(words=settings.research_answer_words)
                    + ("" if body.lang == "en" else f" Write the answer in {LANG_NAME[body.lang]}.")),
            user=(f"Statutory text:\n{law_text}" if law_text else "") + f"Excerpts:\n{_excerpts(db, to_ai)}\n\nResearch query: {query}",
            smart=body.deep, model=(settings.model_deep_research or None) if body.deep else None,
            effort=settings.deep_research_effort if body.deep else "low",
            # Quick answers skip thinking: otherwise it can use up the budget before the answer is written
            max_tokens=3000 if body.deep else 2000, think=body.deep, workspace_id=user.workspace_id)
        result["cost_usd"] = _cost_since(db, user.workspace_id, before)
        result["ai_log_id"] = ai_log.record(db, feature="research_deep" if body.deep else "research", output=result["answer"],
                                            user=user, prompt=query, sources=[f"{x['code']} s.{x['number']}" for x in statutes if x.get("text")]
                                            + ai_log.source_labels(result["sources"][:len(to_ai)]))
    return result


def _last_usage_id(db: Session, workspace_id: int) -> int:
    return db.query(func.coalesce(func.max(UsageLog.id), 0)).filter(UsageLog.workspace_id == workspace_id).scalar()


def _cost_since(db: Session, workspace_id: int, after_id: int) -> float:
    """What the call just made cost (0 when served from the local cache)."""
    return round(db.query(func.coalesce(func.sum(UsageLog.cost_usd), 0.0))
                 .filter(UsageLog.workspace_id == workspace_id, UsageLog.id > after_id).scalar(), 5)


class CourtQuery(BaseModel):
    query: str
    case_id: int | None = None  # answer from this matter's record first, then the library


@router.post("/courtroom")
def courtroom(body: CourtQuery, user: User = Depends(require_types("advocate", "firm")), db: Session = Depends(get_db)):
    case = access.case_for(db, user, body.case_id) if body.case_id else None
    hits = search(db, body.query, user.workspace_id, k=4)
    if case:
        own = [d for (d,) in db.query(Document.id).filter(Document.case_id == case.id, Document.superseded.is_(False))]
        record = search(db, body.query, user.workspace_id, own, k=2) if own else []
        seen = {p.id for p, _ in record}
        hits = (record + [h for h in hits if h[0].id not in seen])[:5]
    if not hits:
        return {"answer": "No authority in your library.", "sources": []}
    answer = llm.ask(db, feature="courtroom", system=COURTROOM_SYSTEM,
                     user=f"Excerpts:\n{_excerpts(db, hits)}\n\nBench question: {body.query}",
                     smart=False, effort="low", max_tokens=800, think=False, workspace_id=user.workspace_id)
    sources = _sources(db, hits, body.query)
    log_id = ai_log.record(db, feature="courtroom", output=answer, user=user, prompt=body.query, case_id=case.id if case else None,
                           sources=ai_log.source_labels(sources))
    return {"answer": answer, "sources": sources, "ai_log_id": log_id}


class ValidityIn(BaseModel):
    document_ids: list[int] = Field(max_length=30)


def treatment_status(v: Counter) -> str:
    """Status from how many citing judgments used each kind of word. One stray "overruled" near a much-followed
    judgment's name (it usually overruled something else) must not flip it, so proportions decide."""
    total = sum(v.values())
    if not total:
        return "Unverified"
    against = v["Overruled"] + v["Doubtful"]
    if v["Overruled"] >= 3 and v["Overruled"] / total >= 0.4:
        return "Overruled"
    if against >= 2 and against / total >= 0.15:
        return "Mixed"  # treated differently by later benches: read them
    if v["Good Law"] >= 2 and v["Good Law"] / total >= 0.5:
        return "Good Law"
    if v["Distinguished"] >= max(1, v["Good Law"]):
        return "Distinguished"
    return "Unverified"


NEAR = 150  # characters either side of a case name in which a treatment word counts
OTHER_CASE = re.compile(r"\s(?:v\.|vs\.?|versus)\s", re.I)


def _treatments_by_name(db: Session, d: Document, citing_ids: list[int]) -> Counter:
    """How later judgments that cite `d` (citation graph) describe it, read next to its name. A word counts only when no
    other case name stands between it and this one, so "X overruled Y" is not read as X being overruled."""
    if not IS_PG or not citing_ids:
        return Counter()
    pet = citegraph.split_parties((d.meta or {}).get("title") or "")[0]
    words = [w for w in re.findall(r"[a-z0-9]+", pet.lower()) if w not in citegraph.NOISE and len(w) > 1][:2]
    if not words or max(len(w) for w in words) < 4:
        return Counter()
    name_rx = re.compile(r"\W+".join(re.escape(w) for w in words), re.I)
    rows = db.execute(text("SELECT document_id, text FROM passages WHERE document_id = ANY(:ids) "
                           "AND tsv @@ phraseto_tsquery('english', :n) LIMIT 400"), {"ids": citing_ids[:200], "n": " ".join(words)}).all()
    found: dict[int, set] = {}
    for did, body in rows:
        for hit in name_rx.finditer(body):
            before = body[max(0, hit.start() - NEAR): hit.start()]
            after = body[hit.end(): hit.end() + NEAR]
            for status, rx in TREATMENT_WORDS.items():
                for side, chunk in (("before", before), ("after", after)):
                    for m in rx.finditer(chunk):
                        between = chunk[m.end():] if side == "before" else chunk[:m.start()]
                        if not OTHER_CASE.search(between):
                            found.setdefault(did, set()).add(status)
    return Counter(s for statuses in found.values() for s in statuses)  # one vote per citing judgment and status


@router.get("/judgments/{doc_id}/citations")
def judgment_citations(doc_id: int, _: User = Depends(member), db: Session = Depends(get_db)):
    """Precedent graph of one library judgment: the judgments it cites and those that cite it (citation graph)."""
    d = db.get(Document, doc_id)
    if not d or d.kind != "judgment" or d.workspace_id is not None:
        raise HTTPException(404, "Judgment not found in the library.")

    def card(x: Document) -> dict:
        m = x.meta or {}
        return {"id": x.id, "title": m.get("title") or x.filename, "year": (m.get("decision_date") or "")[:4],
                "citation": m.get("neutral_citation") or m.get("scr_citation"), "cited_by": x.cited_by or 0}

    cited_by = db.query(Document).join(CitationEdge, CitationEdge.citing_id == Document.id).filter(CitationEdge.cited_id == d.id).all()
    cites = db.query(Document).join(CitationEdge, CitationEdge.cited_id == Document.id).filter(CitationEdge.citing_id == d.id).all()
    return {"judgment": card(d), "cited_by": sorted((card(x) for x in cited_by), key=lambda c: c["year"], reverse=True),
            "cites": sorted((card(x) for x in cites), key=lambda c: -c["cited_by"]),
            "unlinked_citations": max(0, len(d.citations or []) - len(cites)),
            "note": "Links come from the citations in each judgment, matched to the library by citation number or by case "
                    "name and year. Citations that could not be matched to exactly one judgment are not shown."}


@router.post("/research/validity")
def research_validity(body: ValidityIn, user: User = Depends(member), db: Session = Depends(get_db)):
    """Subsequent treatment of each result, read from later judgments in the library that cite it. Uses citations only,
    so a judgment later judgments cite differently (e.g. only by SCC) shows as Unverified rather than as good law."""
    out = {}
    docs = db.query(Document).filter(Document.id.in_(body.document_ids), Document.kind == "judgment", Document.workspace_id.is_(None)).all()
    for d in docs:
        m = d.meta or {}
        cites = [c for c in (m.get("neutral_citation"), m.get("scr_citation")) if c]
        treatments, citing = [], set()
        for cite in cites:
            pattern = re.compile(r"\W*".join(re.escape(t) for t in re.findall(r"[A-Za-z0-9]+", cite)), re.I)
            for c in passages_citing(db, cite, user.workspace_id, d.id):
                for hit in pattern.finditer(c.text):
                    citing.add(c.document_id)
                    window = c.text[max(0, hit.start() - 400): hit.end() + 400]
                    treatments += [st for st, rx in TREATMENT_WORDS.items() if rx.search(window)]
        graph = [i for (i,) in db.query(CitationEdge.citing_id).filter(CitationEdge.cited_id == d.id)]
        by_name = _treatments_by_name(db, d, graph)
        votes = Counter(treatments) + by_name
        status = treatment_status(votes)
        n = max(len(citing | set(graph)), d.cited_by or 0)
        out[d.id] = {"status": status, "cited_by": n, "citation": cites[0] if cites else None,
                     "treatments": {k: votes[k] for k in ("Good Law", "Distinguished", "Doubtful", "Overruled") if votes[k]},
                     "strength": "Frequently cited" if n >= 5 else "Moderately cited" if n >= 2 else "Rarely cited" if n == 1 else "Not cited in library"}
    return out


class PrecedentQuery(BaseModel):
    query: str


@router.post("/precedent")
def validate_precedent(body: PrecedentQuery, user: User = Depends(member), db: Session = Depends(get_db)):
    norm = normalize(body.query)
    target = norm["citation"] if norm else body.query.strip()
    if len(target) < 4:
        raise HTTPException(400, "Enter a citation or case name.")
    # Tolerant regex: "(2017) 10 SCC 1" also matches "(2017)10 SCC 1"
    pattern = re.compile(r"\s*".join(re.escape(t) for t in re.split(r"\s+", target)), re.I)

    # Candidates: passages hybrid search ranks highest for the citation (private docs + public library)
    hits = search(db, target, user.workspace_id, k=80)
    own = {d.id for d in db.query(Document).filter(Document.id.in_({p.document_id for p, _ in hits}))
           if target in ((d.meta or {}).get("scr_citation"), (d.meta or {}).get("neutral_citation"))}
    treatments: list[dict] = []
    citing_docs: set[int] = set()
    for c, _ in hits:
        if c.document_id in own:  # the judgment itself is not "subsequent treatment"
            continue
        for m in pattern.finditer(c.text):
            citing_docs.add(c.document_id)
            window = c.text[max(0, m.start() - 400): m.end() + 400]
            for status, rx in TREATMENT_WORDS.items():
                if rx.search(window):
                    page = re.findall(r"\[p\.(\d+)\]", c.text[: m.start()])
                    treatments.append({"status": status, "document_id": c.document_id,
                                       "page": int(page[-1]) if page else c.page_start,
                                       "context": re.sub(r"\s+", " ", window).strip()[:500]})
                    break

    found = {t["status"] for t in treatments}
    status = next((s for s in ("Overruled", "Doubtful", "Distinguished", "Good Law") if s in found), "Unverified")
    n = len(citing_docs)
    strength = "Frequently cited" if n >= 5 else "Moderately cited" if n >= 2 else "Rarely cited" if n == 1 else "Not in library"
    risk = None
    if status == "Overruled":
        risk = "HIGH RISK: subsequent treatment in your library indicates this authority was overruled. Do not rely on it without checking the overruling judgment."
    elif status == "Doubtful":
        risk = "CAUTION: this authority has been doubted or referred to a larger Bench."
    elif status == "Unverified":
        risk = "Status could not be verified from your library. Check SCC Online / the SC website before relying on it."
    return {"query": body.query, "citation": norm, "status": status, "strength": strength, "citing_documents": n,
            "treatments": treatments[:20], "risk": risk,
            "note": "Derived from the Nyay Apex library (public SC judgments + your documents). Treatment is detected "
                    "from wording near the citation - confirm by reading the citing judgment."}


# ---------- Citation Manager ----------

class TextIn(BaseModel):
    text: str


def _saved_dict(c: SavedCitation, pref: str | None) -> dict:
    parallels = c.parallels or []
    return {"id": c.id, "citation": c.citation, "case_name": c.case_name, "reporter": c.reporter, "note": c.note,
            "status": c.status or "unknown", "parallels": parallels, "cited_in": c.cited_in,
            "judgment_id": c.judgment_id, "verified_at": c.verified_at,
            "preferred": citation_intel.preferred(c.citation, parallels, pref)}


def _apply(c: SavedCitation, info: dict, db: Session) -> None:
    c.status, c.parallels, c.cited_in = info["status"], info["parallels"], info["cited_in"]
    c.judgment_id = (info.get("judgment") or {}).get("id")
    if info.get("case_name") and not c.case_name:
        c.case_name = info["case_name"][:300]
    c.verified_at = datetime.utcnow()


def _judgment_links(db: Session, rows: list[SavedCitation]) -> dict[int, dict]:
    ids = {r.judgment_id for r in rows if r.judgment_id}
    return {d.id: {"title": (d.meta or {}).get("title"), "decision_date": (d.meta or {}).get("decision_date"),
                   "source_url": (d.meta or {}).get("source_url")}
            for d in db.query(Document).filter(Document.id.in_(ids))} if ids else {}


def _with_judgment(db: Session, rows: list[SavedCitation], pref: str | None) -> list[dict]:
    links = _judgment_links(db, rows)
    return [{**_saved_dict(r, pref), "judgment": links.get(r.judgment_id)} for r in rows]


@router.post("/citations/parse")
def parse_citations(body: TextIn, user: User = Depends(member), db: Session = Depends(get_db)):
    """Find citations in pasted text and say which are in the library (fast check, no parallel mining)."""
    saved = {citation_intel.key(c.citation) for c in db.query(SavedCitation.citation).filter(SavedCitation.workspace_id == user.workspace_id)}
    seen, out = set(), []
    for c in find_citations(body.text):
        k = citation_intel.key(c["citation"])
        if k in seen:
            continue
        seen.add(k)
        info = citation_intel.quick(db, c["citation"], user.workspace_id) or {}
        # library title beats the text heuristic; otherwise use the name written next to the citation
        name = info.get("case_name") if info.get("status") == "verified" else (c["case_name"] or info.get("case_name", ""))
        out.append({**info, "case_name": name or "", "raw": c["raw"], "saved": k in saved})
        if len(out) >= 40:
            break
    return out


@router.post("/citations/check")
def check_citations(body: TextIn, user: User = Depends(member), db: Session = Depends(get_db)):
    """Citation validation before a document is finalised (PRD 6.3): every citation in a draft, with its status."""
    items = parse_citations(body, user, db)
    return {"total": len(items), "verified": sum(i.get("status") == "verified" for i in items),
            "cited": sum(i.get("status") == "cited" for i in items),
            "unknown": sum(i.get("status") == "unknown" for i in items), "items": items}


class CitationIn(BaseModel):
    citation: str
    case_name: str = ""
    note: str = ""


@router.get("/citations")
def list_citations(q: str = "", user: User = Depends(member), db: Session = Depends(get_db)):
    query = db.query(SavedCitation).filter(SavedCitation.workspace_id == user.workspace_id)
    if q:
        like = f"%{q}%"
        query = query.filter((SavedCitation.citation.ilike(like)) | (SavedCitation.case_name.ilike(like)) | (SavedCitation.note.ilike(like)))
    return _with_judgment(db, query.order_by(SavedCitation.id.desc()).all(), user.citation_pref)


@router.post("/citations")
def save_citation(body: CitationIn, user: User = Depends(member), db: Session = Depends(get_db)):
    info = citation_intel.lookup(db, body.citation, user.workspace_id)
    if not info:
        raise HTTPException(400, "Not a recognised SCC / AIR / MANU / SCR / INSC / SCC OnLine citation.")
    # Same judgment already saved under this or a parallel citation?
    keys = {citation_intel.key(info["citation"])} | {citation_intel.key(p["citation"]) for p in info["parallels"]}
    for existing in db.query(SavedCitation).filter(SavedCitation.workspace_id == user.workspace_id):
        if citation_intel.key(existing.citation) in keys:
            return {**_with_judgment(db, [existing], user.citation_pref)[0], "duplicate": True}
    c = SavedCitation(workspace_id=user.workspace_id, citation=info["citation"], reporter=info["reporter"],
                      case_name=(body.case_name.strip() or info["case_name"] or "")[:300], note=body.note)
    _apply(c, info, db)
    db.add(c)
    db.commit()
    return _with_judgment(db, [c], user.citation_pref)[0]


@router.post("/citations/{cid}/verify")
def reverify(cid: int, user: User = Depends(member), db: Session = Depends(get_db)):
    c = db.get(SavedCitation, cid)
    if not c or c.workspace_id != user.workspace_id:
        raise HTTPException(404, "Citation not found.")
    info = citation_intel.lookup(db, c.citation, user.workspace_id)
    if info:
        _apply(c, info, db)
        db.commit()
    return _with_judgment(db, [c], user.citation_pref)[0]


@router.delete("/citations/{cid}")
def delete_citation(cid: int, user: User = Depends(member), db: Session = Depends(get_db)):
    c = db.get(SavedCitation, cid)
    if c and c.workspace_id == user.workspace_id:
        db.delete(c)
        db.commit()
    return {"ok": True}


@router.get("/citations/export")
def export_citations(user: User = Depends(member), db: Session = Depends(get_db)):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["case_name", "citation", "reporter", "parallel_citations", "library_status", "cited_in_judgments", "note"])
    for c in db.query(SavedCitation).filter(SavedCitation.workspace_id == user.workspace_id).order_by(SavedCitation.case_name):
        w.writerow([c.case_name, c.citation, c.reporter, "; ".join(p["citation"] for p in (c.parallels or [])),
                    c.status or "", c.cited_in if c.cited_in is not None else "", c.note])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=citations.csv"})
