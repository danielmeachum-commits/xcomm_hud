"""Equipment kits — saved rosters of the gear a package actually brings.

See docs/design/equipment-kits.md.

Kits sit between doctrine and deployment. `package_def` says a Flyaway Comms
Package carries two AN/TSC-198s; a kit says *ours are these two*, by pinning
`equipment_asset` rows from the property book.

Kits follow the same global-or-workspace shape as enclaves and the equipment
catalog: `workspace_id IS NULL` is a global, admin-managed row, a non-null one
is a local addition, and reads merge both. Global is the normal case — a
workspace is an operating picture, not a tenant, so a kit describing the unit's
gear outlives any one exercise.

Two facts about pinning shape most of this file:

* A pin is non-exclusive in both directions. One TACLANE can be listed by every
  kit that would use it; and the same asset can be materialized into several
  workspaces at once, because planning next month's exercise while this
  month's is live is ordinary.
* A pin is not a reservation. `commitments` reports which pictures already hold
  a box so the operator can see it, but nothing refuses on that basis.
"""

from __future__ import annotations

import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, selectinload

from action_registry import record_action
from db import get_db
from deps import get_current_workspace, requires
from models import (
    Enclave,
    Equipment,
    EquipmentAsset,
    EquipmentAssetCapability,
    EquipmentHolding,
    EquipmentKit,
    EquipmentKitBulk,
    EquipmentKitItem,
    EquipmentKitUtc,
    EquipmentType,
    PackageDef,
    PackageInstance,
    Site,
    User,
    UtcDef,
    UtcInstance,
    Workspace,
)
from pubsub import notify
from schemas import (
    AssetCommitment,
    EquipmentKitIn,
    EquipmentKitOut,
    EquipmentKitPatch,
    EquipmentKitUtcIn,
    EquipmentKitUtcOut,
    EquipmentKitBulkOut,
    EquipmentKitItemOut,
    KitCaptureIn,
    KitRefreshIn,
    SubjectKinds,
)

router = APIRouter(prefix="/kits", tags=["equipment-kits"])


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _require_write(row_workspace_id: int | None, user: User) -> None:
    """Global kits are admin-only; workspace kits need operator.

    Mirrors equipment_catalog._require_write and enclaves._require_write — the
    route dependency already established `operator`, so this only adds the bar
    for the global tier.
    """
    if row_workspace_id is None and user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Editing a global kit requires admin",
        )


def _load_kit(db: Session, kit_id: int, workspace: Workspace) -> EquipmentKit:
    row = (
        db.query(EquipmentKit)
        .options(
            selectinload(EquipmentKit.utcs).selectinload(EquipmentKitUtc.items),
            selectinload(EquipmentKit.utcs).selectinload(EquipmentKitUtc.bulk),
        )
        .filter(EquipmentKit.id == kit_id)
        .first()
    )
    # Global rows are visible from every workspace; a workspace's own kit is
    # visible only from it.
    if row is None or (
        row.workspace_id is not None and row.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kit not found")
    return row


def _load_package(db: Session, package_id: int, workspace: Workspace) -> PackageInstance:
    row = db.get(PackageInstance, package_id)
    if row is None or row.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Package not found")
    return row


# ---------- serialization ----------


class _KitContext:
    """Everything needed to fatten a kit's items, loaded once per response.

    A kit of three UTCs carrying nine radios each would otherwise issue a query
    per item for the asset, another for every workspace holding it, and another
    for that workspace's UTC. Built in the bulk style `routers/status.py::rollup`
    established.
    """

    def __init__(self, db: Session, workspace: Workspace, kits: list[EquipmentKit]):
        asset_ids: set[int] = set()
        type_ids: set[int] = set()
        def_ids: set[int] = set()
        for kit in kits:
            for ku in kit.utcs:
                if ku.utc_def_id:
                    def_ids.add(ku.utc_def_id)
                for item in ku.items:
                    asset_ids.add(item.asset_id)
                for b in ku.bulk:
                    type_ids.add(b.equipment_type_id)

        self.assets: dict[int, EquipmentAsset] = {}
        if asset_ids:
            for a in (
                db.query(EquipmentAsset)
                .options(selectinload(EquipmentAsset.capabilities))
                .filter(EquipmentAsset.id.in_(asset_ids))
            ):
                self.assets[a.id] = a
                type_ids.add(a.equipment_type_id)

        self.types: dict[int, EquipmentType] = {}
        if type_ids:
            for t in db.query(EquipmentType).filter(EquipmentType.id.in_(type_ids)):
                self.types[t.id] = t

        self.utc_defs: dict[int, UtcDef] = {}
        if def_ids:
            for d in db.query(UtcDef).filter(UtcDef.id.in_(def_ids)):
                self.utc_defs[d.id] = d

        # Which pictures already hold each asset. Across ALL workspaces on
        # purpose — "this radio is already in the Fort Pickett plan" is exactly
        # the thing worth knowing before promising it here.
        self.commitments: dict[int, list[AssetCommitment]] = {}
        self.here: set[int] = set()
        if asset_ids:
            rows = (
                db.query(Equipment).filter(Equipment.asset_id.in_(asset_ids)).all()
            )
            ws_ids = {r.workspace_id for r in rows}
            utc_ids = {r.utc_instance_id for r in rows if r.utc_instance_id}
            site_ids = {r.site_id for r in rows}
            wss = (
                {w.id: w for w in db.query(Workspace).filter(Workspace.id.in_(ws_ids))}
                if ws_ids
                else {}
            )
            utcs = (
                {
                    u.id: u
                    for u in db.query(UtcInstance).filter(UtcInstance.id.in_(utc_ids))
                }
                if utc_ids
                else {}
            )
            sites = (
                {s.id: s for s in db.query(Site).filter(Site.id.in_(site_ids))}
                if site_ids
                else {}
            )
            for r in rows:
                if r.workspace_id == workspace.id:
                    self.here.add(r.asset_id)
                w = wss.get(r.workspace_id)
                u = utcs.get(r.utc_instance_id) if r.utc_instance_id else None
                st = sites.get(r.site_id)
                self.commitments.setdefault(r.asset_id, []).append(
                    AssetCommitment(
                        workspace_id=r.workspace_id,
                        workspace_name=w.name if w else f"Workspace {r.workspace_id}",
                        equipment_id=r.id,
                        utc_instance_id=u.id if u else None,
                        utc_name=u.name if u else None,
                        site_name=st.name if st else None,
                    )
                )

        self.package_defs: dict[int, PackageDef] = {}
        pd_ids = {k.package_def_id for k in kits if k.package_def_id}
        if pd_ids:
            for pd in db.query(PackageDef).filter(PackageDef.id.in_(pd_ids)):
                self.package_defs[pd.id] = pd


def _item_out(row: EquipmentKitItem, ctx: _KitContext) -> EquipmentKitItemOut:
    out = EquipmentKitItemOut.model_validate(row)
    asset = ctx.assets.get(row.asset_id)
    if asset is None:
        # The FK cascades, so this should be unreachable — but a kit rendering
        # a blank row is a better failure than a 500.
        return out
    out.equipment_code = asset.equipment_code
    out.serial_number = asset.serial_number
    out.equipment_type_id = asset.equipment_type_id
    out.capability_kinds = [c.kind for c in asset.capabilities]
    out.retired = asset.retired_at is not None
    t = ctx.types.get(asset.equipment_type_id)
    if t is not None:
        out.type_title = t.title
        out.type_short_name = t.short_name
    out.commitments = ctx.commitments.get(asset.id, [])
    out.in_this_workspace = asset.id in ctx.here
    return out


def _bulk_out(row: EquipmentKitBulk, ctx: _KitContext) -> EquipmentKitBulkOut:
    out = EquipmentKitBulkOut.model_validate(row)
    t = ctx.types.get(row.equipment_type_id)
    if t is not None:
        out.type_title = t.title
        out.type_short_name = t.short_name
    return out


def _kit_utc_out(row: EquipmentKitUtc, ctx: _KitContext) -> EquipmentKitUtcOut:
    out = EquipmentKitUtcOut.model_validate(row)
    if row.utc_def_id is not None:
        d = ctx.utc_defs.get(row.utc_def_id)
        if d is not None:
            out.utc_def_code = d.code
            out.utc_def_name = d.name
    out.items = [_item_out(i, ctx) for i in row.items]
    out.bulk = [_bulk_out(b, ctx) for b in row.bulk]
    return out


def _kit_out(row: EquipmentKit, ctx: _KitContext) -> EquipmentKitOut:
    out = EquipmentKitOut.model_validate(row)
    out.is_global = row.workspace_id is None
    if row.package_def_id is not None:
        pd = ctx.package_defs.get(row.package_def_id)
        if pd is not None:
            out.package_def_code = pd.code
    out.utcs = [_kit_utc_out(u, ctx) for u in row.utcs]
    out.item_count = sum(len(u.items) for u in out.utcs)
    out.bulk_count = sum(b.quantity for u in out.utcs for b in u.bulk)
    out.committed_count = sum(
        1 for u in out.utcs for i in u.items if i.commitments
    )
    out.retired_count = sum(1 for u in out.utcs for i in u.items if i.retired)
    return out


# ---------- writes shared by create, replace, and capture ----------


def _validate_asset_ids(db: Session, asset_ids: list[int]) -> None:
    """Every pin must be a real property-book asset.

    Checked in one query rather than per item: a kit captured from a large
    package pins dozens at once, and the failure worth reporting is the whole
    set, not whichever tripped first.
    """
    if not asset_ids:
        return
    found = {
        a_id
        for (a_id,) in db.query(EquipmentAsset.id).filter(
            EquipmentAsset.id.in_(set(asset_ids))
        )
    }
    missing = sorted(set(asset_ids) - found)
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Assets not found in the property book: {missing}",
        )


def _write_kit_utcs(
    db: Session, workspace: Workspace, kit: EquipmentKit, utcs: list[EquipmentKitUtcIn]
) -> None:
    """Replace a kit's whole UTC tree.

    Wholesale replace rather than diff, matching `utc_def`'s lines endpoint.
    Kit rows carry no state anything else points at — no FK targets them — so
    churning their ids costs nothing, and the alternative is reconciliation
    logic with no payoff.
    """
    kit.utcs.clear()
    db.flush()

    _validate_asset_ids(db, [i.asset_id for u in utcs for i in u.items])

    for order, u in enumerate(utcs):
        if u.utc_def_id is not None:
            d = db.get(UtcDef, u.utc_def_id)
            if d is None or (
                d.workspace_id is not None and d.workspace_id != workspace.id
            ):
                raise HTTPException(
                    status.HTTP_404_NOT_FOUND,
                    f"UTC definition {u.utc_def_id} not found",
                )
        row = EquipmentKitUtc(
            kit_id=kit.id,
            utc_def_id=u.utc_def_id,
            name=u.name,
            role_hint=u.role_hint,
            notes=u.notes,
            display_order=u.display_order or order,
        )
        db.add(row)
        db.flush()
        # Dedup within a slot: the unique constraint would reject it anyway,
        # and a 500 from a constraint is a worse answer than just pinning it
        # once.
        seen: set[int] = set()
        for i_order, item in enumerate(u.items):
            if item.asset_id in seen:
                continue
            seen.add(item.asset_id)
            db.add(
                EquipmentKitItem(
                    kit_utc_id=row.id,
                    asset_id=item.asset_id,
                    display_order=item.display_order or i_order,
                )
            )
        for b in u.bulk:
            t = db.get(EquipmentType, b.equipment_type_id)
            if t is None or (
                t.workspace_id is not None and t.workspace_id != workspace.id
            ):
                raise HTTPException(
                    status.HTTP_404_NOT_FOUND,
                    f"Equipment type {b.equipment_type_id} not found",
                )
            if b.enclave_id is not None:
                e = db.get(Enclave, b.enclave_id)
                if e is None or (
                    e.workspace_id is not None and e.workspace_id != workspace.id
                ):
                    raise HTTPException(
                        status.HTTP_404_NOT_FOUND, f"Enclave {b.enclave_id} not found"
                    )
                # A global kit pointing at one workspace's enclave would be
                # broken for every other picture that deploys it.
                if kit.workspace_id is None and e.workspace_id is not None:
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST,
                        f"Global kits can only use global enclaves — "
                        f"'{e.name}' belongs to a workspace.",
                    )
            db.add(
                EquipmentKitBulk(
                    kit_utc_id=row.id,
                    equipment_type_id=b.equipment_type_id,
                    quantity=b.quantity,
                    enclave_id=b.enclave_id,
                )
            )
    db.flush()


def _promote_to_asset(db: Session, eq: Equipment) -> EquipmentAsset | None:
    """The property-book row for this piece of gear, creating it if needed.

    This is what makes "Save as kit" work from a workspace that predates the
    property book: the serials already typed into an operating picture become
    the unit's inventory, once, instead of being retyped globally.

    Matching is by serial first, then by equipment ID. A matching ID with a
    *different* serial is two different boxes colliding in the namespace, not
    one box — promoting that would silently merge two radios, so it is refused
    by returning None and the caller drops the pin.
    """
    if eq.asset_id is not None:
        return db.get(EquipmentAsset, eq.asset_id)

    match = None
    if eq.serial_number:
        match = (
            db.query(EquipmentAsset)
            .filter(EquipmentAsset.serial_number == eq.serial_number)
            .first()
        )
    if match is None:
        by_code = (
            db.query(EquipmentAsset)
            .filter(EquipmentAsset.equipment_code == eq.equipment_code)
            .first()
        )
        if by_code is not None:
            if (
                eq.serial_number
                and by_code.serial_number
                and by_code.serial_number != eq.serial_number
            ):
                return None
            match = by_code
    if match is not None:
        eq.asset_id = match.id
        db.flush()
        return match

    asset = EquipmentAsset(
        equipment_type_id=eq.equipment_type_id,
        equipment_code=eq.equipment_code,
        serial_number=eq.serial_number,
        notes=eq.notes,
    )
    db.add(asset)
    db.flush()
    for order, cap in enumerate(eq.capabilities):
        db.add(
            EquipmentAssetCapability(
                asset_id=asset.id, kind=cap.kind, display_order=order
            )
        )
    eq.asset_id = asset.id
    db.flush()
    return asset


def _capture_utcs(
    db: Session, workspace: Workspace, package: PackageInstance
) -> tuple[list[EquipmentKitUtcIn], list[str]]:
    """Read a live package back out as kit input, promoting its gear.

    Reads from what is physically attached (`equipment`, `equipment_holding`),
    not from `utc_instance_line`. The snapshot records what the deployment
    *meant* to bring; a kit should record what it actually took, since that is
    the configuration worth repeating.

    Returns the slots plus any gear that could not be promoted, so the caller
    can say so rather than silently dropping it.
    """
    from schemas import EquipmentKitBulkIn, EquipmentKitItemIn

    utcs = (
        db.query(UtcInstance)
        .filter(
            UtcInstance.workspace_id == workspace.id,
            UtcInstance.package_instance_id == package.id,
        )
        .order_by(UtcInstance.display_order, UtcInstance.id)
        .all()
    )
    out: list[EquipmentKitUtcIn] = []
    skipped: list[str] = []
    for order, u in enumerate(utcs):
        gear = (
            db.query(Equipment)
            .filter(Equipment.utc_instance_id == u.id)
            .order_by(Equipment.equipment_code)
            .all()
        )
        holdings = (
            db.query(EquipmentHolding)
            .filter(EquipmentHolding.utc_instance_id == u.id)
            .all()
        )
        items: list[EquipmentKitItemIn] = []
        for i, eq in enumerate(gear):
            asset = _promote_to_asset(db, eq)
            if asset is None:
                skipped.append(
                    f"{eq.equipment_code}: equipment ID already in the property "
                    f"book under a different serial"
                )
                continue
            items.append(EquipmentKitItemIn(asset_id=asset.id, display_order=i))
        out.append(
            EquipmentKitUtcIn(
                utc_def_id=u.utc_def_id,
                name=u.name,
                # A deployment committed to a role; as doctrine for next time
                # that commitment is exactly the hint worth keeping.
                role_hint=u.role,
                display_order=order,
                items=items,
                bulk=[
                    EquipmentKitBulkIn(
                        equipment_type_id=h.equipment_type_id,
                        # Authorized, not on-hand: the kit is the plan, and
                        # planning next deployment around this one's shortfall
                        # would make the shortage permanent.
                        quantity=h.authorized_qty or h.on_hand_qty,
                        enclave_id=None,
                    )
                    for h in holdings
                ],
            )
        )
    return out, skipped


# ---------- endpoints ----------


@router.get("", response_model=list[EquipmentKitOut])
def list_kits(
    include_retired: bool = Query(default=False),
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _: User = Depends(requires("viewer")),
):
    q = (
        db.query(EquipmentKit)
        .options(
            selectinload(EquipmentKit.utcs).selectinload(EquipmentKitUtc.items),
            selectinload(EquipmentKit.utcs).selectinload(EquipmentKitUtc.bulk),
        )
        .filter(
            (EquipmentKit.workspace_id.is_(None))
            | (EquipmentKit.workspace_id == workspace.id)
        )
    )
    if not include_retired:
        q = q.filter(EquipmentKit.retired_at.is_(None))
    rows = q.order_by(EquipmentKit.name).all()
    ctx = _KitContext(db, workspace, rows)
    return [_kit_out(r, ctx) for r in rows]


@router.get("/{kit_id}", response_model=EquipmentKitOut)
def get_kit(
    kit_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _: User = Depends(requires("viewer")),
):
    row = _load_kit(db, kit_id, workspace)
    return _kit_out(row, _KitContext(db, workspace, [row]))


@router.post("", response_model=EquipmentKitOut, status_code=status.HTTP_201_CREATED)
def create_kit(
    body: EquipmentKitIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    # Kits describe the unit's gear, so global is the default and a
    # workspace-local kit is the opt-out.
    local: bool = Query(default=False),
    current_user: User = Depends(requires("operator")),
):
    owner_id = workspace.id if local else None
    _require_write(owner_id, current_user)
    kit = EquipmentKit(
        workspace_id=owner_id,
        name=body.name,
        description=body.description,
        package_def_id=body.package_def_id,
    )
    db.add(kit)
    db.flush()
    _write_kit_utcs(db, workspace, kit, body.utcs)
    record_action(
        db,
        action_slug="kit.saved",
        workspace_id=owner_id,
        subject_kind=SubjectKinds.EQUIPMENT_KIT,
        subject_id=kit.id,
        subject_label=kit.name,
        user_id=current_user.id,
        note=f"{sum(len(u.items) for u in body.utcs)} item(s) pinned",
    )
    db.flush()
    db.refresh(kit)
    notify(background_tasks)
    return _kit_out(kit, _KitContext(db, workspace, [kit]))


@router.patch("/{kit_id}", response_model=EquipmentKitOut)
def patch_kit(
    kit_id: int,
    body: EquipmentKitPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _: User = Depends(requires("operator")),
):
    kit = _load_kit(db, kit_id, workspace)
    _require_write(kit.workspace_id, current_user)
    data = body.model_dump(exclude_unset=True)
    retired = data.pop("retired", None)
    for field, value in data.items():
        setattr(kit, field, value)
    if retired is not None:
        kit.retired_at = _now() if retired else None
    db.flush()
    notify(background_tasks)
    return _kit_out(kit, _KitContext(db, workspace, [kit]))


@router.put("/{kit_id}/utcs", response_model=EquipmentKitOut)
def replace_kit_utcs(
    kit_id: int,
    body: list[EquipmentKitUtcIn],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Wholesale-replace a kit's contents, mirroring `PUT /utc-defs/{id}/lines`."""
    kit = _load_kit(db, kit_id, workspace)
    _require_write(kit.workspace_id, current_user)
    _write_kit_utcs(db, workspace, kit, body)
    db.refresh(kit)
    notify(background_tasks)
    return _kit_out(kit, _KitContext(db, workspace, [kit]))


@router.delete("/{kit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_kit(
    kit_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Hard-delete a kit.

    Unlike the catalog, nothing holds a RESTRICT reference to a kit and no
    deployment depends on one having survived — a kit is a convenience, and a
    deployment made from it is complete on its own. `retired` on the PATCH
    endpoint is there for kits worth keeping out of the picker without losing.
    """
    kit = _load_kit(db, kit_id, workspace)
    _require_write(kit.workspace_id, current_user)
    pinned = sum(len(u.items) for u in kit.utcs)
    record_action(
        db,
        action_slug="kit.deleted",
        workspace_id=kit.workspace_id,
        subject_kind=SubjectKinds.EQUIPMENT_KIT,
        subject_id=kit.id,
        subject_label=kit.name,
        user_id=current_user.id,
        note=(
            f"{pinned} pinned item(s) released; no equipment was deleted"
            if pinned
            else "Kit held no pinned equipment"
        ),
    )
    db.delete(kit)
    notify(background_tasks)


@router.post(
    "/capture", response_model=EquipmentKitOut, status_code=status.HTTP_201_CREATED
)
def capture_kit(
    body: KitCaptureIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    local: bool = Query(default=False),
    current_user: User = Depends(requires("operator")),
):
    """Save a live package as a kit — the way kits actually get made.

    Also promotes the package's gear into the property book, so a workspace
    that typed its serials before assets existed contributes them once instead
    of retyping them globally.
    """
    package = _load_package(db, body.package_instance_id, workspace)
    owner_id = workspace.id if local else None
    _require_write(owner_id, current_user)
    utcs, skipped = _capture_utcs(db, workspace, package)
    if not utcs:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"'{package.name}' has no deployed UTCs to capture.",
        )
    kit = EquipmentKit(
        workspace_id=owner_id,
        name=body.name,
        description=body.description,
        package_def_id=body.package_def_id or package.package_def_id,
    )
    db.add(kit)
    db.flush()
    _write_kit_utcs(db, workspace, kit, utcs)
    record_action(
        db,
        action_slug="kit.saved",
        workspace_id=owner_id,
        subject_kind=SubjectKinds.EQUIPMENT_KIT,
        subject_id=kit.id,
        subject_label=kit.name,
        user_id=current_user.id,
        note=(
            f"Captured from '{package.name}' — {len(utcs)} UTC(s), "
            f"{sum(len(u.items) for u in utcs)} item(s) pinned"
            + (f"; {len(skipped)} skipped" if skipped else "")
        ),
    )
    db.flush()
    db.refresh(kit)
    notify(background_tasks)
    return _kit_out(kit, _KitContext(db, workspace, [kit]))


@router.post("/{kit_id}/refresh", response_model=EquipmentKitOut)
def refresh_kit(
    kit_id: int,
    body: KitRefreshIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Re-pin an existing kit from a live package, replacing its contents."""
    kit = _load_kit(db, kit_id, workspace)
    _require_write(kit.workspace_id, current_user)
    package = _load_package(db, body.package_instance_id, workspace)
    utcs, skipped = _capture_utcs(db, workspace, package)
    if not utcs:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"'{package.name}' has no deployed UTCs to capture.",
        )
    _write_kit_utcs(db, workspace, kit, utcs)
    record_action(
        db,
        action_slug="kit.saved",
        workspace_id=kit.workspace_id,
        subject_kind=SubjectKinds.EQUIPMENT_KIT,
        subject_id=kit.id,
        subject_label=kit.name,
        user_id=current_user.id,
        note=f"Refreshed from '{package.name}' — {len(utcs)} UTC(s)"
        + (f"; {len(skipped)} skipped" if skipped else ""),
    )
    db.flush()
    db.refresh(kit)
    notify(background_tasks)
    return _kit_out(kit, _KitContext(db, workspace, [kit]))
