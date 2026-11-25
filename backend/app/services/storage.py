"""Uploaded files on disk, encrypted at rest (AES-256-GCM) when FILE_KEY is set.

Files are named by the SHA-256 of their plain content (dedupe) and decrypted only in memory, or into a private
temporary file for libraries that need a path. Losing FILE_KEY means losing every stored file: keep a copy offline.
"""

import base64
import mimetypes
import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote

from fastapi.responses import Response

from ..config import settings

MAGIC = b"NYENC1\n"
NONCE = 12


def _aead():
    if not settings.file_key:
        return None
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = base64.urlsafe_b64decode(settings.file_key.encode())
    if len(key) != 32:
        raise RuntimeError("FILE_KEY must be 32 bytes, url-safe base64 (python -m app.encrypt_files --new-key).")
    return AESGCM(key)


def path_for(sha: str, suffix: str) -> Path:
    return Path(settings.upload_dir) / f"{sha}{suffix.lower()}"


def exists(sha: str, suffix: str) -> bool:
    return path_for(sha, suffix).exists()


def encrypt(data: bytes) -> bytes:
    aead = _aead()
    if aead is None:
        return data
    nonce = os.urandom(NONCE)
    return MAGIC + nonce + aead.encrypt(nonce, data, MAGIC)


def decrypt(blob: bytes) -> bytes:
    if not blob.startswith(MAGIC):
        return blob  # stored before encryption was switched on
    aead = _aead()
    if aead is None:
        raise RuntimeError("This file is encrypted but FILE_KEY is not set.")
    n = len(MAGIC)
    return aead.decrypt(blob[n:n + NONCE], blob[n + NONCE:], MAGIC)


def write(data: bytes, sha: str, suffix: str) -> None:
    p = path_for(sha, suffix)
    if p.exists():
        return
    tmp = p.with_name(p.name + ".part")
    tmp.write_bytes(encrypt(data))
    os.chmod(tmp, 0o600)
    tmp.replace(p)


def read(sha: str, suffix: str) -> bytes:
    return decrypt(path_for(sha, suffix).read_bytes())


@contextmanager
def plain_path(sha: str, suffix: str) -> Iterator[Path]:
    """A readable plain file for libraries that open paths (PyMuPDF, python-docx). Deleted afterwards."""
    p = path_for(sha, suffix)
    blob = p.read_bytes()
    if not blob.startswith(MAGIC):
        yield p
        return
    private = Path(settings.upload_dir) / ".tmp"
    private.mkdir(mode=0o700, exist_ok=True)
    fd, name = tempfile.mkstemp(suffix=suffix.lower(), dir=private)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(decrypt(blob))
        yield Path(name)
    finally:
        Path(name).unlink(missing_ok=True)


def download(data: bytes, filename: str) -> Response:
    media = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return Response(data, media_type=media, headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}", "Cache-Control": "private, no-store"})


def encrypt_existing() -> tuple[int, int]:
    """Encrypt files stored before FILE_KEY was set. Returns (encrypted, already)."""
    done = already = 0
    for p in Path(settings.upload_dir).iterdir():
        if not p.is_file() or p.name.endswith(".part"):
            continue
        blob = p.read_bytes()
        if blob.startswith(MAGIC):
            already += 1
            continue
        tmp = p.with_name(p.name + ".part")
        tmp.write_bytes(encrypt(blob))
        os.chmod(tmp, 0o600)
        tmp.replace(p)
        done += 1
    return done, already
