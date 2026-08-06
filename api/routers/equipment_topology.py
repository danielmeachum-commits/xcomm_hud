"""Equipment links and the network topology bundle.

`equipment_link` rows are the first thing in this app that relates one site to
another — until now `Site` only related downward to its own services and
gateways, and the sites map rendered with an empty edge array. An RFK at Site A
shooting to an RFK at Site B is what makes B an extension of A, and that fact
now has somewhere to live.

`GET /topology/network` is the canvas's single read. It is built as one bulk
pass in the style of routers/status.py::rollup — the canvas renders every piece
of gear in the workspace at once, so an N+1 here would be felt immediately.
"""

from __future__ import annotations

import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from equipment_status import (
    build_derived,
    derive_utc_role,
    load_backing_for_gateways,
    load_backing_for_services,
)
from models import (
    Equipment,
    EquipmentCanvasPosition,
    EquipmentCapability,
    EquipmentLink,
    Gateway,
    Service,
    ServiceDelivery,
    Site,
    User,
    UtcDef,
    UtcInstance,
    Workspace,
)
from pubsub import notify
from routers.equipment import equipment_out_bulk
from rules_engine import emit_trigger
from schemas import (
    EquipmentLinkIn,
    EquipmentLinkOut,
    EquipmentLinkPatch,
    EquipmentPositionIn,
    EquipmentPositionOut,
    NetworkTopologyOut,
    TopologySiteNode,
    UtcInstanceOut,
)

router = APIRouter(tags=["equipment-topology"])


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _load_equipment(db: Session, equipment_id: int, workspace: Workspace) -> Equipment:
    row = db.get(Equipment, equipment_id)
    if row is None or row.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Equipment not found")
    return row


def _load_link(db: Session, link_id: int, workspace: Workspace) -> EquipmentLink:
    row = db.get(EquipmentLink, link_id)
    if row is None or row.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found")
    return row


def _link_out(
    db: Session, row: EquipmentLink, cache: dict[int, Equipment] | None = None
) -> EquipmentLinkOut:
    out = EquipmentLinkOut.model_validate(row)
    cache = cache if cache is not None else {}

    def _get(eq_id: int) -> Equipment | None:
        if eq_id not in cache:
            found = db.get(Equipment, eq_id)
            if found is None:
                return None
            cache[eq_id] = found
        return cache[eq_id]

    a = _get(row.a_equipment_id)
    b = _get(row.b_equipment_id)
    if a is not None:
        out.a_equipment_code = a.equipment_code
        out.a_site_id = a.site_id
    if b is not None:
        out.b_equipment_code = b.equipment_code
        out.b_site_id = b.site_id
    return out


def _validate_capability_end(
    db: Session, capability_id: int | None, equipment_id: int
) -> None:
    """A link's named capability must belong to the equipment on that end.

    Without this you could record that the shot leaves a capability on a
    completely different radio, which would render as nonsense on the canvas.
    """
    if capability_id is None:
        return
    cap = db.get(EquipmentCapability, capability_id)
    if cap is None or cap.equipment_id != equipment_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Capability does not belong to the equipment on that end of the link.",
        )


# ---------- links ----------


@router.get("/topology/links", response_model=list[EquipmentLinkOut])
def list_links(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    rows = (
        db.query(EquipmentLink)
        .filter(EquipmentLink.workspace_id == workspace.id)
        .order_by(EquipmentLink.id)
        .all()
    )
    cache: dict[int, Equipment] = {}
    return [_link_out(db, r, cache) for r in rows]


@router.post(
    "/topology/links",
    response_model=EquipmentLinkOut,
    status_code=status.HTTP_201_CREATED,
)
def create_link(
    body: EquipmentLinkIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    if body.a_equipment_id == body.b_equipment_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "A link needs two different pieces of gear."
        )
    a = _load_equipment(db, body.a_equipment_id, workspace)
    b = _load_equipment(db, body.b_equipment_id, workspace)
    _validate_capability_end(db, body.a_capability_id, a.id)
    _validate_capability_end(db, body.b_capability_id, b.id)

    # The unique constraint is directional, but a link is a physical fact —
    # A↔B and B↔A of the same kind are the same cable, so catch the reverse
    # here rather than letting a duplicate through.
    existing = (
        db.query(EquipmentLink)
        .filter(
            EquipmentLink.workspace_id == workspace.id,
            EquipmentLink.kind == body.kind,
            (
                (EquipmentLink.a_equipment_id == a.id)
                & (EquipmentLink.b_equipment_id == b.id)
            )
            | (
                (EquipmentLink.a_equipment_id == b.id)
                & (EquipmentLink.b_equipment_id == a.id)
            ),
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A '{body.kind}' link between {a.equipment_code} and "
            f"{b.equipment_code} already exists.",
        )

    row = EquipmentLink(workspace_id=workspace.id, **body.model_dump())
    db.add(row)
    db.flush()
    emit_trigger(
        db,
        "equipment.link_changed",
        {
            "link_id": row.id,
            "a_equipment_code": a.equipment_code,
            "b_equipment_code": b.equipment_code,
            "link_kind": row.kind,
            "prev_status": None,
            "new_status": row.status,
            "source_flow": "create",
            "crosses_sites": a.site_id != b.site_id,
            "user_id": current_user.id,
            "username": current_user.username,
            "occurred_at": _now(),
        },
        workspace_id=workspace.id,
    )
    db.flush()
    notify(background_tasks)
    return _link_out(db, row)


@router.patch("/topology/links/{link_id}", response_model=EquipmentLinkOut)
def patch_link(
    link_id: int,
    body: EquipmentLinkPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_link(db, link_id, workspace)
    data = body.model_dump(exclude_unset=True)
    if "a_capability_id" in data:
        _validate_capability_end(db, data["a_capability_id"], row.a_equipment_id)
    if "b_capability_id" in data:
        _validate_capability_end(db, data["b_capability_id"], row.b_equipment_id)
    prev_status = row.status
    for k, v in data.items():
        setattr(row, k, v)
    db.flush()

    a = db.get(Equipment, row.a_equipment_id)
    b = db.get(Equipment, row.b_equipment_id)
    if "status" in data and data["status"] != prev_status:
        emit_trigger(
            db,
            "equipment.link_changed",
            {
                "link_id": row.id,
                "a_equipment_code": a.equipment_code if a else None,
                "b_equipment_code": b.equipment_code if b else None,
                "link_kind": row.kind,
                "prev_status": prev_status,
                "new_status": row.status,
                "source_flow": "update",
                "crosses_sites": bool(a and b and a.site_id != b.site_id),
                "user_id": current_user.id,
                "username": current_user.username,
                "occurred_at": _now(),
            },
            workspace_id=workspace.id,
        )
        db.flush()
    notify(background_tasks)
    return _link_out(db, row)


@router.delete(
    "/topology/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_link(
    link_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_link(db, link_id, workspace)
    a = db.get(Equipment, row.a_equipment_id)
    b = db.get(Equipment, row.b_equipment_id)
    emit_trigger(
        db,
        "equipment.link_changed",
        {
            "link_id": row.id,
            "a_equipment_code": a.equipment_code if a else None,
            "b_equipment_code": b.equipment_code if b else None,
            "link_kind": row.kind,
            "prev_status": row.status,
            "new_status": None,
            "source_flow": "delete",
            "crosses_sites": bool(a and b and a.site_id != b.site_id),
            "user_id": current_user.id,
            "username": current_user.username,
            "occurred_at": _now(),
        },
        workspace_id=workspace.id,
    )
    db.delete(row)
    notify(background_tasks)


# ---------- canvas positions ----------


@router.put(
    "/topology/positions/{equipment_id}", response_model=EquipmentPositionOut
)
def set_position(
    equipment_id: int,
    body: EquipmentPositionIn,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    """Persist a dragged node.

    Deliberately does NOT call `notify` — the canvas debounces these at ~400ms
    while dragging, and broadcasting each one would make every other client
    refresh continuously while someone tidies the layout.
    """
    _load_equipment(db, equipment_id, workspace)
    row = db.get(EquipmentCanvasPosition, equipment_id)
    if row is None:
        row = EquipmentCanvasPosition(equipment_id=equipment_id, x=body.x, y=body.y)
        db.add(row)
    else:
        row.x = body.x
        row.y = body.y
    db.flush()
    return EquipmentPositionOut(equipment_id=equipment_id, x=row.x, y=row.y)


# ---------- the canvas bundle ----------


@router.get("/topology/network", response_model=NetworkTopologyOut)
def network_topology(
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
    utcs = (
        db.query(UtcInstance)
        .filter(UtcInstance.workspace_id == workspace.id)
        .order_by(UtcInstance.site_id, UtcInstance.display_order)
        .all()
    )
    equipment = (
        db.query(Equipment)
        .filter(Equipment.workspace_id == workspace.id)
        .order_by(Equipment.site_id, Equipment.equipment_code)
        .all()
    )
    links = (
        db.query(EquipmentLink)
        .filter(EquipmentLink.workspace_id == workspace.id)
        .all()
    )
    positions = (
        db.query(EquipmentCanvasPosition)
        .filter(
            EquipmentCanvasPosition.equipment_id.in_([e.id for e in equipment])
            if equipment
            else False
        )
        .all()
    )

    equipment_by_utc: dict[int, set[int]] = {}
    for e in equipment:
        if e.utc_instance_id is not None:
            equipment_by_utc.setdefault(e.utc_instance_id, set()).add(e.id)

    utcs_by_site: dict[int, list[int]] = {}
    for u in utcs:
        utcs_by_site.setdefault(u.site_id, []).append(u.id)

    utc_defs = {
        d.id: d
        for d in db.query(UtcDef).filter(
            UtcDef.id.in_({u.utc_def_id for u in utcs if u.utc_def_id})
        )
    }
    site_names = {s.id: s.name for s in sites}

    utc_out: list[UtcInstanceOut] = []
    for u in utcs:
        row = UtcInstanceOut.model_validate(u)
        row.site_name = site_names.get(u.site_id)
        d = utc_defs.get(u.utc_def_id) if u.utc_def_id else None
        if d is not None:
            row.utc_def_code = d.code
        row.derived_role = derive_utc_role(u.id, equipment_by_utc, links)
        utc_out.append(row)

    # Deliveries, not identities: `service_derived` is keyed by the id that
    # capability bindings point at, and status is per-site — an identity row
    # has neither.
    services = (
        db.query(ServiceDelivery)
        .join(Site, Site.id == ServiceDelivery.site_id)
        .filter(Site.workspace_id == workspace.id)
        .all()
    )
    gateways = (
        db.query(Gateway)
        .join(Site, Site.id == Gateway.site_id)
        .filter(Site.workspace_id == workspace.id)
        .all()
    )
    svc_backing = load_backing_for_services(db, [s.id for s in services])
    gw_backing = load_backing_for_gateways(db, [g.id for g in gateways])

    link_cache = {e.id: e for e in equipment}
    return NetworkTopologyOut(
        sites=[
            TopologySiteNode(
                site_id=s.id,
                name=s.name,
                status=s.status,
                utc_instance_ids=utcs_by_site.get(s.id, []),
            )
            for s in sites
        ],
        utc_instances=utc_out,
        equipment=equipment_out_bulk(db, equipment),
        links=[_link_out(db, r, link_cache) for r in links],
        positions=[
            EquipmentPositionOut(equipment_id=p.equipment_id, x=p.x, y=p.y)
            for p in positions
        ],
        service_derived={
            s.id: build_derived(s.status, svc_backing.get(s.id, [])) for s in services
        },
        gateway_derived={
            g.id: build_derived(g.status, gw_backing.get(g.id, [])) for g in gateways
        },
    )
