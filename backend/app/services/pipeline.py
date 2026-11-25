"""Document Intelligence pipeline.

  Upload -> extract/OCR -> clean -> chunk -> regex chronology + citations   (0 tokens)
         -> BULK model: facts per chunk (parallel, or Batch API at 50%)     (cheap)
         -> Python merges events                                            (0 tokens)
         -> SMART model: case brief from the merged facts only              (small input)
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ..config import settings
from ..db import SessionLocal
from ..models import Chunk, Document, User
from . import ai_log, llm, passages, storage
from .chunker import chunk_pages
from .citations import extract_document_citations
from .clean import clean_pages, estimate_tokens
from .dates import extract_chronology
from .extract import extract_pages
from .prompts import BRIEF_SCHEMA, BRIEF_SYSTEM, FACTS_SCHEMA, FACTS_SYSTEM

log = logging.getLogger(__name__)
MIN_CHUNK_WORDS = 80  # skip near-empty chunks (cover pages, blank annexure sheets)
MAX_EVENTS_TO_BRIEF = 400
WORKERS = 6


def _facts_for_chunk(chunk_id: int, text: str, workspace_id: int) -> tuple[int, dict]:
    db = SessionLocal()
    try:
        return chunk_id, llm.ask(db, feature="doc_facts", system=FACTS_SYSTEM, user=text,
                                 smart=False, effort="low", max_tokens=3000, schema=FACTS_SCHEMA, workspace_id=workspace_id)
    except Exception as e:  # one bad chunk must not fail the whole record
        log.warning("facts failed for chunk %s: %s", chunk_id, e)
        return chunk_id, {"events": [], "parties": [], "issues": []}
    finally:
        db.close()


def _merge_events(regex_events: list[dict], ai_events: list[dict]) -> list[dict]:
    merged: dict[tuple, dict] = {}
    for e in ai_events:
        key = (e.get("date", ""), e["event"][:40].lower())
        merged.setdefault(key, {"date": e.get("date", ""), "event": e["event"], "pages": [e.get("page")], "source": "ai"})
    ai_dates = {e.get("date") for e in ai_events}
    for e in regex_events:
        # Keep regex-only dates the model missed - guarantees no dated fact is silently dropped
        if e["date"] not in ai_dates:
            merged.setdefault((e["date"], e["event"][:40].lower()), e)
    return sorted(merged.values(), key=lambda e: (e["date"] or "9999", e["pages"][0] or 0))


def _run_ai(db, doc: Document, rows: list[Chunk], stats: dict, use_batch: bool) -> None:
    work = [(r.id, r.text) for r in rows if len(r.text.split()) >= MIN_CHUNK_WORDS]
    stats["chunks_sent_to_ai"] = len(work)
    stats["tokens_sent_est"] = estimate_tokens(sum(len(t) for _, t in work))

    if use_batch:
        items = [(f"c{cid}", llm.build_params(model=settings.model_bulk, system=FACTS_SYSTEM, user=text,
                                              max_tokens=3000, effort="low", schema=FACTS_SCHEMA)) for cid, text in work]
        out = llm.run_batch(db, feature="doc_facts_batch", items=items, workspace_id=doc.workspace_id)
        results = [(int(k[1:]), v) for k, v in out.items() if isinstance(v, dict)]
    else:
        with ThreadPoolExecutor(WORKERS) as pool:
            results = list(pool.map(lambda w: _facts_for_chunk(*w, doc.workspace_id), work))

    by_id = {r.id: r for r in rows}
    ai_events, issues, parties = [], [], set()
    for cid, facts in results:
        by_id[cid].facts = facts.get("events", [])
        ai_events += [e for e in facts.get("events", []) if e.get("event")]
        issues += facts.get("issues", [])
        parties.update(facts.get("parties", []))

    doc.chronology = _merge_events(doc.chronology, ai_events)
    db.commit()

    # Brief: SMART model sees only the compact chronology + issues, never the raw record
    lines = [f"{e['date'] or 'undated'}: {e['event']} [p.{e['pages'][0]}]" for e in doc.chronology[:MAX_EVENTS_TO_BRIEF]]
    user = (
        f"Parties: {', '.join(sorted(parties))[:1500]}\n\n"
        f"Chronology:\n" + "\n".join(lines) + "\n\n"
        f"Issues noted in the record:\n" + "\n".join(f"- {i}" for i in dict.fromkeys(issues))[:6000] + "\n\n"
        f"Authorities cited in the record: " + "; ".join(f"{c['case_name']}, {c['citation']}" if c["case_name"] else c["citation"] for c in doc.citations[:60])
    )
    stats["brief_input_tokens_est"] = estimate_tokens(len(user))
    doc.brief = llm.ask(db, feature="doc_brief", system=BRIEF_SYSTEM, user=user, smart=True,
                        effort="medium", max_tokens=8000, schema=BRIEF_SCHEMA, workspace_id=doc.workspace_id)
    ai_log.record(db, feature="doc_brief", output=doc.brief, user=db.get(User, doc.uploaded_by) if doc.uploaded_by else None,
                  workspace_id=doc.workspace_id, case_id=doc.case_id,
                  document_id=doc.id, prompt=f"Brief of {doc.filename}", sources=[f"{doc.filename} (chronology and issues)"])


def enqueue(background, doc, use_ai: bool, use_batch: bool = False) -> None:
    """Hand a saved, queued document to the worker service, or analyse it in this process after the response."""
    if settings.job_worker:
        doc.job_opts = {"use_ai": use_ai, "use_batch": use_batch}  # the caller commits; the worker polls the queue
    else:
        background.add_task(process_document, doc.id, use_ai, use_batch)


def process_document(document_id: int, use_ai: bool = True, use_batch: bool = False) -> None:
    db = SessionLocal()
    doc = db.get(Document, document_id)
    try:
        doc.status = "processing"
        db.commit()

        with storage.plain_path(doc.sha256, Path(doc.filename).suffix.lower()) as path:
            pages = extract_pages(path)
        cleaned, stats = clean_pages(pages)
        chunks = chunk_pages(cleaned)

        db.query(Chunk).filter(Chunk.document_id == doc.id).delete()
        rows = [Chunk(document_id=doc.id, idx=c.idx, page_start=c.page_start, page_end=c.page_end, text=c.text) for c in chunks]
        db.add_all(rows)
        doc.pages = len(pages)
        doc.chronology = extract_chronology(cleaned)
        doc.citations = extract_document_citations(cleaned)
        stats["chunks"] = len(rows)
        stats["tokens_raw_est"] = estimate_tokens(stats["raw_chars"])
        db.commit()

        # Retrieval index: small passages + local embeddings (0 tokens)
        stats.update(passages.build(db, doc, cleaned))

        if use_ai and settings.ai_enabled:
            try:
                _run_ai(db, doc, rows, stats, use_batch)
            except Exception as e:
                # Keep the free (Python) results; just report why the AI part didn't run
                log.exception("AI step failed for document %s", document_id)
                db.rollback()
                doc = db.get(Document, document_id)
                doc.error = "AI step failed - showing Python-only results. " + str(getattr(e, "detail", e))[:1500]

        doc.stats = stats
        doc.status = "done"
        db.commit()
    except Exception as e:
        log.exception("processing failed for document %s", document_id)
        db.rollback()
        doc = db.get(Document, document_id)
        doc.status, doc.error = "failed", str(getattr(e, "detail", e))[:2000]
        db.commit()
    finally:
        db.close()
