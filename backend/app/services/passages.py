"""Split cleaned pages into small overlapping passages for retrieval, then embed them."""

import logging
import time
from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Document, Passage
from . import embeddings
from .extract import Page

log = logging.getLogger(__name__)
WINDOW = 250  # words per passage (~330 tokens: fits every embedding model's limit)
STRIDE = 200  # 50-word overlap so a holding split across a boundary is still found whole


@dataclass
class PassageData:
    idx: int
    page_start: int
    page_end: int
    text: str


def make_passages(pages: list[Page]) -> list[PassageData]:
    words: list[tuple[str, int]] = [(w, p.number) for p in pages for w in p.text.split()]
    out: list[PassageData] = []
    if not words:
        return out
    for start in range(0, max(len(words) - (WINDOW - STRIDE), 1), STRIDE):
        window = words[start:start + WINDOW]
        if len(window) < 20 and out:  # tiny tail is already covered by the previous overlap
            break
        out.append(PassageData(len(out), window[0][1], window[-1][1], " ".join(w for w, _ in window)))
    return out


def build(db: Session, doc: Document, pages: list[Page], commit: bool = True, embed: bool = True) -> dict:
    """(Re)create passages + embeddings for a document. Returns stats for the document.
    embed=False stores text only: keyword and citation search still work, and it takes far less disk."""
    db.query(Passage).filter(Passage.document_id == doc.id).delete()
    data = make_passages(pages)
    rows = [Passage(document_id=doc.id, workspace_id=doc.workspace_id, idx=p.idx, page_start=p.page_start,
                    page_end=p.page_end, text=p.text) for p in data]

    stats = {"passages": len(rows), "embed_model": None, "embed_seconds": 0}
    t = time.time()
    vectors = embeddings.embed_passages([r.text for r in rows]) if embed else None
    if vectors is not None:
        if vectors.shape[1] != settings.embed_dim:
            raise RuntimeError(f"EMBED_DIM={settings.embed_dim} but {settings.embed_model} gives {vectors.shape[1]}-d vectors")
        for r, v in zip(rows, vectors):
            r.embedding, r.embed_model = v, settings.embed_model
        stats.update(embed_model=settings.embed_model, embed_seconds=round(time.time() - t, 1))
    else:
        stats["embed_model"] = "unavailable (keyword search only)" if embed else "skipped (keyword search only)"
    db.add_all(rows)
    if commit:
        db.commit()
    return stats


def copy(db: Session, src: Document, dst: Document) -> None:
    """Reuse passages + vectors when the same file is uploaded again (zero compute)."""
    db.add_all([Passage(document_id=dst.id, workspace_id=dst.workspace_id, idx=p.idx, page_start=p.page_start,
                        page_end=p.page_end, text=p.text, embedding=p.embedding, embed_model=p.embed_model)
                for p in src.passages])
