"""Login (WhatsApp OTP), onboarding for the four account types, team invites, verification queue."""

import re
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import false, or_
from sqlalchemy.orm import Session

from ..auth import current_user, end_session, member, require_roles, start_session
from ..config import settings
from ..db import get_db
from ..models import ROLES, ClientAccess, Invite, User, Workspace
from ..services import mailer, otp, passwords
from ..services.ratelimit import client_ip, hit

router = APIRouter(prefix="/api", tags=["auth"])

# Which panel sections each account type sees (frontend hides the rest; routes enforce where it matters)
FEATURES = {
    "advocate": ["dashboard", "research", "law", "precedent", "citations", "documents", "drafting", "compliance", "cases", "courtroom", "usage"],
    "firm": ["dashboard", "research", "law", "precedent", "citations", "documents", "drafting", "compliance", "cases", "courtroom", "usage", "team"],
    "corporate": ["dashboard", "research", "law", "precedent", "citations", "documents", "drafting", "compliance", "cases", "usage", "team"],
    # Students learn on the tools but don't hold live client matters
    "student": ["research", "law", "precedent", "citations", "documents", "drafting", "compliance", "usage"],
    # A person following their own case: plain-language tools only (no drafting/filing, which is an advocate's work)
    "individual": ["personal", "law"],
}
ROLE_LABELS = {
    "owner": "Admin", "aor": "Advocate-on-Record", "senior": "Senior Advocate", "junior": "Junior Advocate",
    "clerk": "Clerk", "gc": "General Counsel", "counsel": "Legal Counsel", "paralegal": "Paralegal",
}
ADVOCATE_ROLES = {"aor", "senior", "junior"}


def _is_platform_admin(u: User) -> bool:
    phones = {p.strip() for p in settings.platform_admin_phones.split(",") if p.strip()}
    emails = {e.strip().lower() for e in settings.platform_admin_emails.split(",") if e.strip()}
    return bool(u.phone and u.phone in phones) or bool(u.email and u.email in emails and u.password_hash)


def client_invites_for(db: Session, u: User):
    conds = []
    if u.phone:
        conds.append(ClientAccess.phone == u.phone)
    if u.email:
        conds.append(ClientAccess.email == u.email)
    return db.query(ClientAccess).filter(or_(*conds) if conds else false(), ClientAccess.user_id.is_(None),
                                         ClientAccess.revoked_at.is_(None)).all()


def _require_invite(db: Session, email: str | None = None, phone: str | None = None) -> None:
    """Private pilot (ALLOW_SIGNUP=false): only people a chamber or advocate has invited can create an account."""
    if settings.allow_signup:
        return
    probe = User(email=email, phone=phone)  # never added to the session
    if _invites_for(db, probe).first() is None and not client_invites_for(db, probe):
        raise HTTPException(403, "Nyay Apex is in a private pilot. Please ask your chamber or advocate to invite you first.")


def _invites_for(db: Session, u: User):
    conds = []
    if u.phone:
        conds.append(Invite.phone == u.phone)
    if u.email:
        conds.append(Invite.email == u.email)
    return db.query(Invite).filter(or_(*conds) if conds else false(), Invite.accepted_at.is_(None))


def user_dict(u: User, db: Session) -> dict:
    ws = u.workspace
    out = {
        "id": u.id, "phone": u.phone, "name": u.name, "email": u.email, "role": u.role,
        "role_label": ROLE_LABELS.get(u.role or "", u.role), "profile": u.profile or {},
        "verification": u.verification, "language": u.language, "citation_pref": u.citation_pref,
        "onboarded": u.onboarded, "is_platform_admin": _is_platform_admin(u), "has_password": bool(u.password_hash),
        "workspace": {"id": ws.id, "type": ws.type, "name": ws.name, "details": ws.details or {}} if ws else None,
        "features": ["portal"] if u.kind == "client" else (FEATURES.get(ws.type, []) if ws else []),
        "kind": u.kind,
    }
    if not u.onboarded:
        out["client_invites"] = [
            {"id": c.id, "matter": c.case.title, "firm": c.case and db.get(Workspace, c.case.workspace_id).name, "name": c.name}
            for c in client_invites_for(db, u)
        ]
        out["pending_invites"] = [
            {"id": i.id, "workspace": i.workspace.name, "workspace_type": i.workspace.type, "role": i.role,
             "role_label": ROLE_LABELS.get(i.role, i.role), "name": i.name}
            for i in _invites_for(db, u)
        ]
    return out


# ---------- OTP login ----------

class PhoneIn(BaseModel):
    phone: str


class VerifyIn(BaseModel):
    phone: str
    code: str


def _phone_can_log_in(db: Session, phone: str) -> bool:
    """A registered number, or one a chamber/advocate has invited (their account is created on first login)."""
    if db.query(User.id).filter(User.phone == phone).first():
        return True
    probe = User(phone=phone)  # never added to the session
    return _invites_for(db, probe).first() is not None or bool(client_invites_for(db, probe))


NO_ACCOUNT_FOR_PHONE = "No account uses this number yet. Create an account, or log in and add it from your profile."


@router.post("/auth/otp/send")
def send_otp(body: PhoneIn, request: Request, db: Session = Depends(get_db)):
    phone = otp.normalize_phone(body.phone)
    hit(f"otp-ip:{client_ip(request)}", 20, 3600, "Too many code requests from this network. Try again in an hour.")
    hit(f"otp-phone:{phone}", 6, 3600, "Too many codes sent to this number. Try again in an hour.")
    if not _phone_can_log_in(db, phone):
        raise HTTPException(404, NO_ACCOUNT_FOR_PHONE)
    user = db.query(User).filter(User.phone == phone).first()
    channels = otp.send(phone, user.email if user else None)
    return {"sent": True, "phone": phone, "channel": channels[0], "channels": channels, "resend_after": otp.RESEND_GAP_S}


@router.post("/auth/otp/verify")
def verify_otp(body: VerifyIn, request: Request, response: Response, db: Session = Depends(get_db)):
    phone = otp.normalize_phone(body.phone)
    hit(f"otp-verify:{phone}", 10, 900, "Too many wrong codes. Wait 15 minutes and request a new one.")
    if not _phone_can_log_in(db, phone):
        raise HTTPException(404, NO_ACCOUNT_FOR_PHONE)
    otp.verify(phone, body.code.strip())
    user = db.query(User).filter(User.phone == phone).first()
    if not user:
        user = User(phone=phone)
        db.add(user)
    user.last_login_at = datetime.utcnow()
    db.commit()
    start_session(response, user)
    return {"user": user_dict(user, db)}


class EmailLoginIn(BaseModel):
    email: str
    password: str


class RegisterIn(BaseModel):
    name: str = Field("", max_length=120)
    email: str
    password: str
    phone: str | None = None  # optional: can be added later from the profile
    code: str | None = None  # WhatsApp OTP for `phone`


def _check_new_account(db: Session, body: RegisterIn) -> tuple[str, str | None]:
    email = passwords.normalize_email(body.email)
    passwords.check_strength(body.password)
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        msg = ("An account with this email already exists - log in instead." if existing.password_hash
               else "This email belongs to an account that logs in with WhatsApp OTP. Log in there and set a password from your profile.")
        raise HTTPException(409, msg)
    phone = otp.normalize_phone(body.phone) if body.phone else None
    if phone and db.query(User.id).filter(User.phone == phone).first():
        raise HTTPException(409, "This WhatsApp number is already linked to an account. Log in with it instead.")
    _require_invite(db, email=email, phone=phone)
    return email, phone


@router.post("/auth/register/start")
def register_start(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    """Checks the form first, so a paid WhatsApp message is only sent for a registration that can succeed."""
    hit(f"register-ip:{client_ip(request)}", 10, 3600, "Too many sign-ups from this network. Try again in an hour.")
    email, phone = _check_new_account(db, body)
    if not phone:
        raise HTTPException(400, "Enter your WhatsApp number.")
    channels = otp.send(phone, email)  # same code on WhatsApp and by email
    return {"sent": True, "phone": phone, "channel": channels[0], "channels": channels, "resend_after": otp.RESEND_GAP_S}


@router.post("/auth/register")
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    hit(f"register-ip:{client_ip(request)}", 10, 3600, "Too many sign-ups from this network. Try again in an hour.")
    email, phone = _check_new_account(db, body)
    if phone:  # a number is stored only once its owner has proved it with the code
        if not body.code:
            raise HTTPException(400, "Enter the code sent to your WhatsApp or email.")
        otp.verify(phone, body.code.strip())
    user = User(email=email, phone=phone, name=body.name.strip(), password_hash=passwords.hash_password(body.password),
                last_login_at=datetime.utcnow())
    db.add(user)
    db.commit()
    start_session(response, user)
    return {"user": user_dict(user, db)}


def _find_account(db: Session, raw: str | None) -> tuple[str, User | None]:
    """Accounts are found by email or by WhatsApp number, whichever was typed."""
    raw = (raw or "").strip()
    if "@" in raw:
        email = passwords.normalize_email(raw)
        return email, db.query(User).filter(User.email == email).first()
    phone = otp.normalize_phone(raw)
    return phone, db.query(User).filter(User.phone == phone).first()


@router.post("/auth/login")
def login(body: EmailLoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    hit(f"login-ip:{client_ip(request)}", 30, 900, "Too many login attempts from this network. Wait 15 minutes.")
    login_id, user = _find_account(db, body.email)
    passwords.guard(login_id)
    # Same message whether the login or the password is wrong (no account enumeration)
    if not user or not passwords.verify_password(body.password, user.password_hash):
        passwords.record_failure(login_id)
        raise HTTPException(401, "Incorrect email/mobile or password.")
    passwords.clear(login_id)
    user.last_login_at = datetime.utcnow()
    db.commit()
    start_session(response, user)
    return {"user": user_dict(user, db)}


class ForgotIn(BaseModel):
    email: str


@router.post("/auth/password/forgot")
def forgot_password(body: ForgotIn, request: Request, db: Session = Depends(get_db)):
    """Typed a mobile: code on WhatsApp. Typed an email: code by email (or the linked WhatsApp if mail is off)."""
    hit(f"forgot-ip:{client_ip(request)}", 10, 3600, "Too many reset requests from this network. Try again in an hour.")
    login_id, user = _find_account(db, body.email)
    if "@" not in login_id:
        passwords.throttle_reset(login_id)
        if user:  # same response for unknown numbers: never reveal who has an account
            otp.send(login_id, user.email)
        return {"sent": True, "channel": "whatsapp", "hint": "******" + login_id[-4:], "resend_after": passwords.RESET_GAP_S}
    email = login_id
    if mailer.enabled():
        passwords.throttle_reset(email)
        if user:  # same response for unknown emails: never reveal who has an account
            code = passwords.new_reset_code(email)
            if not mailer.send(email, "Your Nyay Apex password reset code",
                               f"Your Nyay Apex password reset code is {code}\n\nIt is valid for 15 minutes. "
                               "If you did not ask for this, ignore this email; your password has not changed.\n"):
                raise HTTPException(502, "The reset email could not be sent. Please try again in a few minutes.")
        return {"sent": True, "channel": "email", "hint": passwords.mask_email(email), "resend_after": passwords.RESET_GAP_S}
    if not user or not user.phone:
        raise HTTPException(400, "Password reset works through the mobile number linked to your account. "
                                 "If you never linked one, contact support.")
    otp.send(user.phone)
    return {"sent": True, "channel": "whatsapp", "hint": "******" + user.phone[-4:], "resend_after": otp.RESEND_GAP_S}


class ResetIn(BaseModel):
    email: str
    code: str
    new_password: str


@router.post("/auth/password/reset")
def reset_password(body: ResetIn, request: Request, response: Response, db: Session = Depends(get_db)):
    hit(f"reset-ip:{client_ip(request)}", 20, 3600, "Too many attempts from this network. Try again in an hour.")
    email, user = _find_account(db, body.email)
    passwords.check_strength(body.new_password)
    if "@" not in email:
        if not user:
            raise HTTPException(401, "Incorrect or expired code.")
        otp.verify(email, body.code.strip())
    elif mailer.enabled():
        passwords.check_reset_code(email, body.code.strip())
        if not user:
            raise HTTPException(401, "Incorrect code.")
    elif not user or not user.phone:
        raise HTTPException(400, "Reset not available for this account.")
    else:
        otp.verify(user.phone, body.code.strip())
    user.password_hash = passwords.hash_password(body.new_password)
    user.last_login_at = datetime.utcnow()
    passwords.clear(email)
    db.commit()
    start_session(response, user)
    return {"user": user_dict(user, db)}


class SetPasswordIn(BaseModel):
    email: str | None = None
    current_password: str | None = None
    new_password: str


@router.post("/auth/password")
def set_password(body: SetPasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Add email+password login to a WhatsApp account, or change the password."""
    if user.password_hash and not passwords.verify_password(body.current_password or "", user.password_hash):
        raise HTTPException(401, "Current password is incorrect.")
    passwords.check_strength(body.new_password)
    if body.email:
        _set_email(db, user, body.email)
    if not user.email and not user.phone:
        raise HTTPException(400, "Add an email or WhatsApp number to log in with a password.")
    user.password_hash = passwords.hash_password(body.new_password)
    db.commit()
    return user_dict(user, db)


class LinkPhoneIn(BaseModel):
    phone: str
    code: str | None = None


@router.post("/auth/phone")
def link_phone(body: LinkPhoneIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Link a WhatsApp number to an email account (enables OTP login + password reset). Call without code, then with it."""
    phone = otp.normalize_phone(body.phone)
    if db.query(User).filter(User.phone == phone, User.id != user.id).first():
        raise HTTPException(409, "This number is already linked to another account.")
    if not body.code:
        otp.send(phone)
        return {"sent": True, "resend_after": otp.RESEND_GAP_S}
    otp.verify(phone, body.code.strip())
    user.phone = phone
    db.commit()
    return user_dict(user, db)


def _set_email(db: Session, user: User, raw: str | None) -> None:
    if not raw:
        if user.password_hash:
            raise HTTPException(400, "Email is your login for this account and can't be removed.")
        user.email = None
        return
    email = passwords.normalize_email(raw)
    if email != user.email and db.query(User).filter(User.email == email, User.id != user.id).first():
        raise HTTPException(409, "This email is already used by another account.")
    user.email = email


@router.get("/auth/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_dict(user, db)


@router.post("/auth/session")
def to_cookie(response: Response, user: User = Depends(current_user)):
    """Move a browser that still holds a token in page storage over to the httpOnly cookie."""
    start_session(response, user)
    return {"ok": True}


@router.post("/auth/logout")
def logout(response: Response):
    end_session(response)
    return {"ok": True}


class PrefsIn(BaseModel):
    name: str | None = None
    email: str | None = None
    language: Literal["en", "hi"] | None = None
    citation_pref: Literal["SCC", "AIR", "MANU"] | None = None
    whatsapp_alerts: bool | None = None  # hearing / task / limitation alerts on WhatsApp (in-app alerts always on)
    email_alerts: bool | None = None  # the same alerts by email (off by default)


@router.patch("/auth/me")
def update_me(body: PrefsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if "email" in data:
        _set_email(db, user, data.pop("email"))
    for key in ("whatsapp_alerts", "email_alerts"):
        if key in data:
            user.profile = {**(user.profile or {}), key: bool(data.pop(key))}
    for k, v in data.items():
        setattr(user, k, v)
    db.commit()
    return user_dict(user, db)


# ---------- Onboarding ----------

class OnboardIn(BaseModel):
    mode: Literal["create", "join", "client"] = "create"
    invite_id: int | None = None
    account_type: Literal["advocate", "firm", "corporate", "student", "individual"] | None = None
    name: str = Field(min_length=2, max_length=120)
    email: str | None = None
    workspace_name: str | None = None
    workspace_details: dict = {}
    profile: dict = {}
    language: Literal["en", "hi"] = "en"
    citation_pref: Literal["SCC", "AIR", "MANU"] = "SCC"
    consent: bool = False  # DPDP Act, 2023
    ai_ack: bool = False  # AI output is advisory; advocate verifies & discloses (SC AI Regs 4, 8, 43)


def _clean(d: dict, keys: tuple[str, ...]) -> dict:
    return {k: (v.strip() if isinstance(v, str) else v) for k, v in d.items() if k in keys and v not in (None, "")}


ADVOCATE_KEYS = ("bar_enrolment_no", "state_bar_council", "enrolment_year", "is_aor", "aor_code", "practice_areas", "courts", "designation")
CORPORATE_KEYS = ("designation", "department")
STUDENT_KEYS = ("college", "course", "year", "college_email", "student_id")
INDIVIDUAL_KEYS = ("city", "state", "occupation")


def _check_advocate(profile: dict, required: bool) -> str:
    """Returns the verification status for advocate details."""
    if not profile.get("bar_enrolment_no"):
        if required:
            raise HTTPException(400, "Bar Council enrolment number is required.")
        return "not_required"
    # Formats differ by State Bar Council (D/1234/2015, MAH/1234/2010, K-123/2001 …) - only sanity-check here
    if not re.fullmatch(r"[A-Za-z0-9/ .()-]{4,30}", profile["bar_enrolment_no"]) or not re.search(r"\d", profile["bar_enrolment_no"]):
        raise HTTPException(400, "Enter the enrolment number as on your Bar Council card, e.g. D/1234/2015.")
    if not profile.get("state_bar_council"):
        raise HTTPException(400, "Select your State Bar Council.")
    if profile.get("is_aor") and not profile.get("aor_code"):
        raise HTTPException(400, "Enter your AOR code, or untick Advocate-on-Record.")
    return "pending"


@router.post("/auth/onboarding")
def onboard(body: OnboardIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.onboarded:
        raise HTTPException(400, "Already onboarded.")
    if body.mode == "client":
        # Clients: portal-only access to the matters they were invited to
        if not body.consent:
            raise HTTPException(400, "Please accept the data protection consent to continue.")
        pending = client_invites_for(db, user)
        if not pending:
            raise HTTPException(404, "No client invitation found for this number / email.")
        now = datetime.utcnow()
        for ca in pending:
            ca.user_id, ca.accepted_at = user.id, now
        user.name, user.kind, user.language = body.name.strip(), "client", body.language
        if body.email:
            _set_email(db, user, body.email)
        user.consent_at, user.onboarded = now, True
        db.commit()
        db.refresh(user)
        return user_dict(user, db)

    if not (body.consent and body.ai_ack):
        raise HTTPException(400, "Both consents are required to use Nyay Apex.")

    if body.mode == "join":
        inv = db.get(Invite, body.invite_id or 0)
        mine = inv and ((inv.phone and inv.phone == user.phone) or (inv.email and inv.email == user.email))
        if not mine or inv.accepted_at:
            raise HTTPException(404, "Invite not found for this number.")
        ws, role = inv.workspace, inv.role
        inv.accepted_at = datetime.utcnow()
        if role in ADVOCATE_ROLES:
            profile = _clean(body.profile, ADVOCATE_KEYS)
            verification = _check_advocate(profile, required=True)
        else:
            profile, verification = _clean(body.profile, CORPORATE_KEYS), "not_required"
    else:
        t = body.account_type
        if not t:
            raise HTTPException(400, "Choose an account type.")
        if t == "advocate":
            profile = _clean(body.profile, ADVOCATE_KEYS)
            verification = _check_advocate(profile, required=True)
            ws_name = body.name
        elif t == "firm":
            profile = _clean(body.profile, ADVOCATE_KEYS)
            verification = _check_advocate(profile, required=False)  # firm admin may be an office manager
            ws_name = (body.workspace_name or "").strip()
        elif t == "corporate":
            profile, verification = _clean(body.profile, CORPORATE_KEYS), "not_required"
            ws_name = (body.workspace_name or "").strip()
        elif t == "individual":
            profile, verification = _clean(body.profile, INDIVIDUAL_KEYS), "not_required"
            ws_name = body.name
        else:  # student
            profile = _clean(body.profile, STUDENT_KEYS)
            if not profile.get("college"):
                raise HTTPException(400, "College / university is required.")
            verification = "pending"
            ws_name = body.name
        if len(ws_name) < 2:
            raise HTTPException(400, "Enter the firm / company name.")
        details = _clean(body.workspace_details, ("gstin", "cin", "address", "city", "size", "industry"))
        if details.get("gstin") and not re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]", details["gstin"].upper()):
            raise HTTPException(400, "GSTIN looks invalid (15 characters, e.g. 07ABCDE1234F1Z5).")
        ws = Workspace(type=t, name=ws_name, details=details)
        db.add(ws)
        db.flush()
        role = "owner"

    user.name = body.name.strip()
    if body.email:
        _set_email(db, user, body.email)
    user.workspace_id, user.role = ws.id, role
    user.profile, user.verification = profile, verification
    user.language, user.citation_pref = body.language, body.citation_pref
    user.consent_at = user.ai_ack_at = datetime.utcnow()
    user.onboarded = True
    db.commit()
    db.refresh(user)
    return user_dict(user, db)


# ---------- Team (firm / corporate) ----------

def _member_dict(u: User) -> dict:
    return {"id": u.id, "name": u.name, "phone": u.phone, "email": u.email, "role": u.role, "role_label": ROLE_LABELS.get(u.role or "", u.role),
            "verification": u.verification, "last_login_at": u.last_login_at}


@router.get("/team")
def team(user: User = Depends(member), db: Session = Depends(get_db)):
    ws = user.workspace
    return {
        "workspace": {"id": ws.id, "name": ws.name, "type": ws.type},
        "roles": [{"id": r, "label": ROLE_LABELS[r]} for r in ROLES[ws.type] if r != "owner"],
        "members": [_member_dict(m) for m in ws.members],
        "invites": [{"id": i.id, "phone": i.phone, "email": i.email, "name": i.name, "role": i.role, "role_label": ROLE_LABELS.get(i.role, i.role),
                     "created_at": i.created_at}
                    for i in db.query(Invite).filter(Invite.workspace_id == ws.id, Invite.accepted_at.is_(None))],
        "can_manage": user.role == "owner",
        "settings": {"junior_scope": (ws.details or {}).get("junior_scope", "assigned")},
    }


class InviteIn(BaseModel):
    phone: str | None = None
    email: str | None = None
    name: str = ""
    role: str


@router.post("/team/invites")
def create_invite(body: InviteIn, user: User = Depends(require_roles("owner")), db: Session = Depends(get_db)):
    ws = user.workspace
    if ws.type not in ("firm", "corporate"):
        raise HTTPException(400, "Only firm and corporate accounts can add team members.")
    if body.role not in ROLES[ws.type] or body.role == "owner":
        raise HTTPException(400, "Invalid role for this account.")
    if not (body.phone or body.email):
        raise HTTPException(400, "Enter a mobile number or an email.")
    phone = otp.normalize_phone(body.phone) if body.phone else None
    email = passwords.normalize_email(body.email) if body.email else None
    match = ([User.phone == phone] if phone else []) + ([User.email == email] if email else [])
    existing = db.query(User).filter(or_(*match)).first()
    if existing and existing.onboarded:
        raise HTTPException(409, "Already a member." if existing.workspace_id == ws.id else "This person already has a Nyay Apex account.")
    key = (Invite.phone == phone) if phone else (Invite.email == email)
    inv = db.query(Invite).filter(Invite.workspace_id == ws.id, key).first()
    if inv:
        inv.role, inv.name, inv.accepted_at, inv.phone, inv.email = body.role, body.name, None, phone, email
    else:
        inv = Invite(workspace_id=ws.id, phone=phone, email=email, name=body.name.strip(), role=body.role, invited_by=user.id)
        db.add(inv)
    db.commit()
    # No message is sent automatically: the invitee simply logs in with this number / email.
    return {"id": inv.id, "phone": phone, "email": email, "role": inv.role}


@router.delete("/team/invites/{invite_id}")
def delete_invite(invite_id: int, user: User = Depends(require_roles("owner")), db: Session = Depends(get_db)):
    inv = db.get(Invite, invite_id)
    if inv and inv.workspace_id == user.workspace_id:
        db.delete(inv)
        db.commit()
    return {"ok": True}


class RoleIn(BaseModel):
    role: str


@router.patch("/team/members/{user_id}")
def change_role(user_id: int, body: RoleIn, user: User = Depends(require_roles("owner")), db: Session = Depends(get_db)):
    m = db.get(User, user_id)
    if not m or m.workspace_id != user.workspace_id or m.id == user.id:
        raise HTTPException(404, "Member not found.")
    if body.role not in ROLES[user.workspace.type]:
        raise HTTPException(400, "Invalid role.")
    m.role = body.role
    db.commit()
    return _member_dict(m)


@router.delete("/team/members/{user_id}")
def remove_member(user_id: int, user: User = Depends(require_roles("owner")), db: Session = Depends(get_db)):
    m = db.get(User, user_id)
    if not m or m.workspace_id != user.workspace_id or m.id == user.id:
        raise HTTPException(404, "Member not found.")
    # Removed members must onboard again (fresh account) - their access to this workspace ends now
    m.workspace_id, m.role, m.onboarded = None, None, False
    db.commit()
    return {"ok": True}


# ---------- Verification queue (platform admins) ----------

def platform_admin(user: User = Depends(current_user)) -> User:
    if not _is_platform_admin(user):
        raise HTTPException(403, "Platform admins only.")
    return user


class TeamSettingsIn(BaseModel):
    # assigned: juniors / clerks / paralegals see only matters they are on; all: everyone sees every matter
    junior_scope: Literal["assigned", "all"]


@router.patch("/team/settings")
def team_settings(body: TeamSettingsIn, user: User = Depends(require_roles("owner")), db: Session = Depends(get_db)):
    from sqlalchemy.orm.attributes import flag_modified

    ws = user.workspace
    ws.details = {**(ws.details or {}), "junior_scope": body.junior_scope}
    flag_modified(ws, "details")
    db.commit()
    return {"junior_scope": body.junior_scope}


@router.get("/admin/whatsapp/templates")
def whatsapp_templates(_: User = Depends(platform_admin)):
    """Approved WhatsApp templates on the abwpl account - pick one for WHATSAPP_NOTIFY_TEMPLATE."""
    from ..services import notify

    if not settings.whatsapp_otp_api_key:
        raise HTTPException(503, "Set WHATSAPP_OTP_API_KEY first.")
    try:
        return {"configured": settings.whatsapp_notify_template or None, "templates": notify.list_templates()}
    except Exception as e:
        raise HTTPException(502, f"Could not fetch templates: {e}")


@router.get("/admin/verifications")
def pending_verifications(_: User = Depends(platform_admin), db: Session = Depends(get_db)):
    return [{**_member_dict(u), "profile": u.profile, "workspace": u.workspace.name if u.workspace else None,
             "workspace_type": u.workspace.type if u.workspace else None, "created_at": u.created_at}
            for u in db.query(User).filter(User.verification == "pending").order_by(User.id)]


class DecisionIn(BaseModel):
    status: Literal["verified", "rejected"]


@router.post("/admin/verifications/{user_id}")
def decide(user_id: int, body: DecisionIn, _: User = Depends(platform_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found.")
    u.verification = body.status
    db.commit()
    return _member_dict(u)
