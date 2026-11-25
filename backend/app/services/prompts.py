"""Prompts and output schemas. Keep these strings byte-stable: they are the cached prefix."""

FACTS_SYSTEM = (
    "Extract facts from one excerpt of a court record. Return only events that the excerpt itself states, "
    "with the page number from the nearest preceding [p.N] marker. Dates as YYYY-MM-DD; use '' if no exact date. "
    "Keep each event under 30 words. Issues = legal questions raised in this excerpt, under 20 words each."
)
FACTS_SCHEMA = {
    "type": "object",
    "properties": {
        "events": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"date": {"type": "string"}, "event": {"type": "string"}, "page": {"type": "integer"}},
            },
        },
        "parties": {"type": "array", "items": {"type": "string"}},
        "issues": {"type": "array", "items": {"type": "string"}},
    },
}

BRIEF_SYSTEM = (
    "You prepare a case brief for oral argument before the Supreme Court of India from a pre-extracted "
    "chronology and issue list (not the full record). Separate core issues from ancillary ones. "
    "Flag contradictions only where two listed events with page refs conflict, and cite both pages. "
    "Frame questions of law the way they appear in an SLP. List constitutional articles only if the material engages them."
)
BRIEF_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "core_issues": {"type": "array", "items": {"type": "string"}},
        "ancillary_issues": {"type": "array", "items": {"type": "string"}},
        "questions_of_law": {"type": "array", "items": {"type": "string"}},
        "contradictions": {
            "type": "array",
            "items": {"type": "object", "properties": {"point": {"type": "string"}, "pages": {"type": "array", "items": {"type": "integer"}}}},
        },
        "articles": {"type": "array", "items": {"type": "string"}},
        "hearing_points": {"type": "array", "items": {"type": "string"}},
    },
}

QA_SYSTEM = (
    "Answer the advocate's question using only the excerpts provided. Each excerpt is labelled "
    "[doc:ID p.N]. Cite those labels after every statement. If the excerpts don't answer it, say "
    "'Not found in the uploaded record.' and stop."
)

RESEARCH_SYSTEM = (
    "You are a legal research assistant. Use only the judgment excerpts provided, labelled in [square brackets] (case name + citation, or doc:ID, with pages). "
    "Rank the most relevant authorities first. For each: what it held, why it is relevant to the query, "
    "and the label. Labels naming NCLT or NCLAT are tribunal orders: say so, and rank Supreme Court judgments above them. "
    "Never cite a case that is not in the excerpts. End with a one-line caution if the "
    "excerpts are thin. Plain English, short paragraphs. Keep the whole answer under {words} words; "
    "skip authorities that add nothing new."
)

# ---- Individual accounts (a person following their own case, not a lawyer) ----
# Legal information in plain words, never legal advice or a forecast (Advocates Act 1961; draft SC AI Regulations 2026).
CITIZEN_RULES = (
    "The reader is an ordinary person, not a lawyer. Write in simple, everyday {lang} with short sentences. "
    "When you must use a legal word, explain it in brackets the first time. "
    "Give legal INFORMATION only. Never tell the reader what they should do in their own case, never say whether they "
    "will win or lose, never estimate chances, and never comment on any judge. "
    "Do not invent facts, dates, section numbers or cases; if the material does not answer something, say so plainly. "
    "End with one line suggesting they confirm with an advocate, or with free legal aid (NALSA helpline 15100) if they cannot afford one."
)

CITIZEN_RESEARCH_SYSTEM = (
    "You explain Indian law to an ordinary person. Use only the statutory text and judgment excerpts provided, labelled in "
    "[square brackets]. Start with a two or three sentence plain answer to the question. Then 'What the law says' (the "
    "relevant sections in simple words) and 'What courts have said' (at most three judgments: what each decided, in one or "
    "two lines, with its [label]). Never cite anything not in the material. Keep it under {words} words. "
) + CITIZEN_RULES

CITIZEN_EXPLAIN_SYSTEM = (
    "You explain a legal document (for example an FIR, a legal notice, a summons, a court order, a judgment or an "
    "agreement) to the person it concerns. Use only the document text given. Use these headings:\n"
    "1. What this document is (type, who issued it, to whom, date)\n"
    "2. What it says, in simple words (main points as a short list)\n"
    "3. Important dates and deadlines mentioned (exact, as written; 'none mentioned' if none)\n"
    "4. Laws and sections mentioned (each with a one-line plain meaning)\n"
    "5. Legal words used here (word: simple meaning)\n"
    "6. Questions you may want to ask your advocate (4 to 6 questions)\n"
    "Quote dates, names, numbers and section numbers exactly as written in the document. "
) + CITIZEN_RULES

COURTROOM_SYSTEM = (
    "Live hearing. Answer in at most 4 short lines: the authority, its holding in one sentence, and the "
    "excerpt's [label]. No preamble. If nothing in the excerpts answers it, reply exactly: 'No authority in your library.'"
)

DRAFT_SYSTEM = (
    "You draft Supreme Court of India pleadings as a first draft for an Advocate-on-Record. Follow the "
    "section skeleton you are given exactly, in order, using its headings. Use only the facts supplied; "
    "where a fact is missing write [TO BE FILLED: what is needed] instead of inventing it. Formal, "
    "precise language; numbered paragraphs; no rhetorical overstatement."
)

TEMPLATES = {
    "slp_civil": {
        "label": "Special Leave Petition (Civil)",
        "sections": [
            "SYNOPSIS AND LIST OF DATES",
            "IN THE SUPREME COURT OF INDIA — CIVIL APPELLATE JURISDICTION — SPECIAL LEAVE PETITION (CIVIL) NO. ___ OF ____ (cause title)",
            "PETITION UNDER ARTICLE 136 OF THE CONSTITUTION OF INDIA (opening paragraph identifying the impugned judgment)",
            "1. QUESTIONS OF LAW",
            "2. DECLARATION UNDER ORDER XXI RULE 3(2), SC RULES 2013 (no other petition filed) [VERIFY RULE NO.]",
            "3. DECLARATION: annexures are true copies of the record [VERIFY RULE NO.]",
            "4. GROUNDS",
            "5. GROUNDS FOR INTERIM RELIEF",
            "6. MAIN PRAYER",
            "7. PRAYER FOR INTERIM RELIEF",
            "FILED BY: Advocate-on-Record [TO BE FILLED]",
        ],
    },
    "slp_criminal": {
        "label": "Special Leave Petition (Criminal)",
        "sections": [
            "SYNOPSIS AND LIST OF DATES",
            "IN THE SUPREME COURT OF INDIA — CRIMINAL APPELLATE JURISDICTION — SPECIAL LEAVE PETITION (CRL.) NO. ___ OF ____ (cause title)",
            "PETITION UNDER ARTICLE 136 OF THE CONSTITUTION OF INDIA",
            "1. QUESTIONS OF LAW",
            "2. DECLARATION UNDER ORDER XXII, SC RULES 2013 (no other petition filed) [VERIFY RULE NO.]",
            "3. DECLARATION: annexures are true copies of the record [VERIFY RULE NO.]",
            "4. GROUNDS",
            "5. GROUNDS FOR INTERIM RELIEF (incl. exemption from surrendering, if applicable)",
            "6. MAIN PRAYER",
            "7. PRAYER FOR INTERIM RELIEF",
        ],
    },
    "writ_32": {
        "label": "Writ Petition (Article 32)",
        "sections": [
            "SYNOPSIS AND LIST OF DATES",
            "IN THE SUPREME COURT OF INDIA — CIVIL ORIGINAL JURISDICTION — WRIT PETITION (CIVIL) NO. ___ OF ____ (cause title)",
            "WRIT PETITION UNDER ARTICLE 32 OF THE CONSTITUTION OF INDIA",
            "1. FUNDAMENTAL RIGHTS INFRINGED (articles and how)",
            "2. FACTS",
            "3. GROUNDS",
            "4. DECLARATION: no other petition on the same cause filed",
            "5. PRAYER",
        ],
    },
    "civil_appeal": {
        "label": "Civil Appeal",
        "sections": [
            "SYNOPSIS AND LIST OF DATES",
            "IN THE SUPREME COURT OF INDIA — CIVIL APPELLATE JURISDICTION — CIVIL APPEAL NO. ___ OF ____",
            "MEMORANDUM OF APPEAL (statutory provision under which the appeal lies)",
            "1. FACTS",
            "2. QUESTIONS OF LAW",
            "3. GROUNDS",
            "4. PRAYER",
        ],
    },
    "review": {
        "label": "Review Petition",
        "sections": [
            "IN THE SUPREME COURT OF INDIA — REVIEW PETITION (__) NO. ___ OF ____ IN (main matter)",
            "REVIEW PETITION UNDER ARTICLE 137 r/w ORDER XLVII, SC RULES 2013",
            "1. JUDGMENT UNDER REVIEW",
            "2. ERROR APPARENT ON THE FACE OF THE RECORD",
            "3. GROUNDS",
            "4. CERTIFICATE: grounds not urged earlier / counsel's certificate",
            "5. PRAYER",
        ],
    },
    "curative": {
        "label": "Curative Petition",
        "sections": [
            "IN THE SUPREME COURT OF INDIA — CURATIVE PETITION (__) NO. ___ OF ____ IN REVIEW PETITION NO. ___",
            "CURATIVE PETITION (Rupa Ashok Hurra v. Ashok Hurra, (2002) 4 SCC 388; Order XLVIII, SC Rules 2013)",
            "1. GROUNDS (violation of natural justice / bias)",
            "2. STATEMENT that grounds were taken in the review petition",
            "3. CERTIFICATE OF SENIOR ADVOCATE",
            "4. PRAYER",
        ],
    },
}
