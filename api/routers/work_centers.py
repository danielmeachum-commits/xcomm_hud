"""WorkCenter CRUD — physical/functional grouping of personnel per workspace."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import WorkCenter, Workspace
from pubsub import notify
from schemas import WorkCenterIn, WorkCenterOut, WorkCenterPatch

router = APIRouter(prefix="/work-centers", tags=["personnel"])


@router.get("", response_model=list[WorkCenterOut])
def list_work_centers(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    return (
        db.query(WorkCenter)
        .filter(WorkCenter.workspace_id == workspace.id)
        .order_by(WorkCenter.name)
        .all()
    )


@router.post("", response_model=WorkCenterOut, status_code=status.HTTP_201_CREATED)
def create_work_center(
    body: WorkCenterIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    if (
        db.query(WorkCenter)
        .filter(
            WorkCenter.workspace_id == workspace.id, WorkCenter.name == body.name
        )
        .first()
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Work center name already exists"
        )
    wc = WorkCenter(workspace_id=workspace.id, **body.model_dump())
    db.add(wc)
    db.flush()
    notify(background_tasks)
    return wc


def _load(db: Session, wc_id: int, workspace: Workspace) -> WorkCenter:
    wc = db.get(WorkCenter, wc_id)
    if wc is None or wc.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work center not found")
    return wc


@router.patch("/{wc_id}", response_model=WorkCenterOut)
def patch_work_center(
    wc_id: int,
    body: WorkCenterPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    wc = _load(db, wc_id, workspace)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] != wc.name:
        clash = (
            db.query(WorkCenter)
            .filter(
                WorkCenter.workspace_id == workspace.id,
                WorkCenter.name == data["name"],
                WorkCenter.id != wc.id,
            )
            .first()
        )
        if clash:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Work center name already exists"
            )
    for k, v in data.items():
        setattr(wc, k, v)
    db.flush()
    notify(background_tasks)
    return wc


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
