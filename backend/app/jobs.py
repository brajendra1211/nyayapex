"""Scheduled jobs (run by a systemd timer on the server, or by hand):

    python -m app.jobs causelist    # read new Supreme Court cause lists, match matters, notify
    python -m app.jobs reminders    # evening reminders: tomorrow's hearings, limitation, tasks due (once a day)
    python -m app.jobs citegraph    # rebuild the judgment citation graph (once a day, after 10 pm; ~15 s)
    python -m app.jobs all
"""

import json
import logging
import sys
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError

from .db import SessionLocal, prepare_database
from .models import Case, JobRun, Task, User
from .services import access, causelist, notify

REMINDER_HOUR_IST = 17  # evening reminders go out on the first run after 5 pm
LIMITATION_WARN_DAYS = (7, 3, 1, 0)


def _once_today(db, name: str, detail: dict | None = None) -> bool:
    """Claim today's run of a daily job. False if it already ran today."""
    db.add(JobRun(name=name, day=causelist.today_ist(), detail=detail or {}))
    try:
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False


def reminders(db, force: bool = False) -> dict:
    now = datetime.now(causelist.IST)
    if not force and now.hour < REMINDER_HOUR_IST:
        return {"skipped": "before evening"}
    if not _once_today(db, "reminders"):
        return {"skipped": "already sent today"}
    today = now.date()
    tomorrow = today + timedelta(days=1)
    sent = {"hearings": 0, "limitation": 0, "tasks": 0}
    for c in db.query(Case).filter(Case.next_hearing == tomorrow):
        where = f" ({c.bench})" if c.bench else ""
        notify.notify(db, access.matter_people(db, c), f"Hearing tomorrow, {tomorrow:%d %b}: \"{c.title}\"{where}",
                      case_id=c.id, kind="reminder", link=f"/matter?id={c.id}", whatsapp=True)
        sent["hearings"] += 1
    for days in LIMITATION_WARN_DAYS:
        for c in db.query(Case).filter(Case.limitation_expiry == today + timedelta(days=days)):
            when = "TODAY" if days == 0 else f"in {days} day{'s' if days > 1 else ''} ({c.limitation_expiry:%d %b})"
            notify.notify(db, access.matter_people(db, c), f"Limitation for \"{c.title}\" expires {when}",
                          case_id=c.id, kind="limitation", link=f"/matter?id={c.id}", whatsapp=True)
            sent["limitation"] += 1
    for t in db.query(Task).filter(Task.status == "open", Task.due_date == tomorrow, Task.assignee_id.isnot(None)):
        u = db.get(User, t.assignee_id)
        c = db.get(Case, t.case_id)
        notify.notify(db, [u], f"Due tomorrow: \"{t.title}\" on \"{c.title}\"", case_id=c.id, kind="task",
                      link=f"/matter?id={c.id}", whatsapp=True)
        sent["tasks"] += 1
    db.commit()
    return sent


def main(argv: list[str]) -> None:
    logging.basicConfig(level=logging.WARNING)
    what = argv[0] if argv else "all"
    prepare_database()
    db = SessionLocal()
    out = {}
    try:
        if what in ("causelist", "all"):
            out["causelist"] = causelist.sync(db)
        if what in ("reminders", "all"):
            out["reminders"] = reminders(db, force="--force" in argv)
        if what == "citegraph" or (what == "all" and datetime.now(causelist.IST).hour >= 22 and _once_today(db, "citegraph")):
            from . import citegraph

            out["citegraph"] = {k: v for k, v in citegraph.build().items() if k != "top"}
    finally:
        db.close()
    print(datetime.now(causelist.IST).strftime("%Y-%m-%d %H:%M"), json.dumps(out, default=str)[:3000], flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
