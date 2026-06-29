"""Stub ingest endpoint for future scoi enclave pushes.

Validates X-Ingest-Token against any EnclaveSource.ingest_token_hash via argon2,
updates last_contact_at + sync_status, logs the payload, and returns 202.

TODO: write-through to equipment/services + emit status_event rows with
source="ingest" once scoi-side push is wired up.
"""

from __future__ import annotations

import logging

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from models import EnclaveSource
from rollup import worst_of  # noqa: F401  (kept here so future write-through is local)
from schemas import IngestAck, IngestPayload

log = logging.getLogger("xcomm_hud.ingest")
_ph = PasswordHasher()

router = APIRouter(tags=["ingest"])


def _verify_token(db: Session, token: str) -> EnclaveSource:
    for src in db.query(EnclaveSource).all():
        if not src.ingest_token_hash:
            continue
        try:
            _ph.verify(src.ingest_token_hash, token)
            return src
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            continue
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid ingest token")


@router.post("/ingest", response_model=IngestAck, status_code=status.HTTP_202_ACCEPTED)
def ingest(
    body: IngestPayload,
    db: Session = Depends(get_db),
    x_ingest_token: str = Header(default=""),
):
    if not x_ingest_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing X-Ingest-Token")
    src = _verify_token(db, x_ingest_token)

    import datetime as _dt

    src.last_contact_at = _dt.datetime.now(_dt.timezone.utc)
    src.sync_status = "ok"

    log.info(
        "ingest accepted",
        extra={
            "enclave_source": src.name,
            "claimed_source_name": body.source_name,
            "equipment_count": len(body.equipment),
            "service_count": len(body.services),
            "ts": body.ts.isoformat(),
        },
    )
    # TODO: write-through to equipment/services + status_event(source="ingest").
    return IngestAck(accepted=True, enclave_source_id=src.id)
