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
    Enclave,
    Equipment,
    EquipmentHolding,
    EquipmentType,
    EquipmentTypeCapability,
    EquipmentTypeEnclave,
    EquipmentTypeWorkCenter,
    PackageDef,
    PackageDefUtc,
    User,
    UtcDef,
    UtcDefLine,
    UtcDefManforLine,
    WorkCenter,
    Workspace,
)
from pubsub import notify
from routers.work_centers import load_visible as load_work_center
from schemas import (
    EquipmentTypeCapabilityIn,
    EquipmentTypeIn,
    EquipmentTypeOut,
    EquipmentTypePatch,
    EquipmentTypeWorkCenterIn,
    EquipmentTypeWorkCenterOut,
    PackageDefIn,
    PackageDefOut,
    PackageDefPatch,
    UtcDefIn,
    UtcDefLineIn,
    UtcDefManforLineIn,
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


def _type_out(
    db: Session, row: EquipmentType, workspace: Workspace
) -> EquipmentTypeOut:
    out = EquipmentTypeOut.model_validate(row)
    out.is_global = row.workspace_id is None
    out.enclave_ids = sorted(link.enclave_id for link in row.enclave_links)
    # Ownership is answered per workspace, so a global type carries every
    # workspace's links — only this one's are its answer. Primary first, then
    # by id: the responsible shop is the one people look for.
    links = sorted(
        (l for l in row.work_center_links if l.workspace_id == workspace.id),
        key=lambda l: (not l.is_primary, l.id),
    )
    names = {
        w.id: w.name
        for w in db.query(WorkCenter).filter(
            WorkCenter.id.in_([l.work_center_id for l in links])
        )
    } if links else {}
    out.work_centers = [
        EquipmentTypeWorkCenterOut(
            id=l.id,
            equipment_type_id=l.equipment_type_id,
            work_center_id=l.work_center_id,
            is_primary=l.is_primary,
            work_center_name=names.get(l.work_center_id),
        )
        for l in links
    ]
    return out


def _set_type_work_centers(
    db: Session,
    row: EquipmentType,
    links: list[EquipmentTypeWorkCenterIn],
    workspace: Workspace,
) -> None:
    """Replace the responsible-work-center set. Wholesale, like capabilities.

    Scoped to the caller's workspace on both sides: the rows written carry
    `workspace_id`, and only that workspace's work centers may be named. That
    is what lets a workspace answer for a GLOBAL equipment type without
    claiming to speak for anyone else's.

    At most one primary survives — a second `is_primary` would trip
    `uq_equipment_type_work_center_primary`, and silently keeping the first is
    friendlier than a 409 about a checkbox.
    """
    db.query(EquipmentTypeWorkCenter).filter(
        EquipmentTypeWorkCenter.equipment_type_id == row.id,
        EquipmentTypeWorkCenter.workspace_id == workspace.id,
    ).delete(synchronize_session=False)

    seen_primary = False
    for link in {l.work_center_id: l for l in links}.values():
        wc = load_work_center(db, link.work_center_id, workspace)
        if wc is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Work center {link.work_center_id} not found",
            )
        primary = link.is_primary and not seen_primary
        seen_primary = seen_primary or primary
        db.add(
            EquipmentTypeWorkCenter(
                workspace_id=workspace.id,
                equipment_type_id=row.id,
                work_center_id=wc.id,
                is_primary=primary,
            )
        )


def _set_type_enclaves(
    db: Session, row: EquipmentType, enclave_ids: list[int], workspace: Workspace
) -> None:
    """Replace the capable-enclave set. Wholesale, like capabilities.

    Validates visibility so a workspace can't declare capability for another
    workspace's enclave. Duplicates are collapsed rather than rejected — the
    caller sent a set, not a sequence.
    """
    db.query(EquipmentTypeEnclave).filter(
        EquipmentTypeEnclave.equipment_type_id == row.id
    ).delete(synchronize_session=False)
    for enclave_id in dict.fromkeys(enclave_ids):
        enclave = db.get(Enclave, enclave_id)
        if enclave is None or (
            enclave.workspace_id is not None
            and enclave.workspace_id != workspace.id
        ):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"Enclave {enclave_id} not found"
            )
        db.add(
            EquipmentTypeEnclave(equipment_type_id=row.id, enclave_id=enclave.id)
        )


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
        .options(
            selectinload(EquipmentType.work_center_links),
            selectinload(EquipmentType.capabilities),
            selectinload(EquipmentType.enclave_links),
        )
        .filter(_visible(EquipmentType, workspace, include_retired))
        .order_by(
            EquipmentType.category, EquipmentType.subcategory, EquipmentType.title
        )
        .all()
    )
    return [_type_out(db, r, workspace) for r in rows]


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

    payload = body.model_dump(
        exclude={"capabilities", "enclave_ids", "work_centers"}
    )
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
    _set_type_enclaves(db, row, body.enclave_ids, workspace)
    _set_type_work_centers(db, row, body.work_centers, workspace)
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _type_out(db, row, workspace)


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
    return _type_out(db, row, workspace)


@router.put(
    "/equipment-types/{type_id}/capabilities", response_model=EquipmentTypeOut
)
def replace_type_capabilities(
    type_id: int,
    body: list[EquipmentTypeCapabilityIn],
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
                kind=cap.kind,
                label=cap.label,
                description=cap.description,
                display_order=order,
                materialize_by_default=cap.materialize_by_default,
            )
        )
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _type_out(db, row, workspace)


@router.put("/equipment-types/{type_id}/enclaves", response_model=EquipmentTypeOut)
def replace_type_enclaves(
    type_id: int,
    body: list[int],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Replace which enclaves this model of gear can serve.

    Like capabilities, this does NOT retroactively change already-registered
    gear: an instance keeps whatever `enclave_id` an operator recorded, even if
    the type stops declaring it. Narrowing the catalog must not silently
    rewrite history.
    """
    row = _load_type(db, type_id, workspace)
    _require_write(row.workspace_id, current_user)
    _set_type_enclaves(db, row, body, workspace)
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _type_out(db, row, workspace)


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


def _merge_manfor(lines: list[UtcDefManforLineIn]) -> list[UtcDefManforLineIn]:
    """Fold duplicate (shop, skill level) pairs into one line, summing the count.

    `uq_utc_def_manfor_shop_level` would reject the second row outright, and a
    500 about a unique index is a worse answer than storing what the caller
    plainly meant: two requests for a Sys Ops 7-level are a request for two.
    Same instinct as `_set_type_work_centers` keeping the first primary rather
    than 409-ing about a checkbox.

    Keyed on the trimmed name exactly as the constraint sees it, so the router
    and the database never disagree about what counts as a duplicate. Order of
    first appearance is kept — the MANFOR is an ordered list.
    """
    merged: dict[tuple[str, int | None], UtcDefManforLineIn] = {}
    for line in lines:
        key = (line.work_center.strip(), line.skill_level)
        first = merged.get(key)
        if first is None:
            merged[key] = line.model_copy()
        else:
            first.quantity += line.quantity
    return list(merged.values())


def _manfor_row(
    utc_def_id: int, line: UtcDefManforLineIn, order: int
) -> UtcDefManforLine:
    """One authorized position, normalized.

    The shop is trimmed but NOT case-folded: it is a work center's name, and
    names are shown as their owner wrote them.
    """
    return UtcDefManforLine(
        utc_def_id=utc_def_id,
        work_center=line.work_center.strip(),
        skill_level=line.skill_level,
        quantity=line.quantity,
        display_order=order,
    )


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
        .options(selectinload(UtcDef.lines), selectinload(UtcDef.manfor))
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
    row = UtcDef(
        workspace_id=owner_id, **body.model_dump(exclude={"lines", "manfor"})
    )
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
    for order, position in enumerate(_merge_manfor(body.manfor)):
        db.add(_manfor_row(row.id, position, order))
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


@router.put(
    "/equipment-types/{type_id}/work-centers", response_model=EquipmentTypeOut
)
def replace_type_work_centers(
    type_id: int,
    body: list[EquipmentTypeWorkCenterIn],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Replace which work centers answer for this type, wholesale.

    Note this does NOT go through `_require_write`: naming your own shop as
    responsible for a global catalog row is a workspace-local fact, not an edit
    to the shared catalog, and `_set_type_work_centers` only ever touches rows
    carrying this workspace's id. Requiring admin here would mean no ordinary
    workspace could ever say who owns a globally-catalogued radio.
    """
    row = _load_type(db, type_id, workspace)
    _set_type_work_centers(db, row, body, workspace)
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _type_out(db, row, workspace)


@router.put("/utc-defs/{utc_def_id}/lines", response_model=UtcDefOut)
def replace_utc_def_lines(
    utc_def_id: int,
    body: list[UtcDefLineIn],
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
        _load_type(db, line.equipment_type_id, workspace)
        db.add(
            UtcDefLine(
                utc_def_id=row.id,
                equipment_type_id=line.equipment_type_id,
                quantity=line.quantity,
                # Carried through on purpose: dropping it here would silently
                # untag every line the moment someone edited the bill of
                # materials, and the deploy wizard's enclave step reads this.
                enclave_id=line.enclave_id,
                notes=line.notes,
                display_order=order,
            )
        )
    db.flush()
    db.refresh(row)
    notify(background_tasks)
    return _utc_def_out(db, row)


@router.put("/utc-defs/{utc_def_id}/manfor", response_model=UtcDefOut)
def replace_utc_def_manfor(
    utc_def_id: int,
    body: list[UtcDefManforLineIn],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Replace the UTC's authorized positions, wholesale.

    Same shape as `/lines` next door: the MANFOR is edited as a list and saved
    as one, so a reorder and a removal are one write rather than three. No
    RESTRICT foreign key points at a position — a position authorizes a slot
    rather than naming a person — so delete-and-reinsert is safe here in a way
    it would not be for equipment.
    """
    row = _load_utc_def(db, utc_def_id, workspace)
    _require_write(row.workspace_id, current_user)
    db.query(UtcDefManforLine).filter(UtcDefManforLine.utc_def_id == row.id).delete(
        synchronize_session=False
    )
    for order, position in enumerate(_merge_manfor(body)):
        db.add(_manfor_row(row.id, position, order))
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

    # A package may carry the same UTC in two roles — a primary and the
    # alternate standing by for it — but the same UTC in the same role twice is
    # a quantity of two, not a second row. `uq_package_def_utc_role` enforces
    # that; catching it here turns an IntegrityError 500 into something a form
    # can put next to the offending field.
    seen: set[tuple[int, str]] = set()
    for utc in body:
        pair = (int(utc["utc_def_id"]), utc.get("role_hint", "either"))
        if pair in seen:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "The same UTC is listed twice in the same role — raise its "
                "quantity instead.",
            )
        seen.add(pair)

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
