"""Public website: the contact form, and its inbox for the platform team."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Enquiry, User
from ..services import mailer, notify, passwords
from ..services.ratelimit import client_ip, hit
from .auth import _is_platform_admin, platform_admin

router = APIRouter(prefix="/api", tags=["site"])

TOPICS = ("demo", "pilot", "support", "partnership", "privacy", "other")


class EnquiryIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(max_length=200)
    phone: str = Field("", max_length=20)
    organisation: str = Field("", max_length=200)
    topic: Literal["demo", "pilot", "support", "partnership", "privacy", "other"] = "other"
    message: str = Field(min_length=10, max_length=5000)
    website: str = ""  # honeypot: people never see this field; bots fill it


@router.post("/public/contact")
def contact(body: EnquiryIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    hit(f"contact-ip:{ip}", 5, 3600, "Too many messages from this network. Please try again in an hour.")
    if body.website.strip():
        return {"ok": True}  # quietly drop bot submissions
    email = passwords.normalize_email(body.email)
    e = Enquiry(name=body.name.strip(), email=email, phone=body.phone.strip(), organisation=body.organisation.strip(),
                topic=body.topic, message=body.message.strip(), ip=ip)
    db.add(e)
    db.flush()
    admins = [u for u in db.query(User).filter((User.email.isnot(None)) | (User.phone.isnot(None))) if _is_platform_admin(u)]
    notify.notify(db, admins, f"New {body.topic} enquiry from {e.name}{' (' + e.organisation + ')' if e.organisation else ''}",
                  kind="enquiry", link="/admin")
    db.commit()
    for a in admins:  # a copy by email, when mail is set up
        if a.email and mailer.enabled():
            mailer.send(a.email, f"Nyay Apex enquiry: {body.topic} from {e.name}",
                        f"{e.name} <{e.email}> {e.phone}\n{e.organisation}\n\n{e.message}\n\nReply from {settings.app_url}/admin\n")
    return {"ok": True}


@router.get("/admin/enquiries")
def enquiries(_: User = Depends(platform_admin), db: Session = Depends(get_db)):
    rows = db.query(Enquiry).order_by(Enquiry.id.desc()).limit(300).all()
    return [{k: getattr(r, k) for k in ("id", "name", "email", "phone", "organisation", "topic", "message", "status", "created_at")}
            for r in rows]


class EnquiryPatch(BaseModel):
    status: Literal["new", "replied", "closed"]


@router.patch("/admin/enquiries/{eid}")
def update_enquiry(eid: int, body: EnquiryPatch, _: User = Depends(platform_admin), db: Session = Depends(get_db)):
    e = db.get(Enquiry, eid)
    if not e:
        raise HTTPException(404, "Enquiry not found.")
    e.status, e.updated_at = body.status, datetime.utcnow()
    db.commit()
    return {"ok": True}
