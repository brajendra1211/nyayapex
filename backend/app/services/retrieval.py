"""Hybrid retrieval: keyword (exact words, citations, section numbers) + dense vectors (meaning, Hindi↔English),
fused with Reciprocal Rank Fusion. Zero API tokens - only the top passages go to Claude.

Every search covers the caller's private documents plus the shared public library of SC judgments
(passages with workspace_id NULL); never another account's documents.

Backends (chosen from DATABASE_URL):
  * PostgreSQL - full-text search (GIN on a generated tsvector) + pgvector HNSW. Scales to the full corpus.
  * SQLite     - in-memory BM25 + numpy cosine per workspace. Dev / small pilots only.
"""

import math
import re
import threading
from collections import Counter
from dataclasses import dataclass, field

import numpy as np
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, defer

from ..config import settings
from ..db import IS_PG
from ..models import Document, Passage, SectionMap
from . import embeddings, legal_hindi, tribunal
from . import statutes as statute_refs

TOKEN_RE = re.compile(r"[a-z0-9]+")
# English stop words + words present in nearly every judgment (they add cost, not signal)
STOP = set(("the a an of to in and or is was be by for on at as that this with which from it are were has have had not "
            "court learned counsel hon ble case also said such any may shall").split())
K1, B = 1.5, 0.75
RRF_K = 60  # standard RRF constant
CANDIDATES = 50  # top-N from each retriever before fusion
MAX_TERMS = 16
HNSW_OVERFETCH = 500  # filtered search over many judgments: take more nearest neighbours, then keep those in scope
EXACT_SCAN_DOCS = 2000  # up to this many judgments, an exact vector scan is fast enough
COMMON_TERM_FREQ = 0.03  # a word in more than this share of passages does not pick out a topic
KEYWORD_POOL = 300  # passages ranked per keyword tier, before judging how often a judgment returns to the words
MAX_NAME_MATCHES = 25  # more titles than this contain the words: not one named case
NOT_IN_NAMES = {"vs", "versus", "anr", "ors", "etc", "others", "another"}
AUTHORITY_MIN_CITED = 10  # judgments cited this often form their own candidate list (landmarks on the query's words)
TRIBUNAL_WEIGHT = 0.8  # a tribunal order on the same point ranks below a Supreme Court judgment (it does not bind)
AUTHORITY_WEIGHT = 0.5  # a judgment cited by n others in the library scores x (1 + w * log10(1 + n)) (app.citegraph)
PHRASE_RE = re.compile(r'"([^"]{2,200})"')
STATUTE_WORDS = {  # how each Act is named in judgments (to_tsquery syntax)
    "IPC": "ipc | i.p.c | (penal <-> code)", "CRPC": "crpc | cr.p.c | (criminal <-> procedure)",
    "IEA": "evidence", "BNS": "bns | (nyaya <-> sanhita)", "BNSS": "bnss | (nagarik <-> suraksha)", "BSA": "bsa | (sakshya <-> adhiniyam)",
}


@dataclass
class SearchFilters:
    year_from: int | None = None
    year_to: int | None = None
    judge: str = ""
    party: str = ""
    provision: str = ""  # "302 IPC", "Section 482 BNSS", "Article 21"
    forum: str = ""  # "SC", "NCLAT", "NCLT" (library judgments only); "" = all

    def active(self) -> bool:
        return bool(self.year_from or self.year_to or self.judge.strip() or self.party.strip() or self.provision.strip() or self.forum)


_common: set[str] | None = None


def provision_variants(db: Session, provision: str) -> list[tuple[str, str]]:
    """The provision typed and its old/new counterpart, so BNS 103 also finds the case law on IPC 302."""
    out: list[tuple[str, str]] = []
    for code, num in statute_refs.parse_provisions(provision):
        out.append((code, num))
        rows = db.query(SectionMap).filter(or_((SectionMap.old_code == code) & (SectionMap.old_section == num),
                                               (SectionMap.new_code == code) & (SectionMap.new_section == num))).all()
        for m in rows:
            other = (m.new_code, m.new_section) if m.old_code == code else (m.old_code, m.old_section)
            if other[1]:
                out.append(other)
    return list(dict.fromkeys(out))


def _provision_tsquery(variants: list[tuple[str, str]]) -> str:
    parts = []
    for code, num in variants:
        n = re.sub(r"[^0-9a-z]", "", num.lower())
        if code == "COI":
            parts.append(f"(article <-> {n})")
        elif code in STATUTE_WORDS:
            # "Sections 302/34 IPC" is one token, 302/34, so the number may also start a combined token
            parts.append(f"(section <-> ({n} | '{n}/':*) & ({STATUTE_WORDS[code]}))")
    return " | ".join(parts)


def filtered_documents(db: Session, f: SearchFilters, workspace_id: int) -> list[int]:
    """Document ids matching the filters (PostgreSQL). Metadata filters apply to library judgments."""
    where, params = ["(d.workspace_id = :ws OR d.workspace_id IS NULL)"], {"ws": workspace_id}
    if f.year_from:
        where.append("d.meta->>'decision_date' >= :df")
        params["df"] = f"{f.year_from:04d}-01-01"
    if f.year_to:
        where.append("d.meta->>'decision_date' <= :dt")
        params["dt"] = f"{f.year_to:04d}-12-31"
    if f.judge.strip():
        where.append("(d.meta->>'judges' ILIKE :j OR d.meta->>'author' ILIKE :j)")
        params["j"] = "%" + f.judge.strip().replace("%", "") + "%"
    if f.party.strip():
        where.append("(d.meta->>'title' ILIKE :p OR d.meta->>'petitioner' ILIKE :p OR d.meta->>'respondent' ILIKE :p)")
        params["p"] = "%" + f.party.strip().replace("%", "") + "%"
    if f.forum:
        where.append("d.kind = 'judgment' AND coalesce(d.meta->>'forum', 'SC') = :forum")
        params["forum"] = f.forum
    if f.provision.strip():
        tsq = _provision_tsquery(provision_variants(db, f.provision))
        if not tsq:
            return []
        where.append("d.id IN (SELECT p.document_id FROM passages p WHERE p.tsv @@ to_tsquery('english', :tsq))")
        params["tsq"] = tsq
    return [r[0] for r in db.execute(text("SELECT d.id FROM documents d WHERE " + " AND ".join(where)), params)]


def _tokens(text_: str) -> list[str]:
    return [t for t in TOKEN_RE.findall(text_.lower()) if t not in STOP and len(t) > 1]


def _scope(workspace_id: int):
    return or_(Passage.workspace_id == workspace_id, Passage.workspace_id.is_(None))


# ---------------------------------------------------------------- PostgreSQL

def _common_lexemes(db: Session) -> set[str]:
    """Stems in more than COMMON_TERM_FREQ of all passages ("section", "court"), from PostgreSQL's own statistics."""
    global _common
    if _common is None:
        row = db.execute(text("SELECT most_common_elems::text::text[], most_common_elem_freqs FROM pg_stats "
                              "WHERE tablename = 'passages' AND attname = 'tsv'")).first()
        if not row or not row[0]:
            return set()  # not analysed yet: treat every word as rare
        _common = {w for w, freq in zip(row[0], row[1]) if freq > COMMON_TERM_FREQ}
    return _common


def _pg_keyword(db: Session, query: str, workspace_id: int, document_ids: list[int] | None) -> list[int]:
    terms = list(dict.fromkeys(_tokens(query)))[:MAX_TERMS]
    if not terms:
        return []
    stems = db.execute(text("SELECT t, ts_lexize('english_stem', t) FROM unnest(CAST(:t AS text[])) t"), {"t": terms}).all()
    stem_of = {t: (st[0] if st else None) for t, st in stems}
    terms = [t for t in terms if stem_of.get(t) is not None] or terms  # drop English stop words the parser would drop
    common = _common_lexemes(db)
    rare = [t for t in terms if stem_of.get(t) not in common]
    # Best first: every word, then every distinctive word, then any distinctive word. Common words alone
    # ("section", "court") say little and are slow to rank, so they never select a passage across the whole library.
    tiers = [" & ".join(terms)]
    if 1 < len(rare) < len(terms):
        tiers.append(" & ".join(rare))
    if len(terms) > 1:
        tiers.append(" | ".join(terms if document_ids or not rare else rare))
    # A "quoted phrase" must be present exactly.
    phrases = PHRASE_RE.findall(query)[:3]
    must = "".join(f" && phraseto_tsquery('english', :ph{i})" for i in range(len(phrases)))
    sql = (
        f"SELECT p.id, p.document_id, ts_rank_cd(p.tsv, x.q, 32) FROM passages p, (SELECT to_tsquery('english', :q){must} AS q) x "
        "WHERE p.tsv @@ x.q AND (p.workspace_id = :ws OR p.workspace_id IS NULL) "
        + ("AND p.document_id = ANY(:docs) " if document_ids else "")
        + "ORDER BY 3 DESC LIMIT :n"
    )
    params = {"ws": workspace_id, "n": KEYWORD_POOL, **{f"ph{i}": ph for i, ph in enumerate(phrases)}}
    if document_ids:
        params["docs"] = list(document_ids)
    ordered: list[int] = []
    for tier in tiers:
        rows = [r for r in db.execute(text(sql), {**params, "q": tier}) if r[0] not in ordered]
        # A judgment that keeps returning to these words is about them; one good passage may be a passing mention
        in_doc = Counter(r[1] for r in rows)
        rows.sort(key=lambda r: -r[2] * (1 + math.log2(in_doc[r[1]])))
        ordered += [r[0] for r in rows]
        if len(ordered) >= CANDIDATES:
            break
    return ordered[:CANDIDATES]


def _pg_authority(db: Session, query: str, workspace_id: int, document_ids: list[int] | None) -> list[int]:
    """Passages with every query word from judgments the library cites often. The landmark on a point is often not the
    judgment that discusses it at greatest length, so it would not surface from keyword density alone."""
    terms = list(dict.fromkeys(_tokens(query)))[:MAX_TERMS]
    if len(terms) < 2:
        return []
    sql = ("SELECT p.id, p.document_id FROM passages p JOIN documents d ON d.id = p.document_id "
           "WHERE d.cited_by >= :minc AND d.workspace_id IS NULL AND p.tsv @@ to_tsquery('english', :q) "
           + ("AND p.document_id = ANY(:docs) " if document_ids else "")
           + "ORDER BY ts_rank_cd(p.tsv, to_tsquery('english', :q), 32) * (1 + log(d.cited_by)) DESC LIMIT 60")
    params = {"q": " & ".join(terms), "minc": AUTHORITY_MIN_CITED, **({"docs": list(document_ids)} if document_ids else {})}
    out, per = [], Counter()
    for pid, did in db.execute(text(sql), params):
        if per[did] < 2:
            per[did] += 1
            out.append(pid)
    return out[:CANDIDATES]


def _pg_name(db: Session, query: str, workspace_id: int, document_ids: list[int] | None) -> list[int]:
    """The query is a case name ("Maneka Gandhi v Union of India", "Puttaswamy"): first passage of those judgments."""
    names = [t for t in _tokens(query) if t not in NOT_IN_NAMES][:8]
    if not names:
        return []
    where = " AND ".join(f"d.meta->>'title' ~* :n{i}" for i in range(len(names)))
    params = {"ws": workspace_id, "lim": MAX_NAME_MATCHES + 1, **{f"n{i}": rf"\y{t}\y" for i, t in enumerate(names)}}
    if document_ids:
        where += " AND d.id = ANY(:docs)"
        params["docs"] = list(document_ids)
    docs = db.execute(text(f"SELECT d.id FROM documents d WHERE d.kind = 'judgment' AND (d.workspace_id = :ws OR d.workspace_id IS NULL) "
                           f"AND {where} ORDER BY length(d.meta->>'title'), d.id LIMIT :lim"), params).all()
    if not docs or len(docs) > MAX_NAME_MATCHES:  # many titles share these words: a topic or a common party, not one case
        return []
    order = [r[0] for r in docs]
    first = dict(db.execute(text("SELECT DISTINCT ON (document_id) document_id, id FROM passages "
                                 "WHERE document_id = ANY(:d) ORDER BY document_id, idx"), {"d": order}).all())
    return [first[d] for d in order if d in first]


def _pg_dense(db: Session, query: str, workspace_id: int, document_ids: list[int] | None) -> list[int]:
    q = embeddings.embed_query(query)
    if q is None:
        return []
    vec = "[" + ",".join(f"{x:.6f}" for x in q.tolist()) + "]"
    # Few judgments: exact scan (an HNSW post-filter could drop them). Many: nearest neighbours, then keep those in scope.
    exact = bool(document_ids) and len(document_ids) <= EXACT_SCAN_DOCS
    if exact:
        db.execute(text("SET LOCAL enable_indexscan = off"))
    else:
        db.execute(text(f"SET LOCAL hnsw.ef_search = {HNSW_OVERFETCH if document_ids else 100}"))
    sql = (
        "SELECT id, document_id FROM passages "
        "WHERE embedding IS NOT NULL AND embed_model = :m AND (workspace_id = :ws OR workspace_id IS NULL) "
        + ("AND document_id = ANY(:docs) " if exact else "")
        + "ORDER BY embedding <=> CAST(:v AS vector) LIMIT :n"
    )
    params = {"m": settings.embed_model, "ws": workspace_id, "v": vec, "n": CANDIDATES if exact or not document_ids else HNSW_OVERFETCH}
    if exact:
        params["docs"] = list(document_ids)
    found = db.execute(text(sql), params).all()
    db.commit()  # end the transaction so SET LOCAL doesn't leak
    if document_ids and not exact:
        scope = set(document_ids)
        found = [r for r in found if r[1] in scope]
    return [r[0] for r in found[:CANDIDATES]]


# ---------------------------------------------------------------- SQLite (in-memory)

@dataclass
class _Index:
    stamp: tuple
    ids: np.ndarray
    doc_ids: np.ndarray
    tfs: list[Counter]
    lengths: np.ndarray
    avg_len: float
    df: Counter
    postings: dict[str, list[int]] = field(default_factory=dict)
    vectors: np.ndarray | None = None
    has_vec: np.ndarray | None = None


_cache: dict[int, _Index] = {}
_lock = threading.Lock()


def _mem_index(db: Session, workspace_id: int) -> _Index:
    n, last = db.query(func.count(Passage.id), func.max(Passage.id)).filter(_scope(workspace_id)).one()
    stamp = (n, last, settings.embed_model)
    idx = _cache.get(workspace_id)
    if idx is not None and idx.stamp == stamp:
        return idx
    with _lock:
        rows = db.query(Passage.id, Passage.document_id, Passage.text, Passage.embedding, Passage.embed_model) \
            .filter(_scope(workspace_id)).order_by(Passage.id).all()
        tfs = [Counter(_tokens(r.text)) for r in rows]
        df: Counter = Counter()
        postings: dict[str, list[int]] = {}
        for i, tf in enumerate(tfs):
            for t in tf:
                df[t] += 1
                postings.setdefault(t, []).append(i)
        lengths = np.array([sum(tf.values()) for tf in tfs], dtype=np.float32)
        vectors = has_vec = None
        usable = [i for i, r in enumerate(rows) if r.embedding is not None and r.embed_model == settings.embed_model]
        if usable:
            vectors = np.zeros((len(rows), len(rows[usable[0]].embedding)), dtype=np.float32)
            has_vec = np.zeros(len(rows), dtype=bool)
            for i in usable:
                vectors[i], has_vec[i] = rows[i].embedding, True
        idx = _cache[workspace_id] = _Index(
            stamp=stamp, ids=np.array([r.id for r in rows]), doc_ids=np.array([r.document_id for r in rows]),
            tfs=tfs, lengths=lengths, avg_len=float(lengths.mean()) if len(rows) else 1.0, df=df,
            postings=postings, vectors=vectors, has_vec=has_vec)
    return idx


def _mem_keyword(idx: _Index, query: str, allowed: np.ndarray | None) -> list[int]:
    n = len(idx.ids)
    scores: dict[int, float] = {}
    for t in set(_tokens(query)):
        rows = idx.postings.get(t)
        if not rows:
            continue
        idf = math.log(1 + (n - idx.df[t] + 0.5) / (idx.df[t] + 0.5))
        for i in rows:
            if allowed is not None and not allowed[i]:
                continue
            tf = idx.tfs[i][t]
            scores[i] = scores.get(i, 0.0) + idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * idx.lengths[i] / idx.avg_len))
    return [int(idx.ids[i]) for i in sorted(scores, key=scores.get, reverse=True)[:CANDIDATES]]


def _mem_dense(idx: _Index, query: str, allowed: np.ndarray | None) -> list[int]:
    if idx.vectors is None:
        return []
    q = embeddings.embed_query(query)
    if q is None or q.shape[0] != idx.vectors.shape[1]:
        return []
    mask = idx.has_vec if allowed is None else (idx.has_vec & allowed)
    sims = np.where(mask, idx.vectors @ q, -np.inf)
    return [int(idx.ids[i]) for i in np.argsort(-sims)[:CANDIDATES] if np.isfinite(sims[i])]


# ---------------------------------------------------------------- exact citations

CITE_RES = [
    re.compile(r"\b(?:19|20)\d{2}\s*INSC\s*\d+\b", re.I),
    re.compile(r"\[(?:19|20)\d{2}\]\s*(?:\d+|Supp\.?\s*\d*)\s*S\.?\s*C\.?\s*R\.?\s*\d+", re.I),
    re.compile(r"\((?:19|20)\d{2}\)\s*\d+\s*S\.?\s*C\.?\s*C\.?\s*\d+", re.I),
    re.compile(r"\bAIR\s*(?:19|20)\d{2}\s*SC\s*\d+\b", re.I),
]


def _citations_in(query: str) -> list[str]:
    return [m.group(0) for rx in CITE_RES for m in rx.finditer(query)] + tribunal.find_case_numbers(query)


def _exact_citation(db: Session, query: str, workspace_id: int, document_ids: list[int] | None) -> list[int]:
    """A citation in the query must match as a phrase ("2025 INSC 24" ≠ any page saying 2025 … INSC …).
    The judgment that *is* that citation comes first, then passages that cite it."""
    cites = _citations_in(query)
    if not cites:
        return []
    ids: list[int] = []
    for cite in cites:
        words = " ".join(TOKEN_RE.findall(cite.lower()))
        if IS_PG:
            own = db.execute(text(
                "SELECT p.id FROM passages p JOIN documents d ON d.id = p.document_id "
                "WHERE d.kind = 'judgment' AND (p.workspace_id = :ws OR p.workspace_id IS NULL) "
                "AND regexp_replace(lower(coalesce(d.meta->>'neutral_citation','') || ' ' || coalesce(d.meta->>'scr_citation','') || ' ' || "
                "coalesce(d.meta->>'case_no','') || ' ' || coalesce(d.meta->>'other_case_nos','')), "
                "'[^a-z0-9]+', ' ', 'g') LIKE '%' || :w || '%' ORDER BY p.idx LIMIT 2"), {"ws": workspace_id, "w": words})
            ids += [r[0] for r in own]
            sql = ("SELECT id FROM passages, phraseto_tsquery('simple', :w) q WHERE to_tsvector('simple', text) @@ q "
                   "AND (workspace_id = :ws OR workspace_id IS NULL) "
                   + ("AND document_id = ANY(:docs) " if document_ids else "")
                   + "AND tsv @@ plainto_tsquery('english', :w) LIMIT :n")
            params = {"w": words, "ws": workspace_id, "n": CANDIDATES}
            if document_ids:
                params["docs"] = list(document_ids)
            ids += [r[0] for r in db.execute(text(sql), params)]
        else:
            rx = re.compile(r"\W*".join(re.escape(t) for t in words.split()), re.I)
            q = db.query(Passage.id, Passage.text).filter(_scope(workspace_id))
            if document_ids:
                q = q.filter(Passage.document_id.in_(document_ids))
            ids += [pid for pid, t in q if rx.search(t)][:CANDIDATES]
    return list(dict.fromkeys(ids))


# ---------------------------------------------------------------- public API

MAX_PER_DOC = 2  # overlapping windows of one judgment shouldn't crowd out other authorities


def passages_citing(db: Session, citation: str, workspace_id: int, exclude_document: int) -> list[Passage]:
    """Passages of other documents that mention this exact citation."""
    ids = _exact_citation(db, citation, workspace_id, None)[:CANDIDATES]
    if not ids:
        return []
    return db.query(Passage).options(defer(Passage.embedding)).filter(Passage.id.in_(ids), Passage.document_id != exclude_document).all()


def search(db: Session, query: str, workspace_id: int, document_ids: list[int] | None = None,
           k: int = 6, filters: SearchFilters | None = None) -> list[tuple[Passage, float]]:
    """Top-k passages (private docs + public library). Each passage gets `.matched_by` ⊆ {"citation", "name", "keyword", "meaning"}."""
    one_document = bool(document_ids)  # asked about specific documents: no per-judgment cap
    query, _ = legal_hindi.expand(query)  # "अग्रिम जमानत" is also searched as "anticipatory bail"
    if filters and filters.active() and IS_PG:
        document_ids = filtered_documents(db, filters, workspace_id)
        if not document_ids:
            return []
    exact = _exact_citation(db, query, workspace_id, document_ids)
    keyword_only: set[int] = set()
    names: list[int] = []
    landmarks: list[int] = []
    if IS_PG:
        names = _pg_name(db, query, workspace_id, document_ids)
        landmarks = _pg_authority(db, query, workspace_id, document_ids)
        kw = _pg_keyword(db, query, workspace_id, document_ids)
        # A quoted phrase must match exactly, which a meaning search cannot promise
        dn = [] if PHRASE_RE.search(query) else _pg_dense(db, query, workspace_id, document_ids)
        if kw:  # judgments stored without vectors can only score once: count that once fairly, or they sink
            keyword_only = {r[0] for r in db.execute(text("SELECT id FROM passages WHERE id = ANY(:i) AND embedding IS NULL"), {"i": kw})}
    else:
        idx = _mem_index(db, workspace_id)
        if not len(idx.ids):
            return []
        allowed = np.isin(idx.doc_ids, document_ids) if document_ids else None
        kw, dn = _mem_keyword(idx, query, allowed), _mem_dense(idx, query, allowed)

    fused: dict[int, float] = {}
    for ranked, weight in ((exact, 3.0), (names, 3.0), (kw, 1.0), (dn, 1.0), (landmarks, 1.0)):  # an exact citation or case name outranks fuzzy matches
        for rank, pid in enumerate(ranked):
            fused[pid] = fused.get(pid, 0.0) + weight * (2 if ranked is kw and pid in keyword_only else 1) / (RRF_K + rank + 1)
    if fused and AUTHORITY_WEIGHT:  # among relevant passages, the judgments the Court keeps citing come first
        doc_of = dict(db.query(Passage.id, Passage.document_id).filter(Passage.id.in_(list(fused))).all())
        cited = dict(db.query(Document.id, Document.cited_by).filter(Document.id.in_(set(doc_of.values())),
                                                                     Document.cited_by > 0).all())
        for pid in fused:
            if (n := cited.get(doc_of.get(pid))):
                fused[pid] *= 1 + AUTHORITY_WEIGHT * math.log10(1 + n)
    if fused and TRIBUNAL_WEIGHT != 1:
        doc_of = dict(db.query(Passage.id, Passage.document_id).filter(Passage.id.in_(list(fused))).all())
        forum = dict(db.query(Document.id, Document.meta["forum"].as_string()).filter(Document.id.in_(set(doc_of.values())),
                                                                                       Document.kind == "judgment").all())
        for pid in fused:
            if forum.get(doc_of.get(pid)) not in (None, "", "SC"):
                fused[pid] *= TRIBUNAL_WEIGHT
    ranked_ids = sorted(fused, key=lambda pid: (-fused[pid], pid))[:k * 4]  # id tie-break: stable prompt -> cache hits
    if not ranked_ids:
        return []

    sets = {"citation": set(exact), "name": set(names), "keyword": set(kw) | set(landmarks), "meaning": set(dn)}
    by_id = {p.id: p for p in db.query(Passage).options(defer(Passage.embedding)).filter(Passage.id.in_(ranked_ids))}
    out, per_doc = [], Counter()
    for pid in ranked_ids:
        p = by_id.get(pid)
        if p is None or (not one_document and per_doc[p.document_id] >= MAX_PER_DOC):
            continue
        per_doc[p.document_id] += 1
        p.matched_by = [name for name, s in sets.items() if pid in s]
        out.append((p, round(fused[pid] * 1000, 2)))
        if len(out) == k:
            break
    return out
