"""Folder tree CRUD for the document library.

Folders are returned as flat lists scoped by workspace + site; the UI
assembles the tree from `parent_id`. Deleting a folder cascades to its
subfolders while documents inside survive (folder_id SET NULL).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import Folder, Workspace
from pubsub import notify
from schemas import FolderIn, FolderOut, FolderPatch

router = APIRouter(prefix="/folders", tags=["folders"])


def _load_folder_in_workspace(
    db: Session, folder_id: int, workspace: Workspace
) -> Folder:
    folder = db.get(Folder, folder_id)
    if folder is None or folder.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    return folder


@router.get("", response_model=list[FolderOut])
def list_folders(
    site_id: Optional[int] = None,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    q = db.query(Folder).filter(Folder.workspace_id == workspace.id)
    if site_id is None:
        q = q.filter(Folder.site_id.is_(None))
    else:
        q = q.filter(Folder.site_id == site_id)
    return q.order_by(Folder.name).all()


@router.post("", response_model=FolderOut, status_code=status.HTTP_201_CREATED)
def create_folder(
    body: FolderIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    if body.parent_id is not None:
        _load_folder_in_workspace(db, body.parent_id, workspace)
    folder = Folder(workspace_id=workspace.id, **body.model_dump())
    db.add(folder)
    db.flush()
    notify(background_tasks)
    return folder


@router.patch("/{folder_id}", response_model=FolderOut)
def patch_folder(
    folder_id: int,
    body: FolderPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    folder = _load_folder_in_workspace(db, folder_id, workspace)
    updates = body.model_dump(exclude_unset=True)
    if updates.get("parent_id") is not None:
        if updates["parent_id"] == folder.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Folder cannot be its own parent",
            )
        _load_folder_in_workspace(db, updates["parent_id"], workspace)
    for k, v in updates.items():
        setattr(folder, k, v)
    db.flush()
    notify(background_tasks)
    return folder


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_folder(
    folder_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    folder = _load_folder_in_workspace(db, folder_id, workspace)
    db.delete(folder)
    notify(background_tasks)
