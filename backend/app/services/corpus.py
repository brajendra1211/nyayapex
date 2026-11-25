"""Shared public library of Supreme Court judgments.

Sources
  * Bulk: "Indian Supreme Court Judgments" open dataset on AWS (mirror of the official e-SCR; CC-BY-4.0,
    Dattam Labs) - https://registry.opendata.aws/indian-supreme-court-judgments/
  * One-off: a PDF link from the Supreme Court's own sites (e.g. e-SCR), pasted by a user.

We never automate the e-SCR search page (it is CAPTCHA-protected) and we never store the PDFs:
only text passages, embeddings and metadata, plus the source link.
"""

import hashlib
import io
import logging
import re
from datetime import datetime
from urllib.parse import urljoin, urlparse

import httpx
from sqlalchemy.orm import Session

from ..models import Document
from . import passages
from .citations import extract_document_citations
from .clean import clean_pages
from .extract import extract_pdf_bytes

log = logging.getLogger(__name__)

AWS_BUCKET = "https://indian-supreme-court-judgments.s3.ap-south-1.amazonaws.com"
ATTRIBUTION = ("Supreme Court of India judgments (e-SCR) via the Indian Supreme Court Judgments dataset "
               "by Dattam Labs, CC-BY-4.0 - registry.opendata.aws/indian-supreme-court-judgments")
ALLOWED_HOSTS = {
    "scr.sci.gov.in", "digiscr.sci.gov.in", "api.sci.gov.in", "main.sci.gov.in", "www.sci.gov.in", "sci.gov.in",
    "indian-supreme-court-judgments.s3.ap-south-1.amazonaws.com",
}
MAX_PDF_BYTES = 60 * 1024 * 1024
UA = {"User-Agent": "NyayApex/0.1 (legal research; contact: admin)"}


# ---------------------------------------------------------------- fetching

def _check_host(url: str) -> None:
    u = urlparse(url)
    if u.scheme != "https" or (u.hostname or "").lower() not in ALLOWED_HOSTS:
        raise ValueError("Only https links from the Supreme Court's websites (e.g. scr.sci.gov.in) can be imported.")


def fetch_pdf(url: str, client: httpx.Client | None = None) -> bytes:
    """Download a PDF from an allow-listed host. Redirects are followed only within the allow-list."""
    own = client is None
    client = client or httpx.Client(timeout=60, headers=UA)
    try:
        for _ in range(4):
            _check_host(url)
            with client.stream("GET", url, follow_redirects=False) as r:
                if r.is_redirect:
                    url = urljoin(url, r.headers.get("location", ""))
                    continue
                if r.status_code != 200:
                    raise ValueError(f"The link returned HTTP {r.status_code} (temporary e-SCR links expire - search again and copy a fresh link).")
                buf = io.BytesIO()
                for chunk in r.iter_bytes():
                    buf.write(chunk)
                    if buf.tell() > MAX_PDF_BYTES:
                        raise ValueError("PDF is larger than 60 MB.")
                data = buf.getvalue()
                if not data.startswith(b"%PDF"):
                    raise ValueError("The link did not return a PDF.")
                return data
        raise ValueError("Too many redirects.")
    finally:
        if own:
            client.close()


def aws_year_metadata(year: int, client: httpx.Client) -> list[dict]:
    import pyarrow.parquet as pq

    r = client.get(f"{AWS_BUCKET}/metadata/parquet/year={year}/metadata.parquet")
    if r.status_code == 404:
        return []
    r.raise_for_status()
    return pq.read_table(io.BytesIO(r.content)).to_pylist()


def aws_pdf_url(year: int, path: str) -> str:
    return f"{AWS_BUCKET}/data/pdf/year={year}/english/{path}_EN.pdf"


# ---------------------------------------------------------------- metadata

def _iso_date(raw: str | None) -> str | None:
    for fmt in ("%d-%m-%Y", "%d %B %Y", "%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime((raw or "").strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


KEEP_UPPER = {"UOI", "CBI", "NIA", "NCB", "ED", "LIC", "SBI", "HDFC", "ICICI", "NHAI", "DDA", "MCD", "NOIDA", "BSNL",
              "ONGC", "NTPC", "GAIL", "SEBI", "RBI", "IDBI", "ITO", "CIT", "DCIT", "M/S", "LLP", "UP", "MP", "J&K"}


def nice_case(s: str) -> str:
    """'STATE OF U.P. & ORS.' -> 'State of U.P. & Ors.'; leaves mixed-case text alone."""
    letters = [c for c in s if c.isalpha()]
    if not letters or sum(c.isupper() for c in letters) / len(letters) < 0.8:
        return s
    out = []
    for i, w in enumerate(s.split()):
        bare = w.strip(".,()&")
        if i > 0 and w.lower() in {"of", "and", "the", "for", "in", "v.", "vs.", "@"}:
            out.append(w.lower())
        elif bare.upper() in {"LTD", "PVT", "ORS", "ANR", "CO", "MR", "DR", "SMT", "SHRI", "ST"}:
            out.append(w.capitalize())
        elif (bare.upper() in KEEP_UPPER or re.fullmatch(r"(?:[A-Z]\.)+[A-Z]?\.?", bare)  # U.P., A.K.
                or (bare.isalpha() and len(bare) <= 5 and not re.search(r"[AEIOU]", bare))):  # NBCC, CBI
            out.append(w)
        elif i > 0 and w.lower() in {"of", "and", "the", "for", "in", "v.", "vs.", "@"}:
            out.append(w.lower())
        else:  # "(RANI)" -> "(Rani)", "ORS." -> "Ors."
            out.append(re.sub(r"[A-Za-z][A-Za-z']*", lambda m: m.group(0).capitalize(), w))
    return " ".join(out)


def meta_from_aws(row: dict, year: int) -> dict:
    title = re.sub(r"\s+versus\s+", " v. ", (row.get("title") or "").strip(), flags=re.I)
    return {
        "title": nice_case(re.sub(r"\s+", " ", title)),
        "petitioner": row.get("petitioner"), "respondent": row.get("respondent"),
        "scr_citation": (row.get("citation") or "").strip() or None,
        "neutral_citation": (row.get("case_id") or "").strip() or None,
        "decision_date": _iso_date(row.get("decision_date")),
        "judges": row.get("judge"), "author": row.get("author_judge"),
        "disposal": row.get("disposal_nature"), "court": row.get("court") or "Supreme Court of India",
        "source": "aws-escr", "source_url": aws_pdf_url(year, row["path"]), "attribution": ATTRIBUTION,
    }


SCR_RE = re.compile(r"\[(\d{4})\]\s*(\d+|Supp\.?\s*\d*)\s*S\.?\s*C\.?\s*R\.?\s*(\d+)", re.I)
INSC_RE = re.compile(r"\b((?:19|20)\d{2})\s*INSC\s*(\d+)\b")
DATE_RE = re.compile(r"\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b")


def meta_from_first_page(text_: str, source_url: str) -> dict:
    """Best-effort header parse of an e-SCR judgment (title, citations, date, bench)."""
    lines = [l.strip() for l in text_.splitlines() if l.strip()]
    meta: dict = {"source": "link", "source_url": source_url, "court": "Supreme Court of India"}
    if m := SCR_RE.search(text_):
        meta["scr_citation"] = f"[{m.group(1)}] {m.group(2).strip()} S.C.R. {m.group(3)}"
    if m := INSC_RE.search(text_):
        meta["neutral_citation"] = f"{m.group(1)} INSC {m.group(2)}"
    if m := DATE_RE.search(text_):
        meta["decision_date"] = _iso_date(m.group(0))
    # Title: the lines after the citation line, up to "(Civil Appeal No. …)" / the date
    start = next((i + 1 for i, l in enumerate(lines[:8]) if SCR_RE.search(l) or INSC_RE.search(l)), 0)
    title_lines = []
    for l in lines[start:start + 8]:
        if l.startswith("(") or DATE_RE.search(l) or l.startswith("["):
            break
        title_lines.append(l)
    title = " ".join(title_lines)
    title = re.sub(r"\s+(v\.|vs\.?|versus)\s+", " v. ", title, flags=re.I)
    meta["title"] = nice_case(title)[:250] or None
    if m := re.search(r"\[([^\]]*JJ?\.)\]", text_):
        meta["judges"] = m.group(1).replace("*", "").strip()
    return meta


# ---------------------------------------------------------------- ingest

def find_existing(db: Session, source_key: str | None, sha: str) -> Document | None:
    q = db.query(Document).filter(Document.kind == "judgment")
    if source_key and (d := q.filter(Document.source_key == source_key).first()):
        return d
    return q.filter(Document.sha256 == sha).first()


def ingest(db: Session, data: bytes, meta: dict, source_key: str | None, embed: bool = True) -> tuple[Document, bool]:
    """Add one judgment to the public library. Returns (document, created)."""
    sha = hashlib.sha256(data).hexdigest()
    if existing := find_existing(db, source_key, sha):
        return existing, False

    pages = extract_pdf_bytes(data)
    cleaned, stats = clean_pages(pages)
    title = meta.get("title") or meta.get("neutral_citation") or meta.get("scr_citation") or "Supreme Court judgment"
    doc = Document(workspace_id=None, kind="judgment", filename=title[:300], sha256=sha, pages=len(pages),
                   status="done", meta=meta, source_key=source_key,
                   citations=extract_document_citations(cleaned)[:300])
    db.add(doc)
    db.flush()
    stats.update(passages.build(db, doc, cleaned, commit=False, embed=embed))
    doc.stats = stats
    db.commit()
    return doc, True
