"""Event feed — CRUD + SSE stream.

Two responsibilities on this router because they share the `/events` prefix:

- Append-only history of validation and general events (list / create /
  edit-note / admin soft-delete). Rows are never physically deleted and
  status fields are never mutated after insert; only `note` may be edited
  (audit trail preserved via `edited_at`) and admins may set `hidden_at`
  to remove a row from the default feed.
- Server-Sent Events stream at `/events/stream` for live UI updates.
  Clients subscribe once; mutations elsewhere in the API publish topic
  frames through the pubsub broadcaster.
"""

from __future__ import annotations

import asyncio
import datetime
from typing import AsyncIterator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Event, Gateway, Service, Site, User
from pubsub import broadcaster
from schemas import (
    EventBulkIds,
    EventCreateIn,
    EventNotePatch,
    EventOut,
    EventType,
    GENERAL_SUBJECT_KINDS,
    SubjectKind,
    VALIDATION_SUBJECT_KINDS,
)

router = APIRouter(prefix="/events", tags=["events"])

KEEPALIVE_INTERVAL = 20.0


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _enrich(db: Session, v: Event) -> EventOut:
    out = EventOut.model_validate(v)
    if v.validated_by_user_id is not None:
        u = db.get(User, v.validated_by_user_id)
        if u:
            out.validated_by_username = u.username
    if v.subject_id is not None:
        if v.subject_kind == "service":
            svc = db.get(Service, v.subject_id)
            if svc:
                out.subject_name = svc.name
                out.site_id = svc.site_id
                site = db.get(Site, svc.site_id)
                if site:
                    out.site_name = site.name
        elif v.subject_kind == "gateway":
            gw = db.get(Gateway, v.subject_id)
            if gw:
                out.subject_name = gw.name
                out.site_id = gw.site_id
                site = db.get(Site, gw.site_id)
                if site:
                    out.site_name = site.name
        elif v.subject_kind == "service_gateway":
            # subject_id is the service; the gateway lives in second_subject_id
            # so subject_name stays the service, and subject_label carries the
            # "svc via gw" hint that the UI shows as a subtitle.
            svc = db.get(Service, v.subject_id)
            if svc:
                out.subject_name = svc.name
                out.site_id = svc.site_id
                site = db.get(Site, svc.site_id)
                if site:
                    out.site_name = site.name
        elif v.subject_kind in ("site", "site_fpcon", "site_emcon"):
            site = db.get(Site, v.subject_id)
            if site:
                out.subject_name = site.name
                out.site_id = site.id
                out.site_name = site.name
    # For general events, fall back to the free-text label as the display name.
    if out.subject_name is None and v.subject_label:
        out.subject_name = v.subject_label
    return out


def _resolve_subject(db: Session, subject_kind: str, subject_id: int):
    """Return the current row for a validation-kind subject, or raise 404."""
    if subject_kind == "service":
        obj = db.get(Service, subject_id)
    elif subject_kind == "gateway":
        obj = db.get(Gateway, subject_id)
    elif subject_kind in ("site", "site_fpcon", "site_emcon"):
        obj = db.get(Site, subject_id)
    else:
        obj = None
    if obj is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Subject {subject_kind}#{subject_id} not found",
        )
    return obj


@router.get("", response_model=list[EventOut])
def list_events(
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
    site_id: Optional[int] = Query(default=None),
    event_type: Optional[EventType] = Query(default=None),
    subject_kind: Optional[SubjectKind] = Query(default=None),
    subject_id: Optional[int] = Query(default=None),
    second_subject_id: Optional[int] = Query(default=None),
    since: Optional[datetime.datetime] = Query(default=None),
    include_hidden: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=2000),
):
    q = db.query(Event)
    if event_type:
        q = q.filter(Event.event_type == event_type)
    if subject_kind:
        q = q.filter(Event.subject_kind == subject_kind)
    if subject_id:
        q = q.filter(Event.subject_id == subject_id)
    if second_subject_id:
        q = q.filter(Event.second_subject_id == second_subject_id)
    if since:
        q = q.filter(Event.validated_at >= since)
    if not include_hidden:
        q = q.filter(Event.hidden_at.is_(None))
    rows = q.order_by(Event.validated_at.desc()).limit(limit).all()

    enriched = [_enrich(db, v) for v in rows]
    if site_id is not None:
        enriched = [v for v in enriched if v.site_id == site_id]
    return enriched


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    body: EventCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("operator")),
):
    """Manually append an event.

    Two event_type flows:

    - ``validation``: requires ``subject_id`` referencing a live entity
      (service/gateway/site) and a ``status``. Does not change the subject's
      live status; use the subject-specific validate endpoint for that.
    - ``general``: for system/mission/exercise notes. ``subject_label`` is
      free text; ``status`` is optional.
    """
    if body.event_type == "validation":
        if body.subject_kind not in VALIDATION_SUBJECT_KINDS:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"subject_kind '{body.subject_kind}' is not valid for a validation event",
            )
        if body.subject_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "subject_id is required for a validation event",
            )
        if body.status is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "status is required for a validation event",
            )
        _resolve_subject(db, body.subject_kind, body.subject_id)
    else:
        if body.subject_kind not in GENERAL_SUBJECT_KINDS:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"subject_kind '{body.subject_kind}' is not valid for a general event",
            )
        if not body.subject_label and body.subject_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "A subject label or subject_id is required",
            )

    row = Event(
        event_type=body.event_type,
        validated_at=_now(),
        subject_kind=body.subject_kind,
        subject_id=body.subject_id,
        subject_label=body.subject_label,
        prev_status=body.prev_status,
        status=body.status,
        source="manual",
        validated_by_user_id=current_user.id,
        note=body.note,
    )
    db.add(row)
    db.flush()
    return _enrich(db, row)


@router.patch("/{event_id}", response_model=EventOut)
def edit_event_note(
    event_id: int,
    body: EventNotePatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("operator")),
):
    """Edit the note field only. Admins can edit any row; operators only their
    own. Sets `edited_at` so downstream consumers can flag amended entries.
    """
    row = db.get(Event, event_id)
    if row is None or row.hidden_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    if current_user.role != "admin" and row.validated_by_user_id != current_user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the author or an admin can edit this event",
        )
    row.note = body.note
    row.edited_at = _now()
    db.flush()
    return _enrich(db, row)


@router.post("/bulk-hide", response_model=list[EventOut])
def bulk_hide_events(
    body: EventBulkIds,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("admin")),
):
    """Admin-only soft-delete of multiple events. Unhidden rows are unaffected."""
    if not body.ids:
        return []
    rows = db.query(Event).filter(Event.id.in_(body.ids)).all()
    now = _now()
    for row in rows:
        if row.hidden_at is None:
            row.hidden_at = now
            row.hidden_by_user_id = current_user.id
    db.flush()
    return [_enrich(db, r) for r in rows]


@router.post("/{event_id}/unhide", response_model=EventOut)
def unhide_event(
    event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(requires("admin")),
):
    row = db.get(Event, event_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    row.hidden_at = None
    row.hidden_by_user_id = None
    db.flush()
    return _enrich(db, row)


# --- Live-update stream ---


async def _event_stream(request: Request) -> AsyncIterator[bytes]:
    queue = broadcaster.subscribe()
    try:
        yield b"retry: 3000\n\n"
        while True:
            if await request.is_disconnected():
                return
            try:
                topic = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_INTERVAL)
            except asyncio.TimeoutError:
                yield b": keepalive\n\n"
                continue
            yield f"data: {topic}\n\n".encode("utf-8")
    finally:
        broadcaster.unsubscribe(queue)


@router.get("/stream")
async def stream(request: Request, _=Depends(requires("viewer"))) -> StreamingResponse:
    return StreamingResponse(
        _event_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
