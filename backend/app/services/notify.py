"""In-app notifications, optionally mirrored to WhatsApp through an approved abwpl.com template.

WhatsApp is used sparingly (hearing date changes, tasks/requests, client messages) so people don't mute it.
Message text never includes privileged content - only "there is an update on <matter>, open Nyay Apex".
"""

import logging
import threading

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal
from ..models import Notification, User

log = logging.getLogger(__name__)


def whatsapp_enabled() -> bool:
    return bool(settings.whatsapp_notify_template and settings.whatsapp_otp_api_key)


def send_template(phone: str, template: str, parameters: list[str]) -> tuple[bool, str]:
    try:
        r = httpx.post(f"{settings.whatsapp_api_base}/messages/send",
                       headers={"X-API-Key": settings.whatsapp_otp_api_key},
                       json={"phone": phone, "templateName": template, "parameters": parameters}, timeout=20)
        ok = r.status_code < 400
        if not ok:
            log.warning("WhatsApp send failed %s: %s", r.status_code, r.text[:300])
        return ok, r.text[:300]
    except httpx.HTTPError as e:
        log.warning("WhatsApp send error: %s", e)
        return False, str(e)


def list_templates() -> list | dict:
    r = httpx.get(f"{settings.whatsapp_api_base}/messages/templates",
                  headers={"X-API-Key": settings.whatsapp_otp_api_key}, timeout=20)
    r.raise_for_status()
    return r.json()


def _deliver(notification_ids: list[int]) -> None:
    db = SessionLocal()
    try:
        for nid in notification_ids:
            n = db.get(Notification, nid)
            u = db.get(User, n.user_id) if n else None
            if not n or not u or not u.phone or (u.profile or {}).get("whatsapp_alerts") is False:
                if n:
                    n.whatsapp = "skipped"
                continue
            ok, _ = send_template(u.phone, settings.whatsapp_notify_template,
                                  [u.name or "there", f"{n.text} - open {settings.app_url}{n.link}"[:900]])
            n.whatsapp = "sent" if ok else "failed"
        db.commit()
    finally:
        db.close()


def _email(pairs: list[tuple[str, str, str]]) -> None:
    from . import mailer

    for to, text, link in pairs:
        mailer.send(to, "Nyay Apex update", f"{text}\n\nOpen: {settings.app_url}{link}\n\n"
                    "You get this because email alerts are on in your Nyay Apex account (Account -> Alerts).\n")


def notify(db: Session, users: list[User], text: str, *, case_id: int | None = None, kind: str = "update",
           link: str = "", whatsapp: bool = False, exclude: User | None = None) -> None:
    """Create in-app notifications (committed by the caller) and send WhatsApp in the background."""
    seen, rows = set(), []
    for u in users:
        if u is None or u.id in seen or (exclude and u.id == exclude.id):
            continue
        seen.add(u.id)
        rows.append(Notification(user_id=u.id, case_id=case_id, kind=kind, text=text[:500], link=link))
    db.add_all(rows)
    db.flush()
    if whatsapp and whatsapp_enabled() and rows:
        ids = [r.id for r in rows]
        # after the caller commits, deliver off the request thread
        threading.Timer(1.0, _deliver, args=(ids,)).start()
    if whatsapp and settings.mail_from:  # the same important alerts by email, for those who asked for them
        mails = [(u.email, text[:500], link) for u in users
                 if u is not None and u.email and (u.profile or {}).get("email_alerts") and u.id in seen]
        if mails:
            threading.Timer(1.0, _email, args=(mails,)).start()
