"""Password hashing (stdlib scrypt) + email/password policy + brute-force lockout."""

import base64
import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict, deque

from fastapi import HTTPException

N, R, P = 2**14, 8, 1  # scrypt cost (~16 MB, a few ms)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")

MAX_FAILS = 8
WINDOW_S = 15 * 60
_fails: dict[str, deque[float]] = defaultdict(deque)


RESET_TTL_S = 15 * 60
RESET_GAP_S = 60
RESET_MAX_PER_HOUR = 5
RESET_MAX_TRIES = 5
_resets: dict[str, dict] = {}  # email -> {hash, expires, tries}
_reset_sends: dict[str, deque[float]] = defaultdict(deque)


def _code_hash(email: str, code: str) -> str:
    return hashlib.sha256(f"{email}:{code}".encode()).hexdigest()


def throttle_reset(email: str) -> None:
    """Same limits whether or not the account exists, so the response reveals nothing."""
    now, q = time.time(), _reset_sends[email]
    while q and now - q[0] > 3600:
        q.popleft()
    if q and now - q[-1] < RESET_GAP_S:
        raise HTTPException(429, f"Please wait {int(RESET_GAP_S - (now - q[-1]))}s before requesting another code.")
    if len(q) >= RESET_MAX_PER_HOUR:
        raise HTTPException(429, "Too many reset requests. Try again in an hour.")
    q.append(now)


def new_reset_code(email: str) -> str:
    code = f"{secrets.randbelow(10**6):06d}"
    _resets[email] = {"hash": _code_hash(email, code), "expires": time.time() + RESET_TTL_S, "tries": 0}
    return code


def check_reset_code(email: str, code: str) -> None:
    r = _resets.get(email)
    if not r or time.time() > r["expires"] or r["tries"] >= RESET_MAX_TRIES:
        _resets.pop(email, None)
        raise HTTPException(401, "This code has expired. Request a new one.")
    if not hmac.compare_digest(r["hash"], _code_hash(email, code)):
        r["tries"] += 1
        raise HTTPException(401, "Incorrect code.")
    _resets.pop(email, None)


def mask_email(email: str) -> str:
    name, domain = email.split("@", 1)
    return f"{name[0]}***@{domain}"


def normalize_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 200:
        raise HTTPException(400, "Enter a valid email address.")
    return email


def check_strength(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if len(password) > 128:
        raise HTTPException(400, "Password is too long.")
    if not (re.search(r"[A-Za-z]", password) and re.search(r"\d", password)):
        raise HTTPException(400, "Use both letters and numbers in the password.")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P, dklen=32)
    return f"scrypt${N}${R}${P}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        _, n, r, p, salt, dk = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


def guard(email: str) -> None:
    q = _fails[email]
    now = time.time()
    while q and now - q[0] > WINDOW_S:
        q.popleft()
    if len(q) >= MAX_FAILS:
        raise HTTPException(429, "Too many failed attempts. Try again in 15 minutes or reset your password.")


def record_failure(email: str) -> None:
    _fails[email].append(time.time())


def clear(email: str) -> None:
    _fails.pop(email, None)
