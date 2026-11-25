"""Import NCLAT final orders / judgments into the shared library.

    python -m app.import_nclat --from 2025-11-01 --to 2026-11-20 [--bench delhi|chennai|all] [--max 2500] [--db-limit-gb 7.3] [--dry-run]

Uses the tribunal's public judgment search (nclat.nic.in, judgement date wise; no CAPTCHA) the way its own page does,
one request at a time with a pause, and an honest User-Agent. NCLAT's copyright policy allows reproduction free of charge
if accurate and the source is prominently acknowledged: every order keeps its source link and attribution.
The PDF itself is not stored (readers open it on nclat.nic.in); text and search index are.
Stops on its own when the database reaches --db-limit-gb (the server's 10 GB budget).
"""

import argparse
import html
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import text

from .db import SessionLocal
from .models import Document
from .services import corpus, tribunal

BASE = "https://nclat.nic.in/display-board"
UA = "NyayApex-research/1.0 (+https://nyayapex.ai)"
PAUSE_S = 3.0
BENCHES = {"delhi": "Principal Bench, New Delhi", "chennai": "Chennai Bench"}
FINAL = re.compile(r"final order|judg", re.I)
ARISING = re.compile(r"Arising out of (?:the )?(?:impugned )?order dated\s*([\d./-]+)\s*passed by (?:the )?(National Company Law Tribunal)[,\s]+"
                     r"(.{0,220}?(?:19|20)\d{2})\s*\)", re.I)


def _session() -> tuple[httpx.Client, str]:
    c = httpx.Client(headers={"User-Agent": UA}, timeout=90, follow_redirects=True)
    r = c.get(f"{BASE}/judge")
    r.raise_for_status()
    m = re.search(r'name="_token" value="([^"]+)"', r.text)
    if not m:
        raise SystemExit("NCLAT judgment page changed (no form token); stopping.")
    return c, m.group(1)


def _cells(row: str) -> list[str]:
    return [" ".join(html.unescape(re.sub(r"<[^>]+>", " ", c)).split()) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]


def search(c: httpx.Client, token: str, bench: str, d1: date, d2: date) -> list[dict]:
    """Final orders / judgments dated d1..d2 at one bench, as listed by the tribunal."""
    r = c.post(f"{BASE}/judgement_details", headers={"X-Requested-With": "XMLHttpRequest", "Referer": f"{BASE}/judge"},
               data={"_token": token, "search_by": "order_date_wise", "location": bench, "case_type": "All",
                     "from_date": d1.strftime("%d-%m-%Y"), "to_date": d2.strftime("%d-%m-%Y")})
    r.raise_for_status()
    if r.headers.get("content-type", "").startswith("application/json"):
        return []  # validation message: nothing listed
    out = []
    # each case: a summary row (file no., case no., type, title, bench, status), then its order history with forms
    for block in re.split(r'<div class="order-detail-boxes">', r.text)[1:]:
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", block, re.S)
        # summary row: Sr. No and File Number are header cells, so the data cells are case no., type, title, bench, status, View
        summary = next((x for x in (_cells(r_) for r_ in rows) if len(x) >= 5 and x[-1] == "View" and "/" in x[0]), None)
        if not summary:
            continue
        case_no, case_type, title = summary[:3]
        for r_ in rows:
            cells = _cells(r_)
            form = re.search(r'<form action="[^"]*view_order"(.*?)</form>', r_, re.S)
            if len(cells) < 4 or not form or not FINAL.search(cells[2]):
                continue
            fields = {k: v.strip() for k, v in re.findall(r'name="([^"]+)" value="([^"]*)"', form.group(1))}
            try:
                od = date.fromisoformat(fields.get("order_date", ""))
            except ValueError:
                continue
            if not d1 <= od <= d2:
                continue
            filing = fields.get("filing_no", "")
            if not re.fullmatch(r"\d{6,20}", filing):
                continue
            out.append({"filing_no": filing, "case_no": f"{case_type} No. {case_no}", "case_type": case_type, "title": title,
                        "bench_code": bench, "order_date": od, "coram": cells[3].rstrip(" ,"), "fields": fields})
    return out


def fetch_pdf(c: httpx.Client, token: str, item: dict) -> bytes | None:
    data = {**item["fields"], "_token": token}
    r = c.post(f"{BASE}/view_order", data=data, headers={"Referer": f"{BASE}/judge"})
    if r.status_code != 200 or not r.content.startswith(b"%PDF"):
        return None
    return r.content


def nice_title(t: str) -> str:
    t = re.sub(r"\s+(?:VS\.?|V/S\.?|VERSUS)\s+", " v. ", t, flags=re.I)
    return corpus.nice_case(t)[:250] if hasattr(corpus, "nice_case") else t[:250]


def db_gb(db) -> float:
    return db.execute(text("SELECT pg_database_size(current_database())")).scalar() / 1024 ** 3


def months(d1: date, d2: date):
    a = d1
    while a <= d2:
        b = min(d2, (a.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1))
        yield a, b
        a = b + timedelta(days=1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="d1", required=True)
    ap.add_argument("--to", dest="d2", required=True)
    ap.add_argument("--bench", default="all", choices=["all", *BENCHES])
    ap.add_argument("--max", type=int, default=2500)
    ap.add_argument("--db-limit-gb", type=float, default=7.3)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    d1, d2 = date.fromisoformat(a.d1), date.fromisoformat(a.d2)
    benches = list(BENCHES) if a.bench == "all" else [a.bench]
    db = SessionLocal()
    c, token = _session()
    added = skipped = failed = linked = 0
    try:
        # newest month first, both benches each month: if the budget runs out, the oldest orders are the ones left out
        for m1, m2 in reversed(list(months(d1, d2))):
            for bench in benches:
                items = search(c, token, bench, m1, m2)
                time.sleep(PAUSE_S)
                print(f"{bench} {m1:%b %Y}: {len(items)} final orders listed", flush=True)
                for it in items:
                    key = f"nclat:{it['filing_no']}:{it['order_date']:%Y-%m-%d}"
                    if db.query(Document.id).filter(Document.source_key == key).first() or db.query(Document.id).filter(
                            Document.source_key.like("nclat:%"), Document.meta["other_case_nos"].as_string().contains(it["case_no"])).first():
                        skipped += 1
                        continue
                    if added >= a.max:
                        print(f"reached --max {a.max}; stopping", flush=True)
                        return
                    if db_gb(db) >= a.db_limit_gb:
                        print(f"database at {db_gb(db):.2f} GB (limit {a.db_limit_gb}); stopping to stay within the disk budget", flush=True)
                        return
                    if a.dry_run:
                        print(f"  would add {it['case_no']} | {it['title'][:60]} | {it['order_date']}")
                        added += 1
                        continue
                    pdf = fetch_pdf(c, token, it)
                    time.sleep(PAUSE_S)
                    if not pdf:
                        failed += 1
                        continue
                    from .services.extract import extract_pdf_bytes
                    try:
                        pages = extract_pdf_bytes(pdf)
                    except Exception:
                        failed += 1
                        continue
                    head = "\n".join(p.text for p in pages[:3])
                    if len(head.strip()) < 200:  # scanned copy: no text to search
                        failed += 1
                        continue
                    meta = tribunal.meta_from_text(head, "NCLAT", BENCHES[bench])
                    meta.update(title=nice_title(it["title"]), case_no=it["case_no"], decision_date=f"{it['order_date']:%Y-%m-%d}",
                                members=it["coram"][:300], source="nclat.nic.in", stored=False,
                                source_url=(f"{BASE}/view_order_pdf?fid={it['filing_no']}&&l={bench}&&d={it['order_date']:%Y-%m-%d}&&order_type=J"),
                                imported_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
                    if m := ARISING.search(" ".join(head.split())):
                        meta["arising_from"] = f"{m.group(2)}, {m.group(3)} (order dated {m.group(1)})"[:300]
                    try:
                        doc, created = corpus.ingest(db, pdf, meta, key)
                        if created:
                            added += 1
                        else:  # one judgment decides several appeals: record this case number on it too
                            m0 = dict(doc.meta or {})
                            others = list(dict.fromkeys([*(m0.get("other_case_nos") or []), it["case_no"]]))
                            if it["case_no"] != m0.get("case_no"):
                                doc.meta = {**m0, "other_case_nos": others[:20]}
                                db.commit()
                            linked += 1
                    except Exception as e:  # one bad file must not stop the run
                        db.rollback()
                        failed += 1
                        print(f"  failed {it['case_no']}: {e}", flush=True)
                    if added and added % 25 == 0:
                        print(f"  added {added} (db {db_gb(db):.2f} GB)", flush=True)
    finally:
        print(f"done: added {added}, same judgment as another appeal {linked}, already in library {skipped}, could not read {failed}", flush=True)
        db.close()
        c.close()


if __name__ == "__main__":
    sys.exit(main())
