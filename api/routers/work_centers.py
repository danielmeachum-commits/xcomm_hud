"""Work centers: the shops personnel work in and gear is owned by.

Same global-vs-workspace shape as enclaves: `workspace_id IS NULL` is a
shared, admin-managed shop (seeded in 0066), a non-null workspace_id is a
local addition. Reads merge both; writing a global row needs `admin`.

A local shop may not reuse a global shop's name. MANFOR lines name their shop
by string, and two visible rows answering to "RF" would leave that ambiguous.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import User, WorkCenter, Workspace
from pubsub import notify
from schemas import WorkCenterIn, WorkCenterOut, WorkCenterPatch

router = APIRouter(prefix="/work-centers", tags=["personnel"])


def visible_to(workspace: Workspace):
    """Global shops plus this workspace's own — the filter every reader uses."""
    return (WorkCenter.workspace_id.is_(None)) | (
        WorkCenter.workspace_id == workspace.id
    )


def load_visible(db: Session, wc_id: int, workspace: Workspace) -> WorkCenter | None:
    wc = db.get(WorkCenter, wc_id)
    if wc is None or (
        wc.workspace_id is not None and wc.workspace_id != workspace.id
    ):
        return None
    return wc


def _out(row: WorkCenter) -> WorkCenterOut:
    out = WorkCenterOut.model_validate(row)
    out.is_global = row.workspace_id is None
    return out


def _require_write(row_workspace_id: int | None, user: User) -> None:
    if row_workspace_id is None and user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Editing a global work center requires admin",
        )


def _check_name(
    db: Session,
    workspace: Workspace,
    name: str,
    owner_id: int | None,
    self_id: int | None = None,
) -> None:
    """Reject a name that is already visible from where the row will live.

    A global row is visible from every workspace, so it clashes with any row
    of that name anywhere; a local row clashes with globals and its siblings.
    """
    q = db.query(WorkCenter).filter(func.lower(WorkCenter.name) == name.lower())
    if owner_id is not None:
        q = q.filter(visible_to(workspace))
    if self_id is not None:
        q = q.filter(WorkCenter.id != self_id)
    if q.first():
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Work center name already exists"
        )


@router.get("", response_model=list[WorkCenterOut])
def list_work_centers(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    rows = (
        db.query(WorkCenter)
        .filter(visible_to(workspace))
        .order_by(WorkCenter.name)
        .all()
    )
    return [_out(r) for r in rows]


@router.post("", response_model=WorkCenterOut, status_code=status.HTTP_201_CREATED)
def create_work_center(
    body: WorkCenterIn,
    background_tasks: BackgroundTasks,
    # `global` here means "add to the shared list" — admins only.
    make_global: bool = Query(default=False, alias="global"),
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    owner_id = None if make_global else workspace.id
    _require_write(owner_id, current_user)
    _check_name(db, workspace, body.name, owner_id)
    wc = WorkCenter(workspace_id=owner_id, **body.model_dump())
    db.add(wc)
    db.flush()
    notify(background_tasks)
    return _out(wc)


def _load(db: Session, wc_id: int, workspace: Workspace) -> WorkCenter:
    wc = load_visible(db, wc_id, workspace)
    if wc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work center not found")
    return wc


@router.patch("/{wc_id}", response_model=WorkCenterOut)
def patch_work_center(
    wc_id: int,
    body: WorkCenterPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    wc = _load(db, wc_id, workspace)
    _require_write(wc.workspace_id, current_user)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] != wc.name:
        _check_name(db, workspace, data["name"], wc.workspace_id, self_id=wc.id)
    for k, v in data.items():
        setattr(wc, k, v)
    db.flush()
    notify(background_tasks)
    return _out(wc)


@router.delete("/{wc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_work_center(
    wc_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    wc = _load(db, wc_id, workspace)
    db.delete(wc)
    notify(background_tasks)
