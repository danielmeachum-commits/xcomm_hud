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
    Personnel,
    Service,
    ServiceTemplate,
    Site,
    SiteCanvasPosition,
    Team,
    Unit,
    User,
    WorkCenter,
    Workspace,
)
from pubsub import notify
from workspace_slug import unique_workspace_slug
from schemas import (
    ExportedAnnotation,
    ExportedGateway,
    ExportedPersonnel,
    ExportedPosition,
    ExportedService,
    ExportedSite,
    ExportedTeam,
    ExportedUnit,
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

    return WorkspaceExport(
        exported_at=datetime.datetime.now(datetime.timezone.utc),
        workspace=ExportedWorkspaceMeta(
            name=ws.name,
            description=ws.description,
            tags=list(ws.tags),
        ),
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
