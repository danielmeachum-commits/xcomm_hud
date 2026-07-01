"""Site CRUD. Status is a manually-set posture — no automatic rollup."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import Event, Site, User, Workspace
from pubsub import notify
from schemas import (
    SiteEmconIn,
    SiteFpconIn,
    SiteIn,
    SiteOut,
    SitePatch,
    SiteStatusIn,
)

router = APIRouter(prefix="/sites", tags=["sites"])


@router.get("", response_model=list[SiteOut])
def list_sites(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    return (
        db.query(Site)
        .filter(Site.workspace_id == workspace.id)
        .order_by(Site.name)
        .all()
    )


@router.post("", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
def create_site(
    body: SiteIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    if (
        db.query(Site)
        .filter(Site.workspace_id == workspace.id, Site.name == body.name)
        .first()
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Site name already exists")
    site = Site(workspace_id=workspace.id, **body.model_dump())
    db.add(site)
    db.flush()
    notify(background_tasks)
    return site


@router.get("/{site_id}", response_model=SiteOut)
def get_site(
    site_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    site = db.get(Site, site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    return site


def _load_site_in_workspace(db: Session, site_id: int, workspace: Workspace) -> Site:
    site = db.get(Site, site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    return site


@router.patch("/{site_id}", response_model=SiteOut)
def patch_site(
    site_id: int,
    body: SitePatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    site = _load_site_in_workspace(db, site_id, workspace)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(site, k, v)
    db.flush()
    notify(background_tasks)
    return site


@router.post("/{site_id}/status", response_model=SiteOut)
def set_site_status(
    site_id: int,
    body: SiteStatusIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Change a site's posture status and append an event row."""
    site = _load_site_in_workspace(db, site_id, workspace)
    kwargs = dict(
        subject_kind="site_status",
        subject_id=site.id,
        prev_status=site.status,
        status=body.status,
        source="manual",
        validated_by_user_id=current_user.id,
        note=body.note,
    )
    if body.validated_at is not None:
        kwargs["validated_at"] = body.validated_at
    db.add(Event(**kwargs))
    site.status = body.status
    db.flush()
    notify(background_tasks)
    return site


@router.post("/{site_id}/fpcon", response_model=SiteOut)
def set_site_fpcon(
    site_id: int,
    body: SiteFpconIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Change a site's FPCON level and append a validation row to the event log."""
    site = _load_site_in_workspace(db, site_id, workspace)
    kwargs = dict(
        subject_kind="site_fpcon",
        subject_id=site.id,
        prev_status=site.fpcon,
        status=body.level,
        source="manual",
        validated_by_user_id=current_user.id,
        note=body.note,
    )
    if body.validated_at is not None:
        kwargs["validated_at"] = body.validated_at
    db.add(Event(**kwargs))
    site.fpcon = body.level
    db.flush()
    notify(background_tasks)
    return site


@router.post("/{site_id}/emcon", response_model=SiteOut)
def set_site_emcon(
    site_id: int,
    body: SiteEmconIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Change a site's EMCON level and append a validation row to the event log."""
    site = _load_site_in_workspace(db, site_id, workspace)
    kwargs = dict(
        subject_kind="site_emcon",
        subject_id=site.id,
        prev_status=site.emcon,
        status=body.level,
        source="manual",
        validated_by_user_id=current_user.id,
        note=body.note,
    )
    if body.validated_at is not None:
        kwargs["validated_at"] = body.validated_at
    db.add(Event(**kwargs))
    site.emcon = body.level
    db.flush()
    notify(background_tasks)
    return site


@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(
    site_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    site = _load_site_in_workspace(db, site_id, workspace)
    db.delete(site)
    notify(background_tasks)
