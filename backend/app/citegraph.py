"""Citation graph of the judgment library: which judgment cites which, and how often each is cited. Zero tokens.

    python -m app.citegraph            # rebuild (a few minutes for the full corpus); re-run after an import

A citation is linked to a library judgment only when it identifies one judgment unambiguously:
  * SCR / neutral citations by their numbers;
  * SCC / AIR (and others) by the cited case name + year: the cited first party's distinctive words must all appear
    in the first party of a judgment decided that year or the year before (reports often appear the next year),
    and the second parties must share a word when both are known. Several candidates: the one whose first party
    has exactly those words, then the one decided in the cited year, if only one was.
Anything still matching zero or several judgments is left out, so a count can be low but a link is never invented.
"""

import re
import sys
import time
from collections import Counter, defaultdict

from sqlalchemy import text

from .db import IS_PG, SessionLocal, prepare_database
from .models import CitationEdge, Document

NOISE = set("""state union india of the and or ors anr another others through thr lrs lr dead by m s ms smt shri sri mr mrs dr
ltd limited pvt private co company corporation corpn govt government etc vs v versus in re the represented its secretary
chief commissioner director officer collector district appellant respondent petitioner deceased since legal heirs
justice retd his holiness her highness sh kumari km son daughter wife alias other uoi""".split())
WORD = re.compile(r"[a-z0-9]+")
NUMS = re.compile(r"\d+")


def party_words(name: str, n: int = 3) -> frozenset[str]:
    words = [w for w in WORD.findall(name.lower()) if w not in NOISE and len(w) > 1 and not w.isdigit()]
    return frozenset(words[:n])


def split_parties(title: str) -> tuple[str, str]:
    parts = re.split(r"\s+(?:v\.?|vs\.?|versus)\s+", title or "", maxsplit=1, flags=re.I)
    return (parts[0], parts[1]) if len(parts) == 2 else (parts[0], "")


def scr_key(cite: str) -> str | None:
    if "scr" not in cite.lower():
        return None
    supp = "supp" in cite.lower()
    nums = NUMS.findall(cite)
    if supp and len(nums) >= 2:  # [1993] Supp 1 SCR 1 / (1993) Supp SCR 1
        return "scr:" + ":".join(["S", *nums[:3]])
    return "scr:" + ":".join(nums[:3]) if len(nums) >= 3 else None


def insc_key(cite: str) -> str | None:
    m = re.search(r"((?:19|20)\d{2})\s*INSC\s*(\d+)", cite, re.I)
    return f"insc:{m.group(1)}:{int(m.group(2))}" if m else None


def build() -> dict:
    prepare_database()
    db = SessionLocal()
    t0 = time.time()
    rows = db.query(Document.id, Document.meta, Document.citations).filter(Document.kind == "judgment",
                                                                          Document.workspace_id.is_(None)).all()
    by_num: dict[str, int] = {}
    # (year, a first-party word) -> [(id, decision year, first-party words, second-party words)]
    by_word: dict[tuple[int, str], list[tuple[int, int, frozenset, frozenset]]] = defaultdict(list)
    for did, meta, _ in rows:
        m = meta or {}
        for k in (scr_key(m.get("scr_citation") or ""), insc_key(m.get("neutral_citation") or "")):
            if k:
                by_num[k] = did
        year = (m.get("decision_date") or "")[:4]
        if year.isdigit():
            pet, resp = split_parties(m.get("title") or "")
            pw, rw = party_words(pet, 6), party_words(resp, 6)
            for w in pw:
                by_word[(int(year), w)].append((did, int(year), pw, rw))
    edges: set[tuple[int, int]] = set()
    how = Counter()
    for did, meta, cites in rows:
        for c in cites or []:
            cite = c.get("citation") or ""
            target = by_num.get(scr_key(cite) or "") or by_num.get(insc_key(cite) or "")
            if target:
                how["number"] += 1
            elif c.get("case_name"):
                y = re.search(r"(?:19|20)\d{2}", cite)
                pet, resp = split_parties(c["case_name"])
                pw, rw = party_words(pet), party_words(resp)
                if y and pw and max(len(w) for w in pw) >= 4:
                    yr = int(y.group(0))
                    first = min(pw)  # any of the words narrows the lookup; all must match below
                    cands = {x[0]: x for x in by_word.get((yr, first), []) + by_word.get((yr - 1, first), [])
                             if pw <= x[2] and (not rw or not x[3] or rw & x[3])}
                    if len(cands) > 1:  # "Maneka Gandhi" vs "Maneka Sanjay Gandhi": the exact name wins
                        exact = {k: x for k, x in cands.items() if x[2] == pw}
                        cands = exact or cands
                    if len(cands) > 1:  # e.g. two "Bachan Singh v. State of Punjab": keep the one of the cited year
                        same = [k for k, x in cands.items() if x[1] == yr]
                        cands = {same[0]: cands[same[0]]} if len(same) == 1 else cands
                    if len(cands) == 1:
                        target = next(iter(cands))
                        how["name"] += 1
            if target and target != did:
                edges.add((did, target))
    t1 = time.time()
    db.query(CitationEdge).delete()
    db.flush()
    batch = [{"citing_id": a, "cited_id": b} for a, b in edges]
    for i in range(0, len(batch), 5000):
        db.execute(CitationEdge.__table__.insert(), batch[i:i + 5000])
    cited = Counter(b for _, b in edges)
    db.execute(text("UPDATE documents SET cited_by = 0 WHERE kind = 'judgment' AND workspace_id IS NULL"))
    if IS_PG:
        db.execute(text("UPDATE documents d SET cited_by = x.n FROM (SELECT cited_id, count(*) n FROM citation_edges "
                        "GROUP BY cited_id) x WHERE d.id = x.cited_id"))
    else:
        for did, n in cited.items():
            db.execute(text("UPDATE documents SET cited_by = :n WHERE id = :i"), {"n": n, "i": did})
    db.commit()
    top = db.query(Document.id, Document.meta, Document.cited_by).filter(Document.cited_by > 0) \
        .order_by(Document.cited_by.desc()).limit(10).all()
    db.close()
    return {"judgments": len(rows), "edges": len(edges), "matched_by": dict(how), "cited_at_least_once": len(cited),
            "seconds": round(time.time() - t0, 1), "match_seconds": round(t1 - t0, 1),
            "top": [((m or {}).get("title", "")[:50], (m or {}).get("decision_date", "")[:4], n) for _, m, n in top]}


if __name__ == "__main__":
    import json

    print(json.dumps(build(), indent=1, ensure_ascii=False))
    sys.exit(0)
