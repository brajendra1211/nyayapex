"""Encrypt uploaded files at rest.

    python -m app.encrypt_files --new-key   # print a new FILE_KEY to put in backend/.env (keep a copy offline!)
    python -m app.encrypt_files             # encrypt files stored before FILE_KEY was set (safe to re-run)
"""

import base64
import os
import sys

from .config import settings
from .services import storage


def main(argv: list[str]) -> None:
    if "--new-key" in argv:
        print(base64.urlsafe_b64encode(os.urandom(32)).decode())
        return
    if not settings.file_key:
        sys.exit("FILE_KEY is not set in backend/.env")
    done, already = storage.encrypt_existing()
    print(f"encrypted {done} file(s); {already} already encrypted")


if __name__ == "__main__":
    main(sys.argv[1:])
