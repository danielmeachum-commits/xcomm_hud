"""Service CRUD + validation endpoint + reorder."""

from __future__ import annotations

import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from equipment_status import refresh_derived, resolve_status
from effective import (
    clamp_cells_for_service,
    effective_cell_status,
    effective_service_status,
    materialize_cells,
)
from models import (
    Gateway,
    Service,
    ServiceDelivery,
    ServiceGatewayStatus,
    ServiceTemplate,
    Site,
    User,
    Workspace,
)
from pubsub import notify
from rules_engine import emit_trigger
from schemas import (
    ServiceGatewayStatusOut,
    ServiceIn,
    ServiceOut,
    ServicePatch,
    ServiceValidateIn,
    StatusModeIn,
)

router = APIRouter(prefix="/services", tags=["services"])


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _service_out(
    db: Session, delivery: ServiceDelivery, service: Service | None = None
) -> ServiceOut:
    """Serialize a delivery in the shape callers have always seen.

    `id` is the delivery's, which is the id this row carried before 0054 —
    every stored reference (bindings, matrix cells, canvas positions, event
    subject ids) still resolves. Identity fields are joined in from Service.
    """
    service = service or db.get(Service, delivery.service_id)
    gateways = (
        db.query(Gateway).filter(Gateway.site_id == delivery.site_id).all()
    )
    # Materialize any missing (delivery, gateway) cells so downstream views
    # always see a full row per enabled-tier gateway. `cells_by_gw` maps
    # gateway_id → ServiceGatewayStatus for the rollup + response shaping.
    #
    # These take the delivery where they used to take the service, and needed
    # no other change: `status` and `enabled_pace` moved to the delivery, which
    # is the only state effective.py ever read.
    cells_by_gw = materialize_cells(db, delivery, gateways)
    out = ServiceOut(
        id=delivery.id,
        service_id=delivery.service_id,
        name=service.name,
        site_id=delivery.site_id,
        service_template_id=service.service_template_id,
        enclave_id=service.enclave_id,
        kind=service.kind,
        category=service.category,
        reach=delivery.reach,
        icon=service.icon,
        description=service.description,
        status=resolve_status(
            delivery.status,
            delivery.status_mode,
            delivery.derived_status,
            delivery.validated_at,
            delivery.derived_changed_at,
        ),
        reported_status=delivery.status,
        status_mode=delivery.status_mode,
        derived_status=delivery.derived_status,
        enabled_pace=delivery.enabled_pace,
        validated_at=delivery.validated_at,
        validated_by_user_id=delivery.validated_by_user_id,
        display_order=delivery.display_order,
        notes=delivery.notes,
    )
    # R10/R11 read the displayed status, so a delivery in derived mode clamps
    # its cells from the derived value rather than the stale reported one.
    resolved = out.status
    out.effective_status = effective_service_status(
        delivery, gateways, cells_by_gw, local_status=resolved
    )
    if service.service_template_id is not None:
        tpl = db.get(ServiceTemplate, service.service_template_id)
        if tpl and tpl.allowed_statuses:
            out.allowed_statuses = tpl.allowed_statuses
    if delivery.validated_by_user_id is not None:
        u = db.get(User, delivery.validated_by_user_id)
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
            cell.status, resolved, gw.status
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


def _service_in_workspace(
    db: Session, service_id: int, workspace: Workspace
) -> ServiceDelivery:
    """Resolve a path `{service_id}` to a delivery.

    The path parameter keeps its name because the ids did not change: what
    callers have always passed here was a per-site row, which 0054 turned into
    a delivery of the same id.
    """
    delivery = db.get(ServiceDelivery, service_id)
    if delivery is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    site = db.get(Site, delivery.site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    return delivery


@router.get("", response_model=list[ServiceOut])
def list_services(
    site_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    """Every service in the workspace, or one site's when `site_id` is given.

    Two callers were already asking for `?site_id=`; the parameter simply
    didn't exist, so they silently got the whole workspace and one of them
    offered another site's services as binding targets.
    """
    q = (
        db.query(ServiceDelivery, Service)
        .join(Service, Service.id == ServiceDelivery.service_id)
        .filter(Service.workspace_id == workspace.id)
    )
    if site_id is not None:
        q = q.filter(ServiceDelivery.site_id == site_id)
    rows = q.order_by(
        ServiceDelivery.site_id, ServiceDelivery.display_order, Service.name
    ).all()
    return [_service_out(db, d, s) for d, s in rows]


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
    template = None
    if body.service_template_id is not None:
        template = db.get(ServiceTemplate, body.service_template_id)
        if template is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Service template not found"
            )

    # Place the new delivery at the end of the site's current list.
    max_order = (
        db.query(ServiceDelivery)
        .filter(ServiceDelivery.site_id == body.site_id)
        .order_by(ServiceDelivery.display_order.desc())
        .first()
    )
    next_order = (max_order.display_order + 1) if max_order else 0

    # Inherit the template's enclave unless the caller named one. Templates are
    # where the NIPR/SIPR split has always lived, so a service built from one
    # should arrive already tagged rather than needing a second edit.
    enclave_id = body.enclave_id
    if enclave_id is None and template is not None:
        enclave_id = template.enclave_id

    # Find-or-create the identity. This is the behavioural change the split was
    # for: standing up "NIPR Web" at a second site now JOINS the existing
    # service instead of minting an unrelated row that nothing could correlate.
    service = (
        db.query(Service)
        .filter(
            Service.workspace_id == workspace.id,
            Service.name == body.name,
            Service.enclave_id.is_not_distinct_from(enclave_id),
        )
        .first()
    )
    if service is None:
        service = Service(
            workspace_id=workspace.id,
            name=body.name,
            service_template_id=body.service_template_id,
            enclave_id=enclave_id,
            kind=body.kind,
            category=body.category,
            icon=body.icon,
            description=body.description,
        )
        db.add(service)
        db.flush()
    else:
        existing = (
            db.query(ServiceDelivery)
            .filter(
                ServiceDelivery.service_id == service.id,
                ServiceDelivery.site_id == body.site_id,
            )
            .first()
        )
        if existing is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"'{service.name}' is already delivered at '{site.name}'.",
            )

    delivery = ServiceDelivery(
        service_id=service.id,
        site_id=body.site_id,
        reach=body.reach,
        status=body.status,
        notes=body.notes,
        enabled_pace=body.enabled_pace,
        display_order=next_order,
    )
    db.add(delivery)
    db.flush()
    notify(background_tasks)
    return _service_out(db, delivery, service)


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
    delivery = _service_in_workspace(db, service_id, workspace)
    service = db.get(Service, delivery.service_id)

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

    # Identity edits hit every site that delivers this service, which is the
    # point — renaming "NIPR Web" should not rename it at one site only.
    # Anything per-location stays on the delivery.
    identity_fields = {
        "name", "service_template_id", "enclave_id", "kind", "category",
        "icon", "description",
    }
    delivery_fields = {"site_id", "reach", "notes", "display_order", "enabled_pace"}
    for k, v in data.items():
        if k in identity_fields:
            setattr(service, k, v)
        elif k in delivery_fields:
            setattr(delivery, k, v)

    db.flush()
    db.refresh(delivery)
    notify(background_tasks)
    return _service_out(db, delivery, service)


@router.post("/{service_id}/validate", response_model=ServiceOut)
def validate_service(
    service_id: int,
    body: ServiceValidateIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    delivery = _service_in_workspace(db, service_id, workspace)
    service = db.get(Service, delivery.service_id)

    when = body.validated_at or _now()
    emit_trigger(
        db,
        "service.status_changed",
        {
            # The delivery id — what this subject id has always been.
            "service_id": delivery.id,
            "service_name": service.name,
            "prev_status": delivery.status,
            "new_status": body.status,
            "note": body.note,
            "user_id": current_user.id,
            "username": current_user.username,
            "occurred_at": when,
        },
        workspace_id=workspace.id,
    )
    delivery.status = body.status
    delivery.validated_at = when
    delivery.validated_by_user_id = current_user.id
    # R10/R11 cascade to matrix cells. R10: local down/offline forces every
    # cell to match. R11: any cell better than the new local is clamped
    # down. Cascade is skipped when the operator unchecks "cascade to
    # cells" in the validation dialog — cells stay as they were. Upward
    # local moves never cascade (see effective.clamp_cells_for_service).
    # Cascades are transactional integrity logic, so they stay in code
    # rather than in user-editable rules — but each cell that actually
    # changed emits its own trigger (source_flow "cascade") so the audit
    # trail covers cascaded changes too.
    # Derived mode never drives the write cascade. `clamp_cells_for_service`
    # mutates stored cells, and running it at equipment-flap frequency is the
    # cell-blanking failure equipment_status.py has warned about from the
    # start. Read-time R10/R11 still apply on display, so the operator's
    # validated cells keep both their status and their provenance.
    if body.cascade and delivery.status_mode != "derived":
        changed = clamp_cells_for_service(db, delivery.id, body.status)
        gateway_names = {
            g.id: g.name
            for g in db.query(Gateway).filter(
                Gateway.id.in_({cell.gateway_id for cell, _, _ in changed})
            )
        } if changed else {}
        for cell, prev, new in changed:
            emit_trigger(
                db,
                "cell.status_changed",
                {
                    "service_id": delivery.id,
                    "gateway_id": cell.gateway_id,
                    "service_name": service.name,
                    "gateway_name": gateway_names.get(cell.gateway_id),
                    "prev_status": prev,
                    "new_status": new,
                    "source_flow": "cascade",
                    "note": f"Cascaded from service validation ({service.name} → {body.status})",
                    "user_id": current_user.id,
                    "username": current_user.username,
                    "occurred_at": when,
                },
                workspace_id=workspace.id,
            )
    db.flush()
    db.refresh(delivery)
    notify(background_tasks)
    return _service_out(db, delivery, service)


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
    delivery = _service_in_workspace(db, service_id, workspace)

    siblings = (
        db.query(ServiceDelivery)
        .filter(
            ServiceDelivery.site_id == delivery.site_id,
            ServiceDelivery.reach == delivery.reach,
        )
        .order_by(ServiceDelivery.display_order, ServiceDelivery.id)
        .all()
    )
    idx = next((i for i, d in enumerate(siblings) if d.id == delivery.id), None)
    if idx is None:
        return _service_out(db, delivery)

    swap_idx = idx - 1 if direction == "up" else idx + 1
    if swap_idx < 0 or swap_idx >= len(siblings):
        return _service_out(db, delivery)

    other = siblings[swap_idx]
    delivery.display_order, other.display_order = (
        other.display_order,
        delivery.display_order,
    )
    db.flush()
    db.refresh(delivery)
    notify(background_tasks)
    return _service_out(db, delivery)


@router.delete("/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_service(
    service_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    delivery = _service_in_workspace(db, service_id, workspace)
    service_pk = delivery.service_id
    db.delete(delivery)
    db.flush()
    # Deleting the last delivery retires the identity too. Without this a
    # service nobody delivers anywhere would linger, still occupying its
    # (workspace, enclave, name) slot and blocking a later re-create.
    remaining = (
        db.query(ServiceDelivery)
        .filter(ServiceDelivery.service_id == service_pk)
        .count()
    )
    if remaining == 0:
        orphan = db.get(Service, service_pk)
        if orphan is not None:
            db.delete(orphan)
    notify(background_tasks)


@router.post("/{service_id}/status-mode", response_model=ServiceOut)
def set_service_status_mode(
    service_id: int,
    body: StatusModeIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    """Switch a delivery between operator-reported and chain-derived status.

    Per delivery, not per service: one site may have a complete set of required
    bindings while another has none, and forcing both into the same mode would
    make the mode useless at whichever site is less wired up.
    """
    delivery = _service_in_workspace(db, service_id, workspace)
    delivery.status_mode = body.status_mode
    if body.status_mode == "derived":
        # Seed the stored value so the first read has something to resolve
        # against, and so an override made right now is measured against a
        # real timestamp rather than a null.
        refresh_derived(db, [delivery.id], [], _now())
    db.flush()
    notify(background_tasks)
    return _service_out(db, delivery)
