"""Document analysis worker: runs uploads' extraction / chronology / brief outside the web server.

    python -m app.worker          # loop forever (systemd service nyay-worker)
    python -m app.worker --once   # process what is queued, then exit

Enabled with JOB_WORKER=true; otherwise the API processes uploads itself in the background as before.
Several workers can run at once: each claims a document with FOR UPDATE SKIP LOCKED (PostgreSQL). Only documents
whose job options were saved (job_opts) are taken, so a job never starts with the wrong AI setting.
"""

import logging
import signal
import sys
import time
from datetime import datetime, timedelta

from sqlalchemy import text

from .db import IS_PG, SessionLocal, prepare_database
from .models import Document
from .services.pipeline import process_document

log = logging.getLogger("worker")
POLL_SECONDS = 3
STUCK_AFTER = timedelta(minutes=45)  # a document left "processing" this long (worker killed) is queued again
_stop = False


def claim(db) -> Document | None:
    if IS_PG:
        row = db.execute(text(
            "UPDATE documents SET status = 'processing', job_started_at = now() AT TIME ZONE 'utc' WHERE id = ("
            " SELECT id FROM documents WHERE status = 'queued' AND workspace_id IS NOT NULL"
            " AND job_opts IS NOT NULL AND CAST(job_opts AS TEXT) <> 'null'"
            " ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id")).first()
        db.commit()
        return db.get(Document, row[0]) if row else None
    d = next((x for x in db.query(Document).filter(Document.status == "queued", Document.workspace_id.isnot(None))
              .order_by(Document.id) if x.job_opts), None)
    if d:
        d.status, d.job_started_at = "processing", datetime.utcnow()
        db.commit()
    return d


def requeue_stuck(db) -> int:
    n = db.query(Document).filter(Document.status == "processing", Document.job_started_at.isnot(None),
                                  Document.job_started_at < datetime.utcnow() - STUCK_AFTER) \
        .update({Document.status: "queued"}, synchronize_session=False)
    db.commit()
    return n


def run(once: bool = False) -> None:
    prepare_database()
    db = SessionLocal()
    try:
        if n := requeue_stuck(db):
            log.warning("requeued %d stuck document(s)", n)
        while not _stop:
            d = claim(db)
            if d is None:
                if once:
                    return
                time.sleep(POLL_SECONDS)
                continue
            opts = d.job_opts or {}
            t = time.time()
            process_document(d.id, bool(opts.get("use_ai", True)), bool(opts.get("use_batch", False)))
            db.expire_all()
            log.warning("document %d %s in %.1fs", d.id, db.get(Document, d.id).status, time.time() - t)
    finally:
        db.close()


def _graceful(*_):
    global _stop
    _stop = True  # finish the current document, then exit


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(name)s %(message)s")
    signal.signal(signal.SIGTERM, _graceful)
    signal.signal(signal.SIGINT, _graceful)
    run(once="--once" in sys.argv)
