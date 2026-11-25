"""Ambiguity / liability-risk lint for drafts - regex, zero tokens.

Flags are attached to the exact sentence so the advocate can fix them inline.
"""

import re

RULES = [
    (r"\b(?:approximately|about|around|some ?time|sometime)\b", "Vague time/quantity", "State the exact date, amount or period."),
    (r"\betc\.?", "Open-ended list", "List every item, or say 'including' and name them."),
    (r"\band/or\b", "Ambiguous conjunction", "Use 'and' or 'or' - courts read 'and/or' against the drafter."),
    (r"\b(?:it is (?:believed|understood|learnt)|reliably learnt|on information)\b", "Unsourced assertion", "Name the source, or verify on affidavit as 'information received and believed to be true'."),
    (r"\b(?:fraud(?:ulent)?|mala fide|malicious|corrupt|conspir\w+)\b", "Serious allegation", "Plead with full particulars (O. VI r. 4 CPC standard); unparticularised allegations of fraud/mala fides risk costs and adverse remarks."),
    (r"\b(?:always|never)\b", "Absolute statement", "Check this is literally true; absolutes are easy to rebut."),
    (r"\b(?:clearly|obviously|undoubtedly|patently)\b", "Rhetorical overstatement", "Let the facts carry the point; overstatement weakens credibility before the Bench."),
    (r"\[(?:TO BE FILLED|VERIFY|DATE|NAME)[^\]]*\]", "Placeholder left in draft", "Fill this before filing."),
]
SENTENCE_RE = re.compile(r"[^.!?\n]+[.!?]?")


def lint(text: str) -> list[dict]:
    flags = []
    for para_no, para in enumerate(text.split("\n"), start=1):
        for sentence in SENTENCE_RE.findall(para):
            for pattern, label, fix in RULES:
                m = re.search(pattern, sentence, re.I)
                if m:
                    flags.append({"line": para_no, "sentence": sentence.strip()[:300], "match": m.group(0), "risk": label, "fix": fix})
    return flags
