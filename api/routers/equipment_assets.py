"""The property book — every physical box the unit owns, once, globally.

See docs/design/equipment-kits.md §9.

A workspace is an operating picture, not a tenant, so the radio in the rack is
a fact about the unit rather than about any one exercise. This router owns that
fact; `equipment` rows are per-workspace *materializations* of it.

Two consequences shape everything here:

* **Global tier rules apply.** Reads are open to any viewer; writes need
  `admin`, matching enclaves and the equipment catalog. There is no
  workspace-owned asset — that is what `equipment` already is.
* **An asset is a shared source, not an assignment.** Several workspaces may
  each hold a row materialized from the same asset, because planning next
  month's exercise while this month's is live is normal. `commitments` reports
  that; nothing blocks on it.
"""

from __future__ import annotations

import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, selectinload

from action_registry import record_action
from db import get_db
from deps import get_current_workspace, requires
from models import (
    Equipment,
    EquipmentAsset,
    EquipmentAssetCapability,
    EquipmentCapability,
    EquipmentType,
    EquipmentTypeCapability,
    Site,
    User,
    UtcInstance,
    Workspace,
)
from pubsub import notify
from schemas import (
    AssetCommitment,
    AssetImportIn,
    AssetImportOut,
    EquipmentAssetIn,
    EquipmentAssetOut,
    EquipmentAssetPatch,
    SubjectKinds,
)

router = APIRouter(prefix="/assets", tags=["equipment-assets"])


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _require_admin(user: User) -> None:
    """The property book is global, so writing it is admin-only.

    Mirrors equipment_catalog._require_write and enclaves._require_write — the
    route dependency already established `operator`, so this only adds the bar
    for the global tier.
    """
    if user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Editing the property book requires admin",
        )


def _load(db: Session, asset_id: int) -> EquipmentAsset:
    row = (
        db.query(EquipmentAsset)
        .options(selectinload(EquipmentAsset.capabilities))
        .filter(EquipmentAsset.id == asset_id)
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")
    return row


def _default_kinds(db: Session, eq_type: EquipmentType) -> list[str]:
    return [
        c.kind
        for c in db.query(EquipmentTypeCapability)
        .filter(
            EquipmentTypeCapability.equipment_type_id == eq_type.id,
            EquipmentTypeCapability.materialize_by_default.is_(True),
        )
        .order_by(EquipmentTypeCapability.display_order)
    ]


def _propose_code(db: Session, eq_type: EquipmentType, serial: str | None) -> str:
    """`<prefix><last 4 of serial>`, disambiguated against the property book.

    Same shape as `equipment_codes.resolve_code`, but resolving against the
    global namespace rather than a workspace's — an asset's ID has to be unique
    across every picture that will materialize it.
    """
    prefix = (eq_type.id_prefix or "R").upper()
    cleaned = "".join(ch for ch in (serial or "").upper() if ch.isalnum())
    base = f"{prefix}{cleaned[-4:]}" if cleaned else prefix
    taken = {
        c for (c,) in db.query(EquipmentAsset.equipment_code)
    }
    if base not in taken:
        return base
    n = 1
    while f"{base}{n}" in taken:
        n += 1
    return f"{base}{n}"


# ---------- serialization ----------


class _AssetContext:
    """Commitments for a whole page of assets, loaded once.

    A property book of a few hundred boxes rendered one query per asset would
    be the slowest screen in the app; this is the bulk pass the equipment tier
    uses everywhere else.
    """

    def __init__(self, db: Session, assets: list[EquipmentAsset]):
        asset_ids = [a.id for a in assets]
        self.types: dict[int, EquipmentType] = {}
        type_ids = {a.equipment_type_id for a in assets}
        if type_ids:
            for t in db.query(EquipmentType).filter(EquipmentType.id.in_(type_ids)):
                self.types[t.id] = t

        self.commitments: dict[int, list[AssetCommitment]] = {}
        if not asset_ids:
            return
        rows = (
            db.query(Equipment)
            .filter(Equipment.asset_id.in_(asset_ids))
            .all()
        )
        ws_ids = {r.workspace_id for r in rows}
        utc_ids = {r.utc_instance_id for r in rows if r.utc_instance_id}
        site_ids = {r.site_id for r in rows}
        workspaces = {
            w.id: w for w in db.query(Workspace).filter(Workspace.id.in_(ws_ids))
        } if ws_ids else {}
        utcs = {
            u.id: u for u in db.query(UtcInstance).filter(UtcInstance.id.in_(utc_ids))
        } if utc_ids else {}
        sites = {
            s.id: s for s in db.query(Site).filter(Site.id.in_(site_ids))
        } if site_ids else {}
        for r in rows:
            ws = workspaces.get(r.workspace_id)
            utc = utcs.get(r.utc_instance_id) if r.utc_instance_id else None
            site = sites.get(r.site_id)
            self.commitments.setdefault(r.asset_id, []).append(
                AssetCommitment(
                    workspace_id=r.workspace_id,
                    workspace_name=ws.name if ws else f"Workspace {r.workspace_id}",
                    equipment_id=r.id,
                    utc_instance_id=utc.id if utc else None,
                    utc_name=utc.name if utc else None,
                    site_name=site.name if site else None,
                )
            )


def _out(row: EquipmentAsset, ctx: _AssetContext) -> EquipmentAssetOut:
    out = EquipmentAssetOut.model_validate(row)
    t = ctx.types.get(row.equipment_type_id)
    if t is not None:
        out.type_title = t.title
        out.type_short_name = t.short_name
        out.nsn = t.nsn
    out.capability_kinds = [c.kind for c in row.capabilities]
    out.commitments = ctx.commitments.get(row.id, [])
    return out


# ---------- materialization, shared with the deploy endpoint ----------


def materialize_asset(
    db: Session,
    asset: EquipmentAsset,
    workspace: Workspace,
    site: Site,
    utc_instance_id: int | None,
    enclave_id: int | None,
) -> tuple[Equipment, bool]:
    """This workspace's `equipment` row for `asset`, creating it if needed.

    Returns `(row, created)`.

    Find-or-create rather than always-create: redeploying the same kit into the
    same picture must not register the radio twice. When the row already exists
    it is moved — site, UTC and enclave are properties of this deployment, not
    of the box.

    Capabilities are copied from the asset, not re-derived from the type, so a
    box that had `los_rf` struck stays struck everywhere it lands.
    """
    existing = (
        db.query(Equipment)
        .filter(
            Equipment.workspace_id == workspace.id,
            Equipment.asset_id == asset.id,
        )
        .first()
    )
    if existing is not None:
        existing.utc_instance_id = utc_instance_id
        existing.site_id = site.id
        existing.enclave_id = enclave_id
        db.flush()
        return existing, False

    eq = Equipment(
        workspace_id=workspace.id,
        equipment_type_id=asset.equipment_type_id,
        asset_id=asset.id,
        utc_instance_id=utc_instance_id,
        site_id=site.id,
        enclave_id=enclave_id,
        equipment_code=asset.equipment_code,
        serial_number=asset.serial_number,
        notes=asset.notes,
    )
    db.add(eq)
    db.flush()
    for order, cap in enumerate(asset.capabilities):
        db.add(
            EquipmentCapability(
                equipment_id=eq.id,
                kind=cap.kind,
                label=_label_for(db, asset.equipment_type_id, cap.kind),
                display_order=order,
            )
        )
    db.flush()
    return eq, True


def _label_for(db: Session, type_id: int, kind: str) -> str:
    """The type's own label for a capability kind, so materialized rows read
    the same as ones the register flow made."""
    decl = (
        db.query(EquipmentTypeCapability)
        .filter(
            EquipmentTypeCapability.equipment_type_id == type_id,
            EquipmentTypeCapability.kind == kind,
        )
        .first()
    )
    return decl.label if decl is not None else kind


# ---------- endpoints ----------


@router.get("", response_model=list[EquipmentAssetOut])
def list_assets(
    include_retired: bool = Query(default=False),
    equipment_type_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _ws: Workspace = Depends(get_current_workspace),
    __: User = Depends(requires("viewer")),
):
    q = db.query(EquipmentAsset).options(selectinload(EquipmentAsset.capabilities))
    if not include_retired:
        q = q.filter(EquipmentAsset.retired_at.is_(None))
    if equipment_type_id is not None:
        q = q.filter(EquipmentAsset.equipment_type_id == equipment_type_id)
    rows = q.order_by(EquipmentAsset.equipment_code).all()
    ctx = _AssetContext(db, rows)
    return [_out(r, ctx) for r in rows]


@router.get("/{asset_id}", response_model=EquipmentAssetOut)
def get_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    _ws: Workspace = Depends(get_current_workspace),
    __: User = Depends(requires("viewer")),
):
    row = _load(db, asset_id)
    return _out(row, _AssetContext(db, [row]))


@router.post("", response_model=EquipmentAssetOut, status_code=status.HTTP_201_CREATED)
def create_asset(
    body: EquipmentAssetIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _ws: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    _require_admin(current_user)
    eq_type = db.get(EquipmentType, body.equipment_type_id)
    if eq_type is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Equipment type not found")
    if not eq_type.serialized:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"'{eq_type.title}' is unserialized — bulk gear is counted per "
            "deployment, not tracked as property.",
        )
    if body.serial_number:
        clash = (
            db.query(EquipmentAsset)
            .filter(EquipmentAsset.serial_number == body.serial_number)
            .first()
        )
        if clash is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Serial '{body.serial_number}' is already in the property book "
                f"as {clash.equipment_code}.",
            )
    code = (body.equipment_code or "").strip() or _propose_code(
        db, eq_type, body.serial_number
    )
    if (
        db.query(EquipmentAsset).filter(EquipmentAsset.equipment_code == code).first()
        is not None
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Equipment ID '{code}' is already in use."
        )

    asset = EquipmentAsset(
        equipment_type_id=eq_type.id,
        equipment_code=code,
        serial_number=body.serial_number,
        notes=body.notes,
    )
    db.add(asset)
    db.flush()
    kinds = (
        body.capability_kinds
        if body.capability_kinds is not None
        else _default_kinds(db, eq_type)
    )
    for order, kind in enumerate(kinds):
        db.add(
            EquipmentAssetCapability(asset_id=asset.id, kind=kind, display_order=order)
        )
    db.flush()
    record_action(
        db,
        action_slug="asset.registered",
        workspace_id=None,
        subject_kind=SubjectKinds.EQUIPMENT_ASSET,
        subject_id=asset.id,
        subject_label=asset.equipment_code,
        user_id=current_user.id,
        note=f"{eq_type.title}"
        + (f" · S/N {asset.serial_number}" if asset.serial_number else ""),
    )
    db.refresh(asset)
    notify(background_tasks)
    return _out(asset, _AssetContext(db, [asset]))


@router.patch("/{asset_id}", response_model=EquipmentAssetOut)
def patch_asset(
    asset_id: int,
    body: EquipmentAssetPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _ws: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    _require_admin(current_user)
    asset = _load(db, asset_id)
    data = body.model_dump(exclude_unset=True)
    retired = data.pop("retired", None)
    kinds = data.pop("capability_kinds", None)
    for field, value in data.items():
        setattr(asset, field, value)
    if kinds is not None:
        asset.capabilities.clear()
        db.flush()
        for order, kind in enumerate(kinds):
            db.add(
                EquipmentAssetCapability(
                    asset_id=asset.id, kind=kind, display_order=order
                )
            )
    if retired is not None:
        asset.retired_at = _now() if retired else None
        if retired:
            record_action(
                db,
                action_slug="asset.retired",
                workspace_id=None,
                subject_kind=SubjectKinds.EQUIPMENT_ASSET,
                subject_id=asset.id,
                subject_label=asset.equipment_code,
                user_id=current_user.id,
                note="Struck from the property book; deployments keep their rows",
            )
    db.flush()
    db.refresh(asset)
    notify(background_tasks)
    return _out(asset, _AssetContext(db, [asset]))


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def retire_asset(
    asset_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _ws: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Soft delete. Workspaces that materialized this asset keep their rows —
    `equipment.asset_id` is SET NULL, so a past operating picture never loses
    gear because the property book was tidied."""
    _require_admin(current_user)
    asset = _load(db, asset_id)
    asset.retired_at = _now()
    record_action(
        db,
        action_slug="asset.retired",
        workspace_id=None,
        subject_kind=SubjectKinds.EQUIPMENT_ASSET,
        subject_id=asset.id,
        subject_label=asset.equipment_code,
        user_id=current_user.id,
        note="Struck from the property book; deployments keep their rows",
    )
    db.flush()
    notify(background_tasks)


@router.post("/import", response_model=AssetImportOut)
def import_from_workspace(
    body: AssetImportIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Promote this workspace's registered gear into the property book.

    The bridge from what exists today: a workspace that already typed its
    serials shouldn't type them again. Matches an existing asset by serial
    first, then by equipment ID, and links rather than duplicates when it finds
    one — running this twice is a no-op.
    """
    _require_admin(current_user)
    q = db.query(Equipment).filter(Equipment.workspace_id == workspace.id)
    if body.equipment_ids is not None:
        q = q.filter(Equipment.id.in_(body.equipment_ids))
    rows = q.order_by(Equipment.equipment_code).all()

    created: list[EquipmentAsset] = []
    linked = 0
    skipped: list[str] = []
    for eq in rows:
        if eq.asset_id is not None:
            linked += 1
            continue
        match = None
        if eq.serial_number:
            match = (
                db.query(EquipmentAsset)
                .filter(EquipmentAsset.serial_number == eq.serial_number)
                .first()
            )
        if match is None:
            match = (
                db.query(EquipmentAsset)
                .filter(EquipmentAsset.equipment_code == eq.equipment_code)
                .first()
            )
            # Same ID but a different serial is two different boxes that happen
            # to collide in the namespace, not one box. Refusing is right: the
            # alternative silently merges two radios into one asset.
            if (
                match is not None
                and eq.serial_number
                and match.serial_number
                and match.serial_number != eq.serial_number
            ):
                skipped.append(
                    f"{eq.equipment_code}: ID already in the property book with "
                    f"serial {match.serial_number}"
                )
                continue
        if match is not None:
            eq.asset_id = match.id
            linked += 1
            continue

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
        created.append(asset)
    db.flush()

    if created:
        record_action(
            db,
            action_slug="asset.registered",
            workspace_id=None,
            subject_kind=SubjectKinds.EQUIPMENT_ASSET,
            subject_id=created[0].id,
            subject_label=f"{len(created)} asset(s)",
            user_id=current_user.id,
            note=f"Imported from workspace '{workspace.name}'",
        )
        db.flush()

    for a in created:
        db.refresh(a)
    ctx = _AssetContext(db, created)
    notify(background_tasks)
    return AssetImportOut(
        created=[_out(a, ctx) for a in created], linked=linked, skipped=skipped
    )
