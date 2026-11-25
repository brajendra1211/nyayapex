from datetime import date, datetime

import numpy as np
from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from .config import settings
from .db import Base


class EmbeddingType(TypeDecorator):
    """pgvector `vector(N)` on PostgreSQL (HNSW-indexable); raw float32 bytes on SQLite (dev). Python side: np.ndarray."""

    impl = LargeBinary
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            from pgvector.sqlalchemy import Vector

            return dialect.type_descriptor(Vector(settings.embed_dim))
        return dialect.type_descriptor(LargeBinary())

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        arr = np.asarray(value, dtype=np.float32)
        return arr if dialect.name == "postgresql" else arr.tobytes()

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            return np.asarray(value, dtype=np.float32)
        return np.frombuffer(value, dtype=np.float32)


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    diary_no: Mapped[str | None] = mapped_column(String(50))
    case_type: Mapped[str] = mapped_column(String(40), default="SLP (C)")
    bench: Mapped[str | None] = mapped_column(String(200))
    stage: Mapped[str] = mapped_column(String(40), default="Drafting")
    priority: Mapped[str] = mapped_column(String(10), default="Normal")
    next_hearing: Mapped[date | None] = mapped_column(Date)
    limitation_expiry: Mapped[date | None] = mapped_column(Date)
    filing_status: Mapped[str] = mapped_column(String(20), default="NOT READY")
    defects: Mapped[int] = mapped_column(Integer, default=0)
    # Registry case number as the cause list prints it, e.g. "SLP(C) No. 30665/2026" - used to find the matter in the lists
    case_number: Mapped[str | None] = mapped_column(String(80))
    stage_since: Mapped[datetime | None] = mapped_column(DateTime)  # when the stage last changed (registry queue ageing)
    file_location: Mapped[str | None] = mapped_column(String(120))  # where the physical brief is now
    # Individual accounts: court, other party, own role, own advocate, FIR details, questions for the advocate ...
    details: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    documents: Mapped[list["Document"]] = relationship(back_populates="case")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    # NULL = shared public library (SC judgments), visible to every account; otherwise private to one workspace
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="record", index=True)  # record | judgment
    # Judgment metadata: title, scr_citation, neutral_citation, decision_date, judges, disposal, source, source_url …
    meta: Mapped[dict | None] = mapped_column(JSON)
    source_key: Mapped[str | None] = mapped_column(String(120), unique=True)  # e.g. "aws:2025_1_81_92" - import dedupe
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"))
    filename: Mapped[str] = mapped_column(String(300))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    pages: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued/processing/done/failed
    error: Mapped[str | None] = mapped_column(Text)
    # Zero-token results (pure Python)
    chronology: Mapped[list | None] = mapped_column(JSON)
    citations: Mapped[list | None] = mapped_column(JSON)
    stats: Mapped[dict | None] = mapped_column(JSON)
    # AI results (Claude)
    brief: Mapped[dict | None] = mapped_column(JSON)
    # Client portal: only documents an advocate explicitly shares are visible to the client
    shared_with_client: Mapped[bool] = mapped_column(Boolean, default=False)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    # Versions: every upload of a revised file is a new row; version_of points at the first one (NULL on the first)
    version_of: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    version_note: Mapped[str] = mapped_column(String(300), default="")
    superseded: Mapped[bool] = mapped_column(Boolean, default=False)
    # Analysis queue (python -m app.worker): options for the job and when a worker took it
    cited_by: Mapped[int] = mapped_column(Integer, default=0)  # library judgments citing this one (app.citegraph)
    job_opts: Mapped[dict | None] = mapped_column(JSON)
    job_started_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    case: Mapped[Case | None] = relationship(back_populates="documents")
    chunks: Mapped[list["Chunk"]] = relationship(back_populates="document", cascade="all, delete-orphan")
    passages: Mapped[list["Passage"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    page_start: Mapped[int] = mapped_column(Integer)
    page_end: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    facts: Mapped[list | None] = mapped_column(JSON)

    document: Mapped[Document] = relationship(back_populates="chunks")


class Passage(Base):
    """Small overlapping window (~250 words) used for retrieval: BM25 + dense embedding.

    Chunks (~900 words) feed fact extraction; passages are what search returns and what Claude reads.
    """

    __tablename__ = "passages"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    # denormalised from the document for fast filtering; NULL = public library
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    page_start: Mapped[int] = mapped_column(Integer)
    page_end: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[np.ndarray | None] = mapped_column(EmbeddingType())  # float32, L2-normalised
    embed_model: Mapped[str | None] = mapped_column(String(100))

    document: Mapped[Document] = relationship(back_populates="passages")


class SavedCitation(Base):
    __tablename__ = "saved_citations"
    __table_args__ = (UniqueConstraint("workspace_id", "citation"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    case_name: Mapped[str] = mapped_column(String(300), default="")
    citation: Mapped[str] = mapped_column(String(100))
    reporter: Mapped[str] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(Text, default="")
    # Library verification: verified (a judgment in the library) | cited (other judgments cite it) | unknown
    status: Mapped[str | None] = mapped_column(String(12))
    parallels: Mapped[list | None] = mapped_column(JSON)  # [{citation, reporter, seen}]
    judgment_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    cited_in: Mapped[int | None] = mapped_column(Integer)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class LlmCache(Base):
    """Same prompt + same model => answer served from DB, zero tokens."""

    __tablename__ = "llm_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    response: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class UsageLog(Base):
    __tablename__ = "usage_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id"), index=True)
    feature: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(40))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    cached_locally: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------- Accounts ----------

ACCOUNT_TYPES = ("advocate", "firm", "corporate", "student", "individual")
ROLES = {
    "advocate": ("owner",),
    "firm": ("owner", "aor", "senior", "junior", "clerk"),
    "corporate": ("owner", "gc", "counsel", "paralegal"),
    "student": ("owner",),
    "individual": ("owner",),  # a person handling their own case (not an advocate)
}


class Workspace(Base):
    """One account: a single advocate, a chamber/firm, a corporate legal team, a student, or an individual person."""

    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(20))  # ACCOUNT_TYPES
    name: Mapped[str] = mapped_column(String(200))
    details: Mapped[dict] = mapped_column(JSON, default=dict)  # GSTIN, CIN, address, college …
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    members: Mapped[list["User"]] = relationship(back_populates="workspace")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # A user logs in with WhatsApp OTP (phone) and/or email + password; at least one is set
    phone: Mapped[str | None] = mapped_column(String(10), unique=True, index=True)  # 10-digit Indian mobile
    name: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str | None] = mapped_column(String(200), unique=True, index=True)  # stored lower-case
    password_hash: Mapped[str | None] = mapped_column(String(200))
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id"))
    role: Mapped[str | None] = mapped_column(String(20))
    profile: Mapped[dict] = mapped_column(JSON, default=dict)  # bar enrolment, AOR code, college …
    # pending / verified / rejected / not_required - Bar enrolment checked by an admin
    verification: Mapped[str] = mapped_column(String(20), default="not_required")
    language: Mapped[str] = mapped_column(String(5), default="en")
    citation_pref: Mapped[str] = mapped_column(String(10), default="SCC")
    consent_at: Mapped[datetime | None] = mapped_column(DateTime)  # DPDP Act consent
    ai_ack_at: Mapped[datetime | None] = mapped_column(DateTime)  # AI-advisory acknowledgement (SC AI Regs 4, 8, 43)
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)
    # professional = advocate / firm / corporate / student member; client = portal-only access to their matters
    kind: Mapped[str] = mapped_column(String(12), default="professional")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Secret link for the hearings calendar feed (Google / Outlook subscribe); NULL = feed off
    calendar_token: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    workspace: Mapped[Workspace | None] = relationship(back_populates="members")


class Invite(Base):
    """A firm/corporate admin invites a phone number or email; the invitee joins on first login."""

    __tablename__ = "invites"
    __table_args__ = (UniqueConstraint("workspace_id", "phone"), UniqueConstraint("workspace_id", "email"))

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True)
    phone: Mapped[str | None] = mapped_column(String(10), index=True)
    email: Mapped[str | None] = mapped_column(String(200), index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(20))
    invited_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    workspace: Mapped[Workspace] = relationship()


# ---------- Matter collaboration & client portal ----------


class MatterMember(Base):
    """Who in the chamber works on a matter. Juniors/clerks see only matters they are on (unless the firm opts out)."""

    __tablename__ = "matter_members"
    __table_args__ = (UniqueConstraint("case_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(12), default="member")  # lead | member
    added_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id])


class ClientAccess(Base):
    """A client invited to one matter. user_id is filled when the client first logs in."""

    __tablename__ = "client_access"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str | None] = mapped_column(String(10), index=True)
    email: Mapped[str | None] = mapped_column(String(200), index=True)
    invited_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    case: Mapped["Case"] = relationship()


class Message(Base):
    """Matter discussion. channel 'team' is internal (privileged) and never visible to clients; 'client' is shared."""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    channel: Mapped[str] = mapped_column(String(10), default="team")  # team | client
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    attachments: Mapped[list] = mapped_column(JSON, default=list)  # [{type: document|judgment|citation, id, label}]
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    author: Mapped["User"] = relationship()


class Task(Base):
    """Work item or document request on a matter, for a team member or the client."""

    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    details: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(20), default="task")  # task | document_request
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    for_client: Mapped[bool] = mapped_column(Boolean, default=False)
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | done
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    done_at: Mapped[datetime | None] = mapped_column(DateTime)

    assignee: Mapped["User | None"] = relationship(foreign_keys=[assignee_id])


class MatterReference(Base):
    """A judgment / citation pinned to a matter from Research, Precedent or Citations."""

    __tablename__ = "matter_references"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    citation: Mapped[str] = mapped_column(String(120), default="")
    title: Mapped[str] = mapped_column(String(300), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    pages: Mapped[str] = mapped_column(String(20), default="")
    added_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Activity(Base):
    """Audit trail per matter (PRD §8: audit logs for document access; SC AI Regs: accountability)."""

    __tablename__ = "activity"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id"), index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(40))
    document_id: Mapped[int | None] = mapped_column(Integer, index=True)  # set for document access events
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(30))
    text: Mapped[str] = mapped_column(String(500))
    link: Mapped[str] = mapped_column(String(200), default="")
    whatsapp: Mapped[str | None] = mapped_column(String(20))  # None | sent | failed | skipped
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------- Filing packages & AI accountability (SC AI Regulations 2026: Regs 8, 39, 43) ----------


class FilingPackage(Base):
    """A paper-book being prepared for one matter. Content sections are editable; export without approval is a draft."""

    __tablename__ = "filing_packages"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    proceeding: Mapped[str] = mapped_column(String(30), default="slp_civil")
    inputs: Mapped[dict] = mapped_column(JSON, default=dict)  # parties, court below, order, deponent, options
    content: Mapped[dict] = mapped_column(JSON, default=dict)  # synopsis, dates, facts, questions, grounds, prayers …
    ai_sections: Mapped[list] = mapped_column(JSON, default=list)  # which sections were AI-generated (for disclosure)
    ai_model: Mapped[str | None] = mapped_column(String(60))
    checks: Mapped[dict] = mapped_column(JSON, default=dict)  # verification checklist ticks
    status: Mapped[str] = mapped_column(String(12), default="draft")  # draft | approved
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AuditEvent(Base):
    """Per-draft audit trail: AI generation (model, cost), human edits, checks, approval, exports (Reg 43(4))."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity: Mapped[str] = mapped_column(String(20))  # filing_package | draft
    entity_id: Mapped[int] = mapped_column(Integer, index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    event: Mapped[str] = mapped_column(String(30))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AIIncident(Base):
    """User report of a wrong / fabricated / harmful AI output (Reg 39 AI Incident Database)."""

    __tablename__ = "ai_incidents"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    feature: Mapped[str] = mapped_column(String(40))  # research | brief | drafting | filing | courtroom | doc_qa
    category: Mapped[str] = mapped_column(String(30))  # wrong_citation | fabricated | wrong_fact | harmful | other
    description: Mapped[str] = mapped_column(Text)
    excerpt: Mapped[str] = mapped_column(Text, default="")
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(12), default="open")  # open | reviewed | resolved
    ai_output_id: Mapped[int | None] = mapped_column(ForeignKey("ai_outputs.id", ondelete="SET NULL"))
    # Reg 39(1): type (category), cause, manner of occurrence (description), consequences, remedial measures
    cause: Mapped[str] = mapped_column(Text, default="")
    consequences: Mapped[str] = mapped_column(Text, default="")
    remedial_measures: Mapped[str] = mapped_column(Text, default="")
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AIOutput(Base):
    """Register of every AI answer shown to a user (Reg 9 auditability, Reg 43(4) disclosure on request)."""

    __tablename__ = "ai_outputs"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id", ondelete="SET NULL"), index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    feature: Mapped[str] = mapped_column(String(40), index=True)
    model: Mapped[str] = mapped_column(String(60), default="")
    prompt: Mapped[str] = mapped_column(Text, default="")  # the user's question / instruction (not the excerpts)
    output: Mapped[str] = mapped_column(Text, default="")
    sources: Mapped[list] = mapped_column(JSON, default=list)  # what the answer was grounded on
    cached: Mapped[bool] = mapped_column(Boolean, default=False)
    pii_masked: Mapped[int] = mapped_column(Integer, default=0)  # identifiers hidden from the AI provider
    verified_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class Statute(Base):
    """A bare act (or the Constitution) imported section by section from an official PDF."""

    __tablename__ = "statutes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(12), unique=True)  # BNS, BNSS, BSA, IPC, CRPC, IEA, COI
    title: Mapped[str] = mapped_column(String(200))
    act_no: Mapped[str] = mapped_column(String(40), default="")
    version: Mapped[str] = mapped_column(String(200), default="")  # e.g. "As enacted - Gazette of India, 25.12.2023"
    source_name: Mapped[str] = mapped_column(String(200), default="")
    source_url: Mapped[str] = mapped_column(String(500), default="")
    sha256: Mapped[str] = mapped_column(String(64), default="")
    sections_count: Mapped[int] = mapped_column(Integer, default=0)
    imported_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class StatuteSection(Base):
    __tablename__ = "statute_sections"
    __table_args__ = (UniqueConstraint("statute_id", "number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    statute_id: Mapped[int] = mapped_column(ForeignKey("statutes.id", ondelete="CASCADE"), index=True)
    number: Mapped[str] = mapped_column(String(12))  # "103", "120B", "21A"
    sort_key: Mapped[int] = mapped_column(Integer, index=True)
    title: Mapped[str] = mapped_column(String(400), default="")
    text: Mapped[str] = mapped_column(Text, default="")
    chapter: Mapped[str] = mapped_column(String(20), default="")
    chapter_title: Mapped[str] = mapped_column(String(300), default="")
    page: Mapped[int] = mapped_column(Integer, default=0)  # page in the source PDF


class SectionMap(Base):
    """Old <-> new criminal-law correspondence (IPC->BNS, CrPC->BNSS, IEA->BSA)."""

    __tablename__ = "section_map"

    id: Mapped[int] = mapped_column(primary_key=True)
    old_code: Mapped[str] = mapped_column(String(12), index=True)
    old_section: Mapped[str] = mapped_column(String(12), index=True)
    old_title: Mapped[str] = mapped_column(String(400), default="")
    new_code: Mapped[str] = mapped_column(String(12), index=True)
    new_section: Mapped[str | None] = mapped_column(String(12), index=True)  # None = deleted
    new_ref: Mapped[str | None] = mapped_column(String(30))  # sub-section as printed, e.g. "318(4)"
    relation: Mapped[str] = mapped_column(String(20), default="corresponds")  # corresponds | deleted
    source: Mapped[str] = mapped_column(String(300), default="")  # where this pair comes from (with page)
    official: Mapped[bool] = mapped_column(Boolean, default=True)  # False = matched by text similarity, verify
    needs_check: Mapped[bool] = mapped_column(Boolean, default=False)


# ---------- Hearings, cause lists, chamber ----------


class HearingNote(Base):
    """What happened at a hearing, written by the advocate (typed or dictated). Next date updates the matter."""

    __tablename__ = "hearing_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    hearing_date: Mapped[date] = mapped_column(Date)
    court: Mapped[str] = mapped_column(String(120), default="")
    bench: Mapped[str] = mapped_column(String(300), default="")
    item_no: Mapped[str] = mapped_column(String(20), default="")
    outcome: Mapped[str] = mapped_column(String(30), default="")  # adjourned | notice issued | heard | ... (what happened)
    notes: Mapped[str] = mapped_column(Text, default="")
    next_date: Mapped[date | None] = mapped_column(Date)
    dictated: Mapped[bool] = mapped_column(Boolean, default=False)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))  # the order it was read from
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    author: Mapped["User"] = relationship()


class CauseListFile(Base):
    """One published Supreme Court cause list PDF (public). Re-read when its content changes."""

    __tablename__ = "cause_list_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(String(300), unique=True)
    list_date: Mapped[date] = mapped_column(Date, index=True)
    kind: Mapped[str] = mapped_column(String(10))  # daily | advance
    sha256: Mapped[str] = mapped_column(String(64), default="")
    items: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    # NULL = downloaded from the court's server (shared by everyone); else a PDF uploaded by one account, matched only to it
    workspace_id: Mapped[int | None] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    added_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    fetched_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class CauseListEntry(Base):
    __tablename__ = "cause_list_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    file_id: Mapped[int] = mapped_column(ForeignKey("cause_list_files.id", ondelete="CASCADE"), index=True)
    list_date: Mapped[date] = mapped_column(Date, index=True)
    kind: Mapped[str] = mapped_column(String(10))
    court: Mapped[str] = mapped_column(String(60), default="")
    bench: Mapped[str] = mapped_column(String(400), default="")
    item_no: Mapped[str] = mapped_column(String(20), default="")
    case_no: Mapped[str] = mapped_column(String(120), default="")
    case_keys: Mapped[list] = mapped_column(JSON, default=list)  # normalised "slpc:30665:2026", "diary:34272:2026"
    parties: Mapped[str] = mapped_column(Text, default="")
    aor_codes: Mapped[list] = mapped_column(JSON, default=list)
    remarks: Mapped[str] = mapped_column(Text, default="")
    page: Mapped[int] = mapped_column(Integer, default=0)


class CauseListMatch(Base):
    """A matter found in a cause list. Shown on the matter and the dashboard; notified once."""

    __tablename__ = "cause_list_matches"
    __table_args__ = (UniqueConstraint("case_id", "entry_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("cause_list_entries.id", ondelete="CASCADE"))
    matched_by: Mapped[str] = mapped_column(String(20))  # case_number | diary_no
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    entry: Mapped[CauseListEntry] = relationship()


class FileMovement(Base):
    """Physical brief / file movement: chamber -> senior's chamber -> court -> registry ..."""

    __tablename__ = "file_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id", ondelete="CASCADE"), index=True)
    location: Mapped[str] = mapped_column(String(120))
    holder: Mapped[str] = mapped_column(String(120), default="")
    note: Mapped[str] = mapped_column(String(300), default="")
    moved_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    moved_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class JobRun(Base):
    """Daily jobs record their run so a second timer firing the same day does nothing."""

    __tablename__ = "job_runs"
    __table_args__ = (UniqueConstraint("name", "day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    day: Mapped[date] = mapped_column(Date)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class RateHit(Base):
    """Attempts per key (e.g. "login-ip:1.2.3.4") per fixed time window, for rate limiting."""

    __tablename__ = "rate_hits"
    __table_args__ = (UniqueConstraint("key", "slot"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(160))
    slot: Mapped[int] = mapped_column(Integer)
    count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class CitationEdge(Base):
    """Judgment A cites judgment B (library only; built by python -m app.citegraph)."""

    __tablename__ = "citation_edges"
    __table_args__ = (UniqueConstraint("citing_id", "cited_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    citing_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    cited_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)


class Enquiry(Base):
    """A message from the public website's contact form."""

    __tablename__ = "enquiries"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(20), default="")
    organisation: Mapped[str] = mapped_column(String(200), default="")
    topic: Mapped[str] = mapped_column(String(20), default="other")
    message: Mapped[str] = mapped_column(Text)
    ip: Mapped[str] = mapped_column(String(60), default="")
    status: Mapped[str] = mapped_column(String(10), default="new")  # new | replied | closed
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)
