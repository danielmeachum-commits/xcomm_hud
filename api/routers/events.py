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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Event, Gateway, Personnel, Service, ServiceGatewayStatus, Site, User
from pubsub import broadcaster, notify
from schemas import (
    EventBulkIds,
    EventCreateIn,
    EventEditIn,
    EventNotePatch,
    EventOut,
    EventType,
    GENERAL_SUBJECT_KINDS,
    PERSONNEL_SUBJECT_KINDS,
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
        elif v.subject_kind in ("site", "site_fpcon", "site_emcon", "site_status"):
            site = db.get(Site, v.subject_id)
            if site:
                out.subject_name = site.name
                out.site_id = site.id
                out.site_name = site.name
        elif v.subject_kind == "personnel_location":
            # subject_id is the personnel row; second_subject_id (when set)
            # is the site they signed into. Fill site_name off that so the
            # events table's site column stays useful.
            p = db.get(Personnel, v.subject_id)
            if p:
                out.subject_name = f"{p.last_name}, {p.first_name}"
            if v.second_subject_id is not None:
                site = db.get(Site, v.second_subject_id)
                if site:
                    out.site_id = site.id
                    out.site_name = site.name
    # For general events, fall back to the free-text label as the display name.
    if out.subject_name is None and v.subject_label:
        out.subject_name = v.subject_label
    return out


def _resolve_subject(db: Session, subject_kind: str, subject_id: int):
    """Return the current row for a validation- or personnel-kind subject, or raise 404."""
    if subject_kind == "service":
        obj = db.get(Service, subject_id)
    elif subject_kind == "gateway":
        obj = db.get(Gateway, subject_id)
    elif subject_kind in ("site", "site_fpcon", "site_emcon"):
        obj = db.get(Site, subject_id)
    elif subject_kind == "personnel_location":
        obj = db.get(Personnel, subject_id)
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

    Three event_type flows:

    - ``validation``: requires ``subject_id`` referencing a live entity
      (service/gateway/site) and a ``status``. Does not change the subject's
      live status; use the subject-specific validate endpoint for that.
    - ``personnel``: requires ``subject_id`` referencing a personnel row and
      a ``status``. Normally written by the personnel check-in/out flow, not
      through this endpoint.
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
    elif body.event_type == "personnel":
        if body.subject_kind not in PERSONNEL_SUBJECT_KINDS:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"subject_kind '{body.subject_kind}' is not valid for a personnel event",
            )
        if body.subject_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "subject_id is required for a personnel event",
            )
        if body.status is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "status is required for a personnel event",
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
def edit_event(
    event_id: int,
    body: EventEditIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("operator")),
):
    """Edit note, status, and/or validated_at on an event.

    Admins can edit any row; operators only their own. Sets `edited_at` for
    audit. If status or validated_at is changed *and* this event is the most
    recent non-hidden validation for its subject, the subject's live status
    and validated_at are updated to match.
    """
    row = db.get(Event, event_id)
    if row is None or row.hidden_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    if current_user.role != "admin" and row.validated_by_user_id != current_user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the author or an admin can edit this event",
        )

    mutated_status = body.status is not None and body.status != row.status
    mutated_ts = body.validated_at is not None and body.validated_at != row.validated_at

    row.note = body.note
    if body.status is not None:
        row.status = body.status
    if body.validated_at is not None:
        row.validated_at = body.validated_at
    row.edited_at = _now()
    db.flush()

    # Propagate status/timestamp change to the live subject if this was the
    # most recent validation. Only applies to validation-kind events that
    # reference a known subject.
    if (mutated_status or mutated_ts) and row.event_type == "validation":
        _maybe_update_subject(db, row, background_tasks)

    return _enrich(db, row)


@router.post("/{event_id}/revert", response_model=EventOut)
def revert_event(
    event_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("operator")),
):
    """Hide the event and restore the subject to its previous status.

    Only permitted when this event is the most recent non-hidden validation
    for its subject (reverting older events would leave the subject in an
    inconsistent state). Admins may revert any event; operators only their own.
    """
    row = db.get(Event, event_id)
    if row is None or row.hidden_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    if current_user.role != "admin" and row.validated_by_user_id != current_user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the author or an admin can revert this event",
        )
    if (
        row.subject_kind not in VALIDATION_SUBJECT_KINDS
        and row.subject_kind not in PERSONNEL_SUBJECT_KINDS
    ) or row.subject_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Only validation events with a known subject can be reverted",
        )

    # Confirm this is the most recent non-hidden event of this type for this subject.
    q = (
        db.query(Event)
        .filter(
            Event.subject_kind == row.subject_kind,
            Event.subject_id == row.subject_id,
            Event.event_type == row.event_type,
            Event.hidden_at.is_(None),
        )
    )
    if row.second_subject_id is not None:
        q = q.filter(Event.second_subject_id == row.second_subject_id)
    latest = q.order_by(Event.validated_at.desc()).first()
    if latest is None or latest.id != row.id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only the most recent validation can be reverted",
        )

    row.hidden_at = _now()
    row.hidden_by_user_id = current_user.id
    db.flush()

    # Restore subject status to prev_status, falling back to "unknown".
    restore_status = row.prev_status or "unknown"
    # Find the previous event's timestamp to use as the restored validated_at.
    prev_event = (
        db.query(Event)
        .filter(
            Event.subject_kind == row.subject_kind,
            Event.subject_id == row.subject_id,
            Event.event_type == row.event_type,
            Event.hidden_at.is_(None),
            Event.id != row.id,
        )
    )
    if row.second_subject_id is not None:
        prev_event = prev_event.filter(Event.second_subject_id == row.second_subject_id)
    prev_row = prev_event.order_by(Event.validated_at.desc()).first()
    restore_ts = prev_row.validated_at if prev_row else None

    _apply_subject_status(db, row, restore_status, restore_ts, current_user.id, background_tasks)
    return _enrich(db, row)


def _is_most_recent_for_subject(db: Session, row: Event) -> bool:
    """True when `row` is the latest non-hidden event of its type for its subject."""
    q = (
        db.query(Event)
        .filter(
            Event.subject_kind == row.subject_kind,
            Event.subject_id == row.subject_id,
            Event.event_type == row.event_type,
            Event.hidden_at.is_(None),
        )
    )
    if row.second_subject_id is not None:
        q = q.filter(Event.second_subject_id == row.second_subject_id)
    latest = q.order_by(Event.validated_at.desc()).first()
    return latest is not None and latest.id == row.id


def _maybe_update_subject(
    db: Session, row: Event, background_tasks: BackgroundTasks
) -> None:
    """If `row` is the current validation for its subject, propagate changes."""
    if not _is_most_recent_for_subject(db, row):
        return
    if row.status is None:
        return
    _apply_subject_status(db, row, row.status, row.validated_at, row.validated_by_user_id, background_tasks)


def _apply_subject_status(
    db: Session,
    row: Event,
    new_status: str,
    new_ts,
    user_id,
    background_tasks: BackgroundTasks,
) -> None:
    """Write `new_status`/`new_ts` back to the live subject row."""
    if row.subject_kind == "service":
        svc = db.get(Service, row.subject_id)
        if svc:
            svc.status = new_status
            svc.validated_at = new_ts
            svc.validated_by_user_id = user_id
            db.flush()
            notify(background_tasks)
    elif row.subject_kind == "gateway":
        gw = db.get(Gateway, row.subject_id)
        if gw:
            gw.status = new_status
            gw.validated_at = new_ts
            gw.validated_by_user_id = user_id
            db.flush()
            notify(background_tasks)
    elif row.subject_kind == "service_gateway" and row.second_subject_id is not None:
        cell = (
            db.query(ServiceGatewayStatus)
            .filter(
                ServiceGatewayStatus.service_id == row.subject_id,
                ServiceGatewayStatus.gateway_id == row.second_subject_id,
            )
            .one_or_none()
        )
        if cell:
            cell.status = new_status
            cell.validated_at = new_ts
            cell.validated_by_user_id = user_id
            db.flush()
            notify(background_tasks)


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
