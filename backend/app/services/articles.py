"""Constitutional Articles a draft may need to engage, suggested from its own words. Zero tokens.

Suggestions only: each says which words in the draft triggered it, so the advocate can judge relevance.
"""

import re

# (Article, short title, words in the facts / draft that point to it)
RULES = [
    ("136", "Special leave to appeal by the Supreme Court", r"special leave|\bslp\b|impugned (?:judgment|order)"),
    ("32", "Remedies for enforcement of fundamental rights", r"writ petition|\bw\.?p\.?\b|article 32|fundamental rights?"),
    ("14", "Equality before law", r"arbitrar\w+|discriminat\w+|equal(?:ity)?|unreasonabl\w+|similarly situated"),
    ("15", "Prohibition of discrimination on grounds of religion, race, caste, sex or place of birth", r"caste|\bsex\b|gender|religion|place of birth|women"),
    ("16", "Equality of opportunity in public employment", r"appointment|promotion|seniority|recruitment|public employment|selection"),
    ("19", "Freedoms of speech, assembly, movement, profession", r"speech|expression|press|assembl\w+|profession|trade|business|movement"),
    ("20", "Protection in respect of conviction for offences", r"double jeopardy|ex post facto|self[- ]incrimination|retrospective(?:ly)? penal"),
    ("21", "Protection of life and personal liberty", r"liberty|detention|custody|bail|arrest|privacy|\blife\b|dignity|health|speedy trial"),
    ("21A", "Right to education", r"education|school|admission of (?:children|students)"),
    ("22", "Protection against arrest and detention", r"arrest|preventive detention|detenu|grounds of (?:arrest|detention)|produced before"),
    ("25", "Freedom of religion", r"religio\w+|worship|temple|mosque|church"),
    ("226", "Power of High Courts to issue writs", r"high court.{0,40}writ|writ.{0,40}high court|article 226"),
    ("300A", "Right to property (no deprivation save by authority of law)", r"acquisition|compensation for (?:the )?land|property|dispossess\w*"),
    ("311", "Dismissal or removal of civil servants", r"dismiss\w* from service|removal from service|disciplinary|inquiry officer|civil servant"),
    ("142", "Enforcement of decrees and orders of the Supreme Court (complete justice)", r"complete justice|article 142"),
    ("141", "Law declared by the Supreme Court binding", r"binding precedent|law declared|per incuriam"),
]


def suggest(text: str, limit: int = 8) -> list[dict]:
    low = text.lower()
    out = []
    for art, title, rx in RULES:
        hits = sorted({m.group(0) for m in re.finditer(rx, low)})
        if hits:
            out.append({"article": art, "title": title, "because": hits[:4],
                        "already_cited": bool(re.search(rf"article\s+{art.lower()}\b", low))})
    out.sort(key=lambda a: (a["already_cited"], -len(a["because"])))
    return out[:limit]
