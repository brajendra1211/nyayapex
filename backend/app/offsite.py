"""Copy encrypted nightly backups to S3-compatible storage outside this server (Cloudflare R2, AWS S3, Backblaze B2).

    python -m app.offsite upload FILE...   # upload, then delete remote copies older than OFFSITE_KEEP_DAYS
    python -m app.offsite list             # what is stored remotely

Settings come from the environment (root's /root/.nyay-offsite.env, read by deploy/nyay-offsite-backup.sh):
OFFSITE_ENDPOINT, OFFSITE_BUCKET, OFFSITE_ACCESS_KEY, OFFSITE_SECRET_KEY, OFFSITE_PREFIX (default nyayapex/),
OFFSITE_KEEP_DAYS (default 30). Files must already be encrypted (the shell script uses gpg) - the storage
provider never sees plain data.
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _client():
    import boto3
    from botocore.config import Config

    return boto3.client("s3", endpoint_url=os.environ["OFFSITE_ENDPOINT"], aws_access_key_id=os.environ["OFFSITE_ACCESS_KEY"],
                        aws_secret_access_key=os.environ["OFFSITE_SECRET_KEY"], region_name=os.environ.get("OFFSITE_REGION", "auto"),
                        config=Config(retries={"max_attempts": 5, "mode": "standard"}))


def upload(files: list[str]) -> None:
    s3, bucket = _client(), os.environ["OFFSITE_BUCKET"]
    prefix = os.environ.get("OFFSITE_PREFIX", "nyayapex/")
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for f in files:
        p = Path(f)
        key = f"{prefix}{day}/{p.name}"
        s3.upload_file(str(p), bucket, key)
        remote = s3.head_object(Bucket=bucket, Key=key)["ContentLength"]
        if remote != p.stat().st_size:
            sys.exit(f"size mismatch for {key}: local {p.stat().st_size}, remote {remote}")
        print(f"uploaded {key} ({remote} bytes, verified)")
    keep = int(os.environ.get("OFFSITE_KEEP_DAYS", "30"))
    cutoff = datetime.now(timezone.utc) - timedelta(days=keep)
    old = [o["Key"] for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix)
           for o in page.get("Contents", []) if o["LastModified"] < cutoff]
    for i in range(0, len(old), 1000):
        s3.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in old[i:i + 1000]]})
    if old:
        print(f"deleted {len(old)} remote object(s) older than {keep} days")


def listing() -> None:
    s3, bucket = _client(), os.environ["OFFSITE_BUCKET"]
    prefix = os.environ.get("OFFSITE_PREFIX", "nyayapex/")
    total = 0
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for o in page.get("Contents", []):
            total += o["Size"]
            print(f"{o['LastModified']:%Y-%m-%d %H:%M}  {o['Size']:>12}  {o['Key']}")
    print(f"total {total / 1048576:.1f} MB")


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("upload", "list"):
        sys.exit(__doc__)
    if not os.environ.get("OFFSITE_ENDPOINT"):
        print("off-site backup not configured (no OFFSITE_ENDPOINT) - skipped")
        sys.exit(0)
    upload(sys.argv[2:]) if sys.argv[1] == "upload" else listing()
