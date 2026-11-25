"""Mask personal identifiers before text leaves this server for the AI provider (SC AI Regs 2026: Reg 10 data
minimisation, Reg 48(3)-(4) anonymisation where feasible). Pure regex, zero tokens.

Phone numbers, e-mail addresses, Aadhaar and PAN numbers are replaced by stable placeholders ([PHONE_1] ...).
The placeholder -> value map never leaves the server; the AI's answer is un-masked locally before it is shown.
Party names are NOT masked: legal analysis needs them, and they are already public in the cause title.
"""

import re

PATTERNS = [  # order matters: longer number shapes first
    ("AADHAAR", re.compile(r"(?<![\d/])[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![\d/])")),
    ("PHONE", re.compile(r"(?<![\d/])(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\d/])")),
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")),
    ("PAN", re.compile(r"\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b")),
]
PLACEHOLDER = re.compile(r"\[(AADHAAR|PHONE|EMAIL|PAN)_\d+\]")


def mask(text: str) -> tuple[str, dict[str, str]]:
    """Returns (masked text, {placeholder: original}). The same value always gets the same placeholder."""
    mapping: dict[str, str] = {}
    seen: dict[tuple[str, str], str] = {}
    counts: dict[str, int] = {}

    for kind, rx in PATTERNS:
        def repl(m: re.Match, kind=kind) -> str:
            value = m.group(0)
            norm = re.sub(r"[\s-]", "", value).lower()
            if (kind, norm) not in seen:
                counts[kind] = counts.get(kind, 0) + 1
                tag = f"[{kind}_{counts[kind]}]"
                seen[(kind, norm)] = tag
                mapping[tag] = value
            return seen[(kind, norm)]
        text = rx.sub(repl, text)
    return text, mapping


def unmask(value, mapping: dict[str, str]):
    """Put the originals back into the AI's answer (str, or any JSON structure of strings)."""
    if not mapping:
        return value
    if isinstance(value, str):
        return PLACEHOLDER.sub(lambda m: mapping.get(m.group(0), m.group(0)), value)
    if isinstance(value, list):
        return [unmask(v, mapping) for v in value]
    if isinstance(value, dict):
        return {k: unmask(v, mapping) for k, v in value.items()}
    return value
