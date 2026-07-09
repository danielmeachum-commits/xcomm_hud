"""S3-compatible object storage for document files (MinIO in dev).

Thin boto3 wrapper: config from env vars (mirrors db.py), a lazily built
client, and `ensure_bucket()` run once on first use so dev instances
don't need a separate bucket-init step.
"""

from __future__ import annotations

import os

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

S3_ENDPOINT_URL = os.environ.get("S3_ENDPOINT_URL")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY")
S3_BUCKET = os.environ.get("S3_BUCKET", "xcomm-hud")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")

_client = None
_bucket_ready = False


def _get_client():
    """Build the boto3 client once, on first use."""
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT_URL,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            region_name=S3_REGION,
            config=Config(signature_version="s3v4"),
        )
    return _client


def ensure_bucket() -> None:
    """Create the bucket if it doesn't exist yet (idempotent, cached)."""
    global _bucket_ready
    if _bucket_ready:
        return
    client = _get_client()
    try:
        client.head_bucket(Bucket=S3_BUCKET)
    except ClientError:
        try:
            client.create_bucket(Bucket=S3_BUCKET)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                raise
    _bucket_ready = True


def put_stream(key: str, fileobj, content_type: str, length: int) -> None:
    """Upload a file-like object to `key`."""
    ensure_bucket()
    _get_client().put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=fileobj,
        ContentType=content_type,
        ContentLength=length,
    )


def open_stream(key: str):
    """Return the object's streaming body (iterate with .iter_chunks())."""
    ensure_bucket()
    return _get_client().get_object(Bucket=S3_BUCKET, Key=key)["Body"]


def delete(key: str) -> None:
    """Delete the object at `key`."""
    ensure_bucket()
    _get_client().delete_object(Bucket=S3_BUCKET, Key=key)
