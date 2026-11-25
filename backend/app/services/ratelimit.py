"""Fixed-window rate limits kept in the database, so they hold across restarts and API processes."""

import random
import time
from datetime import datetime, timedelta

from fastapi import HTTPException, Request
from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError

from ..db import SessionLocal
from ..models import RateHit


def client_ip(request: Request) -> str:
    # uvicorn runs with --proxy-headers behind Apache, so this is the visitor's address
    return (request.client.host if request.client else "") or "unknown"


def hit(key: str, limit: int, seconds: int, message: str = "Too many attempts. Please try again later.") -> None:
    """Count one attempt for `key` in the current window; 429 once more than `limit` are made."""
    slot = int(time.time()) // seconds
    db = SessionLocal()
    try:
        stmt = update(RateHit).where(RateHit.key == key, RateHit.slot == slot).values(count=RateHit.count + 1)
        if db.execute(stmt).rowcount == 0:
            try:
                db.add(RateHit(key=key, slot=slot, count=1))
                db.commit()
            except IntegrityError:  # another request created it first
                db.rollback()
                db.execute(stmt)
        db.commit()
        count = db.query(RateHit.count).filter(RateHit.key == key, RateHit.slot == slot).scalar() or 0
        if random.random() < 0.01:  # tidy old windows now and then
            db.execute(delete(RateHit).where(RateHit.created_at < datetime.utcnow() - timedelta(days=2)))
            db.commit()
    finally:
        db.close()
    if count > limit:
        wait = seconds - int(time.time()) % seconds
        raise HTTPException(429, message, headers={"Retry-After": str(wait)})
