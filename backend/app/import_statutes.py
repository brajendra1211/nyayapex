"""Import bare acts and the old<->new criminal-law correspondence into the database.

Put the official PDFs in backend/data/statutes/raw/ with these names (any that are missing are skipped):
    BNS.pdf, BNSS.pdf, BSA.pdf   - Gazette of India copies (as enacted, 25.12.2023)
    IPC.pdf, CRPC.pdf, IEA.pdf   - India Code PDFs of the repealed codes (download in a browser from indiacode.nic.in)
    COI.pdf                      - The Constitution of India (legislative.gov.in)
    bprd_handbook.pdf            - BPR&D (MHA) "Handbook on the Bharatiya Nyaya Sanhita, 2023" (IPC<->BNS tables)

    python -m app.import_statutes
"""

import hashlib
import re
import sys
from pathlib import Path

from .db import SessionLocal, prepare_database
from .models import SectionMap, Statute, StatuteSection
from .services import statutes as S

RAW = Path(__file__).resolve().parents[1] / "data" / "statutes" / "raw"

SOURCES = {
    "BNS": ("As enacted - Gazette of India Extraordinary, Part II Sec. 1, No. 53, 25.12.2023",
            "Gazette of India (copy hosted by PRS Legislative Research)",
            "https://prsindia.org/files/bills_acts/acts_parliament/2023/The Bharatiya Nyaya Sanhita, 2023.pdf"),
    "BNSS": ("As enacted - Gazette of India Extraordinary, Part II Sec. 1, No. 54, 25.12.2023",
             "Gazette of India (copy hosted by PRS Legislative Research)",
             "https://prsindia.org/files/bills_acts/acts_parliament/2023/The Bharatiya Nagarik Suraksha Sanhita, 2023.pdf"),
    "BSA": ("As enacted - Gazette of India, 25.12.2023", "Gazette of India (copy hosted by PRS Legislative Research)",
            "https://prsindia.org/files/bills_acts/acts_parliament/2023/The Bharatiya Sakshya Bill, 2023.pdf"),
    "IPC": ("As in India Code (repealed w.e.f. 01.07.2024, with savings)", "India Code", "https://www.indiacode.nic.in/"),
    "CRPC": ("As in India Code (repealed w.e.f. 01.07.2024, with savings)", "India Code", "https://www.indiacode.nic.in/"),
    "IEA": ("As in India Code (repealed w.e.f. 01.07.2024, with savings)", "India Code", "https://www.indiacode.nic.in/"),
    "COI": ("As published by the Legislative Department", "Legislative Department, Ministry of Law and Justice",
            "https://legislative.gov.in/constitution-of-india/"),
}
BPRD_SOURCE = "BPR&D (Ministry of Home Affairs), Handbook on the Bharatiya Nyaya Sanhita, 2023 - correspondence table, p. {page}"


# Marginal headings the PDF parser misses (the heading block sits beside the previous section's heading).
# Copied from the margins of the same Gazette PDFs, page given for checking.
MARGIN_TITLES = {
    ("BNS", "22"): "Act of a person of unsound mind.",  # p.12
    ("BNS", "157"): "Public servant negligently suffering such prisoner to escape.",  # p.49
    ("BNS", "166"): "Abetment of act of insubordination by soldier, sailor or airman.",  # p.50
    ("BNS", "175"): "False statement in connection with an election.",  # p.51
    ("BNS", "243"): "Fraudulent removal or concealment of property to prevent its seizure as forfeited or in execution.",  # p.67
    ("BNS", "340"): "Forged document or electronic record and using it as genuine.",  # p.95
    ("BNSS", "31"): "Public when to assist Magistrates and police.",  # p.11
    ("BNSS", "169"): "Information of design to commit cognizable offences.",  # p.52
    ("BNSS", "201"): "Place of trial in case of certain offences.",  # p.65
    ("BNSS", "316"): "Record of examination of accused.",  # p.96
    ("BNSS", "489"): "Discharge of sureties.",  # p.148
    ("BSA", "77"): "Proof of other official documents.",  # p.26
}
# The Gazette's closing signature and press imprint after the last section ("—————\nNAME,\nSecretary ... PRESS ...")
GAZETTE_TAIL = re.compile(r"\n\s*[—–-]{3,}\s*\n[\s\S]*$")


def clean_section(code: str, number: str, title: str, text_: str) -> tuple[str, str]:
    title = title or MARGIN_TITLES.get((code, number), "").rstrip(".")
    if re.search(r"GOVERNMENT OF INDIA PRESS|Legislative Counsel|CONTROLLER OF PUBLICATIONS", text_ or ""):
        text_ = GAZETTE_TAIL.sub("", text_).rstrip()
    return title, text_


def import_act(db, code: str, path: Path) -> int:
    data = path.read_bytes()
    sections = S.parse_act_pdf(data)
    if len(sections) < 10:
        print(f"  {code}: only {len(sections)} sections recognised - layout not supported yet, skipped")
        return 0
    version, source_name, url = SOURCES[code]
    st = db.query(Statute).filter(Statute.code == code).first() or Statute(code=code)
    st.title, st.act_no = S.CATALOGUE[code]["title"], S.CATALOGUE[code]["act"]
    st.version, st.source_name, st.source_url = version, source_name, url
    st.sha256, st.sections_count = hashlib.sha256(data).hexdigest(), len(sections)
    db.add(st)
    db.flush()
    db.query(StatuteSection).filter(StatuteSection.statute_id == st.id).delete()
    seen = set()
    for s in sections:
        if s.number in seen:
            continue
        seen.add(s.number)
        title, body = clean_section(code, s.number, s.title, s.text)
        db.add(StatuteSection(statute_id=st.id, number=s.number, sort_key=S.sort_key(s.number), title=title[:400],
                              text=body, chapter=s.chapter, chapter_title=s.chapter_title[:300], page=s.page))
    db.commit()
    untitled = sum(1 for s in sections if not clean_section(code, s.number, s.title, '')[0])
    print(f"  {code}: {len(seen)} sections ({untitled} without a marginal title)")
    return len(seen)


def import_bns_map(db, path: Path) -> None:
    pairs = S.parse_bprd_bns_tables(path.read_bytes())
    bns_titles = {s.number: s.title for s in db.query(StatuteSection).join(Statute).filter(Statute.code == "BNS")}
    db.query(SectionMap).filter(SectionMap.old_code == "IPC", SectionMap.new_code == "BNS", SectionMap.official.is_(True)).delete()
    flagged = 0
    for p in pairs:
        # flag only what can be shown wrong: a BNS section the Sanhita does not have
        needs_check = bool(p["bns"] and bns_titles and p["bns"] not in bns_titles)
        flagged += needs_check
        db.add(SectionMap(old_code="IPC", old_section=p["ipc"], old_title=p["ipc_title"][:400], new_code="BNS",
                          new_section=p["bns"], new_ref=p["bns_ref"], relation=p["relation"],
                          source=BPRD_SOURCE.format(page=p["page"]), official=True, needs_check=needs_check))
    db.commit()
    print(f"  IPC->BNS: {len(pairs)} pairs from the BPR&D handbook ({flagged} flagged to check)")


def auto_map(db, old_code: str, new_code: str) -> None:
    """CrPC->BNSS and IEA->BSA: no official table available here, so match sections by their text (flagged)."""
    def load(code):
        st = db.query(Statute).filter(Statute.code == code).first()
        if not st:
            return None
        return [(s.number, s.title, s.text) for s in db.query(StatuteSection).filter(StatuteSection.statute_id == st.id)]
    old, new = load(old_code), load(new_code)
    if not old or not new:
        print(f"  {old_code}->{new_code}: needs both texts imported - skipped")
        return
    db.query(SectionMap).filter(SectionMap.old_code == old_code, SectionMap.new_code == new_code, SectionMap.official.is_(False)).delete()
    matches = S.auto_match(old, new)
    for m in matches:
        db.add(SectionMap(old_code=old_code, old_section=m["old"], old_title=m["old_title"][:400], new_code=new_code,
                          new_section=m["new"], new_ref=m["new"], relation="corresponds",
                          source=f"Matched by text similarity ({m['score']:.0%}) - verify", official=False, needs_check=True))
    db.commit()
    print(f"  {old_code}->{new_code}: {len(matches)} pairs matched by text (marked 'verify')")


def main() -> None:
    prepare_database()
    db = SessionLocal()
    print(f"Reading {RAW}")
    for code in ("BNS", "BNSS", "BSA", "IPC", "CRPC", "IEA", "COI"):
        f = RAW / f"{code}.pdf"
        if f.exists():
            import_act(db, code, f)
        else:
            print(f"  {code}: {f.name} not found - skipped")
    if (RAW / "bprd_handbook.pdf").exists():
        import_bns_map(db, RAW / "bprd_handbook.pdf")
    auto_map(db, "CRPC", "BNSS")
    auto_map(db, "IEA", "BSA")
    db.close()


if __name__ == "__main__":
    sys.exit(main())
