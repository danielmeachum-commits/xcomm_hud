"""Workspace CRUD, duplication, export/import, and current-selection endpoints.

A workspace holds one full operating picture (sites, services, gateways,
canvas positions, canvas annotations). Users switch between workspaces to
plan upcoming exercises or look back at past missions without disturbing the
current baseline.
"""

from __future__ import annotations

import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user
from db import get_db
from deps import requires
from models import (
    CanvasAnnotation,
    Gateway,
    Service,
    ServiceTemplate,
    Site,
    SiteCanvasPosition,
    User,
    Workspace,
)
from pubsub import notify
from workspace_slug import unique_workspace_slug
from schemas import (
    ExportedAnnotation,
    ExportedGateway,
    ExportedPosition,
    ExportedService,
    ExportedSite,
    ExportedWorkspaceMeta,
    WorkspaceDuplicateIn,
    WorkspaceExport,
    WorkspaceImportIn,
    WorkspaceIn,
    WorkspaceOut,
    WorkspacePatch,
    WorkspaceSelectIn,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    return db.query(Workspace).order_by(Workspace.name).all()


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(
    body: WorkspaceIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    if db.query(Workspace).filter(Workspace.name == body.name).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Workspace name already exists")
    ws = Workspace(
        name=body.name,
        slug=unique_workspace_slug(db, body.name),
        description=body.description,
        tags=list(body.tags),
    )
    db.add(ws)
    db.flush()
    notify(background_tasks)
    return ws


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
def patch_workspace(
    workspace_id: int,
    body: WorkspacePatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    ws = db.get(Workspace, workspace_id)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] != ws.name:
        clash = (
            db.query(Workspace)
            .filter(Workspace.name == data["name"], Workspace.id != ws.id)
            .first()
        )
        if clash:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Workspace name already exists"
            )
    for k, v in data.items():
        setattr(ws, k, v)
    db.flush()
    notify(background_tasks)
    return ws


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(
    workspace_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    ws = db.get(Workspace, workspace_id)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    if ws.is_default:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot delete the default workspace",
        )
    db.delete(ws)
    notify(background_tasks)


@router.post(
    "/{workspace_id}/duplicate",
    response_model=WorkspaceOut,
    status_code=status.HTTP_201_CREATED,
)
def duplicate_workspace(
    workspace_id: int,
    body: WorkspaceDuplicateIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    """Copy sites, services, gateways, canvas positions, and annotations into a
    new workspace. Statuses reset to model defaults so the duplicate starts
    from a clean posture. Events are NOT copied — the new workspace has its
    own audit trail.
    """
    source = db.get(Workspace, workspace_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source workspace not found")
    if db.query(Workspace).filter(Workspace.name == body.name).first():
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Workspace name already exists"
        )

    dest = Workspace(
        name=body.name,
        slug=unique_workspace_slug(db, body.name),
        description=body.description,
        tags=list(body.tags),
    )
    db.add(dest)
    db.flush()

    site_id_map: dict[int, int] = {}
    for site in db.query(Site).filter(Site.workspace_id == source.id).all():
        new_site = Site(
            workspace_id=dest.id,
            name=site.name,
            location_label=site.location_label,
            # Reset posture — statuses fall back to model defaults.
            show_fpcon=site.show_fpcon,
            show_emcon=site.show_emcon,
            lat=site.lat,
            lon=site.lon,
            notes=site.notes,
        )
        db.add(new_site)
        db.flush()
        site_id_map[site.id] = new_site.id

    if site_id_map:
        for svc in (
            db.query(Service).filter(Service.site_id.in_(site_id_map.keys())).all()
        ):
            db.add(
                Service(
                    site_id=site_id_map[svc.site_id],
                    service_template_id=svc.service_template_id,
                    name=svc.name,
                    kind=svc.kind,
                    category=svc.category,
                    reach=svc.reach,
                    icon=svc.icon,
                    description=svc.description,
                    # status left as default ("unknown"); no validated_* fields.
                    display_order=svc.display_order,
                    notes=svc.notes,
                    enabled_pace=list(svc.enabled_pace),
                )
            )

        for gw in (
            db.query(Gateway).filter(Gateway.site_id.in_(site_id_map.keys())).all()
        ):
            db.add(
                Gateway(
                    site_id=site_id_map[gw.site_id],
                    name=gw.name,
                    kind=gw.kind,
                    provider=gw.provider,
                    pace=gw.pace,
                    # status left as default ("unknown"); no validated_* fields.
                    display_order=gw.display_order,
                    notes=gw.notes,
                )
            )

        for pos in (
            db.query(SiteCanvasPosition)
            .filter(SiteCanvasPosition.site_id.in_(site_id_map.keys()))
            .all()
        ):
            db.add(
                SiteCanvasPosition(
                    site_id=site_id_map[pos.site_id],
                    x=pos.x,
                    y=pos.y,
                )
            )

    for ann in (
        db.query(CanvasAnnotation)
        .filter(CanvasAnnotation.workspace_id == source.id)
        .all()
    ):
        db.add(
            CanvasAnnotation(
                workspace_id=dest.id,
                text=ann.text,
                x=ann.x,
                y=ann.y,
            )
        )

    db.flush()
    notify(background_tasks)
    return dest


@router.get("/{workspace_id}/export", response_model=WorkspaceExport)
def export_workspace(
    workspace_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    """Serialize a workspace into a portable, ID-free JSON envelope.

    Children reference their parent site by name (unique per workspace).
    Services reference their template by name so imports can rebind them
    against the target instance's catalog. Statuses, IDs, timestamps, and
    validated_by user links are intentionally omitted — this is structural.
    """
    ws = db.get(Workspace, workspace_id)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")

    sites = (
        db.query(Site)
        .filter(Site.workspace_id == ws.id)
        .order_by(Site.name)
        .all()
    )
    site_name_by_id = {s.id: s.name for s in sites}
    site_ids = list(site_name_by_id.keys())

    services = (
        db.query(Service).filter(Service.site_id.in_(site_ids)).all()
        if site_ids
        else []
    )
    gateways = (
        db.query(Gateway).filter(Gateway.site_id.in_(site_ids)).all()
        if site_ids
        else []
    )
    positions = (
        db.query(SiteCanvasPosition)
        .filter(SiteCanvasPosition.site_id.in_(site_ids))
        .all()
        if site_ids
        else []
    )
    annotations = (
        db.query(CanvasAnnotation)
        .filter(CanvasAnnotation.workspace_id == ws.id)
        .order_by(CanvasAnnotation.id)
        .all()
    )

    template_name_by_id: dict[int, str] = {}
    template_ids = {s.service_template_id for s in services if s.service_template_id}
    if template_ids:
        for tpl in (
            db.query(ServiceTemplate)
            .filter(ServiceTemplate.id.in_(template_ids))
            .all()
        ):
            template_name_by_id[tpl.id] = tpl.name

    return WorkspaceExport(
        exported_at=datetime.datetime.now(datetime.timezone.utc),
        workspace=ExportedWorkspaceMeta(
            name=ws.name,
            description=ws.description,
            tags=list(ws.tags),
        ),
        sites=[
            ExportedSite(
                name=s.name,
                location_label=s.location_label,
                fpcon=s.fpcon,
                emcon=s.emcon,
                show_fpcon=s.show_fpcon,
                show_emcon=s.show_emcon,
                lat=s.lat,
                lon=s.lon,
                notes=s.notes,
            )
            for s in sites
        ],
        services=[
            ExportedService(
                site_name=site_name_by_id[svc.site_id],
                service_template_name=(
                    template_name_by_id.get(svc.service_template_id)
                    if svc.service_template_id
                    else None
                ),
                name=svc.name,
                kind=svc.kind,
                category=svc.category,
                reach=svc.reach,
                icon=svc.icon,
                description=svc.description,
                display_order=svc.display_order,
                notes=svc.notes,
                enabled_pace=list(svc.enabled_pace),
            )
            for svc in services
        ],
        gateways=[
            ExportedGateway(
                site_name=site_name_by_id[gw.site_id],
                name=gw.name,
                kind=gw.kind,
                provider=gw.provider,
                pace=gw.pace,
                display_order=gw.display_order,
                notes=gw.notes,
            )
            for gw in gateways
        ],
        positions=[
            ExportedPosition(
                site_name=site_name_by_id[pos.site_id],
                x=pos.x,
                y=pos.y,
            )
            for pos in positions
        ],
        annotations=[
            ExportedAnnotation(text=a.text, x=a.x, y=a.y) for a in annotations
        ],
    )


@router.post(
    "/import",
    response_model=WorkspaceOut,
    status_code=status.HTTP_201_CREATED,
)
def import_workspace(
    body: WorkspaceImportIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    """Create a new workspace from an exported envelope.

    Statuses reset to model defaults (matching the duplicate flow — imports
    are structural, not stateful). Service templates are rebound by name; if
    a name doesn't match a local catalog entry, the service is created
    without a template link.
    """
    payload = body.payload
    target_name = (body.name_override or payload.workspace.name).strip()
    if not target_name:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Workspace name is required"
        )
    if db.query(Workspace).filter(Workspace.name == target_name).first():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Workspace '{target_name}' already exists",
        )

    exported_site_names = {s.name for s in payload.sites}
    if len(exported_site_names) != len(payload.sites):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Duplicate site names in export",
        )
    for child, kind in (
        *[(s, "service") for s in payload.services],
        *[(g, "gateway") for g in payload.gateways],
        *[(p, "position") for p in payload.positions],
    ):
        if child.site_name not in exported_site_names:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"{kind} references unknown site '{child.site_name}'",
            )

    ws = Workspace(
        name=target_name,
        slug=unique_workspace_slug(db, target_name),
        description=payload.workspace.description,
        tags=list(payload.workspace.tags),
    )
    db.add(ws)
    db.flush()

    site_id_by_name: dict[str, int] = {}
    for s in payload.sites:
        new_site = Site(
            workspace_id=ws.id,
            name=s.name,
            location_label=s.location_label,
            # status left as model default; imports are structural.
            fpcon=s.fpcon,
            emcon=s.emcon,
            show_fpcon=s.show_fpcon,
            show_emcon=s.show_emcon,
            lat=s.lat,
            lon=s.lon,
            notes=s.notes,
        )
        db.add(new_site)
        db.flush()
        site_id_by_name[s.name] = new_site.id

    template_id_by_name: dict[str, int] = {}
    referenced = {
        svc.service_template_name
        for svc in payload.services
        if svc.service_template_name
    }
    if referenced:
        for tpl in (
            db.query(ServiceTemplate)
            .filter(ServiceTemplate.name.in_(referenced))
            .all()
        ):
            template_id_by_name[tpl.name] = tpl.id

    for svc in payload.services:
        db.add(
            Service(
                site_id=site_id_by_name[svc.site_name],
                service_template_id=(
                    template_id_by_name.get(svc.service_template_name)
                    if svc.service_template_name
                    else None
                ),
                name=svc.name,
                kind=svc.kind,
                category=svc.category,
                reach=svc.reach,
                icon=svc.icon,
                description=svc.description,
                display_order=svc.display_order,
                notes=svc.notes,
                enabled_pace=list(svc.enabled_pace),
            )
        )

    for gw in payload.gateways:
        db.add(
            Gateway(
                site_id=site_id_by_name[gw.site_name],
                name=gw.name,
                kind=gw.kind,
                provider=gw.provider,
                pace=gw.pace,
                display_order=gw.display_order,
                notes=gw.notes,
            )
        )

    for pos in payload.positions:
        db.add(
            SiteCanvasPosition(
                site_id=site_id_by_name[pos.site_name],
                x=pos.x,
                y=pos.y,
            )
        )

    for ann in payload.annotations:
        db.add(
            CanvasAnnotation(
                workspace_id=ws.id,
                text=ann.text,
                x=ann.x,
                y=ann.y,
            )
        )

    db.flush()
    notify(background_tasks)
    return ws


me_router = APIRouter(prefix="/me", tags=["me"])


@me_router.post("/workspace", response_model=WorkspaceOut)
def select_workspace(
    body: WorkspaceSelectIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ws = db.get(Workspace, body.workspace_id)
    if ws is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    # `current_user` was loaded via a short-lived session in get_current_user
    # and is detached from `db`. Re-fetch through the shared session so the
    # UPDATE actually gets committed by the request-scoped get_db teardown.
    user_row = db.get(User, current_user.id)
    if user_row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    user_row.current_workspace_id = ws.id
    db.flush()
    notify(background_tasks)
    return ws
