from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

IS_PG = settings.database_url.startswith("postgresql")

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    **({"pool_size": 10, "max_overflow": 10} if IS_PG else {}),
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# PostgreSQL-only search structures (idempotent). SQLite dev mode uses the in-memory index instead.
PG_DDL = [
    "CREATE EXTENSION IF NOT EXISTS vector",
    # Keyword search: stemmed English full-text, kept in sync by Postgres itself
    "ALTER TABLE passages ADD COLUMN IF NOT EXISTS tsv tsvector "
    "GENERATED ALWAYS AS (to_tsvector('english', text)) STORED",
    "CREATE INDEX IF NOT EXISTS ix_passages_tsv ON passages USING gin (tsv)",
    # Dense search: approximate nearest neighbours over cosine distance
    "CREATE INDEX IF NOT EXISTS ix_passages_embedding_hnsw ON passages "
    "USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)",
    "CREATE INDEX IF NOT EXISTS ix_documents_kind_ws ON documents (kind, workspace_id)",
    "CREATE INDEX IF NOT EXISTS ix_documents_decision_date ON documents ((meta->>'decision_date'))",
    # Bare acts: keyword search over section title + text
    "ALTER TABLE statute_sections ADD COLUMN IF NOT EXISTS tsv tsvector "
    "GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || text)) STORED",
    "CREATE INDEX IF NOT EXISTS ix_statute_sections_tsv ON statute_sections USING gin (tsv)",
    # Columns added after the first release (create_all does not add indexes to existing tables)
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_calendar_token ON users (calendar_token)",
    "CREATE INDEX IF NOT EXISTS ix_documents_version_of ON documents (version_of)",
]


def _add_missing_columns() -> None:
    """Lightweight migration: add columns that exist in the models but not yet in the database.

    New tables come from create_all(); this only handles new *columns* on existing tables (added as nullable,
    with the model's scalar default). Renames/drops still need a real migration tool (Alembic) before production.
    """
    from sqlalchemy import inspect

    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                ddl = f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(dialect=engine.dialect)}"
                if col.default is not None and getattr(col.default, "is_scalar", False):
                    v = col.default.arg
                    if isinstance(v, bool):
                        ddl += f" DEFAULT {('TRUE' if v else 'FALSE') if IS_PG else int(v)}"
                    elif isinstance(v, (int, float)):
                        ddl += f" DEFAULT {v}"
                    elif isinstance(v, str):
                        ddl += " DEFAULT '" + v.replace("'", "''") + "'"
                conn.execute(text(ddl))


def prepare_database() -> None:
    """Create tables, plus pgvector / full-text indexes on PostgreSQL."""
    from . import models  # noqa: F401  (register tables)

    if IS_PG:
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    _add_missing_columns()
    if IS_PG:
        with engine.begin() as conn:
            for stmt in PG_DDL:
                conn.execute(text(stmt))


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
