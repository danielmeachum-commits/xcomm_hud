"""Event-type catalog CRUD.

The catalog is the vocabulary of declarable event types users pick (or
create inline) when logging events manually: exercise lifecycle
(STARTEX/PAUSEEX/...), briefs, and per-workspace custom types. Global
rows (workspace_id NULL) are the seeded baseline; operators may add
workspace-scoped types, and a workspace slug shadows a global one.
Retiring is a soft-delete so historical events keep resolving.
"""

from __future__ import annotations

import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import EventTypeDef, User, Workspace
from pubsub import notify
from schemas import EventTypeDefIn, EventTypeDefOut, EventTypeDefPatch

router = APIRouter(prefix="/event-types", tags=["event-types"])


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


@router.get("", response_model=list[EventTypeDefOut])
def list_event_types(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
    include_retired: bool = False,
):
    q = db.query(EventTypeDef).filter(
        (EventTypeDef.workspace_id == workspace.id)
        | (EventTypeDef.workspace_id.is_(None))
    )
    if not include_retired:
        q = q.filter(EventTypeDef.retired_at.is_(None))
    rows = q.order_by(EventTypeDef.label).all()
    # A workspace type shadows a global one with the same slug.
    by_slug: dict[str, EventTypeDef] = {}
    for row in rows:
        existing = by_slug.get(row.slug)
        if existing is None or (
            existing.workspace_id is None and row.workspace_id is not None
        ):
            by_slug[row.slug] = row
    return sorted(by_slug.values(), key=lambda r: r.label.lower())


@router.post("", response_model=EventTypeDefOut, status_code=status.HTTP_201_CREATED)
def create_event_type(
    body: EventTypeDefIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    existing = (
        db.query(EventTypeDef)
        .filter(
            EventTypeDef.workspace_id == workspace.id,
            EventTypeDef.slug == body.slug,
            EventTypeDef.retired_at.is_(None),
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Event type '{body.slug}' already exists in this workspace",
        )
    row = EventTypeDef(
        workspace_id=workspace.id,
        created_by_user_id=current_user.id,
        **body.model_dump(),
    )
    db.add(row)
    db.flush()
    notify(background_tasks)
    return row


def _load_editable(
    db: Session, type_id: int, workspace: Workspace, current_user: User
) -> EventTypeDef:
    """Workspace types are editable by operators; globals only by admins."""
    row = db.get(EventTypeDef, type_id)
    if row is None or (
        row.workspace_id is not None and row.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event type not found")
    if row.workspace_id is None and current_user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only admins can modify built-in event types",
        )
    return row


@router.patch("/{type_id}", response_model=EventTypeDefOut)
def patch_event_type(
    type_id: int,
    body: EventTypeDefPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_editable(db, type_id, workspace, current_user)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.flush()
    notify(background_tasks)
    return row


@router.post("/{type_id}/retire", response_model=EventTypeDefOut)
def retire_event_type(
    type_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_editable(db, type_id, workspace, current_user)
    if row.retired_at is None:
        row.retired_at = _now()
        db.flush()
        notify(background_tasks)
    return row


@router.post("/{type_id}/unretire", response_model=EventTypeDefOut)
def unretire_event_type(
    type_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_editable(db, type_id, workspace, current_user)
    if row.retired_at is not None:
        row.retired_at = None
        db.flush()
        notify(background_tasks)
    return row
