"""Unit CRUD — military organization (squadron/wing/...) per workspace.

Units can nest via `parent_unit_id`. Delete SET NULLs children up so the
sub-tree gets promoted rather than lost — safer default than cascade.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import Unit, Workspace
from pubsub import notify
from schemas import UnitIn, UnitOut, UnitPatch

router = APIRouter(prefix="/units", tags=["personnel"])


@router.get("", response_model=list[UnitOut])
def list_units(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    return (
        db.query(Unit)
        .filter(Unit.workspace_id == workspace.id)
        .order_by(Unit.name)
        .all()
    )


def _load(db: Session, unit_id: int, workspace: Workspace) -> Unit:
    u = db.get(Unit, unit_id)
    if u is None or u.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unit not found")
    return u


def _validate_parent(
    db: Session,
    workspace: Workspace,
    parent_unit_id: int | None,
    self_id: int | None,
) -> None:
    if parent_unit_id is None:
        return
    parent = db.get(Unit, parent_unit_id)
    if parent is None or parent.workspace_id != workspace.id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Parent unit not found"
        )
    # Walk up to make sure setting this parent doesn't create a cycle.
    cursor: Unit | None = parent
    depth = 0
    while cursor is not None:
        if self_id is not None and cursor.id == self_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Parent chain would create a cycle",
            )
        depth += 1
        if depth > 32:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Parent chain too deep",
            )
        cursor = (
            db.get(Unit, cursor.parent_unit_id)
            if cursor.parent_unit_id
            else None
        )


def _clear_other_defaults(db: Session, workspace: Workspace, keep_id: int | None) -> None:
    """Making a unit the default clears the flag everywhere else — at most one
    default per workspace (also enforced by a partial unique index)."""
    q = db.query(Unit).filter(
        Unit.workspace_id == workspace.id, Unit.is_default.is_(True)
    )
    if keep_id is not None:
        q = q.filter(Unit.id != keep_id)
    q.update({"is_default": False}, synchronize_session="fetch")


@router.post("", response_model=UnitOut, status_code=status.HTTP_201_CREATED)
def create_unit(
    body: UnitIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    if (
        db.query(Unit)
        .filter(Unit.workspace_id == workspace.id, Unit.name == body.name)
        .first()
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Unit name already exists")
    _validate_parent(db, workspace, body.parent_unit_id, self_id=None)
    if body.is_default:
        _clear_other_defaults(db, workspace, keep_id=None)
    unit = Unit(workspace_id=workspace.id, **body.model_dump())
    db.add(unit)
    db.flush()
    notify(background_tasks)
    return unit


@router.patch("/{unit_id}", response_model=UnitOut)
def patch_unit(
    unit_id: int,
    body: UnitPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    unit = _load(db, unit_id, workspace)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] != unit.name:
        clash = (
            db.query(Unit)
            .filter(
                Unit.workspace_id == workspace.id,
                Unit.name == data["name"],
                Unit.id != unit.id,
            )
            .first()
        )
        if clash:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Unit name already exists"
            )
    if "parent_unit_id" in data:
        _validate_parent(db, workspace, data["parent_unit_id"], self_id=unit.id)
    if data.get("is_default"):
        _clear_other_defaults(db, workspace, keep_id=unit.id)
    for k, v in data.items():
        setattr(unit, k, v)
    db.flush()
    notify(background_tasks)
    return unit


@router.delete("/{unit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_unit(
    unit_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    unit = _load(db, unit_id, workspace)
    db.delete(unit)
    notify(background_tasks)
