"""Citation intelligence over the judgment library - zero AI tokens.

lookup(citation) answers three questions:
  1. Is this citation a judgment in our library?  -> "verified" (title, date, bench, PDF link)
  2. If not, do library judgments cite it?        -> "cited" (count) - it very likely exists
  3. What are its parallel citations?             -> SCC <-> SCR <-> AIR <-> INSC <-> SCC OnLine

Parallels come from (a) the library judgment's own metadata (SCR + INSC) and (b) how e-SCR judgments
list authorities: "Maneka Gandhi v. Union of India [1978] 2 SCR 621 : (1978) 1 SCC 248" - citations
joined by ":" are the same judgment. A pair seen in more than one judgment is more reliable.
"""

import re
from collections import Counter

from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from ..db import IS_PG
from ..models import Document, Passage
from .citations import find_citations, normalize

MAX_PASSAGES = 300
WINDOW = 260
# what may sit between two citations of the same judgment: optional pinpoint page(s), then ":" or "="
JOIN_RE = re.compile(r"^[\s\]\)]*(?:,\s*\d+(?:\s*[-–]\s*\d+)?)?[\s\]\)]*[:=][\s\[\(]*$")


def key(citation: str | None) -> str:
    """'[2025] 1 S.C.R. 81' and '(2025) 1 SCR 81' -> '20251scr81' (punctuation-insensitive identity)."""
    return re.sub(r"[^a-z0-9]", "", (citation or "").lower())


def _words(citation: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", citation.lower()))


def _judgment(db: Session, k: str) -> Document | None:
    if not k:
        return None
    if IS_PG:
        row = db.execute(text(
            "SELECT id FROM documents WHERE kind = 'judgment' AND ("
            "regexp_replace(lower(coalesce(meta->>'scr_citation','')), '[^a-z0-9]', '', 'g') = :k OR "
            "regexp_replace(lower(coalesce(meta->>'neutral_citation','')), '[^a-z0-9]', '', 'g') = :k) LIMIT 1"), {"k": k}).first()
        return db.get(Document, row[0]) if row else None
    for d in db.query(Document).filter(Document.kind == "judgment"):
        m = d.meta or {}
        if k in (key(m.get("scr_citation")), key(m.get("neutral_citation"))):
            return d
    return None


def _passages_citing(db: Session, citation: str, workspace_id: int | None) -> list[tuple[int, str]]:
    w = _words(citation)
    if IS_PG:
        rows = db.execute(text(
            "SELECT document_id, text FROM passages, phraseto_tsquery('simple', :w) q "
            "WHERE tsv @@ plainto_tsquery('english', :w) AND to_tsvector('simple', text) @@ q "
            "AND (workspace_id IS NULL OR workspace_id = :ws) LIMIT :n"), {"w": w, "ws": workspace_id or -1, "n": MAX_PASSAGES})
        return [(r[0], r[1]) for r in rows]
    first = w.split()[-1] if w else ""
    q = db.query(Passage.document_id, Passage.text).filter(Passage.text.ilike(f"%{first}%"),
                                                            or_(Passage.workspace_id.is_(None), Passage.workspace_id == workspace_id))
    return [(d, t) for d, t in q.limit(MAX_PASSAGES * 5)]


def quick(db: Session, raw: str, workspace_id: int | None = None) -> dict | None:
    """Fast status for many citations at once (paragraph extract, draft check): no parallel mining."""
    norm = normalize(raw)
    if not norm:
        return None
    out = {"citation": norm["citation"], "reporter": norm["reporter"], "case_name": norm["case_name"],
           "status": "unknown", "judgment": None, "parallels": [], "cited_in": None}
    j = _judgment(db, key(norm["citation"]))
    if j:
        m = j.meta or {}
        out.update(status="verified", case_name=m.get("title") or j.filename,
                   judgment={"id": j.id, "title": m.get("title"), "decision_date": m.get("decision_date"), "source_url": m.get("source_url")})
        other = m.get("neutral_citation") if key(m.get("scr_citation")) == key(norm["citation"]) else m.get("scr_citation")
        if other:
            out["parallels"] = [{"citation": (normalize(other) or {}).get("citation", other), "reporter": (normalize(other) or {}).get("reporter", ""), "seen": 5}]
        return out
    w = _words(norm["citation"])
    if IS_PG:
        hit = db.execute(text(
            "SELECT 1 FROM passages, phraseto_tsquery('simple', :w) q WHERE tsv @@ plainto_tsquery('english', :w) "
            "AND to_tsvector('simple', text) @@ q AND (workspace_id IS NULL OR workspace_id = :ws) LIMIT 1"),
            {"w": w, "ws": workspace_id or -1}).first()
        if hit:
            out["status"] = "cited"
    return out


def lookup(db: Session, raw: str, workspace_id: int | None = None) -> dict | None:
    norm = normalize(raw)
    if not norm:
        return None
    target, k = norm["citation"], key(norm["citation"])
    out = {"citation": target, "reporter": norm["reporter"], "case_name": norm["case_name"],
           "status": "unknown", "judgment": None, "parallels": [], "cited_in": 0}

    j = _judgment(db, k)
    parallels: Counter = Counter()
    names: Counter = Counter()
    if j:
        m = j.meta or {}
        out["status"] = "verified"
        out["judgment"] = {"id": j.id, "title": m.get("title") or j.filename, "decision_date": m.get("decision_date"),
                           "judges": m.get("judges"), "source_url": m.get("source_url"),
                           "scr_citation": m.get("scr_citation"), "neutral_citation": m.get("neutral_citation")}
        out["case_name"] = out["judgment"]["title"]
        for c in (m.get("scr_citation"), m.get("neutral_citation")):
            if c and key(c) != k:
                parallels[normalize(c)["citation"] if normalize(c) else c] += 5  # authoritative

    # How other judgments cite it: count + ":"-joined parallels + the case name they use
    pattern = re.compile(r"\W*".join(re.escape(t) for t in _words(target).split()), re.I)
    citing_docs = set()
    for doc_id, body in _passages_citing(db, target, workspace_id):
        if j and doc_id == j.id:
            continue
        for mt in pattern.finditer(body):
            citing_docs.add(doc_id)
            lo = max(0, mt.start() - WINDOW)
            window = body[lo: mt.end() + WINDOW]
            cits = sorted(find_citations(window), key=lambda c: c["offset"])
            # group citations that are joined by ":" into chains
            chains, cur = [], []
            for c in cits:
                if cur:
                    prev = cur[-1]
                    gap = window[prev["offset"] + len(prev["raw"]): c["offset"]]
                    if JOIN_RE.match(gap):
                        cur.append(c)
                        continue
                    chains.append(cur)
                cur = [c]
            if cur:
                chains.append(cur)
            for chain in chains:
                if not any(key(c["citation"]) == k for c in chain):
                    continue
                for c in chain:
                    if key(c["citation"]) != k:
                        parallels[c["citation"]] += 1
                name = chain[0]["case_name"]
                if name and " v. " in name and len(name) < 160:
                    names[name] += 1
    out["cited_in"] = len(citing_docs)
    if out["status"] != "verified" and out["cited_in"]:
        out["status"] = "cited"
    if not out["case_name"] and names:
        out["case_name"] = names.most_common(1)[0][0]
    # keep parallels seen at least twice, or once when that's all the evidence there is
    min_seen = 2 if sum(parallels.values()) > 3 else 1
    out["parallels"] = [{"citation": c, "reporter": (normalize(c) or {}).get("reporter", ""), "seen": n}
                        for c, n in parallels.most_common(6) if n >= min_seen]
    return out


def preferred(saved: str, parallels: list[dict], pref: str | None) -> str:
    """Citation in the user's preferred reporter (SCC / AIR / MANU) when we know one, else the saved one."""
    if pref:
        for p in parallels:
            if p.get("reporter") == pref:
                return p["citation"]
    return saved
