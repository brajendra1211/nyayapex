"""AI output register (SC AI Regs 2026: Reg 9 auditability; Reg 43(4) - on request, show which AI system was
used, what it produced and how it was verified). One row per AI answer shown to a user."""

import json

from sqlalchemy.orm import Session

from ..models import AIOutput, User
from . import llm


def record(db: Session, *, feature: str, output, user: User | None = None, workspace_id: int | None = None,
           case_id: int | None = None, document_id: int | None = None, prompt: str = "",
           sources: list | None = None) -> int:
    """Store the answer of the ask() just made on this thread. Returns the register id (shown with the answer)."""
    info = llm.last_call()
    row = AIOutput(workspace_id=workspace_id if workspace_id is not None else (user.workspace_id if user else None),
                   user_id=user.id if user else None, case_id=case_id, document_id=document_id, feature=feature,
                   model=info["model"], prompt=(prompt or "")[:4000],
                   output=output if isinstance(output, str) else json.dumps(output, ensure_ascii=False),
                   sources=sources or [], cached=info["cached"], pii_masked=info["pii_masked"])
    db.add(row)
    db.commit()
    return row.id


def source_labels(sources: list[dict]) -> list[str]:
    """Compact, human-readable grounding list for the register."""
    out = []
    for s in sources or []:
        name = s.get("document") or f"doc {s.get('document_id')}"
        cite = s.get("neutral_citation") or s.get("scr_citation")
        pages = s.get("pages") or []
        out.append(f"{name}{', ' + cite if cite else ''}{f' p.{pages[0]}-{pages[1]}' if len(pages) == 2 else ''}")
    return out
