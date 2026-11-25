"""One-time codes for phone login, registration and password reset.

Nyay Apex makes the code itself and sends the same code on every channel it has:
  - WhatsApp, through the approved authentication template (WHATSAPP_OTP_TEMPLATE, one variable = the code);
  - email, when an address is known and mail is set up.
Only a hash of the code is kept, for OTP_TTL_S. If the template message cannot be sent, the provider's own
OTP service (which makes and checks its own code) is used for WhatsApp, and its codes are accepted too.
"""

import hashlib
import hmac
import logging
import re
import secrets
import time
from collections import defaultdict, deque

import httpx
from fastapi import HTTPException

from ..config import settings
from . import mailer

log = logging.getLogger(__name__)
PHONE_RE = re.compile(r"^[6-9]\d{9}$")
DEV_CODE = "123456"
OTP_TTL_S = 10 * 60

# Abuse limits per phone (in-memory; move to Redis when running several API workers)
RESEND_GAP_S = 30
MAX_SENDS_PER_HOUR = 5
MAX_VERIFY_FAILS = 5
_sends: dict[str, deque[float]] = defaultdict(deque)
_fails: dict[str, int] = defaultdict(int)
_codes: dict[str, dict] = {}  # phone -> {hash, expires, provider}


def normalize_phone(raw: str) -> str:
    """'+91 98765-43210' / '09876543210' -> '9876543210'."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if not PHONE_RE.match(digits):
        raise HTTPException(400, "Enter a valid 10-digit Indian mobile number.")
    return digits


def _masked(x) -> str:
    return re.sub(r"[6-9]\d{9}", "<phone>", re.sub(r"\b\d{6}\b", "<code>", str(x)))[:300]


def _post(url: str, payload: dict, label: str) -> dict:
    try:
        r = httpx.post(url, json=payload, headers={"X-API-Key": settings.whatsapp_otp_api_key}, timeout=15)
    except httpx.HTTPError as e:
        log.warning("OTP %s unreachable: %s", label, e)
        return {"status": 599, "body": None}
    try:
        body = r.json()
    except ValueError:
        body = {"raw": r.text[:300]}
    # logged either way, so that "accepted but never delivered" can be traced with the provider
    log.warning("OTP %s %s %s: %s", label, "failed" if r.status_code >= 400 else "accepted", r.status_code, _masked(body))
    return {"status": r.status_code, "body": body}


def _ok(body) -> bool:
    """Provider response shape isn't documented; treat explicit false-y flags as failure."""
    if not isinstance(body, dict):
        return True
    for key in ("success", "verified", "valid", "ok", "status"):
        if key in body:
            v = body[key]
            if isinstance(v, str):
                return v.lower() in ("success", "ok", "true", "verified", "approved", "sent", "accepted", "queued")
            return bool(v)
    return True


def _hash(phone: str, code: str) -> str:
    return hashlib.sha256(f"{phone}:{code}:{settings.jwt_secret}".encode()).hexdigest()


# Meta authentication templates need the code twice: in the body and in the "Copy code" (URL) button.
# The abwpl request format for the button is not documented, so the known shapes are tried in turn;
# a wrong shape is rejected by Meta with 400 before anything is delivered. The shape that worked is remembered.
_btn = lambda c: [{"type": "text", "text": c}]  # noqa: E731
_SHAPES = [
    lambda c: {"parameters": [c], "buttonParameters": [c]},
    lambda c: {"parameters": [c], "buttons": [{"type": "url", "sub_type": "url", "index": 0, "parameters": [c]}]},
    lambda c: {"components": [{"type": "body", "parameters": _btn(c)},
                              {"type": "button", "sub_type": "url", "index": "0", "parameters": _btn(c)}]},
    lambda c: {"parameters": [c], "components": [{"type": "button", "sub_type": "url", "index": "0", "parameters": _btn(c)}]},
    lambda c: {"parameters": [c], "buttonParameter": c},
    lambda c: {"parameters": [c], "otp": c, "code": c},
    lambda c: {"parameters": [c, c]},
]
_shape_ok: int | None = None


def _whatsapp(phone: str, code: str) -> str | None:
    """'template', 'provider', or None when WhatsApp could not be used."""
    if not settings.whatsapp_otp_api_key:
        return None
    if settings.whatsapp_otp_template:
        global _shape_ok
        order = ([_shape_ok] if _shape_ok is not None else []) + [i for i in range(len(_SHAPES)) if i != _shape_ok]
        for i in order:
            payload = {"phone": phone, "templateName": settings.whatsapp_otp_template, **_SHAPES[i](code)}
            res = _post(f"{settings.whatsapp_api_base}/messages/send", payload, f"template shape {i}")
            if res["status"] < 400 and _ok(res["body"]):
                _shape_ok = i
                return "template"
            if res["status"] != 400:  # 401/429/5xx: another shape will not help
                break
    res = _post(f"{settings.whatsapp_otp_url}/send", {"phone": phone}, "provider")
    if res["status"] == 429:  # the provider's own resend gap, e.g. "Please wait 18s ..."
        msg = res["body"].get("message") if isinstance(res["body"], dict) else None
        raise HTTPException(429, msg or "Please wait a little before requesting another code.")
    return "provider" if res["status"] < 400 and _ok(res["body"]) else None


def _email(email: str, code: str) -> bool:
    if not mailer.enabled():
        return False
    return mailer.send(email, f"{code} is your Nyay Apex code",
                       f"Your Nyay Apex one-time code is {code}\n\nIt is valid for {OTP_TTL_S // 60} minutes. "
                       "Do not share it with anyone. If you did not ask for it, ignore this email.\n")


def send(phone: str, email: str | None = None) -> list[str]:
    """Sends one code to the WhatsApp number and, if given, the email. Returns the channels that took it."""
    now = time.time()
    q = _sends[phone]
    while q and now - q[0] > 3600:
        q.popleft()
    if q and now - q[-1] < RESEND_GAP_S:
        raise HTTPException(429, f"Please wait {int(RESEND_GAP_S - (now - q[-1]))}s before requesting another code.")
    if len(q) >= MAX_SENDS_PER_HOUR:
        raise HTTPException(429, "Too many OTP requests for this number. Try again in an hour.")

    if settings.otp_dev_bypass:
        channels, code, via = ["whatsapp"], DEV_CODE, None
    else:
        code = f"{secrets.randbelow(10**6):06d}"
        via = _whatsapp(phone, code)
        channels = ["whatsapp"] if via else []
        if email and _email(email, code):
            channels.append("email")
        if not channels:
            raise HTTPException(502, "The code could not be sent right now. Please try again in a minute, or use email and password.")
    _codes[phone] = {"hash": _hash(phone, code), "expires": now + OTP_TTL_S, "provider": via == "provider"}
    q.append(now)
    _fails[phone] = 0
    return channels


def verify(phone: str, code: str) -> None:
    if not re.fullmatch(r"\d{4,8}", code or ""):
        raise HTTPException(400, "Enter the code you received.")
    if _fails[phone] >= MAX_VERIFY_FAILS:
        raise HTTPException(429, "Too many wrong codes. Request a new OTP.")

    rec = _codes.get(phone)
    ok = bool(rec) and time.time() <= rec["expires"] and hmac.compare_digest(rec["hash"], _hash(phone, code))
    if not ok and rec and rec["provider"] and time.time() <= rec["expires"]:
        res = _post(f"{settings.whatsapp_otp_url}/verify", {"phone": phone, "code": code}, "provider verify")
        ok = res["status"] < 400 and _ok(res["body"])
    if not ok:
        _fails[phone] += 1
        raise HTTPException(401, "Incorrect or expired code.")
    _codes.pop(phone, None)
    _fails.pop(phone, None)


def sent_text(channels: list[str]) -> str:
    return " and ".join({"whatsapp": "WhatsApp", "email": "email"}[c] for c in channels)
