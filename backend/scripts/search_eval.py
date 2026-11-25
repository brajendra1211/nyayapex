"""Where does the judgment a lawyer would expect rank? Run after changing retrieval. No AI, full library needed.

    PYTHONPATH=. python scripts/search_eval.py
"""
import logging
import time

logging.disable(logging.WARNING)
from app.db import SessionLocal
from app.models import Document
from app.services.retrieval import search

GOLD = [
    ("Kesavananda Bharati", "kesavananda"), ("Maneka Gandhi v Union of India", "maneka gandhi"), ("Puttaswamy", "puttaswamy"),
    ("Vishaka", "vishaka"), ("Bachan Singh", "bachan singh"), ("D.K. Basu v State of West Bengal", "basu"), ("Indra Sawhney", "sawhney"),
    ("right to privacy", "puttaswamy"), ("basic structure doctrine", "kesavananda"), ("sexual harassment at workplace guidelines", "vishaka"),
    ("arrest guidelines custodial violence", "basu"), ("rarest of rare death penalty", "bachan singh"), ("triple talaq", "shayara"),
    ("procedure established by law personal liberty passport", "maneka gandhi"), ("anticipatory bail principles", "sibbia"),
    ("arrest section 41 498A guidelines", "arnesh"), ("FIR registration mandatory cognizable offence", "lalita kumari"),
    ("reservation creamy layer", "sawhney"), ("custodial death compensation", "nilabati"), ("section 65B certificate electronic evidence", "anvar"),
    ("polluter pays principle", "vellore"), ("President's rule Article 356", "bommai"), ("section 66A free speech", "shreya singhal"),
    ("passive euthanasia", "shanbaug"), ("section 377 consensual", "navtej"), ("public interest litigation locus standi", "gupta"),
]
db = SessionLocal()
found = 0
total = 0.0
for q, want in GOLD:
    t = time.time()
    hits = search(db, q, 0, k=30)
    s = time.time() - t
    total += s
    seen = list(dict.fromkeys(p.document_id for p, _ in hits))
    titles = [((d.meta or {}).get("title") or d.filename).lower() for d in (db.get(Document, i) for i in seen)]
    rank = next((i + 1 for i, x in enumerate(titles) if want in x), None)
    found += rank is not None and rank <= 5
    print(f"{s:6.2f}s rank={str(rank):4} {q[:52]:52} top: {titles[0][:34] if titles else '-'}")
print(f"gold in top 5: {found}/{len(GOLD)}  total {total:.1f}s")
