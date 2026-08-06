"""Serialized equipment, its capabilities, and their bindings.

The capability rows are the interesting part. They're materialized from the
type's declaration when gear is registered, then owned by the instance — an
operator can delete `los_rf` from a kit that shipped without the antenna, and
each capability carries its own status so "the data port is dead but voice is
fine" is expressible.

Setting a capability status emits a trigger carrying `contradicts_reported`,
which is what the seeded advisory rule keys on. Note what this router does NOT
do: it never writes `service.status` or `gateway.status`. See
api/equipment_status.py for why that stays a human decision.
"""

from __future__ import annotations

import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import Text, or_
from sqlalchemy.orm import Session

from action_registry import record_action
from db import get_db
from deps import get_current_workspace, requires
from equipment_codes import resolve_code
from equipment_status import (
    disagrees,
    load_backing_for_gateways,
    load_backing_for_services,
    refresh_derived,
)
from models import (
    CapabilityGatewayLink,
    CapabilityServiceLink,
    Enclave,
    Equipment,
    EquipmentCapability,
    EquipmentType,
    EquipmentTypeCapability,
    Gateway,
    Service,
    ServiceDelivery,
    Site,
    User,
    UtcInstance,
    Workspace,
)
from pubsub import notify
from rules_engine import emit_trigger
from schemas import (
    EquipmentCapabilityIn,
    EquipmentCapabilityOut,
    EquipmentCapabilityPatch,
    EquipmentIn,
    EquipmentOut,
    EquipmentPatch,
    EquipmentStatusIn,
    SubjectKinds,
)

router = APIRouter(tags=["equipment"])


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# ---------- loaders ----------


def _load_equipment(db: Session, equipment_id: int, workspace: Workspace) -> Equipment:
    row = db.get(Equipment, equipment_id)
    if row is None or row.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Equipment not found")
    return row


def _load_capability(
    db: Session, capability_id: int, workspace: Workspace
) -> tuple[EquipmentCapability, Equipment]:
    cap = db.get(EquipmentCapability, capability_id)
    if cap is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Capability not found")
    eq = _load_equipment(db, cap.equipment_id, workspace)
    return cap, eq


def _load_type(db: Session, type_id: int, workspace: Workspace) -> EquipmentType:
    row = db.get(EquipmentType, type_id)
    if row is None or (
        row.workspace_id is not None and row.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Equipment type not found")
    return row


def _site_in_workspace(db: Session, site_id: int, workspace: Workspace) -> Site:
    site = db.get(Site, site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    return site


# ---------- serialization ----------


def _capability_out(
    db: Session,
    cap: EquipmentCapability,
    service_ids: list[int] | None = None,
    gateway_ids: list[int] | None = None,
) -> EquipmentCapabilityOut:
    out = EquipmentCapabilityOut.model_validate(cap)
    if cap.validated_by_user_id is not None:
        u = db.get(User, cap.validated_by_user_id)
        if u:
            out.validated_by_username = u.username
    if service_ids is None:
        service_ids = [
            r.service_delivery_id
            for r in db.query(CapabilityServiceLink).filter(
                CapabilityServiceLink.equipment_capability_id == cap.id
            )
        ]
    if gateway_ids is None:
        gateway_ids = [
            r.gateway_id
            for r in db.query(CapabilityGatewayLink).filter(
                CapabilityGatewayLink.equipment_capability_id == cap.id
            )
        ]
    out.bindings.service_ids = service_ids
    out.bindings.gateway_ids = gateway_ids
    links = (
        db.query(CapabilityServiceLink)
        .filter(CapabilityServiceLink.equipment_capability_id == cap.id)
        .all()
    )
    out.bindings.required_service_ids = [
        r.service_delivery_id for r in links if r.required
    ]
    out.bindings.group_keys = {
        r.service_delivery_id: r.group_key for r in links if r.group_key
    }
    return out


def equipment_out(db: Session, eq: Equipment) -> EquipmentOut:
    """Single-row serializer. Use `equipment_out_bulk` for lists."""
    return equipment_out_bulk(db, [eq])[0]


def equipment_out_bulk(db: Session, rows: list[Equipment]) -> list[EquipmentOut]:
    """Serialize many equipment rows without N+1.

    The list view and the topology bundle both render every piece of gear at a
    site with its capabilities and bindings; doing that per-row would be a
    dozen queries per radio.
    """
    if not rows:
        return []
    ids = [r.id for r in rows]
    types = {
        t.id: t
        for t in db.query(EquipmentType).filter(
            EquipmentType.id.in_({r.equipment_type_id for r in rows})
        )
    }
    sites = {
        s.id: s
        for s in db.query(Site).filter(Site.id.in_({r.site_id for r in rows}))
    }
    utcs = {
        u.id: u
        for u in db.query(UtcInstance).filter(
            UtcInstance.id.in_({r.utc_instance_id for r in rows if r.utc_instance_id})
        )
    }
    users = {
        u.id: u
        for u in db.query(User).filter(
            User.id.in_({r.validated_by_user_id for r in rows if r.validated_by_user_id})
        )
    }
    caps = (
        db.query(EquipmentCapability)
        .filter(EquipmentCapability.equipment_id.in_(ids))
        .order_by(EquipmentCapability.display_order, EquipmentCapability.id)
        .all()
    )
    cap_ids = [c.id for c in caps]
    svc_links: dict[int, list[int]] = {}
    svc_required: dict[int, list[int]] = {}
    svc_groups: dict[int, dict[int, str]] = {}
    gw_links: dict[int, list[int]] = {}
    if cap_ids:
        for r in db.query(CapabilityServiceLink).filter(
            CapabilityServiceLink.equipment_capability_id.in_(cap_ids)
        ):
            svc_links.setdefault(r.equipment_capability_id, []).append(
                r.service_delivery_id
            )
            if r.required:
                svc_required.setdefault(r.equipment_capability_id, []).append(
                    r.service_delivery_id
                )
            if r.group_key:
                svc_groups.setdefault(r.equipment_capability_id, {})[
                    r.service_delivery_id
                ] = r.group_key
        for r in db.query(CapabilityGatewayLink).filter(
            CapabilityGatewayLink.equipment_capability_id.in_(cap_ids)
        ):
            gw_links.setdefault(r.equipment_capability_id, []).append(r.gateway_id)
    caps_by_equipment: dict[int, list[EquipmentCapability]] = {}
    for c in caps:
        caps_by_equipment.setdefault(c.equipment_id, []).append(c)

    out_rows: list[EquipmentOut] = []
    for eq in rows:
        out = EquipmentOut.model_validate(eq)
        t = types.get(eq.equipment_type_id)
        if t is not None:
            out.type_title = t.title
            out.type_short_name = t.short_name
            out.type_category = t.category
            out.nsn = t.nsn
        site = sites.get(eq.site_id)
        if site is not None:
            out.site_name = site.name
        utc = utcs.get(eq.utc_instance_id) if eq.utc_instance_id else None
        if utc is not None:
            out.utc_name = utc.name
        u = users.get(eq.validated_by_user_id) if eq.validated_by_user_id else None
        if u is not None:
            out.validated_by_username = u.username
        out.capabilities = []
        for c in caps_by_equipment.get(eq.id, []):
            cap_out = EquipmentCapabilityOut.model_validate(c)
            if c.validated_by_user_id is not None:
                cu = users.get(c.validated_by_user_id) or db.get(
                    User, c.validated_by_user_id
                )
                if cu:
                    cap_out.validated_by_username = cu.username
            cap_out.bindings.service_ids = svc_links.get(c.id, [])
            cap_out.bindings.required_service_ids = svc_required.get(c.id, [])
            cap_out.bindings.group_keys = svc_groups.get(c.id, {})
            cap_out.bindings.gateway_ids = gw_links.get(c.id, [])
            out.capabilities.append(cap_out)
        out_rows.append(out)
    return out_rows


# ---------- equipment CRUD ----------


@router.get("/equipment", response_model=list[EquipmentOut])
def list_equipment(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    site_id: int | None = Query(default=None),
    utc_instance_id: int | None = Query(default=None),
    search: str | None = Query(default=None),
    _=Depends(requires("viewer")),
):
    q = db.query(Equipment).filter(Equipment.workspace_id == workspace.id)
    if site_id is not None:
        q = q.filter(Equipment.site_id == site_id)
    if utc_instance_id is not None:
        q = q.filter(Equipment.utc_instance_id == utc_instance_id)
    if search:
        # Nobody says "AN/PRC-117G" — they say "117G" or "radio". Match the
        # nicknames stored on the type as well as the identifiers on the
        # instance, so all the ways a person might refer to a box work.
        term = f"%{search.strip()}%"
        q = q.join(EquipmentType, EquipmentType.id == Equipment.equipment_type_id).filter(
            or_(
                Equipment.equipment_code.ilike(term),
                Equipment.serial_number.ilike(term),
                EquipmentType.title.ilike(term),
                EquipmentType.short_name.ilike(term),
                # JSONB text match across the alias array. Cheap at this
                # volume; revisit with a GIN index if the catalog grows large.
                EquipmentType.aliases.cast(Text).ilike(term),
            )
        )
    rows = q.order_by(Equipment.site_id, Equipment.equipment_code).all()
    return equipment_out_bulk(db, rows)


@router.post(
    "/equipment", response_model=EquipmentOut, status_code=status.HTTP_201_CREATED
)
def create_equipment(
    body: EquipmentIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    eq_type = _load_type(db, body.equipment_type_id, workspace)
    site = _site_in_workspace(db, body.site_id, workspace)
    if not eq_type.serialized:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"'{eq_type.title}' is an unserialized type — track it as a holding "
            "on a deployed UTC instead of registering it individually.",
        )
    if body.utc_instance_id is not None:
        utc = db.get(UtcInstance, body.utc_instance_id)
        if utc is None or utc.workspace_id != workspace.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "UTC instance not found")

    code, conflict = resolve_code(
        db, workspace.id, eq_type, body.serial_number, body.equipment_code
    )
    if conflict is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "message": f"Equipment ID '{code}' is already in use.",
                "requested": code,
                "suggestion": conflict,
            },
        )

    check_enclave_allowed(db, eq_type, body.enclave_id)
    eq = Equipment(
        workspace_id=workspace.id,
        equipment_type_id=eq_type.id,
        site_id=site.id,
        utc_instance_id=body.utc_instance_id,
        enclave_id=body.enclave_id,
        equipment_code=code,
        serial_number=body.serial_number,
        status=body.status,
        notes=body.notes,
    )
    db.add(eq)
    db.flush()
    materialize_capabilities(db, eq, eq_type, body.capability_kinds)
    db.flush()

    emit_trigger(
        db,
        "equipment.registered",
        {
            "equipment_id": eq.id,
            "equipment_code": eq.equipment_code,
            "equipment_title": eq_type.title,
            "serial_number": eq.serial_number,
            "site_id": site.id,
            "site_name": site.name,
            "user_id": current_user.id,
            "username": current_user.username,
            "occurred_at": _now(),
        },
        workspace_id=workspace.id,
    )
    db.refresh(eq)
    notify(background_tasks)
    return equipment_out(db, eq)


def check_enclave_allowed(
    db: Session,
    eq_type: EquipmentType,
    enclave_id: int | None,
) -> None:
    """Reject assigning gear to an enclave its type isn't declared capable of.

    An empty declaration means unrestricted, not "capable of nothing" — the
    same convention capabilities use. That keeps this from blocking operators
    whose catalog simply hasn't been filled in yet, while still catching the
    real mistake: putting a NIPR-only box on SIPR.

    Applied on write only. Narrowing a type's declarations later does NOT
    invalidate gear already recorded, for the same reason editing capabilities
    doesn't rewrite materialized rows.
    """
    if enclave_id is None:
        return
    allowed = {link.enclave_id for link in eq_type.enclave_links}
    if not allowed or enclave_id in allowed:
        return
    names = (
        db.query(Enclave.name)
        .filter(Enclave.id.in_(allowed))
        .order_by(Enclave.name)
        .all()
    )
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        {
            "message": (
                f"{eq_type.short_name or eq_type.title} isn't declared capable "
                "of that enclave."
            ),
            "allowed": [n for (n,) in names],
        },
    )


def materialize_capabilities(
    db: Session,
    eq: Equipment,
    eq_type: EquipmentType,
    only_kinds: list[str] | None = None,
) -> list[EquipmentCapability]:
    """Copy the type's declared capabilities onto this instance.

    This is the moment the catalog stops being authoritative: from here the
    instance owns its own rows, so editing the type later can't rewrite what
    an operator recorded about a specific kit.

    `only_kinds` lets the register/deploy wizard drop capabilities a
    particular kit doesn't have; omitting it takes everything flagged
    `materialize_by_default`.
    """
    declared = (
        db.query(EquipmentTypeCapability)
        .filter(EquipmentTypeCapability.equipment_type_id == eq_type.id)
        .order_by(EquipmentTypeCapability.display_order)
        .all()
    )
    created: list[EquipmentCapability] = []
    for order, decl in enumerate(declared):
        if only_kinds is not None:
            if decl.kind not in only_kinds:
                continue
        elif not decl.materialize_by_default:
            continue
        cap = EquipmentCapability(
            equipment_id=eq.id,
            kind=decl.kind,
            label=decl.label,
            status="unvalidated",
            source="template",
            display_order=order,
        )
        db.add(cap)
        created.append(cap)
    return created


@router.get("/equipment/{equipment_id}", response_model=EquipmentOut)
def get_equipment(
    equipment_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    return equipment_out(db, _load_equipment(db, equipment_id, workspace))


@router.patch("/equipment/{equipment_id}", response_model=EquipmentOut)
def patch_equipment(
    equipment_id: int,
    body: EquipmentPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    eq = _load_equipment(db, equipment_id, workspace)
    data = body.model_dump(exclude_unset=True)
    if "site_id" in data and data["site_id"] is not None:
        _site_in_workspace(db, data["site_id"], workspace)
    if "equipment_type_id" in data and data["equipment_type_id"] is not None:
        _load_type(db, data["equipment_type_id"], workspace)
    if "enclave_id" in data:
        # Check against the type this row will HAVE after the patch, not the
        # one it had before — both fields can move in the same request.
        target_type = db.get(
            EquipmentType, data.get("equipment_type_id") or eq.equipment_type_id
        )
        if target_type is not None:
            check_enclave_allowed(db, target_type, data["enclave_id"])
    if "equipment_code" in data and data["equipment_code"]:
        eq_type = db.get(EquipmentType, data.get("equipment_type_id") or eq.equipment_type_id)
        code, conflict = resolve_code(
            db,
            workspace.id,
            eq_type,
            data.get("serial_number", eq.serial_number),
            data["equipment_code"],
            exclude_id=eq.id,
        )
        if conflict is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                {
                    "message": f"Equipment ID '{code}' is already in use.",
                    "requested": code,
                    "suggestion": conflict,
                },
            )
        data["equipment_code"] = code
    for k, v in data.items():
        setattr(eq, k, v)
    db.flush()
    db.refresh(eq)
    notify(background_tasks)
    return equipment_out(db, eq)


@router.post("/equipment/{equipment_id}/status", response_model=EquipmentOut)
def set_equipment_status(
    equipment_id: int,
    body: EquipmentStatusIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    eq = _load_equipment(db, equipment_id, workspace)
    when = body.validated_at or _now()
    eq_type = db.get(EquipmentType, eq.equipment_type_id)
    site = db.get(Site, eq.site_id)
    emit_trigger(
        db,
        "equipment.status_changed",
        {
            "equipment_id": eq.id,
            "equipment_code": eq.equipment_code,
            "equipment_title": eq_type.title if eq_type else None,
            "prev_status": eq.status,
            "new_status": body.status,
            "site_id": eq.site_id,
            "site_name": site.name if site else None,
            "note": body.note,
            "user_id": current_user.id,
            "username": current_user.username,
            "occurred_at": when,
        },
        workspace_id=workspace.id,
    )
    eq.status = body.status
    eq.validated_at = when
    eq.validated_by_user_id = current_user.id
    db.flush()
    db.refresh(eq)
    notify(background_tasks)
    return equipment_out(db, eq)


@router.delete("/equipment/{equipment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment(
    equipment_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    eq = _load_equipment(db, equipment_id, workspace)
    # Recorded before the delete, while there is still something to describe.
    # Serialized gear is accountable property — it disappearing with no trace
    # of who unregistered it is the one thing an audit feed must not allow.
    record_action(
        db,
        action_slug="equipment.deleted",
        workspace_id=workspace.id,
        subject_kind=SubjectKinds.EQUIPMENT,
        subject_id=eq.id,
        subject_label=eq.equipment_code,
        user_id=current_user.id,
        note=(
            f"Serial {eq.serial_number}" if eq.serial_number else "No serial recorded"
        ),
    )
    db.delete(eq)
    notify(background_tasks)


# ---------- capabilities ----------


@router.post(
    "/equipment/{equipment_id}/capabilities",
    response_model=EquipmentCapabilityOut,
    status_code=status.HTTP_201_CREATED,
)
def add_capability(
    equipment_id: int,
    body: EquipmentCapabilityIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    eq = _load_equipment(db, equipment_id, workspace)
    cap = EquipmentCapability(equipment_id=eq.id, **body.model_dump())
    db.add(cap)
    db.flush()
    notify(background_tasks)
    return _capability_out(db, cap)


@router.patch(
    "/capabilities/{capability_id}", response_model=EquipmentCapabilityOut
)
def patch_capability(
    capability_id: int,
    body: EquipmentCapabilityPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    cap, _eq = _load_capability(db, capability_id, workspace)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(cap, k, v)
    db.flush()
    notify(background_tasks)
    return _capability_out(db, cap)


@router.post(
    "/capabilities/{capability_id}/status", response_model=EquipmentCapabilityOut
)
def set_capability_status(
    capability_id: int,
    body: EquipmentStatusIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Set one capability's status.

    Emits the trigger with `contradicts_reported` precomputed — true when this
    capability backs a service or gateway whose *reported* status is still
    healthier than what the capability now says. That's the condition the
    seeded advisory rule fires on.

    This endpoint does not touch the service or gateway. The operator is shown
    the disagreement and decides.
    """
    cap, eq = _load_capability(db, capability_id, workspace)
    when = body.validated_at or _now()
    site = db.get(Site, eq.site_id)

    bound_service_ids = [
        r.service_delivery_id
        for r in db.query(CapabilityServiceLink).filter(
            CapabilityServiceLink.equipment_capability_id == cap.id
        )
    ]
    bound_gateway_ids = [
        r.gateway_id
        for r in db.query(CapabilityGatewayLink).filter(
            CapabilityGatewayLink.equipment_capability_id == cap.id
        )
    ]
    contradicts = False
    bound_labels: list[str] = []
    # Bound ids are DELIVERY ids; the label comes from the shared identity.
    for d, svc in (
        db.query(ServiceDelivery, Service)
        .join(Service, Service.id == ServiceDelivery.service_id)
        .filter(ServiceDelivery.id.in_(bound_service_ids))
        if bound_service_ids
        else []
    ):
        bound_labels.append(svc.name)
        if disagrees(d.status, body.status):
            contradicts = True
    for gw in db.query(Gateway).filter(Gateway.id.in_(bound_gateway_ids)) if bound_gateway_ids else []:
        bound_labels.append(gw.name)
        if disagrees(gw.status, body.status):
            contradicts = True

    emit_trigger(
        db,
        "equipment.capability_status_changed",
        {
            "capability_id": cap.id,
            "capability_label": cap.label,
            "capability_kind": cap.kind,
            "equipment_id": eq.id,
            "equipment_code": eq.equipment_code,
            "prev_status": cap.status,
            "new_status": body.status,
            "contradicts_reported": contradicts,
            "bound_targets": ", ".join(bound_labels) or None,
            "site_id": eq.site_id,
            "site_name": site.name if site else None,
            "note": body.note,
            "user_id": current_user.id,
            "username": current_user.username,
            "occurred_at": when,
        },
        workspace_id=workspace.id,
    )
    cap.status = body.status
    cap.validated_at = when
    cap.validated_by_user_id = current_user.id
    db.flush()
    # This is the only thing that can move a dependency chain, so it is where
    # the stored derived value is refreshed and `derived_changed_at` stamped —
    # and only when the value actually MOVES, because that timestamp is what an
    # operator override is measured against. Refreshing it on every save would
    # expire every override on the next unrelated capability edit.
    #
    # Note what this does NOT do: it writes derived_status and its timestamp
    # and nothing else. No status is set, no cell is touched, no cascade runs.
    refresh_derived(db, bound_service_ids, bound_gateway_ids, when)
    db.flush()
    notify(background_tasks)
    return _capability_out(db, cap, bound_service_ids, bound_gateway_ids)


@router.delete(
    "/capabilities/{capability_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_capability(
    capability_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    cap, _eq = _load_capability(db, capability_id, workspace)
    db.delete(cap)
    notify(background_tasks)


# ---------- bindings ----------


@router.put(
    "/capabilities/{capability_id}/services/{service_id}",
    response_model=EquipmentCapabilityOut,
)
def bind_capability_to_service(
    capability_id: int,
    service_id: int,
    background_tasks: BackgroundTasks,
    role: str = Query(default="endpoint", pattern="^(endpoint|transport)$"),
    # Does this capability GATE the service? Defaults to False so binding
    # stays the low-commitment act it has always been — saying "this is
    # related" must not silently mean "this must be up".
    required: bool = Query(default=False),
    # Bindings sharing a key are OR'd: one live path in the group is enough.
    group_key: str | None = Query(default=None),
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    cap, _eq = _load_capability(db, capability_id, workspace)
    svc = db.get(ServiceDelivery, service_id)
    if svc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    _site_in_workspace(db, svc.site_id, workspace)
    existing = db.get(CapabilityServiceLink, (cap.id, service_id))
    if existing is None:
        db.add(
            CapabilityServiceLink(
                equipment_capability_id=cap.id,
                service_delivery_id=service_id,
                required=required,
                group_key=group_key,
                role=role
            )
        )
    else:
        existing.role = role
        existing.required = required
        existing.group_key = group_key
    db.flush()
    # Marking something required can change the chain's answer immediately.
    refresh_derived(db, [service_id], [], _now())
    db.flush()
    notify(background_tasks)
    return _capability_out(db, cap)


@router.delete(
    "/capabilities/{capability_id}/services/{service_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def unbind_capability_from_service(
    capability_id: int,
    service_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    cap, _eq = _load_capability(db, capability_id, workspace)
    row = db.get(CapabilityServiceLink, (cap.id, service_id))
    if row is not None:
        db.delete(row)
    notify(background_tasks)


@router.put(
    "/capabilities/{capability_id}/gateways/{gateway_id}",
    response_model=EquipmentCapabilityOut,
)
def bind_capability_to_gateway(
    capability_id: int,
    gateway_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    cap, _eq = _load_capability(db, capability_id, workspace)
    gw = db.get(Gateway, gateway_id)
    if gw is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Gateway not found")
    _site_in_workspace(db, gw.site_id, workspace)
    if db.get(CapabilityGatewayLink, (cap.id, gateway_id)) is None:
        db.add(
            CapabilityGatewayLink(
                equipment_capability_id=cap.id, gateway_id=gateway_id
            )
        )
    db.flush()
    notify(background_tasks)
    return _capability_out(db, cap)


@router.delete(
    "/capabilities/{capability_id}/gateways/{gateway_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def unbind_capability_from_gateway(
    capability_id: int,
    gateway_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    cap, _eq = _load_capability(db, capability_id, workspace)
    row = db.get(CapabilityGatewayLink, (cap.id, gateway_id))
    if row is not None:
        db.delete(row)
    notify(background_tasks)


# ---------- advisory read ----------


@router.get("/sites/{site_id}/equipment-advisory")
def site_equipment_advisory(
    site_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    """Reported-vs-derived for every service and gateway at a site.

    Read-only by design — this is the data behind the "3 of 4 backing
    capabilities up" badge and the Apply button, which posts to the existing
    service/gateway validation endpoints under the operator's own name.
    """
    from equipment_status import build_derived

    _site_in_workspace(db, site_id, workspace)
    services = (
        db.query(ServiceDelivery)
        .filter(ServiceDelivery.site_id == site_id)
        .all()
    )
    gateways = db.query(Gateway).filter(Gateway.site_id == site_id).all()
    svc_backing = load_backing_for_services(db, [s.id for s in services])
    gw_backing = load_backing_for_gateways(db, [g.id for g in gateways])
    return {
        "service_derived": {
            s.id: build_derived(s.status, svc_backing.get(s.id, [])) for s in services
        },
        "gateway_derived": {
            g.id: build_derived(g.status, gw_backing.get(g.id, [])) for g in gateways
        },
    }
