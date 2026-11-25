"""Session tokens + request dependencies. Every data route depends on `member()`,
which guarantees a logged-in, onboarded user and gives the workspace to scope queries by."""

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

_bearer = HTTPBearer(auto_error=False)
ALGO = "HS256"
SESSION_COOKIE = "nyay_session"
CSRF_HEADER = "x-nyay-client"  # the web app sends it; a cross-site form cannot (custom headers need CORS approval)
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def issue_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(user.id), "iat": now, "exp": now + timedelta(days=settings.jwt_ttl_days)},
                      settings.jwt_secret, algorithm=ALGO)


def start_session(response: Response, user: User) -> None:
    """Log in by an httpOnly cookie: page scripts can never read the session token."""
    response.set_cookie(SESSION_COOKIE, issue_token(user), max_age=settings.jwt_ttl_days * 86400, httponly=True,
                        secure=settings.app_url.startswith("https"), samesite="lax", path="/api")


def end_session(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/api", secure=settings.app_url.startswith("https"), httponly=True, samesite="lax")


def current_user(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
                 db: Session = Depends(get_db)) -> User:
    # A bearer token (scripts, older browser sessions) or the session cookie set at login
    token = creds.credentials if creds else request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Please log in.")
    if not creds and request.method not in SAFE_METHODS and request.headers.get(CSRF_HEADER) != "web":
        raise HTTPException(403, "Request blocked (missing app header).")
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Please log in.")
    user = db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(401, "Please log in.")
    return user


def member(user: User = Depends(current_user)) -> User:
    """Logged in AND finished onboarding (has a workspace + consents)."""
    if not user.onboarded or not user.workspace_id:
        raise HTTPException(403, "Complete onboarding first.")
    return user


def require_roles(*roles: str):
    def dep(user: User = Depends(member)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Your role does not allow this action.")
        return user
    return dep


def require_types(*types: str):
    """Restrict a feature to some account types (e.g. no live client matters for students)."""
    def dep(user: User = Depends(member)) -> User:
        if user.workspace.type not in types:
            raise HTTPException(403, "This feature isn't available for your account type.")
        return user
    return dep
