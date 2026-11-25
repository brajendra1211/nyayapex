from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    # Needed only when the API key is not scoped to a single workspace
    anthropic_workspace_id: str = ""
    database_url: str = "sqlite:///./nyay.db"
    model_bulk: str = "claude-haiku-5-5"
    model_smart: str = "claude-opus-5-5"
    # Research "Deep analysis" cost controls. Empty model = MODEL_SMART. claude-sonnet-5-5 roughly halves the cost again.
    model_deep_research: str = ""
    deep_research_effort: str = "low"  # low | medium | high - thinking tokens are the biggest part of the bill
    research_sources: int = 5  # references shown on the Research page
    research_passages_to_ai: int = 5  # top-N of those sent to Claude
    research_answer_words: int = 300
    upload_dir: Path = Path("./uploads")
    ai_calls_per_hour: int = 300  # per account (cache hits are free and not counted)
    file_key: str = ""  # AES-256 key (url-safe base64) for uploaded files at rest; empty = stored as uploaded
    job_worker: bool = False  # True = documents are analysed by the separate worker (python -m app.worker)
    ai_mask_pii: bool = True  # hide phone / e-mail / Aadhaar / PAN from the AI provider (restored locally)
    soffice_path: str = ""  # LibreOffice for Word->PDF on the server; empty = auto-detect, else upload the PDF

    # Hybrid RAG: local embedding model (runs on this server via ONNX; no tokens, data never leaves).
    # Fast default for CPU. On a GPU / many-core server use "intfloat/multilingual-e5-large" (better, ~30x slower on CPU).
    embed_model: str = "minishlab/potion-multilingual-128M"
    embed_dim: int = 256  # must match EMBED_MODEL (potion=256, e5-large=1024); fixes the pgvector column size
    embed_cache_dir: Path = Path("./models")
    embed_threads: int = 4
    rag_dense: bool = True  # False = keyword (BM25) only
    cors_origins: str = "http://localhost:3000"

    # WhatsApp OTP login (abwpl.com)
    whatsapp_otp_url: str = "https://abwpl.com/api/public/otp"
    whatsapp_otp_api_key: str = ""
    # Approved AUTHENTICATION template with one variable (the code). Empty = the provider's own OTP service only.
    whatsapp_otp_template: str = "nyay_apex_otp"
    # WhatsApp notifications (same abwpl.com account/key). The template must be approved on abwpl/Meta and take
    # two body parameters: {{1}} = recipient name, {{2}} = the update text. Empty = in-app notifications only.
    whatsapp_api_base: str = "https://abwpl.com/api/public"
    whatsapp_notify_template: str = ""
    app_url: str = "http://localhost:3000"
    # DEV ONLY: accept code 123456 without calling WhatsApp. Never enable in production.
    otp_dev_bypass: bool = False
    mail_from: str = ""  # e.g. noreply@nyayapex.ai; empty = password reset falls back to WhatsApp
    sendmail_path: str = "/usr/sbin/sendmail"
    # SMTP instead of sendmail, e.g. Google Workspace: smtp.gmail.com, 587, the mailbox, an app password.
    # MAIL_FROM must then be that mailbox or a "Send mail as" alias of it.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    allow_signup: bool = True  # false = private pilot, new accounts need a pending invite

    # Comma-separated 10-digit numbers allowed to approve Bar / student verifications
    platform_admin_phones: str = ""
    platform_admin_emails: str = ""

    # Session tokens
    jwt_secret: str = ""
    jwt_ttl_days: int = 7

    # Per-1M-token prices (USD) used only for the usage dashboard estimate
    prices: dict[str, tuple[float, float]] = {
        "claude-haiku-5-5": (0.10, 0.50),
        "claude-sonnet-5-5": (2.00, 10.00),
        "claude-opus-5-5": (4.00, 20.00),
    }

    @property
    def ai_enabled(self) -> bool:
        return bool(self.anthropic_api_key)


settings = Settings()
settings.upload_dir.mkdir(parents=True, exist_ok=True)

if not settings.jwt_secret:
    # Dev fallback: a random secret means everyone is logged out on every restart.
    import logging
    import secrets

    settings.jwt_secret = secrets.token_urlsafe(48)
    logging.getLogger(__name__).warning("JWT_SECRET not set - using a temporary secret (sessions reset on restart).")
