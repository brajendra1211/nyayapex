"""Local multilingual embeddings (fastembed / ONNX). Zero API tokens; text never leaves the server.

Hindi and English map into the same vector space, so a Hindi question can find an English judgment.
"""

import logging
import threading

import numpy as np

from ..config import settings

log = logging.getLogger(__name__)
_model = None
_failed = False
_lock = threading.Lock()


def _prefixes() -> tuple[str, str]:
    # e5 models are trained with these prefixes; other models take raw text
    return ("query: ", "passage: ") if "e5" in settings.embed_model.lower() else ("", "")


def model():
    """Lazy singleton. Returns None if dense retrieval is off or the model can't load (search falls back to BM25)."""
    global _model, _failed
    if not settings.rag_dense or _failed:
        return None
    if _model is None:
        with _lock:
            if _model is None and not _failed:
                try:
                    from fastembed import TextEmbedding

                    settings.embed_cache_dir.mkdir(parents=True, exist_ok=True)
                    _model = TextEmbedding(settings.embed_model, cache_dir=str(settings.embed_cache_dir),
                                           threads=settings.embed_threads)
                    log.info("embedding model ready: %s", settings.embed_model)
                except Exception:
                    log.exception("embedding model failed to load - keyword search only")
                    _failed = True
    return _model


def available() -> bool:
    return model() is not None


def _normalise(m: np.ndarray) -> np.ndarray:
    m = m.astype(np.float32)
    n = np.linalg.norm(m, axis=1, keepdims=True)
    n[n == 0] = 1
    return m / n


def embed_passages(texts: list[str], batch_size: int = 32) -> np.ndarray | None:
    m = model()
    if m is None or not texts:
        return None
    _, p = _prefixes()
    with _lock:  # ONNX session already uses all threads; serialise callers
        return _normalise(np.array(list(m.embed([p + t for t in texts], batch_size=batch_size))))


def embed_query(text: str) -> np.ndarray | None:
    m = model()
    if m is None:
        return None
    q, _ = _prefixes()
    with _lock:
        return _normalise(np.array(list(m.embed([q + text]))))[0]


def to_bytes(v: np.ndarray) -> bytes:
    return v.astype(np.float32).tobytes()


def from_bytes(b: bytes) -> np.ndarray:
    return np.frombuffer(b, dtype=np.float32)


def warm_up() -> None:
    """Load the model in the background at startup so the first search isn't slow."""
    threading.Thread(target=model, daemon=True, name="embed-warmup").start()
