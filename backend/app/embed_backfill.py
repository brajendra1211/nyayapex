"""Add meaning (vector) search to library passages imported with --no-embed, e.g. the 1950-2014 judgments.

    python -m app.embed_backfill                    # resumable; stops at the size limit
    python -m app.embed_backfill --limit-mb 9300    # database + app folder ceiling in MB (default 9300)

The local embedding model runs on this server: no tokens, nothing leaves it.
"""

import argparse
import shutil
import subprocess
import sys
import time

from sqlalchemy import text

from .config import settings
from .db import SessionLocal, engine, prepare_database
from .models import Passage
from .services import embeddings

BATCH = 1000
VACUUM_EVERY = 100  # batches: lets PostgreSQL reuse the space of the rows each update replaces


def _app_folder_mb() -> int:
    try:
        return int(subprocess.run(["du", "-sm", "/home/nyayapex"], capture_output=True, text=True, timeout=300).stdout.split()[0])
    except Exception:
        return 0


def run(limit_mb: int) -> None:
    prepare_database()
    if embeddings.model() is None:
        sys.exit("embedding model unavailable")
    db = SessionLocal()
    folder = _app_folder_mb() if shutil.which("du") else 0
    todo = db.execute(text("SELECT count(*) FROM passages WHERE embedding IS NULL AND workspace_id IS NULL")).scalar()
    print(f"{todo} passages to embed with {settings.embed_model}; size ceiling {limit_mb} MB", flush=True)
    done, started, last_id = 0, time.time(), 0
    while True:
        rows = db.execute(text("SELECT id, text FROM passages WHERE embedding IS NULL AND workspace_id IS NULL AND id > :a "
                               "ORDER BY id LIMIT :n"), {"a": last_id, "n": BATCH}).all()
        if not rows:
            break
        vecs = embeddings.embed_passages([r[1] for r in rows], batch_size=128)
        db.bulk_update_mappings(Passage, [{"id": r[0], "embedding": v, "embed_model": settings.embed_model} for r, v in zip(rows, vecs)])
        db.commit()
        last_id = rows[-1][0]
        done += len(rows)
        batches = done // BATCH
        if batches % VACUUM_EVERY == 0:
            with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
                c.execute(text("VACUUM passages"))
        if batches % 20 == 0:
            db_mb = db.execute(text("SELECT pg_database_size(current_database()) / 1048576")).scalar()
            rate = done / max(time.time() - started, 1)
            print(f"  {done}/{todo}  {rate:.0f}/s  db {db_mb} MB  eta {(todo - done) / max(rate, 1) / 60:.0f} min", flush=True)
            if db_mb + folder > limit_mb:
                print(f"STOP_SIZE_LIMIT at {done} (db {db_mb} MB + app folder {folder} MB > {limit_mb} MB)", flush=True)
                return
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(text("VACUUM ANALYZE passages"))
    print(f"EMBED_DONE {done} passages in {(time.time() - started) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--limit-mb", type=int, default=9300)
    run(p.parse_args().limit_mb)
