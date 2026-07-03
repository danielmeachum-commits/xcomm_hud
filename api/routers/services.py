"""Service CRUD + validation endpoint + reorder."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from effective import (
    clamp_cells_for_service,
    effective_cell_status,
    effective_service_status,
    materialize_cells,
)
from models import (
    Event,
    Gateway,
    Service,
    ServiceGatewayStatus,
    ServiceTemplate,
    Site,
    User,
    Workspace,
)
from pubsub import notify
from schemas import (
    ServiceGatewayStatusOut,
    ServiceIn,
    ServiceOut,
    ServicePatch,
    ServiceValidateIn,
)

router = APIRouter(prefix="/services", tags=["services"])


def _service_out(db: Session, service: Service) -> ServiceOut:
    gateways = (
        db.query(Gateway).filter(Gateway.site_id == service.site_id).all()
    )
    # Materialize any missing (service, gateway) cells so downstream views
    # always see a full row per enabled-tier gateway. `cells_by_gw` maps
    # gateway_id → ServiceGatewayStatus for the rollup + response shaping.
    cells_by_gw = materialize_cells(db, service, gateways)
    out = ServiceOut.model_validate(service)
    out.effective_status = effective_service_status(
        service, gateways, cells_by_gw
    )
    if service.service_template_id is not None:
        tpl = db.get(ServiceTemplate, service.service_template_id)
        if tpl and tpl.allowed_statuses:
            out.allowed_statuses = tpl.allowed_statuses
    if service.validated_by_user_id is not None:
        u = db.get(User, service.validated_by_user_id)
        if u:
            out.validated_by_username = u.username

    # Cell rows attached to the response. Sorted by gateway_id so the UI
    # can iterate deterministically without a second lookup.
    gw_by_id = {g.id: g for g in gateways}
    user_cache: dict[int, str] = {}
    cell_out: list[ServiceGatewayStatusOut] = []
    for gw_id, cell in sorted(cells_by_gw.items()):
        gw = gw_by_id.get(gw_id)
        if gw is None:
            continue
        entry = ServiceGatewayStatusOut.model_validate(cell)
        entry.effective_status = effective_cell_status(
            cell.status, service.status, gw.status
        )
        if cell.validated_by_user_id is not None:
            uid = cell.validated_by_user_id
            if uid not in user_cache:
                u = db.get(User, uid)
                if u:
                    user_cache[uid] = u.username
            entry.validated_by_username = user_cache.get(uid)
        cell_out.append(entry)
    out.gateway_statuses = cell_out
    return out


def _service_in_workspace(db: Session, service_id: int, workspace: Workspace) -> Service:
    service = db.get(Service, service_id)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    site = db.get(Site, service.site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    return service


@router.get("", response_model=list[ServiceOut])
def list_services(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    services = (
        db.query(Service)
        .join(Site, Site.id == Service.site_id)
        .filter(Site.workspace_id == workspace.id)
        .order_by(Service.site_id, Service.display_order, Service.name)
        .all()
    )
    return [_service_out(db, s) for s in services]


@router.post("", response_model=ServiceOut, status_code=status.HTTP_201_CREATED)
def create_service(
    body: ServiceIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    site = db.get(Site, body.site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if body.service_template_id is not None and db.get(
        ServiceTemplate, body.service_template_id
    ) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service template not found")

    # Place new service at the end of the site's current list.
    max_order = (
        db.query(Service)
        .filter(Service.site_id == body.site_id)
        .order_by(Service.display_order.desc())
        .first()
    )
    next_order = (max_order.display_order + 1) if max_order else 0

    service = Service(**body.model_dump(), display_order=next_order)
    db.add(service)
    db.flush()
    notify(background_tasks)
    return _service_out(db, service)


@router.get("/{service_id}", response_model=ServiceOut)
def get_service(
    service_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    service = _service_in_workspace(db, service_id, workspace)
    return _service_out(db, service)


@router.patch("/{service_id}", response_model=ServiceOut)
def patch_service(
    service_id: int,
    body: ServicePatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    service = _service_in_workspace(db, service_id, workspace)

    data = body.model_dump(exclude_unset=True)
    if "site_id" in data:
        target_site = db.get(Site, data["site_id"])
        if target_site is None or target_site.workspace_id != workspace.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if "service_template_id" in data and data["service_template_id"] is not None:
        if db.get(ServiceTemplate, data["service_template_id"]) is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Service template not found"
            )

    for k, v in data.items():
        setattr(service, k, v)

    db.flush()
    db.refresh(service)
    notify(background_tasks)
    return _service_out(db, service)


@router.post("/{service_id}/validate", response_model=ServiceOut)
def validate_service(
    service_id: int,
    body: ServiceValidateIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    service = _service_in_workspace(db, service_id, workspace)

    prev = service.status
    kwargs = dict(
        subject_kind="service",
        subject_id=service.id,
        prev_status=prev,
        status=body.status,
        source="manual",
        validated_by_user_id=current_user.id,
        note=body.note,
    )
    if body.validated_at is not None:
        kwargs["validated_at"] = body.validated_at
    v = Event(**kwargs)
    db.add(v)
    db.flush()
    service.status = body.status
    service.validated_at = v.validated_at
    service.validated_by_user_id = current_user.id
    # R10/R11 cascade to matrix cells. R10: local down/offline forces every
    # cell to match. R11: any cell better than the new local is clamped
    # down. Cascade is skipped when the operator unchecks "cascade to
    # cells" in the validation dialog — cells stay as they were. Upward
    # local moves never cascade (see effective.clamp_cells_for_service).
    if body.cascade:
        clamp_cells_for_service(db, service.id, body.status)
    db.flush()
    db.refresh(service)
    notify(background_tasks)
    return _service_out(db, service)


@router.post("/{service_id}/move", response_model=ServiceOut)
def move_service(
    service_id: int,
    background_tasks: BackgroundTasks,
    direction: str = Query(..., pattern="^(up|down)$"),
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    """Swap display_order with the adjacent service at the same site.

    Adjacency is computed over services sharing the same `reach` lane so a
    move only reshuffles within Local or within External, matching the canvas
    layout the operator sees.
    """
    service = _service_in_workspace(db, service_id, workspace)

    siblings = (
        db.query(Service)
        .filter(
            Service.site_id == service.site_id,
            Service.reach == service.reach,
        )
        .order_by(Service.display_order, Service.id)
        .all()
    )
    idx = next((i for i, s in enumerate(siblings) if s.id == service.id), None)
    if idx is None:
        return _service_out(db, service)

    swap_idx = idx - 1 if direction == "up" else idx + 1
    if swap_idx < 0 or swap_idx >= len(siblings):
        return _service_out(db, service)

    other = siblings[swap_idx]
    service.display_order, other.display_order = other.display_order, service.display_order
    db.flush()
    db.refresh(service)
    notify(background_tasks)
    return _service_out(db, service)


@router.delete("/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_service(
    service_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    service = _service_in_workspace(db, service_id, workspace)
    db.delete(service)
    notify(background_tasks)
