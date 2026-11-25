"""Outgoing mail: through an SMTP account (e.g. Google Workspace with an app password) when SMTP_HOST is set,
otherwise through the server's own mail system (sendmail)."""

import logging
import smtplib
import subprocess
from email.message import EmailMessage

from ..config import settings

log = logging.getLogger(__name__)


def enabled() -> bool:
    return bool(settings.mail_from)


def send(to: str, subject: str, body: str) -> bool:
    msg = EmailMessage()
    msg["From"] = f"Nyay Apex <{settings.mail_from}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        if settings.smtp_host:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
                s.starttls()
                s.login(settings.smtp_user, settings.smtp_password)
                s.send_message(msg)
        else:
            subprocess.run([settings.sendmail_path, "-i", "-f", settings.mail_from, "--", to], input=msg.as_bytes(),
                           check=True, timeout=20, capture_output=True)
        return True
    except (OSError, subprocess.SubprocessError, smtplib.SMTPException) as e:
        log.warning("mail not sent: %s", type(e).__name__)
        return False
