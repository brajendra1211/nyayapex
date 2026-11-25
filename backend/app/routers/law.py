"""Bare-act library: what the law says, verbatim, with old<->new criminal-law correspondence and the Supreme Court
judgments that discuss each provision. No AI here - text comes from the official PDFs (Reg 19(1)(d) legal research)."""

import re
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from ..auth import member
from ..db import IS_PG, get_db
from ..models import Chunk, Document, SectionMap, Statute, StatuteSection, User
from ..services import access, ai_log, legal_hindi, llm
from ..services import statutes as S
from ..services.retrieval import search

router = APIRouter(prefix="/api", tags=["law"])

ALIAS = {"IPC": "Indian Penal Code", "CRPC": "Code of Criminal Procedure", "IEA": "Evidence Act",
         "BNS": "Bharatiya Nyaya Sanhita", "BNSS": "Bharatiya Nagarik Suraksha Sanhita", "BSA": "Bharatiya Sakshya Adhiniyam",
         "COI": "Constitution"}


SYNONYMS = {  # common usage -> words the statutes actually use
    "anticipatory bail": "apprehending arrest bail direction",
    "fir": "information cognizable offence officer in charge police station",
    "quash": "inherent powers High Court",
    "default bail": "investigation cannot be completed custody period",
    "dying declaration": "statement cause death",
    "electronic evidence": "electronic record admissibility certificate",
    "chargesheet": "report police officer completion investigation",
    "charge sheet": "report police officer completion investigation",
    "remand": "detention custody Magistrate",
    "domestic violence": "cruelty husband relative",
    "sexual harassment": "sexual harassment",
    "cheque bounce": "dishonour cheque",
    "confession": "confession",
    "witness protection": "witness protection",
    "plea bargaining": "plea bargaining",
    "absconding": "proclaimed person",
    "whatsapp": "electronic record", "screenshot": "electronic record", "cctv": "electronic record",
    "email": "electronic record", "sms": "electronic record", "video recording": "electronic record",
}


def _statute(db: Session, code: str) -> Statute | None:
    return db.query(Statute).filter(Statute.code == code.upper()).first()


def _section(db: Session, code: str, number: str) -> StatuteSection | None:
    st = _statute(db, code)
    if not st:
        return None
    return db.query(StatuteSection).filter(StatuteSection.statute_id == st.id,
                                           StatuteSection.number == S.base_number(number)).first()


def correspondence(db: Session, code: str, number: str) -> list[dict]:
    """Both directions: IPC 302 -> BNS 103, and BNS 103 -> IPC 302."""
    code, number = code.upper(), S.base_number(number)
    rows = db.query(SectionMap).filter(or_((SectionMap.old_code == code) & (SectionMap.old_section == number),
                                           (SectionMap.new_code == code) & (SectionMap.new_section == number))).all()
    out = []
    for m in rows:
        forward = m.old_code == code
        other_code, other_sec = (m.new_code, m.new_section) if forward else (m.old_code, m.old_section)
        other = _section(db, other_code, other_sec) if other_sec else None
        out.append({"direction": "new" if forward else "old", "code": other_code, "section": other_sec,
                    "ref": (m.new_ref if forward else m.old_section) or other_sec, "relation": m.relation,
                    "title": (other.title if other else "") or (m.old_title if not forward else ""),
                    "available": bool(other), "source": m.source, "official": m.official, "needs_check": m.needs_check})
    return sorted(out, key=lambda r: S.sort_key(r["section"] or "0"))


def section_dict(db: Session, st: Statute, sec: StatuteSection, with_map: bool = True) -> dict:
    info = S.CATALOGUE.get(st.code, {})
    out = {"code": st.code, "statute": st.title, "unit": info.get("unit", "Section"), "number": sec.number,
           "title": sec.title, "text": sec.text, "chapter": sec.chapter, "chapter_title": sec.chapter_title,
           "version": st.version, "source_name": st.source_name, "source_url": st.source_url, "page": sec.page}
    if info.get("repealed_from"):
        out["status"] = f"Repealed w.e.f. {info['repealed_from']:%d.%m.%Y} (applies to offences/proceedings before that date, subject to the saving clause)"
    elif info.get("in_force_from"):
        out["status"] = f"In force from {info['in_force_from']:%d.%m.%Y}"
    if with_map:
        out["correspondence"] = correspondence(db, st.code, sec.number)
    return out


# ---------------------------------------------------------------- browse

@router.get("/law/statutes")
def statutes(_: User = Depends(member), db: Session = Depends(get_db)):
    have = {s.code: s for s in db.query(Statute)}
    maps = dict(db.query(SectionMap.old_code, func.count()).group_by(SectionMap.old_code).all())
    out = []
    for code, info in S.CATALOGUE.items():
        st = have.get(code)
        out.append({"code": code, "title": info["title"], "act": info["act"], "available": bool(st),
                    "sections": st.sections_count if st else 0, "version": st.version if st else None,
                    "source_name": st.source_name if st else None, "mapped_to_new": maps.get(code, 0),
                    "replaced_by": info.get("replaced_by"), "replaces": info.get("replaces")})
    return out


@router.get("/law/{code}/sections")
def contents(code: str, _: User = Depends(member), db: Session = Depends(get_db)):
    st = _statute(db, code)
    if not st:
        raise HTTPException(404, f"{code.upper()} is not in the library yet.")
    rows = db.query(StatuteSection.number, StatuteSection.title, StatuteSection.chapter, StatuteSection.chapter_title) \
        .filter(StatuteSection.statute_id == st.id).order_by(StatuteSection.sort_key).all()
    return {"code": st.code, "title": st.title, "version": st.version, "source_name": st.source_name,
            "sections": [{"number": n, "title": t, "chapter": c, "chapter_title": ct} for n, t, c, ct in rows]}


@router.get("/law/{code}/{number}")
def section(code: str, number: str, user: User = Depends(member), db: Session = Depends(get_db)):
    st = _statute(db, code)
    sec = _section(db, code, number) if st else None
    if not sec:
        corr = correspondence(db, code, number)
        if corr:  # e.g. IPC section whose text is not imported yet - still show the mapping
            return {"code": code.upper(), "statute": S.CATALOGUE.get(code.upper(), {}).get("title", code), "number": S.base_number(number),
                    "title": next((c["title"] for c in corr if c["direction"] == "old"), "") or
                             db.query(SectionMap.old_title).filter(SectionMap.old_code == code.upper(),
                                                                   SectionMap.old_section == S.base_number(number)).scalar() or "",
                    "text": None, "correspondence": corr, "status": "Text not in the library yet - see the corresponding provision."}
        raise HTTPException(404, f"{code.upper()} {number} not found in the library.")
    return section_dict(db, st, sec)


@router.get("/law/{code}/{number}/judgments")
def judgments(code: str, number: str, user: User = Depends(member), db: Session = Depends(get_db)):
    """Supreme Court judgments in the library that discuss this provision (or its old/new counterpart)."""
    code, number = code.upper(), S.base_number(number)
    names = [(code, number)] + [(c["code"], c["section"]) for c in correspondence(db, code, number) if c["section"]]
    seen, out = set(), []
    for c, n in names[:3]:
        unit = "Article" if c == "COI" else "Section"
        sec = _section(db, c, n)
        q = f"{unit} {n} {ALIAS.get(c, c)} {sec.title if sec else ''}".strip()
        for p, score in search(db, q, user.workspace_id, k=6):
            d = db.get(Document, p.document_id)
            if not d or d.kind != "judgment" or d.id in seen:
                continue
            body = p.text
            mentions = bool(re.search(rf"\b(?:section|s\.|sec\.?|article|art\.?)\s*{re.escape(n)}\b", body, re.I))
            seen.add(d.id)
            m = d.meta or {}
            out.append({"document_id": d.id, "title": m.get("title") or d.filename,
                        "citation": m.get("neutral_citation") or m.get("scr_citation"), "decision_date": m.get("decision_date"),
                        "source_url": m.get("source_url"), "pages": [p.page_start, p.page_end], "via": f"{c} {n}",
                        "mentions_provision": mentions, "snippet": re.sub(r"\[p\.\d+\]\s*", "", body[:350]).strip()})
    out.sort(key=lambda j: not j["mentions_provision"])
    return out[:8]


# ---------------------------------------------------------------- search & references

def lookup_references(db: Session, text_: str, limit: int = 6) -> list[dict]:
    """Statute provisions named in free text ('302 IPC', 'Section 482 BNSS', 'Article 21'), with their text."""
    refs = S.parse_provisions(text_)
    out = []
    for code, n in refs[:limit]:
        st = _statute(db, code)
        sec = _section(db, code, n) if st else None
        if sec:
            out.append(section_dict(db, st, sec))
        elif corr := correspondence(db, code, n):
            out.append({"code": code, "statute": S.CATALOGUE[code]["title"], "number": n, "title": "", "text": None,
                        "correspondence": corr, "status": "Text not in the library yet"})
    return out


NUMBER_ONLY = re.compile(r"^\s*(?:(?:section|sec|s|dhara|धारा)\.?\s*)?(\d{1,3}[A-Z]{0,2})\s*$", re.I)
NOISE_TITLES = r"^(definitions|general explanations|compounding of offences|interpretation)"  # long sections that mention everything


def _stub(db: Session, code: str, n: str) -> dict | None:
    """An old-code section whose text is not imported, shown through its new-law counterpart."""
    corr = correspondence(db, code, n)
    if not corr:
        return None
    title = db.query(SectionMap.old_title).filter(SectionMap.old_code == code, SectionMap.old_section == n).scalar() or ""
    return {"code": code, "statute": S.CATALOGUE[code]["title"], "number": n, "title": title, "text": None,
            "correspondence": corr, "status": "Text not in the library yet - see the corresponding provision."}


def _with_counterparts(db: Session, refs: list[dict]) -> list[dict]:
    """IPC 420 (no text yet) is followed by the full text of BNS 318 it became."""
    out, seen = [], set()
    for r in refs:
        key = (r["code"], r["number"])
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
        if r.get("text"):
            continue
        for c in r.get("correspondence") or []:
            st = _statute(db, c["code"]) if c.get("section") else None
            sec = _section(db, c["code"], c["section"]) if st else None
            if sec and (c["code"], sec.number) not in seen:
                seen.add((c["code"], sec.number))
                out.append(section_dict(db, st, sec))
    return out[:8]


# Everyday terms -> the section people mean, shown first (each checked against the section's title in the library)
PINNED = {
    "anticipatory bail": [("BNSS", "482")],
    "default bail": [("BNSS", "187")], "statutory bail": [("BNSS", "187")], "remand": [("BNSS", "187")],
    "bail": [("BNSS", "478"), ("BNSS", "480"), ("BNSS", "483"), ("BNSS", "482")],
    "zero fir": [("BNSS", "173")], "fir": [("BNSS", "173")], "first information report": [("BNSS", "173")],
    "charge sheet": [("BNSS", "193")], "chargesheet": [("BNSS", "193")],
    "dying declaration": [("BSA", "26")],
    "electronic evidence": [("BSA", "63"), ("BSA", "61")], "electronic record": [("BSA", "63"), ("BSA", "61")],
    "maintenance": [("BNSS", "144")],
    "quash": [("BNSS", "528")], "quashing": [("BNSS", "528")], "inherent powers": [("BNSS", "528")],
    "dowry death": [("BNS", "80")], "dowry": [("BNS", "80")],
    "domestic violence": [("BNS", "85"), ("BNS", "86")], "cruelty": [("BNS", "85"), ("BNS", "86")],
    "summons": [("BNSS", "63"), ("BNSS", "64")],
    "arrest without warrant": [("BNSS", "35")], "arrest": [("BNSS", "35"), ("BNSS", "47"), ("BNSS", "58")],
    "abetment of suicide": [("BNS", "108")],
    "criminal intimidation": [("BNS", "351")], "threat": [("BNS", "351")],
    "confession": [("BSA", "22"), ("BSA", "23"), ("BNSS", "183")],
    "criminal conspiracy": [("BNS", "61")], "conspiracy": [("BNS", "61")],
    "sexual harassment": [("BNS", "75")],
    "trespass": [("BNS", "329")], "mischief": [("BNS", "324")],
    "absconding": [("BNSS", "84")], "proclaimed offender": [("BNSS", "84")],
    "organised crime": [("BNS", "111")], "terrorism": [("BNS", "113")], "terrorist act": [("BNS", "113")],
    "sedition": [("BNS", "152")],
    "hurt": [("BNS", "114"), ("BNS", "115"), ("BNS", "117")],
}
_PIN_KEYS = sorted(PINNED, key=len, reverse=True)


def _pinned(db: Session, phrase: str) -> list[tuple[str, str]]:
    """Sections for the everyday terms in the query, longest phrase first ('anticipatory bail' before 'bail')."""
    low, out = f" {phrase.lower()} ", []
    for k in _PIN_KEYS:
        if f" {k} " in low:
            low = low.replace(f" {k} ", " ")
            out += [p for p in PINNED[k] if p not in out]
    return out[:5]


def _text_search(db: Session, words: str, phrase: str) -> list[tuple[int, float]]:
    """Full-text search where the section title counts most: 'murder' finds Murder and Punishment for murder first."""
    phrase = phrase.lower().strip()
    rows: list = []
    for sql_q in ("websearch_to_tsquery('english', :q)",  # all words, then any word (ranked)
                  "to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', :q)), ' | '))"):
        rows = db.execute(text(
            f"SELECT s.id, ts_rank(s.tsv, {sql_q})"
            f" + 2 * ts_rank(to_tsvector('english', coalesce(s.title, '')), {sql_q})"
            f" + CASE WHEN lower(s.title) IN (:p, :pp, :pd) THEN 1.0 ELSE 0 END"
            f" - CASE WHEN s.title ~* :noise THEN 0.4 ELSE 0 END AS r"
            f" FROM statute_sections s WHERE s.tsv @@ {sql_q} ORDER BY r DESC LIMIT 25"),
            {"q": words, "p": phrase, "pp": f"punishment for {phrase}", "pd": phrase.rstrip("s"), "noise": NOISE_TITLES}).all()
        if len(rows) >= 3:
            break
    return [(r[0], r[1]) for r in rows]


@router.get("/law/search")
def law_search(q: str, user: User = Depends(member), db: Session = Depends(get_db)):
    q = " ".join(q.split())
    if len(q) < 2:
        return {"references": [], "results": [], "notes": []}
    notes: list[str] = []
    q_num = q.translate(legal_hindi.DEVANAGARI_DIGITS)

    # 1. A section number alone ("302", "section 138", "धारा 420"): that number in every act, old codes first
    if m := NUMBER_ONLY.fullmatch(q_num):
        n = S.base_number(m[1])
        refs = []
        for code in ("IPC", "CRPC", "IEA", "BNS", "BNSS", "BSA"):
            st = _statute(db, code)
            sec = _section(db, code, n) if st else None
            if sec:
                refs.append(section_dict(db, st, sec))
            elif not st and (stub := _stub(db, code, n)):
                refs.append(stub)
        notes.append(f"Section {n} in each act. Add the act to narrow it, e.g. \"{n} IPC\" or \"BNS {n}\".")
        if not refs:
            notes = [f"No section {n} in the acts in the library (BNS, BNSS, BSA and the IPC, CrPC and Evidence Act mapping). "
                     "It may be from another act, such as the Negotiable Instruments Act (section 138, cheque bounce)."]
        return {"references": refs[:8], "results": [], "notes": notes}

    # 2. Named provisions ("420 IPC", "BNS 103", "Article 21")
    parsed = S.parse_provisions(q_num)
    if parsed:
        refs = lookup_references(db, q_num)
        found = {(r["code"], r["number"]) for r in refs}
        for code, n in parsed:
            if (code, n) not in found:
                what = "The Constitution of India" if code == "COI" else S.CATALOGUE.get(code, {}).get("title", code)
                notes.append(f"{'Article' if code == 'COI' else 'Section'} {n} of {what} is not in the library yet.")
        return {"references": _with_counterparts(db, refs), "results": [], "notes": notes}

    # 3. Words, in English, Hindi or Hinglish
    results = []
    if IS_PG:
        english = legal_hindi.english_terms(q)
        ascii_part = re.sub(r"[^\x00-\x7F]+", " ", q).strip()
        words = " ".join([ascii_part, *english]).strip()
        for common, statutory in SYNONYMS.items():  # everyday legal terms the bare acts do not use
            if common in words.lower():
                words += " " + statutory
        if english:
            notes.append(f"Searched for: {', '.join(english)}")
        if not words:
            return {"references": [], "results": [], "notes": ["Try the English legal word, e.g. theft, murder or bail."]}
        phrase = " ".join(english) if english and not ascii_part else ascii_part
        rows = _text_search(db, words, phrase)
        codes = {x.id: x.code for x in db.query(Statute)}
        pinned_ids = []
        for code, n in _pinned(db, " ".join([ascii_part, *english])):
            sec = _section(db, code, n)
            if sec:
                pinned_ids.append(sec.id)
        order = list(dict.fromkeys(pinned_ids + [r[0] for r in rows]))[:25]
        secs = {x.id: x for x in db.query(StatuteSection).filter(StatuteSection.id.in_(order))}
        for sid in order:
            x = secs[sid]
            results.append({"code": codes[x.statute_id], "number": x.number, "title": x.title,
                            "snippet": x.text[:260], "chapter_title": x.chapter_title})
    return {"references": [], "results": results, "notes": notes}


LAW_ASK_SYSTEM = (
    "You help a user find the provisions of Indian criminal law (BNS, BNSS, BSA) that relate to a situation or question. "
    "You are given candidate sections from the official bare acts, each labelled like [BNS 303]. Choose only from them. "
    "List the 3 to 5 most relevant sections, most relevant first. For each: the label in square brackets, its heading, "
    "then one or two plain sentences on what it provides and why it may relate to the question. "
    "If a provision of another act (not given) is clearly the main one, name the act in one line without quoting it. "
    "If none of the candidates fits, say so plainly. "
    "Do not quote or invent text that is not in the candidates, do not advise the user what to do, and do not say how a "
    "case would turn out. Mention that for acts before 1 July 2024 the IPC, CrPC or Evidence Act applies instead. "
    "Write in {lang}. Under 200 words. No preamble, no remarks about page numbers or about what the material lacks."
)
KEYWORDS_SYSTEM = (
    "Turn the user's question about Indian law (in any language) into 3 to 8 English search keywords as the BNS, BNSS or "
    "BSA would word them (for example: theft, robbery, criminal intimidation, cheating, electronic record, information in "
    "cognizable cases). Output only the keywords, comma separated."
)
LAW_LANG = {"en": "simple English", "hi": "simple Hindi (Devanagari); keep section labels like [BNS 303] as they are"}
LABEL_RE = re.compile(r"\[(BNSS|BNS|BSA)\s+(\d{1,3}[A-Z]{0,2})\]")


class LawAskIn(BaseModel):
    question: str = Field(min_length=4, max_length=1000)
    lang: Literal["en", "hi"] = "en"


@router.post("/law/ask")
def law_ask(body: LawAskIn, user: User = Depends(member), db: Session = Depends(get_db)):
    """'Which section applies?' in plain words: library search finds candidates, AI picks and explains among them."""
    q = " ".join(body.question.split())
    english = legal_hindi.english_terms(q)
    ascii_part = re.sub(r"[^\x00-\x7F]+", " ", q).strip()
    words = " ".join([ascii_part, *english]).strip()
    try:  # a failed keyword step only narrows the search; the answer is still given
        raw_kw = llm.ask(db, feature="law_ask", system=KEYWORDS_SYSTEM, user=q, max_tokens=300, think=False, workspace_id=user.workspace_id)
    except HTTPException:
        raw_kw = ""
    keywords = re.sub(r"[^A-Za-z ,()-]", " ", raw_kw or "")[:300]
    words = " ".join([words, keywords.replace(",", " ")]).strip()
    for common, statutory in SYNONYMS.items():
        if common in words.lower():
            words += " " + statutory
    ids: list[int] = []
    for code, n in S.parse_provisions(q):  # named provisions first
        sec = _section(db, code, n)
        if sec:
            ids.append(sec.id)
        for c in correspondence(db, code, n):
            sec = _section(db, c["code"], c["section"]) if c.get("section") else None
            if sec:
                ids.append(sec.id)
    for code, n in _pinned(db, " ".join([words.lower(), *[k.strip().lower() for k in keywords.split(",")]])):
        sec = _section(db, code, n)
        if sec:
            ids.append(sec.id)
    if IS_PG:
        for kw in [k.strip() for k in keywords.split(",") if k.strip()][:8]:  # each keyword's best sections first
            ids += [r[0] for r in _text_search(db, kw, kw)[:2]]
        if words:
            ids += [r[0] for r in _text_search(db, words, "")]
    ids = list(dict.fromkeys(ids))[:14]
    if not ids:
        return {"answer": None, "sections": [], "note": "No related section was found in BNS, BNSS or BSA. Try other words."}
    codes = {x.id: x.code for x in db.query(Statute)}
    secs = {x.id: x for x in db.query(StatuteSection).filter(StatuteSection.id.in_(ids))}
    cands = [secs[i] for i in ids if i in secs]
    material = "\n\n".join(f"[{codes[x.statute_id]} {x.number}] {x.title}\n{(x.text or '')[:1400]}" for x in cands)
    answer = llm.ask(db, feature="law_ask", system=LAW_ASK_SYSTEM.format(lang=LAW_LANG[body.lang]),
                     user=f"Candidate sections:\n{material}\n\nQuestion: {q}", max_tokens=2000, think=False, workspace_id=user.workspace_id)
    known = {(codes[x.statute_id], x.number): x for x in cands}
    cited = []
    for code, n in LABEL_RE.findall(answer or ""):
        if (code, n) in known and (code, n) not in cited:
            cited.append((code, n))
    # a label the AI made up (not among the candidates) is not linked
    answer = LABEL_RE.sub(lambda m: m[0] if (m[1], m[2]) in known else f"{m[1]} {m[2]} (not verified)", answer or "")
    log_id = ai_log.record(db, feature="law_ask", output=answer, user=user, prompt=q, sources=[f"{c} s.{n}" for c, n in cited])
    return {"answer": answer, "ai_log_id": log_id, "ai_generated": True,
            "sections": [{"code": c, "number": n, "title": known[(c, n)].title} for c, n in cited],
            "candidates": len(cands),
            "disclaimer": "AI suggestion of sections to read, chosen from the bare acts in the library. Read the full text of each "
                          "section; this is not legal advice."}


@router.get("/law/convert")
def convert(code: str, section: str, _: User = Depends(member), db: Session = Depends(get_db)):
    return correspondence(db, code, section)


@router.get("/matters/{case_id}/applicable-law")
def applicable_law(case_id: int, offence_date: date | None = None, user: User = Depends(member), db: Session = Depends(get_db)):
    """Every statute provision named in this matter's papers, with its text, where it appears, and - given the date of
    the offence / cause of action - whether the old code or the new Sanhita governs."""
    case = access.case_for(db, user, case_id)
    docs = db.query(Document).filter(Document.case_id == case.id).all()
    found: dict[tuple[str, str], dict] = {}
    for d in docs:
        for c in db.query(Chunk).filter(Chunk.document_id == d.id).order_by(Chunk.idx):
            for code, n in S.find_references(c.text):
                f = found.setdefault((code, n), {"count": 0, "where": []})
                f["count"] += 1
                if len(f["where"]) < 5 and not any(w["document_id"] == d.id and w["page"] == c.page_start for w in f["where"]):
                    f["where"].append({"document_id": d.id, "document": d.filename, "page": c.page_start})
    for code, n in S.find_references(case.title or ""):
        found.setdefault((code, n), {"count": 0, "where": []})
    out = []
    for (code, n), f in sorted(found.items(), key=lambda kv: -kv[1]["count"]):
        st = _statute(db, code)
        sec = _section(db, code, n) if st else None
        item = section_dict(db, st, sec) if sec else {
            "code": code, "statute": S.CATALOGUE.get(code, {}).get("title", code), "number": n, "title": "", "text": None,
            "correspondence": correspondence(db, code, n), "status": "Text not in the library yet"}
        item.update(count=f["count"], where=f["where"])
        governing = S.applicable_code(code, offence_date)
        if governing != code:
            item["applicable_note"] = (f"For an offence / cause of action on {offence_date:%d.%m.%Y}, "
                                       f"{S.CATALOGUE[governing]['title']} applies - see the corresponding provision.")
        elif offence_date and S.CATALOGUE.get(code, {}).get("repealed_from"):
            item["applicable_note"] = f"{S.CATALOGUE[code]['title']} governs an offence of {offence_date:%d.%m.%Y} (before 01.07.2024)."
        out.append(item)
    return {"case_id": case.id, "offence_date": offence_date, "documents_scanned": len(docs), "provisions": out}
