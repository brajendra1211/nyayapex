"""Rebuild retrieval passages + embeddings for every analysed document.

Run after changing EMBED_MODEL, or to index documents uploaded before hybrid RAG existed:
    python -m app.reindex            # only documents missing vectors for the current model
    python -m app.reindex --all      # everything
"""

import sys
import time
from pathlib import Path

from .config import settings
from .db import SessionLocal, prepare_database
from .models import Document, Passage
from .services import passages, storage
from .services.clean import clean_pages
from .services.extract import extract_pages


def main(rebuild_all: bool) -> None:
    prepare_database()
    db = SessionLocal()
    try:
        docs = db.query(Document).filter(Document.status == "done").order_by(Document.id).all()
        todo = [d for d in docs if rebuild_all or not db.query(Passage).filter(
            Passage.document_id == d.id, Passage.embed_model == settings.embed_model).first()]
        print(f"{len(todo)} of {len(docs)} documents to index with {settings.embed_model}")
        for d in todo:
            t = time.time()
            suffix = Path(d.filename).suffix.lower()
            if not storage.exists(d.sha256, suffix):
                print(f"  #{d.id} {d.filename}: source file missing, skipped")
                continue
            with storage.plain_path(d.sha256, suffix) as path:
                cleaned, _ = clean_pages(extract_pages(path))
            stats = passages.build(db, d, cleaned)
            d.stats = {**(d.stats or {}), **stats}
            db.commit()
            print(f"  #{d.id} {d.filename}: {stats['passages']} passages in {time.time() - t:.1f}s")
    finally:
        db.close()


if __name__ == "__main__":
    main("--all" in sys.argv)
