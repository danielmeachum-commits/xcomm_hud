"""Canvas state for the React Flow map: site positions + annotations."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import case as sql_case
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from effective import effective_service_status
from models import (
    CanvasAnnotation,
    Gateway,
    Service,
    ServiceGatewayStatus,
    ServiceTemplate,
    Site,
    SiteCanvasPosition,
    User,
    Workspace,
)
from pubsub import notify
from schemas import (
    CanvasAnnotationIn,
    CanvasAnnotationOut,
    CanvasAnnotationPatch,
    CanvasPositionIn,
    CanvasPositionOut,
    GatewayOut,
    MapBundle,
    ServiceOut,
    SiteOut,
)

router = APIRouter(prefix="/canvas", tags=["canvas"])


@router.get("/map", response_model=MapBundle)
def map_bundle(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    sites = (
        db.query(Site)
        .filter(Site.workspace_id == workspace.id)
        .order_by(Site.name)
        .all()
    )
    site_ids = [s.id for s in sites]
    services = (
        db.query(Service)
        .filter(Service.site_id.in_(site_ids))
        .order_by(Service.site_id, Service.display_order, Service.name)
        .all()
    ) if site_ids else []
    pace_order = sql_case(
        (Gateway.pace == "primary", 0),
        (Gateway.pace == "alternate", 1),
        (Gateway.pace == "contingency", 2),
        (Gateway.pace == "emergency", 3),
        else_=4,
    )
    gateways = (
        db.query(Gateway)
        .filter(Gateway.site_id.in_(site_ids))
        .order_by(Gateway.site_id, pace_order, Gateway.display_order, Gateway.name)
        .all()
    ) if site_ids else []
    positions = (
        db.query(SiteCanvasPosition)
        .filter(SiteCanvasPosition.site_id.in_(site_ids))
        .all()
    ) if site_ids else []
    annotations = (
        db.query(CanvasAnnotation)
        .filter(CanvasAnnotation.workspace_id == workspace.id)
        .order_by(CanvasAnnotation.id)
        .all()
    )

    services_by_site: dict[int, list[Service]] = {}
    for s in services:
        services_by_site.setdefault(s.site_id, []).append(s)
    gateways_by_site: dict[int, list[Gateway]] = {}
    for g in gateways:
        gateways_by_site.setdefault(g.site_id, []).append(g)

    # Bulk-load the matrix cells once so effective_service_status can apply
    # R10/R11 accurately across every service instead of falling back to the
    # legacy any-live-gateway heuristic. Missing cells default to unknown
    # inside the rollup (treated as inheriting local when the gateway is
    # live), so a fresh workspace with no validated cells still renders
    # normal statuses instead of collapsing to "down".
    service_ids = [s.id for s in services]
    cells_by_svc: dict[int, dict[int, ServiceGatewayStatus]] = {}
    if service_ids:
        for c in (
            db.query(ServiceGatewayStatus)
            .filter(ServiceGatewayStatus.service_id.in_(service_ids))
            .all()
        ):
            cells_by_svc.setdefault(c.service_id, {})[c.gateway_id] = c

    site_outs: list[SiteOut] = [SiteOut.model_validate(s) for s in sites]

    template_cache: dict[int, ServiceTemplate] = {}
    service_outs: list[ServiceOut] = []
    user_cache: dict[int, str] = {}
    for s in services:
        gws = gateways_by_site.get(s.site_id, [])
        so = ServiceOut.model_validate(s)
        so.effective_status = effective_service_status(
            s, gws, cells_by_svc.get(s.id, {})
        )
        if s.service_template_id is not None:
            tpl = template_cache.get(s.service_template_id)
            if tpl is None:
                tpl = db.get(ServiceTemplate, s.service_template_id)
                if tpl:
                    template_cache[s.service_template_id] = tpl
            if tpl and tpl.allowed_statuses:
                so.allowed_statuses = tpl.allowed_statuses
        if s.validated_by_user_id is not None:
            uname = user_cache.get(s.validated_by_user_id)
            if uname is None:
                u = db.get(User, s.validated_by_user_id)
                if u:
                    uname = u.username
                    user_cache[s.validated_by_user_id] = uname
            so.validated_by_username = uname
        service_outs.append(so)

    gateway_outs: list[GatewayOut] = []
    for g in gateways:
        go = GatewayOut.model_validate(g)
        if g.validated_by_user_id is not None:
            uname = user_cache.get(g.validated_by_user_id)
            if uname is None:
                u = db.get(User, g.validated_by_user_id)
                if u:
                    uname = u.username
                    user_cache[g.validated_by_user_id] = uname
            go.validated_by_username = uname
        gateway_outs.append(go)

    return MapBundle(
        sites=site_outs,
        positions=[
            CanvasPositionOut(site_id=p.site_id, x=p.x, y=p.y) for p in positions
        ],
        services=service_outs,
        gateways=gateway_outs,
        annotations=[CanvasAnnotationOut.model_validate(a) for a in annotations],
    )


@router.put("/positions/{site_id}", response_model=CanvasPositionOut)
def upsert_position(
    site_id: int,
    body: CanvasPositionIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    site = db.get(Site, site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    pos = db.get(SiteCanvasPosition, site_id)
    if pos is None:
        pos = SiteCanvasPosition(site_id=site_id, x=body.x, y=body.y)
        db.add(pos)
    else:
        pos.x = body.x
        pos.y = body.y
    db.flush()
    notify(background_tasks)
    return CanvasPositionOut(site_id=site_id, x=pos.x, y=pos.y)


@router.get("/annotations", response_model=list[CanvasAnnotationOut])
def list_annotations(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    return (
        db.query(CanvasAnnotation)
        .filter(CanvasAnnotation.workspace_id == workspace.id)
        .order_by(CanvasAnnotation.id)
        .all()
    )


@router.post(
    "/annotations",
    response_model=CanvasAnnotationOut,
    status_code=status.HTTP_201_CREATED,
)
def create_annotation(
    body: CanvasAnnotationIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    ann = CanvasAnnotation(workspace_id=workspace.id, **body.model_dump())
    db.add(ann)
    db.flush()
    notify(background_tasks)
    return ann


@router.patch("/annotations/{ann_id}", response_model=CanvasAnnotationOut)
def patch_annotation(
    ann_id: int,
    body: CanvasAnnotationPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    ann = db.get(CanvasAnnotation, ann_id)
    if ann is None or ann.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Annotation not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ann, k, v)
    db.flush()
    notify(background_tasks)
    return ann


@router.delete("/annotations/{ann_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_annotation(
    ann_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    ann = db.get(CanvasAnnotation, ann_id)
    if ann is None or ann.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Annotation not found")
    db.delete(ann)
    notify(background_tasks)
