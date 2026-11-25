"""Bulk-import Supreme Court judgments from the AWS open dataset into the shared public library.

    python -m app.import_corpus --from 2015 --to 2026            # pilot range
    python -m app.import_corpus --from 1950 --to 2026 --workers 6  # full corpus (PostgreSQL recommended)
    python -m app.import_corpus --from 2025 --to 2025 --limit 20   # quick test
    python -m app.import_corpus --from 1950 --to 2014 --no-embed   # text only: keyword + citation search, about half the disk

Resumable: judgments already imported are skipped, so re-run it any time (e.g. after the dataset's
bi-monthly update). PDFs are not stored - only text passages, embeddings and metadata.
"""

import argparse
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import httpx

from .config import settings
from .db import IS_PG, SessionLocal, prepare_database
from .models import Document
from .services import corpus, embeddings


def _download(client: httpx.Client, year: int, row: dict):
    try:
        return row, corpus.fetch_pdf(corpus.aws_pdf_url(year, row["path"]), client), None
    except Exception as e:  # keep going; report at the end
        return row, None, str(e)


def run(year_from: int, year_to: int, limit: int | None, workers: int, embed: bool = True) -> None:
    prepare_database()
    if not IS_PG:
        print("WARNING: DATABASE_URL is SQLite - fine for a small test, use PostgreSQL for the real corpus.")
    if not embed:
        print("Embeddings skipped (--no-embed): keyword and citation search only.\n")
    else:
        if embeddings.model() is None:
            print("WARNING: embedding model unavailable - judgments will be keyword-searchable only.")
        print(f"Embedding model: {settings.embed_model}\n")

    db = SessionLocal()
    client = httpx.Client(timeout=90, headers=corpus.UA, limits=httpx.Limits(max_connections=workers + 2))
    done = failed = 0
    started = time.time()
    try:
        for year in range(year_to, year_from - 1, -1):  # newest first: most useful soonest
            rows = corpus.aws_year_metadata(year, client)
            have = {k for (k,) in db.query(Document.source_key).filter(Document.source_key.like(f"aws:%{year}\\_%", escape="\\"))}
            todo = [r for r in rows if r.get("path") and f"aws:{r['path']}" not in have]
            print(f"{year}: {len(rows)} judgments, {len(rows) - len(todo)} already imported, {len(todo)} new", end="")
            if limit is not None:
                todo = todo[:max(0, limit - done)]
                print(f" (importing {len(todo)} - --limit)", end="")
            print()
            if not todo:
                continue
            with ThreadPoolExecutor(workers) as pool:
                for i, (row, data, err) in enumerate(pool.map(lambda r: _download(client, year, r), todo), start=1):
                    if err:
                        failed += 1
                        print(f"  ! {row['path']}: {err}")
                        continue
                    try:
                        doc, created = corpus.ingest(db, data, corpus.meta_from_aws(row, year), f"aws:{row['path']}", embed=embed)
                        done += created
                    except Exception as e:
                        db.rollback()
                        failed += 1
                        print(f"  ! {row['path']}: {e}")
                        continue
                    if i % 25 == 0 or i == len(todo):
                        rate = done / max(time.time() - started, 1e-6)
                        print(f"  {year}: {i}/{len(todo)}  | total imported {done}  | {rate:.1f}/s")
            if limit is not None and done >= limit:
                break
    except KeyboardInterrupt:
        print("\nStopped - re-run to resume.")
    finally:
        client.close()
        db.close()
    mins = (time.time() - started) / 60
    print(f"\nImported {done} judgments, {failed} failed, in {mins:.1f} min.")


def main(argv: list[str]) -> None:
    logging.basicConfig(level=logging.WARNING)
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--from", dest="year_from", type=int, default=2015)
    p.add_argument("--to", dest="year_to", type=int, default=date.today().year)
    p.add_argument("--limit", type=int, default=None, help="stop after N new judgments")
    p.add_argument("--workers", type=int, default=4, help="parallel downloads")
    p.add_argument("--no-embed", action="store_true", help="store text only (keyword + citation search), saves disk")
    a = p.parse_args(argv)
    run(a.year_from, a.year_to, a.limit, a.workers, embed=not a.no_embed)


if __name__ == "__main__":
    main(sys.argv[1:])
