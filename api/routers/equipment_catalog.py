"""Equipment catalog: types, UTC definitions, package definitions.

Catalog rows come in two flavours, following the same pattern as Rule and
EventTypeDef: `workspace_id IS NULL` is a global, admin-managed row (NSNs and
UTC composition are service-wide facts), and a non-null workspace_id is a
local addition. Reads return both, merged. Writes to a global row require
`admin`; writes to a workspace row require `operator`.

Deletes are soft (`retired_at`) rather than hard, because `utc_def_line` and
`equipment` both hold RESTRICT foreign keys into the catalog — hard-deleting a
type that real gear points at would strip that gear of its identity.
"""

from __future__ import annotations

import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, selectinload

from db import get_db
from deps import get_current_workspace, requires
from models import (
    Equipment,
    EquipmentHolding,
    EquipmentType,
    EquipmentTypeCapability,
    PackageDef,
    PackageDefUtc,
    User,
    UtcDef,
    UtcDefLine,
    Workspace,
)
from pubsub import notify
from schemas import (
    EquipmentTypeIn,
    EquipmentTypeOut,
    EquipmentTypePatch,
    PackageDefIn,
    PackageDefOut,
    PackageDefPatch,
    UtcDefIn,
    UtcDefOut,
    UtcDefPatch,
)

router = APIRouter(tags=["equipment-catalog"])


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _require_write(row_workspace_id: int | None, user: User) -> None:
    """Global catalog rows are admin-only; workspace rows need operator.

    The route dependency already established `operator`, so this only has to
    add the extra bar for globals.
    """
    if row_workspace_id is None and user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Editing the global catalog requires admin",
        )


def _visible(model, workspace: Workspace, include_retired: bool):
    """Global rows plus this workspace's own, optionally including retired."""
    q = (model.workspace_id.is_(None)) | (model.workspace_id == workspace.id)
    if include_retired:
        return q
    return q & (model.retired_at.is_(None))


# ---------- Equipment types ----------


def _norm_tags(tags: list[str]) -> list[str]:
    """Lowercase, trim, drop blanks, dedupe — order preserved.

    Normalizing here rather than in the schema keeps `tags` a plain field on a
    plain model, and means "CCI" and "cci" can never both exist on a row and
    split a filter.
    """
    seen: dict[str, None] = {}
    for t in tags:
        cleaned = t.strip().lower()
        if cleaned:
            seen.setdefault(cleaned, None)
    return list(seen)


def _type_out(row: EquipmentType) -> EquipmentTypeOut:
    out = EquipmentTypeOut.model_validate(row)
    out.is_global = row.workspace_id is None
    return out


def _load_type(db: Session, type_id: int, workspace: Workspace) -> EquipmentType:
    row = db.get(EquipmentType, type_id)
    if row is None or (
        row.workspace_id is not None and row.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Equipment type not found")
    return row


@router.get("/equipment-types", response_model=list[EquipmentTypeOut])
def list_equipment_types(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    include_retired: bool = Query(default=False),
    _=Depends(requires("viewer")),
):
    rows = (
        db.query(EquipmentType)
        .options(selectinload(EquipmentType.capabilities))
        .filter(_visible(EquipmentType, workspace, include_retired))
        .order_by(EquipmentType.category, EquipmentType.title)
        .all()
    )
    return [_type_out(r) for r in rows]


@router.post(
    "/equipment-types",
    response_model=EquipmentTypeOut,
    status_code=status.HTTP_201_CREATED,
)
def create_equipment_type(
    body: EquipmentTypeIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    # `global` here means "seed the shared catalog" — admins only.
    make_global: bool = Query(default=False, alias="global"),
    current_user: User = Depends(requires("operator")),
):
    owner_id = None if make_global else workspace.id
    _require_write(owner_id, current_user)

    payload = body.model_dump(exclude={"capabilities"})
    payload["tags"] = _norm_tags(payload.get("tags") or [])
    row = EquipmentType(workspace_id=owner_id, **payload)
    db.add(row)
    db.flush()
    for order, cap in enumerate(body.capabilities):
        db.add(
            EquipmentTypeCapability(
                equipment_type_id=row.id,
                **{**cap.model_dump(exclude={"display_order"}), "display_order": order},
            )
        )
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _type_out(row)


@router.patch("/equipment-types/{type_id}", response_model=EquipmentTypeOut)
def patch_equipment_type(
    type_id: int,
    body: EquipmentTypePatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_type(db, type_id, workspace)
    _require_write(row.workspace_id, current_user)
    data = body.model_dump(exclude_unset=True)
    retired = data.pop("retired", None)
    if "tags" in data:
        data["tags"] = _norm_tags(data["tags"] or [])
    for k, v in data.items():
        setattr(row, k, v)
    if retired is not None:
        row.retired_at = _now() if retired else None
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _type_out(row)


@router.put(
    "/equipment-types/{type_id}/capabilities", response_model=EquipmentTypeOut
)
def replace_type_capabilities(
    type_id: int,
    body: list[dict],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Replace the declared capability list wholesale.

    Editing declarations does NOT retroactively change already-registered
    gear — instances carry their own materialized rows on purpose, so a
    catalog fix can't silently rewrite what an operator recorded about a
    specific kit.
    """
    row = _load_type(db, type_id, workspace)
    _require_write(row.workspace_id, current_user)
    db.query(EquipmentTypeCapability).filter(
        EquipmentTypeCapability.equipment_type_id == row.id
    ).delete(synchronize_session=False)
    for order, cap in enumerate(body):
        db.add(
            EquipmentTypeCapability(
                equipment_type_id=row.id,
                kind=cap["kind"],
                label=cap["label"],
                description=cap.get("description"),
                display_order=order,
                materialize_by_default=cap.get("materialize_by_default", True),
            )
        )
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _type_out(row)


@router.delete("/equipment-types/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_equipment_type(
    type_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("admin")),
):
    """Hard delete, allowed only when nothing references the type.

    Anything in use must be retired instead — the RESTRICT foreign keys would
    reject the delete anyway, but a 409 with a reason beats a raw integrity
    error surfacing as a 500.
    """
    row = _load_type(db, type_id, workspace)
    _require_write(row.workspace_id, current_user)

    in_use = (
        db.query(UtcDefLine).filter(UtcDefLine.equipment_type_id == row.id).first()
        or db.query(Equipment).filter(Equipment.equipment_type_id == row.id).first()
        or db.query(EquipmentHolding)
        .filter(EquipmentHolding.equipment_type_id == row.id)
        .first()
    )
    if in_use is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Equipment type is in use by a UTC definition or registered gear — "
            "retire it instead of deleting.",
        )
    db.delete(row)
    notify(background_tasks)


# ---------- UTC definitions ----------


def _utc_def_out(db: Session, row: UtcDef) -> UtcDefOut:
    out = UtcDefOut.model_validate(row)
    out.is_global = row.workspace_id is None
    if row.lines:
        types = {
            t.id: t
            for t in db.query(EquipmentType).filter(
                EquipmentType.id.in_([line.equipment_type_id for line in row.lines])
            )
        }
        for line_out, line in zip(out.lines, row.lines):
            t = types.get(line.equipment_type_id)
            if t is not None:
                line_out.equipment_type_title = t.title
                line_out.equipment_type_short_name = t.short_name
                line_out.serialized = t.serialized
    return out


def _load_utc_def(db: Session, utc_def_id: int, workspace: Workspace) -> UtcDef:
    row = db.get(UtcDef, utc_def_id)
    if row is None or (
        row.workspace_id is not None and row.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "UTC definition not found")
    return row


@router.get("/utc-defs", response_model=list[UtcDefOut])
def list_utc_defs(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    include_retired: bool = Query(default=False),
    _=Depends(requires("viewer")),
):
    rows = (
        db.query(UtcDef)
        .options(selectinload(UtcDef.lines))
        .filter(_visible(UtcDef, workspace, include_retired))
        .order_by(UtcDef.code)
        .all()
    )
    return [_utc_def_out(db, r) for r in rows]


@router.post(
    "/utc-defs", response_model=UtcDefOut, status_code=status.HTTP_201_CREATED
)
def create_utc_def(
    body: UtcDefIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    make_global: bool = Query(default=False, alias="global"),
    current_user: User = Depends(requires("operator")),
):
    owner_id = None if make_global else workspace.id
    _require_write(owner_id, current_user)
    row = UtcDef(workspace_id=owner_id, **body.model_dump(exclude={"lines"}))
    db.add(row)
    db.flush()
    for order, line in enumerate(body.lines):
        _load_type(db, line.equipment_type_id, workspace)
        db.add(
            UtcDefLine(
                utc_def_id=row.id,
                **{
                    **line.model_dump(exclude={"display_order"}),
                    "display_order": order,
                },
            )
        )
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _utc_def_out(db, row)


@router.patch("/utc-defs/{utc_def_id}", response_model=UtcDefOut)
def patch_utc_def(
    utc_def_id: int,
    body: UtcDefPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_utc_def(db, utc_def_id, workspace)
    _require_write(row.workspace_id, current_user)
    data = body.model_dump(exclude_unset=True)
    retired = data.pop("retired", None)
    for k, v in data.items():
        setattr(row, k, v)
    if retired is not None:
        row.retired_at = _now() if retired else None
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _utc_def_out(db, row)


@router.put("/utc-defs/{utc_def_id}/lines", response_model=UtcDefOut)
def replace_utc_def_lines(
    utc_def_id: int,
    body: list[dict],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_utc_def(db, utc_def_id, workspace)
    _require_write(row.workspace_id, current_user)
    db.query(UtcDefLine).filter(UtcDefLine.utc_def_id == row.id).delete(
        synchronize_session=False
    )
    for order, line in enumerate(body):
        _load_type(db, int(line["equipment_type_id"]), workspace)
        db.add(
            UtcDefLine(
                utc_def_id=row.id,
                equipment_type_id=int(line["equipment_type_id"]),
                quantity=int(line.get("quantity", 1)),
                notes=line.get("notes"),
                display_order=order,
            )
        )
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _utc_def_out(db, row)


@router.delete("/utc-defs/{utc_def_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_utc_def(
    utc_def_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("admin")),
):
    row = _load_utc_def(db, utc_def_id, workspace)
    _require_write(row.workspace_id, current_user)
    if db.query(PackageDefUtc).filter(PackageDefUtc.utc_def_id == row.id).first():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "UTC definition is used by a package definition — retire it instead.",
        )
    db.delete(row)
    notify(background_tasks)


# ---------- Package definitions ----------


def _package_def_out(db: Session, row: PackageDef) -> PackageDefOut:
    out = PackageDefOut.model_validate(row)
    out.is_global = row.workspace_id is None
    if row.utcs:
        defs = {
            d.id: d
            for d in db.query(UtcDef).filter(
                UtcDef.id.in_([u.utc_def_id for u in row.utcs])
            )
        }
        for utc_out, utc in zip(out.utcs, row.utcs):
            d = defs.get(utc.utc_def_id)
            if d is not None:
                utc_out.utc_def_code = d.code
                utc_out.utc_def_name = d.name
    return out


def _load_package_def(
    db: Session, package_def_id: int, workspace: Workspace
) -> PackageDef:
    row = db.get(PackageDef, package_def_id)
    if row is None or (
        row.workspace_id is not None and row.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Package definition not found")
    return row


@router.get("/package-defs", response_model=list[PackageDefOut])
def list_package_defs(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    include_retired: bool = Query(default=False),
    _=Depends(requires("viewer")),
):
    rows = (
        db.query(PackageDef)
        .options(selectinload(PackageDef.utcs))
        .filter(_visible(PackageDef, workspace, include_retired))
        .order_by(PackageDef.code)
        .all()
    )
    return [_package_def_out(db, r) for r in rows]


@router.post(
    "/package-defs", response_model=PackageDefOut, status_code=status.HTTP_201_CREATED
)
def create_package_def(
    body: PackageDefIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    make_global: bool = Query(default=False, alias="global"),
    current_user: User = Depends(requires("operator")),
):
    owner_id = None if make_global else workspace.id
    _require_write(owner_id, current_user)
    row = PackageDef(workspace_id=owner_id, **body.model_dump(exclude={"utcs"}))
    db.add(row)
    db.flush()
    for order, utc in enumerate(body.utcs):
        _load_utc_def(db, utc.utc_def_id, workspace)
        db.add(
            PackageDefUtc(
                package_def_id=row.id,
                **{**utc.model_dump(exclude={"display_order"}), "display_order": order},
            )
        )
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _package_def_out(db, row)


@router.patch("/package-defs/{package_def_id}", response_model=PackageDefOut)
def patch_package_def(
    package_def_id: int,
    body: PackageDefPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_package_def(db, package_def_id, workspace)
    _require_write(row.workspace_id, current_user)
    data = body.model_dump(exclude_unset=True)
    retired = data.pop("retired", None)
    for k, v in data.items():
        setattr(row, k, v)
    if retired is not None:
        row.retired_at = _now() if retired else None
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _package_def_out(db, row)


@router.put("/package-defs/{package_def_id}/utcs", response_model=PackageDefOut)
def replace_package_def_utcs(
    package_def_id: int,
    body: list[dict],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_package_def(db, package_def_id, workspace)
    _require_write(row.workspace_id, current_user)
    db.query(PackageDefUtc).filter(PackageDefUtc.package_def_id == row.id).delete(
        synchronize_session=False
    )
    for order, utc in enumerate(body):
        _load_utc_def(db, int(utc["utc_def_id"]), workspace)
        db.add(
            PackageDefUtc(
                package_def_id=row.id,
                utc_def_id=int(utc["utc_def_id"]),
                quantity=int(utc.get("quantity", 1)),
                role_hint=utc.get("role_hint", "either"),
                display_order=order,
            )
        )
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _package_def_out(db, row)


@router.delete(
    "/package-defs/{package_def_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_package_def(
    package_def_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("admin")),
):
    row = _load_package_def(db, package_def_id, workspace)
    _require_write(row.workspace_id, current_user)
    db.delete(row)
    notify(background_tasks)
