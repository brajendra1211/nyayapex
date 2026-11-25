"""Remove noise before anything reaches Claude - every removed line is a saved token.

- repeated running headers / footers (case title, court name on every page)
- bare page numbers
- duplicate pages (same annexure attached twice)
- whitespace runs
"""

import hashlib
import re
from collections import Counter

from .extract import Page

PAGE_NUM_RE = re.compile(r"^\s*(page\s*)?[-–]?\s*\d{1,4}\s*[-–]?\s*(of\s*\d+)?\s*$", re.I)
EDGE_LINES = 3
REPEAT_RATIO = 0.3


def _norm(line: str) -> str:
    return re.sub(r"\d+", "#", line.strip().lower())


def clean_pages(pages: list[Page]) -> tuple[list[Page], dict]:
    raw_chars = sum(len(p.text) for p in pages)

    # 1. Lines that repeat at the top/bottom of many pages are headers/footers
    edge_counter: Counter[str] = Counter()
    for p in pages:
        lines = [l for l in p.text.splitlines() if l.strip()]
        for l in lines[:EDGE_LINES] + lines[-EDGE_LINES:]:
            edge_counter[_norm(l)] += 1
    threshold = max(3, int(len(pages) * REPEAT_RATIO))
    boilerplate = {k for k, v in edge_counter.items() if v >= threshold and len(k) > 2}

    cleaned: list[Page] = []
    seen_hashes: set[str] = set()
    duplicates = 0
    for p in pages:
        lines = []
        for line in p.text.splitlines():
            s = line.strip()
            if not s or PAGE_NUM_RE.match(s) or _norm(s) in boilerplate:
                continue
            lines.append(re.sub(r"[ \t]{2,}", " ", s))
        text = "\n".join(lines)
        h = hashlib.sha1(re.sub(r"\s+", "", text).encode()).hexdigest()
        if text and h in seen_hashes:
            duplicates += 1
            continue
        seen_hashes.add(h)
        cleaned.append(Page(p.number, text, p.ocr))

    clean_chars = sum(len(p.text) for p in cleaned)
    stats = {
        "pages": len(pages),
        "ocr_pages": sum(1 for p in pages if p.ocr),
        "duplicate_pages_removed": duplicates,
        "boilerplate_lines": len(boilerplate),
        "raw_chars": raw_chars,
        "clean_chars": clean_chars,
        "noise_removed_pct": round(100 * (1 - clean_chars / raw_chars), 1) if raw_chars else 0,
    }
    return cleaned, stats


def estimate_tokens(chars: int) -> int:
    # ~4 chars per token for English legal text (rough, display only)
    return chars // 4
