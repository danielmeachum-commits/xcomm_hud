"""Workspace CRUD, duplication, export/import, and current-selection endpoints.

A workspace holds one full operating picture (sites, services, gateways,
canvas positions, canvas annotations). Users switch between workspaces to
plan upcoming exercises or look back at past missions without disturbing the
current baseline.
"""

from __future__ import annotations

import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user
from db import get_db
from deps import requires
from models import (
    CanvasAnnotation,
    CapabilityGatewayLink,
    CapabilityServiceLink,
    Enclave,
    Equipment,
    EquipmentCanvasPosition,
    EquipmentCapability,
    EquipmentHolding,
    EquipmentLink,
    EquipmentType,
    EquipmentTypeCapability,
    EquipmentTypeEnclave,
    Gateway,
    PackageDef,
    PackageDefUtc,
    PackageInstance,
    Personnel,
    Service,
    ServiceDelivery,
    ServiceTemplate,
    Site,
    SiteCanvasPosition,
    Team,
    Unit,
    User,
    UtcDef,
    UtcDefLine,
    UtcInstance,
    WorkCenter,
    Workspace,
)
from pubsub import notify
from workspace_slug import unique_workspace_slug
from schemas import (
    ExportedAnnotation,
    ExportedEnclave,
    ExportedEquipment,
    ExportedEquipmentCapability,
    ExportedEquipmentHolding,
    ExportedEquipmentLink,
    ExportedEquipmentType,
    ExportedEquipmentTypeCapability,
    ExportedGateway,
    ExportedPackageDef,
    ExportedPackageDefUtc,
    ExportedPackageInstance,
    ExportedPersonnel,
    ExportedPosition,
    ExportedService,
    ExportedSite,
    ExportedTeam,
    ExportedUnit,
    ExportedUtcDef,
    ExportedUtcDefLine,
    ExportedUtcInstance,
    ExportedWorkCenter,
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

    # Enclaves first: equipment, services and UTC lines all point at them.
    # Global enclaves pass through unmapped (shared by definition); a
    # workspace-local one is duplicated, because copying its id straight across
    # would leave the destination referencing a row it cannot see.
    enclave_map: dict[int, int] = {}
    local_enclaves = (
        db.query(Enclave).filter(Enclave.workspace_id == source.id).all()
    )
    for en in local_enclaves:
        new_en = Enclave(
            workspace_id=dest.id,
            name=en.name,
            short_name=en.short_name,
            color=en.color,
            classification=en.classification,
            display_order=en.display_order,
            retired_at=en.retired_at,
            notes=en.notes,
        )
        db.add(new_en)
        db.flush()
        enclave_map[en.id] = new_en.id
    # Second pass for parents, so a local enclave nested under another local
    # one keeps its shape. A parent that is global stays pointed at the global.
    for en in local_enclaves:
        if en.parent_id is None:
            continue
        db.get(Enclave, enclave_map[en.id]).parent_id = enclave_map.get(
            en.parent_id, en.parent_id
        )

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

    # Services and gateways keep their new ids in maps because the equipment
    # capability bindings below point at them.
    service_id_map: dict[int, int] = {}
    gateway_id_map: dict[int, int] = {}
    if site_id_map:
        # One identity per source Service, then a delivery per site it reached.
        # `service_id_map` still maps old DELIVERY id → new delivery id, because
        # that is what the capability bindings below point at.
        identity_map: dict[int, int] = {}
        for delivery, svc in (
            db.query(ServiceDelivery, Service)
            .join(Service, Service.id == ServiceDelivery.service_id)
            .filter(ServiceDelivery.site_id.in_(site_id_map.keys()))
            .all()
        ):
            new_service_id = identity_map.get(svc.id)
            if new_service_id is None:
                new_svc = Service(
                    workspace_id=dest.id,
                    service_template_id=svc.service_template_id,
                    enclave_id=enclave_map.get(svc.enclave_id, svc.enclave_id),
                    name=svc.name,
                    kind=svc.kind,
                    category=svc.category,
                    icon=svc.icon,
                    description=svc.description,
                )
                db.add(new_svc)
                db.flush()
                identity_map[svc.id] = new_svc.id
                new_service_id = new_svc.id
            new_delivery = ServiceDelivery(
                service_id=new_service_id,
                site_id=site_id_map[delivery.site_id],
                source=delivery.source,
                reach=delivery.reach,
                # status left as default ("unvalidated"); no validated_* fields.
                display_order=delivery.display_order,
                notes=delivery.notes,
                enabled_pace=list(delivery.enabled_pace),
            )
            db.add(new_delivery)
            db.flush()
            service_id_map[delivery.id] = new_delivery.id

        for gw in (
            db.query(Gateway).filter(Gateway.site_id.in_(site_id_map.keys())).all()
        ):
            new_gw = Gateway(
                site_id=site_id_map[gw.site_id],
                name=gw.name,
                kind=gw.kind,
                provider=gw.provider,
                pace=gw.pace,
                # status left as default ("unvalidated"); no validated_* fields.
                display_order=gw.display_order,
                notes=gw.notes,
            )
            db.add(new_gw)
            db.flush()
            gateway_id_map[gw.id] = new_gw.id

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

    # --- Personnel side: units → work_centers → teams → personnel.
    # Units first because personnel.unit_id depends on them, and units may
    # reference each other via parent_unit_id. We do two passes: create rows
    # then rewire parents once the id map exists.
    unit_id_map: dict[int, int] = {}
    src_units = list(
        db.query(Unit).filter(Unit.workspace_id == source.id).all()
    )
    for u in src_units:
        new_u = Unit(
            workspace_id=dest.id, name=u.name, description=u.description
        )
        db.add(new_u)
        db.flush()
        unit_id_map[u.id] = new_u.id
    for u in src_units:
        if u.parent_unit_id and u.parent_unit_id in unit_id_map:
            db.get(Unit, unit_id_map[u.id]).parent_unit_id = unit_id_map[
                u.parent_unit_id
            ]

    wc_id_map: dict[int, int] = {}
    for wc in db.query(WorkCenter).filter(WorkCenter.workspace_id == source.id).all():
        new_wc = WorkCenter(
            workspace_id=dest.id, name=wc.name, description=wc.description
        )
        db.add(new_wc)
        db.flush()
        wc_id_map[wc.id] = new_wc.id

    team_id_map: dict[int, int] = {}
    for team in db.query(Team).filter(Team.workspace_id == source.id).all():
        new_team = Team(
            workspace_id=dest.id,
            name=team.name,
            description=team.description,
            color=team.color,
        )
        db.add(new_team)
        db.flush()
        team_id_map[team.id] = new_team.id

    personnel_id_map: dict[int, int] = {}
    src_personnel = list(
        db.query(Personnel).filter(Personnel.workspace_id == source.id).all()
    )
    for p in src_personnel:
        new_p = Personnel(
            workspace_id=dest.id,
            personnel_type=p.personnel_type,
            branch=p.branch,
            rank=p.rank,
            last_name=p.last_name,
            first_name=p.first_name,
            cellphone=p.cellphone,
            dsn=p.dsn,
            sipr_number=p.sipr_number,
            email=p.email,
            notes=p.notes,
            work_center_id=wc_id_map.get(p.work_center_id)
            if p.work_center_id
            else None,
            unit_id=unit_id_map.get(p.unit_id) if p.unit_id else None,
            # supervisor rewired in second pass once every id is known
            assigned_site_id=site_id_map.get(p.assigned_site_id)
            if p.assigned_site_id
            else None,
            room_number=p.room_number,
            current_status=p.current_status,
            current_site_id=site_id_map.get(p.current_site_id)
            if p.current_site_id
            else None,
            current_status_since=p.current_status_since,
            current_status_note=p.current_status_note,
            expected_return_at=p.expected_return_at,
        )
        new_p.teams = [
            db.get(Team, team_id_map[t.id]) for t in p.teams if t.id in team_id_map
        ]
        db.add(new_p)
        db.flush()
        personnel_id_map[p.id] = new_p.id
    for p in src_personnel:
        if p.supervisor_id and p.supervisor_id in personnel_id_map:
            db.get(Personnel, personnel_id_map[p.id]).supervisor_id = (
                personnel_id_map[p.supervisor_id]
            )

    _duplicate_equipment(
        db, source, dest, site_id_map, service_id_map, gateway_id_map, enclave_map
    )

    db.flush()
    notify(background_tasks)
    return dest


def _duplicate_equipment(
    db: Session,
    source: Workspace,
    dest: Workspace,
    site_id_map: dict[int, int],
    service_id_map: dict[int, int],
    gateway_id_map: dict[int, int],
    # Pre-existing bug, unrelated to the Service split: this function already
    # read `enclave_map` in two places but never received it, so duplicating a
    # workspace that owned any equipment or UTC lines raised NameError. It went
    # unnoticed because the path is only reachable once equipment exists.
    enclave_map: dict[int, int],
) -> None:
    """Copy the equipment tier into the destination workspace.

    Follows the same convention as services and gateways: structure is copied,
    live status is not. Equipment, capabilities, and links all land at their
    default `unvalidated` with no `validated_*` fields, because a duplicate is a
    planning scenario and inheriting yesterday's validations at another site
    would be a lie about who checked what.

    Serial numbers ARE copied. The uniqueness constraint is per workspace, so
    this is legal, and a planning copy that lost its serials would be useless
    for the thing people duplicate a workspace to do. The UI should make the
    provenance obvious.

    Catalog rows are not copied: global ones are shared by definition, and
    workspace-local ones are re-pointed below only when they belong to the
    source, in which case they're duplicated first so the copy is self-contained.
    """
    # --- workspace-local catalog rows the copy will need ---
    equipment_type_map: dict[int, int] = {}
    for t in (
        db.query(EquipmentType)
        .filter(EquipmentType.workspace_id == source.id)
        .all()
    ):
        new_t = EquipmentType(
            workspace_id=dest.id,
            title=t.title,
            short_name=t.short_name,
            aliases=list(t.aliases or []),
            nsn=t.nsn,
            lin=t.lin,
            category=t.category,
            serialized=t.serialized,
            id_prefix=t.id_prefix,
            manufacturer=t.manufacturer,
            model=t.model,
            icon=t.icon,
            description=t.description,
            retired_at=t.retired_at,
        )
        db.add(new_t)
        db.flush()
        equipment_type_map[t.id] = new_t.id
        for cap in (
            db.query(EquipmentTypeCapability)
            .filter(EquipmentTypeCapability.equipment_type_id == t.id)
            .all()
        ):
            db.add(
                EquipmentTypeCapability(
                    equipment_type_id=new_t.id,
                    kind=cap.kind,
                    label=cap.label,
                    description=cap.description,
                    display_order=cap.display_order,
                    materialize_by_default=cap.materialize_by_default,
                )
            )

    utc_def_map: dict[int, int] = {}
    for d in db.query(UtcDef).filter(UtcDef.workspace_id == source.id).all():
        new_d = UtcDef(
            workspace_id=dest.id,
            code=d.code,
            name=d.name,
            description=d.description,
            retired_at=d.retired_at,
        )
        db.add(new_d)
        db.flush()
        utc_def_map[d.id] = new_d.id
        for line in db.query(UtcDefLine).filter(UtcDefLine.utc_def_id == d.id).all():
            db.add(
                UtcDefLine(
                    utc_def_id=new_d.id,
                    # A local UTC may reference a global type, which is not
                    # remapped — hence the fallback to the original id.
                    equipment_type_id=equipment_type_map.get(
                        line.equipment_type_id, line.equipment_type_id
                    ),
                    quantity=line.quantity,
                    enclave_id=enclave_map.get(line.enclave_id, line.enclave_id),
                    notes=line.notes,
                    display_order=line.display_order,
                )
            )

    package_def_map: dict[int, int] = {}
    for pd in db.query(PackageDef).filter(PackageDef.workspace_id == source.id).all():
        new_pd = PackageDef(
            workspace_id=dest.id,
            code=pd.code,
            name=pd.name,
            description=pd.description,
            retired_at=pd.retired_at,
        )
        db.add(new_pd)
        db.flush()
        package_def_map[pd.id] = new_pd.id
        for pu in (
            db.query(PackageDefUtc).filter(PackageDefUtc.package_def_id == pd.id).all()
        ):
            db.add(
                PackageDefUtc(
                    package_def_id=new_pd.id,
                    utc_def_id=utc_def_map.get(pu.utc_def_id, pu.utc_def_id),
                    quantity=pu.quantity,
                    role_hint=pu.role_hint,
                    display_order=pu.display_order,
                )
            )

    # --- deployed instances ---
    package_map: dict[int, int] = {}
    for p in (
        db.query(PackageInstance)
        .filter(PackageInstance.workspace_id == source.id)
        .all()
    ):
        new_p = PackageInstance(
            workspace_id=dest.id,
            package_def_id=package_def_map.get(p.package_def_id, p.package_def_id),
            name=p.name,
            notes=p.notes,
        )
        db.add(new_p)
        db.flush()
        package_map[p.id] = new_p.id

    utc_map: dict[int, int] = {}
    for u in (
        db.query(UtcInstance).filter(UtcInstance.workspace_id == source.id).all()
    ):
        if u.site_id not in site_id_map:
            continue
        new_u = UtcInstance(
            workspace_id=dest.id,
            package_instance_id=package_map.get(u.package_instance_id),
            utc_def_id=utc_def_map.get(u.utc_def_id, u.utc_def_id),
            site_id=site_id_map[u.site_id],
            name=u.name,
            role=u.role,
            notes=u.notes,
            display_order=u.display_order,
        )
        db.add(new_u)
        db.flush()
        utc_map[u.id] = new_u.id

    equipment_map: dict[int, int] = {}
    capability_map: dict[int, int] = {}
    for e in db.query(Equipment).filter(Equipment.workspace_id == source.id).all():
        if e.site_id not in site_id_map:
            continue
        new_e = Equipment(
            workspace_id=dest.id,
            equipment_type_id=equipment_type_map.get(
                e.equipment_type_id, e.equipment_type_id
            ),
            utc_instance_id=utc_map.get(e.utc_instance_id),
            site_id=site_id_map[e.site_id],
            enclave_id=enclave_map.get(e.enclave_id, e.enclave_id),
            equipment_code=e.equipment_code,
            serial_number=e.serial_number,
            # status left as default ("unvalidated"); no validated_* fields.
            notes=e.notes,
        )
        db.add(new_e)
        db.flush()
        equipment_map[e.id] = new_e.id
        for cap in (
            db.query(EquipmentCapability)
            .filter(EquipmentCapability.equipment_id == e.id)
            .all()
        ):
            new_cap = EquipmentCapability(
                equipment_id=new_e.id,
                kind=cap.kind,
                label=cap.label,
                # status left as default; see the docstring.
                source=cap.source,
                notes=cap.notes,
                display_order=cap.display_order,
            )
            db.add(new_cap)
            db.flush()
            capability_map[cap.id] = new_cap.id

    for h in (
        db.query(EquipmentHolding)
        .filter(EquipmentHolding.workspace_id == source.id)
        .all()
    ):
        if h.utc_instance_id not in utc_map:
            continue
        db.add(
            EquipmentHolding(
                workspace_id=dest.id,
                utc_instance_id=utc_map[h.utc_instance_id],
                equipment_type_id=equipment_type_map.get(
                    h.equipment_type_id, h.equipment_type_id
                ),
                authorized_qty=h.authorized_qty,
                on_hand_qty=h.on_hand_qty,
                notes=h.notes,
            )
        )

    # --- bindings and links, once every id is known ---
    if capability_map:
        for link in db.query(CapabilityServiceLink).filter(
            CapabilityServiceLink.equipment_capability_id.in_(capability_map.keys())
        ):
            if link.service_delivery_id not in service_id_map:
                continue
            db.add(
                CapabilityServiceLink(
                    equipment_capability_id=capability_map[
                        link.equipment_capability_id
                    ],
                    service_delivery_id=service_id_map[link.service_delivery_id],
                    role=link.role,
                )
            )
        for link in db.query(CapabilityGatewayLink).filter(
            CapabilityGatewayLink.equipment_capability_id.in_(capability_map.keys())
        ):
            if link.gateway_id not in gateway_id_map:
                continue
            db.add(
                CapabilityGatewayLink(
                    equipment_capability_id=capability_map[
                        link.equipment_capability_id
                    ],
                    gateway_id=gateway_id_map[link.gateway_id],
                )
            )

    for link in (
        db.query(EquipmentLink).filter(EquipmentLink.workspace_id == source.id).all()
    ):
        if (
            link.a_equipment_id not in equipment_map
            or link.b_equipment_id not in equipment_map
        ):
            continue
        db.add(
            EquipmentLink(
                workspace_id=dest.id,
                a_equipment_id=equipment_map[link.a_equipment_id],
                b_equipment_id=equipment_map[link.b_equipment_id],
                a_capability_id=capability_map.get(link.a_capability_id),
                b_capability_id=capability_map.get(link.b_capability_id),
                kind=link.kind,
                direction=link.direction,
                label=link.label,
                # status left as default; see the docstring.
                notes=link.notes,
            )
        )

    # Canvas layout is structure, not status — worth carrying over so a
    # duplicated workspace doesn't open to a pile of nodes at the origin.
    if equipment_map:
        for pos in db.query(EquipmentCanvasPosition).filter(
            EquipmentCanvasPosition.equipment_id.in_(equipment_map.keys())
        ):
            db.add(
                EquipmentCanvasPosition(
                    equipment_id=equipment_map[pos.equipment_id], x=pos.x, y=pos.y
                )
            )

    db.flush()


def _export_equipment(
    db: Session, ws: Workspace, site_name_by_id: dict[int, str]
) -> dict:
    """Serialize the equipment tier by name, ID-free like the rest of the envelope.

    Global catalog rows are deliberately NOT included: they're shared across
    instances by definition, so exporting them would create duplicates on
    import. They're referenced by title/code and re-resolved on the far side;
    an instance missing a global type fails the import loudly rather than
    silently dropping the gear that pointed at it.

    Live status is omitted, matching the rest of the export — this is
    structure, not a snapshot of who validated what.
    """
    site_ids = list(site_name_by_id.keys())

    local_types = (
        db.query(EquipmentType).filter(EquipmentType.workspace_id == ws.id).all()
    )
    # Titles resolve across both scopes on import, so the lookup here has to
    # cover global rows too — most gear points at the global catalog.
    all_type_titles = {
        t.id: t.title
        for t in db.query(EquipmentType).filter(
            (EquipmentType.workspace_id == ws.id)
            | (EquipmentType.workspace_id.is_(None))
        )
    }
    local_utc_defs = db.query(UtcDef).filter(UtcDef.workspace_id == ws.id).all()
    all_utc_codes = {
        d.id: d.code
        for d in db.query(UtcDef).filter(
            (UtcDef.workspace_id == ws.id) | (UtcDef.workspace_id.is_(None))
        )
    }
    local_package_defs = (
        db.query(PackageDef).filter(PackageDef.workspace_id == ws.id).all()
    )
    all_package_codes = {
        p.id: p.code
        for p in db.query(PackageDef).filter(
            (PackageDef.workspace_id == ws.id) | (PackageDef.workspace_id.is_(None))
        )
    }

    packages = (
        db.query(PackageInstance)
        .filter(PackageInstance.workspace_id == ws.id)
        .order_by(PackageInstance.name)
        .all()
    )
    package_name_by_id = {p.id: p.name for p in packages}
    utcs = (
        db.query(UtcInstance)
        .filter(UtcInstance.workspace_id == ws.id)
        .order_by(UtcInstance.name)
        .all()
    )
    utc_name_by_id = {u.id: u.name for u in utcs}
    equipment = (
        db.query(Equipment)
        .filter(Equipment.workspace_id == ws.id)
        .order_by(Equipment.equipment_code)
        .all()
    )
    equipment_code_by_id = {e.id: e.equipment_code for e in equipment}

    caps = (
        db.query(EquipmentCapability)
        .filter(EquipmentCapability.equipment_id.in_(equipment_code_by_id.keys()))
        .order_by(EquipmentCapability.display_order)
        .all()
        if equipment_code_by_id
        else []
    )
    cap_ids = [c.id for c in caps]
    service_names = {
        d.id: svc.name
        for d, svc in (
            db.query(ServiceDelivery, Service)
            .join(Service, Service.id == ServiceDelivery.service_id)
            .filter(ServiceDelivery.site_id.in_(site_ids))
            if site_ids
            else []
        )
    }
    gateway_names = {
        g.id: g.name
        for g in (
            db.query(Gateway).filter(Gateway.site_id.in_(site_ids)) if site_ids else []
        )
    }
    svc_binding: dict[int, list[str]] = {}
    gw_binding: dict[int, list[str]] = {}
    if cap_ids:
        for link in db.query(CapabilityServiceLink).filter(
            CapabilityServiceLink.equipment_capability_id.in_(cap_ids)
        ):
            name = service_names.get(link.service_delivery_id)
            if name:
                svc_binding.setdefault(link.equipment_capability_id, []).append(name)
        for link in db.query(CapabilityGatewayLink).filter(
            CapabilityGatewayLink.equipment_capability_id.in_(cap_ids)
        ):
            name = gateway_names.get(link.gateway_id)
            if name:
                gw_binding.setdefault(link.equipment_capability_id, []).append(name)
    caps_by_equipment: dict[int, list] = {}
    for c in caps:
        caps_by_equipment.setdefault(c.equipment_id, []).append(c)

    holdings = (
        db.query(EquipmentHolding)
        .filter(EquipmentHolding.workspace_id == ws.id)
        .all()
    )
    links = (
        db.query(EquipmentLink).filter(EquipmentLink.workspace_id == ws.id).all()
    )
    # Enclaves travel by name like every other cross-reference. Globals and
    # this workspace's own are both resolvable on the far side: globals by
    # matching name, locals because they ride along in the envelope.
    enclave_name_by_id = {
        e.id: e.name
        for e in db.query(Enclave).filter(
            (Enclave.workspace_id.is_(None)) | (Enclave.workspace_id == ws.id)
        )
    }
    type_enclave_names: dict[int, list[str]] = {}
    for link in db.query(EquipmentTypeEnclave):
        name = enclave_name_by_id.get(link.enclave_id)
        if name:
            type_enclave_names.setdefault(link.equipment_type_id, []).append(name)

    return {
        "enclaves": [
            ExportedEnclave(
                name=e.name,
                short_name=e.short_name,
                color=e.color,
                classification=e.classification,
                display_order=e.display_order,
                parent_name=enclave_name_by_id.get(e.parent_id)
                if e.parent_id
                else None,
                notes=e.notes,
            )
            # Workspace-local only. Globals are shared by definition and
            # resolve by name against the target instance.
            for e in db.query(Enclave)
            .filter(Enclave.workspace_id == ws.id)
            .order_by(Enclave.display_order, Enclave.name)
        ],
        "equipment_types": [
            ExportedEquipmentType(
                title=t.title,
                short_name=t.short_name,
                aliases=list(t.aliases or []),
                nsn=t.nsn,
                lin=t.lin,
                category=t.category,
                serialized=t.serialized,
                id_prefix=t.id_prefix,
                manufacturer=t.manufacturer,
                model=t.model,
                icon=t.icon,
                description=t.description,
                enclave_names=sorted(type_enclave_names.get(t.id, [])),
                capabilities=[
                    ExportedEquipmentTypeCapability(
                        kind=c.kind,
                        label=c.label,
                        description=c.description,
                        display_order=c.display_order,
                        materialize_by_default=c.materialize_by_default,
                    )
                    for c in db.query(EquipmentTypeCapability)
                    .filter(EquipmentTypeCapability.equipment_type_id == t.id)
                    .order_by(EquipmentTypeCapability.display_order)
                ],
            )
            for t in local_types
        ],
        "utc_defs": [
            ExportedUtcDef(
                code=d.code,
                name=d.name,
                description=d.description,
                lines=[
                    ExportedUtcDefLine(
                        equipment_type_title=all_type_titles.get(
                            line.equipment_type_id, ""
                        ),
                        quantity=line.quantity,
                        enclave_name=enclave_name_by_id.get(line.enclave_id)
                        if line.enclave_id
                        else None,
                        notes=line.notes,
                        display_order=line.display_order,
                    )
                    for line in db.query(UtcDefLine)
                    .filter(UtcDefLine.utc_def_id == d.id)
                    .order_by(UtcDefLine.display_order)
                    if all_type_titles.get(line.equipment_type_id)
                ],
            )
            for d in local_utc_defs
        ],
        "package_defs": [
            ExportedPackageDef(
                code=p.code,
                name=p.name,
                description=p.description,
                utcs=[
                    ExportedPackageDefUtc(
                        utc_def_code=all_utc_codes.get(pu.utc_def_id, ""),
                        quantity=pu.quantity,
                        role_hint=pu.role_hint,
                        display_order=pu.display_order,
                    )
                    for pu in db.query(PackageDefUtc)
                    .filter(PackageDefUtc.package_def_id == p.id)
                    .order_by(PackageDefUtc.display_order)
                    if all_utc_codes.get(pu.utc_def_id)
                ],
            )
            for p in local_package_defs
        ],
        "package_instances": [
            ExportedPackageInstance(
                name=p.name,
                package_def_code=all_package_codes.get(p.package_def_id)
                if p.package_def_id
                else None,
                notes=p.notes,
            )
            for p in packages
        ],
        "utc_instances": [
            ExportedUtcInstance(
                name=u.name,
                site_name=site_name_by_id[u.site_id],
                package_name=package_name_by_id.get(u.package_instance_id)
                if u.package_instance_id
                else None,
                utc_def_code=all_utc_codes.get(u.utc_def_id) if u.utc_def_id else None,
                role=u.role,
                notes=u.notes,
                display_order=u.display_order,
            )
            for u in utcs
            if u.site_id in site_name_by_id
        ],
        "equipment": [
            ExportedEquipment(
                equipment_code=e.equipment_code,
                serial_number=e.serial_number,
                equipment_type_title=all_type_titles.get(e.equipment_type_id, ""),
                enclave_name=enclave_name_by_id.get(e.enclave_id)
                if e.enclave_id
                else None,
                site_name=site_name_by_id[e.site_id],
                utc_name=utc_name_by_id.get(e.utc_instance_id)
                if e.utc_instance_id
                else None,
                notes=e.notes,
                capabilities=[
                    ExportedEquipmentCapability(
                        kind=c.kind,
                        label=c.label,
                        source=c.source,
                        notes=c.notes,
                        display_order=c.display_order,
                        service_names=svc_binding.get(c.id, []),
                        gateway_names=gw_binding.get(c.id, []),
                    )
                    for c in caps_by_equipment.get(e.id, [])
                ],
            )
            for e in equipment
            if e.site_id in site_name_by_id
            and all_type_titles.get(e.equipment_type_id)
        ],
        "equipment_holdings": [
            ExportedEquipmentHolding(
                utc_name=utc_name_by_id[h.utc_instance_id],
                equipment_type_title=all_type_titles.get(h.equipment_type_id, ""),
                authorized_qty=h.authorized_qty,
                on_hand_qty=h.on_hand_qty,
                notes=h.notes,
            )
            for h in holdings
            if h.utc_instance_id in utc_name_by_id
            and all_type_titles.get(h.equipment_type_id)
        ],
        "equipment_links": [
            ExportedEquipmentLink(
                a_equipment_code=equipment_code_by_id[link.a_equipment_id],
                b_equipment_code=equipment_code_by_id[link.b_equipment_id],
                kind=link.kind,
                direction=link.direction,
                label=link.label,
                notes=link.notes,
            )
            for link in links
            if link.a_equipment_id in equipment_code_by_id
            and link.b_equipment_id in equipment_code_by_id
        ],
    }


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
    # Same by-name convention as the equipment tier; services carry an enclave
    # too, and it would otherwise be dropped on export.
    enclave_names = {
        e.id: e.name
        for e in db.query(Enclave).filter(
            (Enclave.workspace_id.is_(None)) | (Enclave.workspace_id == ws.id)
        )
    }

    # One exported row per DELIVERY. The format is unchanged and needs no
    # version bump: ExportedService was already keyed on (site_name, name) and
    # already carried the per-site fields, so a service spanning two sites
    # simply exports as two rows — which is exactly what it did before the
    # split. Import rebuilds the shared identity by find-or-create.
    service_pairs = (
        db.query(ServiceDelivery, Service)
        .join(Service, Service.id == ServiceDelivery.service_id)
        .filter(ServiceDelivery.site_id.in_(site_ids))
        .all()
        if site_ids
        else []
    )
    services = [d for d, _ in service_pairs]
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
    template_ids = {
        svc.service_template_id for _, svc in service_pairs if svc.service_template_id
    }
    if template_ids:
        for tpl in (
            db.query(ServiceTemplate)
            .filter(ServiceTemplate.id.in_(template_ids))
            .all()
        ):
            template_name_by_id[tpl.id] = tpl.name

    units = (
        db.query(Unit).filter(Unit.workspace_id == ws.id).order_by(Unit.name).all()
    )
    unit_name_by_id = {u.id: u.name for u in units}
    work_centers = (
        db.query(WorkCenter)
        .filter(WorkCenter.workspace_id == ws.id)
        .order_by(WorkCenter.name)
        .all()
    )
    wc_name_by_id = {wc.id: wc.name for wc in work_centers}
    teams = (
        db.query(Team)
        .filter(Team.workspace_id == ws.id)
        .order_by(Team.name)
        .all()
    )
    team_name_by_id = {t.id: t.name for t in teams}
    people = (
        db.query(Personnel)
        .filter(Personnel.workspace_id == ws.id)
        .order_by(Personnel.last_name, Personnel.first_name)
        .all()
    )
    supervisor_key_by_id = {
        p.id: f"{p.last_name}, {p.first_name}" for p in people
    }

    equipment_export = _export_equipment(db, ws, site_name_by_id)

    return WorkspaceExport(
        exported_at=datetime.datetime.now(datetime.timezone.utc),
        workspace=ExportedWorkspaceMeta(
            name=ws.name,
            description=ws.description,
            tags=list(ws.tags),
        ),
        **equipment_export,
        units=[
            ExportedUnit(
                name=u.name,
                description=u.description,
                parent_unit_name=unit_name_by_id.get(u.parent_unit_id)
                if u.parent_unit_id
                else None,
            )
            for u in units
        ],
        work_centers=[
            ExportedWorkCenter(name=wc.name, description=wc.description)
            for wc in work_centers
        ],
        teams=[
            ExportedTeam(
                name=t.name, description=t.description, color=t.color
            )
            for t in teams
        ],
        personnel=[
            ExportedPersonnel(
                personnel_type=p.personnel_type,
                branch=p.branch,
                rank=p.rank,
                skill_level=p.skill_level,
                last_name=p.last_name,
                first_name=p.first_name,
                cellphone=p.cellphone,
                dsn=p.dsn,
                sipr_number=p.sipr_number,
                email=p.email,
                notes=p.notes,
                work_center_name=wc_name_by_id.get(p.work_center_id)
                if p.work_center_id
                else None,
                unit_name=unit_name_by_id.get(p.unit_id) if p.unit_id else None,
                supervisor_key=supervisor_key_by_id.get(p.supervisor_id)
                if p.supervisor_id
                else None,
                assigned_site_name=site_name_by_id.get(p.assigned_site_id)
                if p.assigned_site_id
                else None,
                room_number=p.room_number,
                team_names=[
                    team_name_by_id[t.id]
                    for t in p.teams
                    if t.id in team_name_by_id
                ],
                current_status=p.current_status,
                current_site_name=site_name_by_id.get(p.current_site_id)
                if p.current_site_id
                else None,
                current_status_note=p.current_status_note,
                expected_return_at=p.expected_return_at,
            )
            for p in people
        ],
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
                site_name=site_name_by_id[d.site_id],
                service_template_name=(
                    template_name_by_id.get(svc.service_template_id)
                    if svc.service_template_id
                    else None
                ),
                enclave_name=enclave_names.get(svc.enclave_id)
                if svc.enclave_id
                else None,
                name=svc.name,
                kind=svc.kind,
                category=svc.category,
                reach=d.reach,
                icon=svc.icon,
                description=svc.description,
                display_order=d.display_order,
                notes=d.notes,
                enabled_pace=list(d.enabled_pace),
            )
            for d, svc in service_pairs
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

    # Enclaves first — services, equipment types, UTC lines and equipment all
    # reference them by name. Workspace-local rows come from the envelope;
    # global ones resolve by name against this instance's shared list, so an
    # export from an instance with the same global seeds lands correctly.
    enclave_id_by_name: dict[str, int] = {
        e.name: e.id
        for e in db.query(Enclave).filter(Enclave.workspace_id.is_(None))
    }
    imported_enclaves: list[Enclave] = []
    for en in payload.enclaves:
        # A local enclave that shadows a global name stays local, matching the
        # shadowing rule the rest of the catalog uses.
        new_en = Enclave(
            workspace_id=ws.id,
            name=en.name,
            short_name=en.short_name,
            color=en.color,
            classification=en.classification,
            display_order=en.display_order,
            notes=en.notes,
        )
        db.add(new_en)
        db.flush()
        enclave_id_by_name[en.name] = new_en.id
        imported_enclaves.append(new_en)
    # Second pass for parents, now that every name resolves.
    for en, row in zip(payload.enclaves, imported_enclaves):
        if en.parent_name:
            row.parent_id = enclave_id_by_name.get(en.parent_name)

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

    # (site name, service name) → id, because service names are only unique
    # within a site. The equipment capability bindings resolve through these.
    service_id_by_key: dict[tuple[str, str], int] = {}
    gateway_id_by_key: dict[tuple[str, str], int] = {}

    # Two exported rows with the same (enclave, name) are the SAME service
    # delivered at two sites — that is the whole point of the split, and it is
    # how an archive taken before it still imports correctly: the rows were
    # always per-site, and find-or-create rebuilds the identity they share.
    identity_by_key: dict[tuple[Optional[int], str], int] = {}
    for svc in payload.services:
        enclave_id = (
            enclave_id_by_name.get(svc.enclave_name) if svc.enclave_name else None
        )
        identity_key = (enclave_id, svc.name)
        service_pk = identity_by_key.get(identity_key)
        if service_pk is None:
            new_svc = Service(
                workspace_id=ws.id,
                service_template_id=(
                    template_id_by_name.get(svc.service_template_name)
                    if svc.service_template_name
                    else None
                ),
                enclave_id=enclave_id,
                name=svc.name,
                kind=svc.kind,
                category=svc.category,
                icon=svc.icon,
                description=svc.description,
            )
            db.add(new_svc)
            db.flush()
            identity_by_key[identity_key] = new_svc.id
            service_pk = new_svc.id
        new_delivery = ServiceDelivery(
            service_id=service_pk,
            site_id=site_id_by_name[svc.site_name],
            reach=svc.reach,
            display_order=svc.display_order,
            notes=svc.notes,
            enabled_pace=list(svc.enabled_pace),
        )
        db.add(new_delivery)
        db.flush()
        service_id_by_key[(svc.site_name, svc.name)] = new_delivery.id

    for gw in payload.gateways:
        new_gw = Gateway(
            site_id=site_id_by_name[gw.site_name],
            name=gw.name,
            kind=gw.kind,
            provider=gw.provider,
            pace=gw.pace,
            display_order=gw.display_order,
            notes=gw.notes,
        )
        db.add(new_gw)
        db.flush()
        gateway_id_by_key[(gw.site_name, gw.name)] = new_gw.id

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

    # --- Personnel side ---
    # Units first (self-referential parent), then work centers, teams,
    # personnel. Rewire supervisor after all people exist.
    unit_id_by_name: dict[str, int] = {}
    for u in payload.units:
        new_u = Unit(
            workspace_id=ws.id, name=u.name, description=u.description
        )
        db.add(new_u)
        db.flush()
        unit_id_by_name[u.name] = new_u.id
    for u in payload.units:
        if u.parent_unit_name and u.parent_unit_name in unit_id_by_name:
            db.get(Unit, unit_id_by_name[u.name]).parent_unit_id = (
                unit_id_by_name[u.parent_unit_name]
            )

    wc_id_by_name: dict[str, int] = {}
    for wc in payload.work_centers:
        new_wc = WorkCenter(
            workspace_id=ws.id, name=wc.name, description=wc.description
        )
        db.add(new_wc)
        db.flush()
        wc_id_by_name[wc.name] = new_wc.id

    team_id_by_name: dict[str, int] = {}
    for t in payload.teams:
        new_t = Team(
            workspace_id=ws.id,
            name=t.name,
            description=t.description,
            color=t.color,
        )
        db.add(new_t)
        db.flush()
        team_id_by_name[t.name] = new_t.id

    personnel_id_by_key: dict[str, int] = {}
    people_records: list[tuple[Personnel, str | None]] = []
    for p in payload.personnel:
        new_p = Personnel(
            workspace_id=ws.id,
            personnel_type=p.personnel_type,
            branch=p.branch,
            rank=p.rank,
            skill_level=p.skill_level,
            last_name=p.last_name,
            first_name=p.first_name,
            cellphone=p.cellphone,
            dsn=p.dsn,
            sipr_number=p.sipr_number,
            email=p.email,
            notes=p.notes,
            work_center_id=wc_id_by_name.get(p.work_center_name)
            if p.work_center_name
            else None,
            unit_id=unit_id_by_name.get(p.unit_name) if p.unit_name else None,
            assigned_site_id=site_id_by_name.get(p.assigned_site_name)
            if p.assigned_site_name
            else None,
            room_number=p.room_number,
            current_status=p.current_status,
            current_site_id=site_id_by_name.get(p.current_site_name)
            if p.current_site_name
            else None,
            current_status_note=p.current_status_note,
            expected_return_at=p.expected_return_at,
        )
        new_p.teams = [
            db.get(Team, team_id_by_name[n])
            for n in p.team_names
            if n in team_id_by_name
        ]
        db.add(new_p)
        db.flush()
        key = f"{p.last_name}, {p.first_name}"
        # First occurrence wins for supervisor lookup — duplicates are rare
        # in practice.
        personnel_id_by_key.setdefault(key, new_p.id)
        people_records.append((new_p, p.supervisor_key))
    for new_p, sup_key in people_records:
        if sup_key and sup_key in personnel_id_by_key:
            new_p.supervisor_id = personnel_id_by_key[sup_key]

    _import_equipment(
        db,
        ws,
        payload,
        site_id_by_name,
        service_id_by_key,
        gateway_id_by_key,
        enclave_id_by_name,
    )

    db.flush()
    notify(background_tasks)
    return ws


def _import_equipment(
    db: Session,
    ws: Workspace,
    payload: WorkspaceExport,
    site_id_by_name: dict[str, int],
    service_id_by_key: dict[tuple[str, str], int],
    gateway_id_by_key: dict[tuple[str, str], int],
    enclave_id_by_name: dict[str, int],
) -> None:
    """Rebuild the equipment tier from a v3 envelope.

    v1 and v2 payloads simply have empty lists here, so older exports import
    into an equipment-free workspace rather than failing.

    Catalog types resolve by title against the target instance: a workspace-
    local row from the envelope first, then the shared global catalog. A type
    that resolves to neither is a hard 422 — importing gear whose identity
    can't be established would produce records nobody can act on, and failing
    loudly is the only honest option.
    """
    type_id_by_title: dict[str, int] = {}
    for t in payload.equipment_types:
        new_t = EquipmentType(
            workspace_id=ws.id,
            title=t.title,
            short_name=t.short_name,
            aliases=list(t.aliases),
            nsn=t.nsn,
            lin=t.lin,
            category=t.category,
            serialized=t.serialized,
            id_prefix=t.id_prefix,
            manufacturer=t.manufacturer,
            model=t.model,
            icon=t.icon,
            description=t.description,
        )
        db.add(new_t)
        db.flush()
        type_id_by_title[t.title] = new_t.id
        for name in t.enclave_names:
            enclave_id = enclave_id_by_name.get(name)
            # An unresolvable enclave is skipped rather than fatal: a missing
            # capability declaration only widens what's allowed, so it can't
            # produce a wrong assignment the way a missing type would produce
            # unidentifiable gear.
            if enclave_id is not None:
                db.add(
                    EquipmentTypeEnclave(
                        equipment_type_id=new_t.id, enclave_id=enclave_id
                    )
                )
        for order, cap in enumerate(t.capabilities):
            db.add(
                EquipmentTypeCapability(
                    equipment_type_id=new_t.id,
                    kind=cap.kind,
                    label=cap.label,
                    description=cap.description,
                    display_order=order,
                    materialize_by_default=cap.materialize_by_default,
                )
            )

    def resolve_type(title: str, context: str) -> int:
        if title in type_id_by_title:
            return type_id_by_title[title]
        row = (
            db.query(EquipmentType)
            .filter(
                EquipmentType.workspace_id.is_(None), EquipmentType.title == title
            )
            .first()
        )
        if row is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"{context} references equipment type '{title}', which is not in "
                "this instance's global catalog and was not included in the "
                "export. Add the type to the catalog and re-import.",
            )
        type_id_by_title[title] = row.id
        return row.id

    utc_def_id_by_code: dict[str, int] = {}
    for d in payload.utc_defs:
        new_d = UtcDef(
            workspace_id=ws.id, code=d.code, name=d.name, description=d.description
        )
        db.add(new_d)
        db.flush()
        utc_def_id_by_code[d.code] = new_d.id
        for order, line in enumerate(d.lines):
            db.add(
                UtcDefLine(
                    utc_def_id=new_d.id,
                    equipment_type_id=resolve_type(
                        line.equipment_type_title, f"UTC definition '{d.code}'"
                    ),
                    quantity=line.quantity,
                    enclave_id=enclave_id_by_name.get(line.enclave_name)
                    if line.enclave_name
                    else None,
                    notes=line.notes,
                    display_order=order,
                )
            )

    def resolve_utc_def(code: str) -> int | None:
        if code in utc_def_id_by_code:
            return utc_def_id_by_code[code]
        row = (
            db.query(UtcDef)
            .filter(UtcDef.workspace_id.is_(None), UtcDef.code == code)
            .first()
        )
        if row is not None:
            utc_def_id_by_code[code] = row.id
            return row.id
        # A missing UTC *definition* is survivable — the deployed UTC keeps its
        # name and gear, it just loses the link to its bill of materials.
        return None

    package_def_id_by_code: dict[str, int] = {}
    for p in payload.package_defs:
        new_pd = PackageDef(
            workspace_id=ws.id, code=p.code, name=p.name, description=p.description
        )
        db.add(new_pd)
        db.flush()
        package_def_id_by_code[p.code] = new_pd.id
        for order, pu in enumerate(p.utcs):
            utc_def_id = resolve_utc_def(pu.utc_def_code)
            if utc_def_id is None:
                continue
            db.add(
                PackageDefUtc(
                    package_def_id=new_pd.id,
                    utc_def_id=utc_def_id,
                    quantity=pu.quantity,
                    role_hint=pu.role_hint,
                    display_order=order,
                )
            )

    package_id_by_name: dict[str, int] = {}
    for p in payload.package_instances:
        package_def_id = None
        if p.package_def_code:
            package_def_id = package_def_id_by_code.get(p.package_def_code)
            if package_def_id is None:
                row = (
                    db.query(PackageDef)
                    .filter(
                        PackageDef.workspace_id.is_(None),
                        PackageDef.code == p.package_def_code,
                    )
                    .first()
                )
                package_def_id = row.id if row else None
        new_p = PackageInstance(
            workspace_id=ws.id,
            package_def_id=package_def_id,
            name=p.name,
            notes=p.notes,
        )
        db.add(new_p)
        db.flush()
        package_id_by_name[p.name] = new_p.id

    utc_id_by_name: dict[str, int] = {}
    for u in payload.utc_instances:
        if u.site_name not in site_id_by_name:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"UTC '{u.name}' references unknown site '{u.site_name}'",
            )
        new_u = UtcInstance(
            workspace_id=ws.id,
            package_instance_id=package_id_by_name.get(u.package_name)
            if u.package_name
            else None,
            utc_def_id=resolve_utc_def(u.utc_def_code) if u.utc_def_code else None,
            site_id=site_id_by_name[u.site_name],
            name=u.name,
            role=u.role,
            notes=u.notes,
            display_order=u.display_order,
        )
        db.add(new_u)
        db.flush()
        utc_id_by_name[u.name] = new_u.id

    equipment_id_by_code: dict[str, int] = {}
    for e in payload.equipment:
        if e.site_name not in site_id_by_name:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Equipment '{e.equipment_code}' references unknown site "
                f"'{e.site_name}'",
            )
        new_e = Equipment(
            workspace_id=ws.id,
            equipment_type_id=resolve_type(
                e.equipment_type_title, f"Equipment '{e.equipment_code}'"
            ),
            utc_instance_id=utc_id_by_name.get(e.utc_name) if e.utc_name else None,
            site_id=site_id_by_name[e.site_name],
            enclave_id=enclave_id_by_name.get(e.enclave_name)
            if e.enclave_name
            else None,
            equipment_code=e.equipment_code,
            serial_number=e.serial_number,
            # status left as model default; imports are structural.
            notes=e.notes,
        )
        db.add(new_e)
        db.flush()
        equipment_id_by_code[e.equipment_code] = new_e.id

        for order, cap in enumerate(e.capabilities):
            new_cap = EquipmentCapability(
                equipment_id=new_e.id,
                kind=cap.kind,
                label=cap.label,
                source=cap.source,
                notes=cap.notes,
                display_order=order,
            )
            db.add(new_cap)
            db.flush()
            for svc_name in cap.service_names:
                svc_id = service_id_by_key.get((e.site_name, svc_name))
                if svc_id is not None:
                    db.add(
                        CapabilityServiceLink(
                            equipment_capability_id=new_cap.id,
                            service_delivery_id=svc_id,
                        )
                    )
            for gw_name in cap.gateway_names:
                gw_id = gateway_id_by_key.get((e.site_name, gw_name))
                if gw_id is not None:
                    db.add(
                        CapabilityGatewayLink(
                            equipment_capability_id=new_cap.id, gateway_id=gw_id
                        )
                    )

    for h in payload.equipment_holdings:
        utc_id = utc_id_by_name.get(h.utc_name)
        if utc_id is None:
            continue
        db.add(
            EquipmentHolding(
                workspace_id=ws.id,
                utc_instance_id=utc_id,
                equipment_type_id=resolve_type(
                    h.equipment_type_title, f"Holding on UTC '{h.utc_name}'"
                ),
                authorized_qty=h.authorized_qty,
                on_hand_qty=h.on_hand_qty,
                notes=h.notes,
            )
        )

    for link in payload.equipment_links:
        a = equipment_id_by_code.get(link.a_equipment_code)
        b = equipment_id_by_code.get(link.b_equipment_code)
        if a is None or b is None or a == b:
            continue
        db.add(
            EquipmentLink(
                workspace_id=ws.id,
                a_equipment_id=a,
                b_equipment_id=b,
                kind=link.kind,
                direction=link.direction,
                label=link.label,
                # status left as model default; imports are structural.
                notes=link.notes,
            )
        )

    db.flush()


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
