"""Deployed packages and UTCs, plus the one-shot deploy endpoint.

`POST /utcs/deploy` is the wizard's single transactional call. Everything a
deployment implies — the UTC instance, its serialized gear with materialized
capabilities, its bulk holdings, and the operator-accepted capability
bindings — lands in one request so a half-built UTC can never exist. If the
third radio's serial collides, nothing is written and the wizard can correct
it without leaving orphans behind.
"""

from __future__ import annotations

import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from action_registry import record_action
from db import get_db
from deps import get_current_workspace, requires
from equipment_codes import resolve_code
from equipment_status import derive_utc_role
from models import (
    CapabilityGatewayLink,
    CapabilityServiceLink,
    Equipment,
    EquipmentCapability,
    EquipmentHolding,
    EquipmentLink,
    EquipmentType,
    Gateway,
    PackageDef,
    PackageInstance,
    Service,
    Site,
    User,
    UtcDef,
    UtcDefLine,
    UtcInstance,
    UtcInstanceLine,
    Workspace,
)
from pubsub import notify
from routers.equipment import (
    check_enclave_allowed,
    equipment_out_bulk,
    materialize_capabilities,
)
from rules_engine import emit_trigger
from schemas import (
    EquipmentHoldingIn,
    EquipmentHoldingOut,
    EquipmentHoldingPatch,
    PackageInstanceIn,
    PackageInstanceOut,
    PackageInstancePatch,
    SubjectKinds,
    UtcCompletenessLine,
    UtcCompletenessOut,
    UtcDeployIn,
    UtcDeployOut,
    UtcInstanceIn,
    UtcInstanceLineIn,
    UtcInstanceLineOut,
    UtcInstanceOut,
    UtcInstancePatch,
)

router = APIRouter(tags=["deployments"])


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _site_in_workspace(db: Session, site_id: int, workspace: Workspace) -> Site:
    site = db.get(Site, site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    return site


def _load_package(db: Session, package_id: int, workspace: Workspace) -> PackageInstance:
    row = db.get(PackageInstance, package_id)
    if row is None or row.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Package not found")
    return row


def _load_utc(db: Session, utc_id: int, workspace: Workspace) -> UtcInstance:
    row = db.get(UtcInstance, utc_id)
    if row is None or row.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "UTC not found")
    return row


def _load_type(db: Session, type_id: int, workspace: Workspace) -> EquipmentType:
    row = db.get(EquipmentType, type_id)
    if row is None or (
        row.workspace_id is not None and row.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Equipment type not found")
    return row


# ---------- serialization ----------


def _package_out(db: Session, row: PackageInstance) -> PackageInstanceOut:
    out = PackageInstanceOut.model_validate(row)
    if row.package_def_id is not None:
        pd = db.get(PackageDef, row.package_def_id)
        if pd is not None:
            out.package_def_code = pd.code
    out.site_ids = sorted(
        {
            u.site_id
            for u in db.query(UtcInstance).filter(
                UtcInstance.package_instance_id == row.id
            )
        }
    )
    return out


def _utc_role_context(db: Session, workspace: Workspace):
    """Everything `derive_utc_role` needs, loaded once for a whole list."""
    equipment_by_utc: dict[int, set[int]] = {}
    for eq_id, utc_id in db.query(Equipment.id, Equipment.utc_instance_id).filter(
        Equipment.workspace_id == workspace.id,
        Equipment.utc_instance_id.isnot(None),
    ):
        equipment_by_utc.setdefault(utc_id, set()).add(eq_id)
    links = (
        db.query(EquipmentLink)
        .filter(EquipmentLink.workspace_id == workspace.id)
        .all()
    )
    return equipment_by_utc, links


def _utc_out(
    db: Session,
    row: UtcInstance,
    equipment_by_utc: dict[int, set[int]] | None = None,
    links: list | None = None,
) -> UtcInstanceOut:
    out = UtcInstanceOut.model_validate(row)
    site = db.get(Site, row.site_id)
    if site is not None:
        out.site_name = site.name
    if row.utc_def_id is not None:
        d = db.get(UtcDef, row.utc_def_id)
        if d is not None:
            out.utc_def_code = d.code
    if row.package_instance_id is not None:
        p = db.get(PackageInstance, row.package_instance_id)
        if p is not None:
            out.package_name = p.name
    if equipment_by_utc is not None and links is not None:
        out.derived_role = derive_utc_role(row.id, equipment_by_utc, links)
    return out


def _holding_out(db: Session, row: EquipmentHolding) -> EquipmentHoldingOut:
    out = EquipmentHoldingOut.model_validate(row)
    t = db.get(EquipmentType, row.equipment_type_id)
    if t is not None:
        out.type_title = t.title
        out.type_short_name = t.short_name
        out.nsn = t.nsn
    return out


def _instance_line_out(db: Session, row: UtcInstanceLine) -> UtcInstanceLineOut:
    out = UtcInstanceLineOut.model_validate(row)
    t = db.get(EquipmentType, row.equipment_type_id)
    if t is not None:
        out.type_title = t.title
        out.type_short_name = t.short_name
        out.serialized = t.serialized
    return out


def _actual_counts(db: Session, utc_id: int) -> dict[int, int]:
    """What is physically on this UTC right now, by equipment type.

    Serialized gear counts one per `equipment` row; bulk counts the holding's
    on-hand quantity, since that is the tier's equivalent of "a thing is here".
    """
    counts: dict[int, int] = {}
    for (type_id,) in db.query(Equipment.equipment_type_id).filter(
        Equipment.utc_instance_id == utc_id
    ):
        counts[type_id] = counts.get(type_id, 0) + 1
    for type_id, on_hand in db.query(
        EquipmentHolding.equipment_type_id, EquipmentHolding.on_hand_qty
    ).filter(EquipmentHolding.utc_instance_id == utc_id):
        counts[type_id] = counts.get(type_id, 0) + (on_hand or 0)
    return counts


def _compare(
    db: Session,
    expected: dict[int, int],
    actual: dict[int, int],
    enclave_by_type: dict[int, int | None] | None = None,
) -> list[UtcCompletenessLine]:
    """One row per type appearing on either side, so surplus is as visible as
    shortfall — gear nobody planned for is its own kind of problem.

    `enclave_by_type` only labels the rows for grouping in the UI; the
    comparison itself stays per type."""
    lines: list[UtcCompletenessLine] = []
    for type_id in sorted(set(expected) | set(actual)):
        t = db.get(EquipmentType, type_id)
        exp = expected.get(type_id, 0)
        act = actual.get(type_id, 0)
        lines.append(
            UtcCompletenessLine(
                equipment_type_id=type_id,
                type_title=t.title if t else None,
                type_short_name=t.short_name if t else None,
                enclave_id=(enclave_by_type or {}).get(type_id),
                serialized=t.serialized if t else True,
                expected=exp,
                actual=act,
                delta=act - exp,
            )
        )
    return lines


def _unsupported_enclaves(
    db: Session, utc: UtcInstance, expected_rows: list[UtcInstanceLine]
) -> list[int]:
    """Enclaves the def calls for that this deployment expects nothing from.

    Derived rather than stored. A stored "supported" set would go stale the
    moment someone edits the expected list mid-mission — which is a first-class
    workflow here, not an edge case — and the snapshot already carries the
    answer: an enclave with doctrine lines and no expectation lines was left
    home. That is a decision, not a shortfall, and the UI must not show it as
    one.
    """
    if utc.utc_def_id is None:
        return []
    doctrine_enclaves = {
        e
        for (e,) in db.query(UtcDefLine.enclave_id).filter(
            UtcDefLine.utc_def_id == utc.utc_def_id,
            UtcDefLine.enclave_id.isnot(None),
        )
    }
    if not doctrine_enclaves:
        return []
    expected_enclaves = {r.enclave_id for r in expected_rows if r.enclave_id}
    return sorted(doctrine_enclaves - expected_enclaves)


def _completeness(db: Session, utc: UtcInstance) -> UtcCompletenessOut:
    expected_rows = (
        db.query(UtcInstanceLine)
        .filter(UtcInstanceLine.utc_instance_id == utc.id)
        .all()
    )
    actual = _actual_counts(db, utc.id)

    # No recorded expectation means nobody said what this UTC should carry —
    # which is not the same as "it should carry nothing". Report `unknown` and
    # resist inventing a baseline from the def, since the whole point of the
    # snapshot is that the def over-states what a tailored deployment brings.
    if not expected_rows:
        return UtcCompletenessOut(
            utc_instance_id=utc.id,
            status="unknown",
            lines=_compare(db, {}, actual),
        )

    # SUM, not last-wins: a type can now legitimately have one row per enclave,
    # and the comparison stays per type because that's what actual counts can
    # be attributed to — bulk holdings carry no enclave at all.
    expected: dict[int, int] = {}
    for r in expected_rows:
        expected[r.equipment_type_id] = (
            expected.get(r.equipment_type_id, 0) + r.quantity
        )
    # Label a type with its enclave only when every row agrees. A type spanning
    # two enclaves gets no label rather than one of them — a NIPR badge on a
    # count that includes SIPR switches would be worse than none.
    enclave_by_type: dict[int, int | None] = {}
    for r in expected_rows:
        if r.equipment_type_id in enclave_by_type:
            if enclave_by_type[r.equipment_type_id] != r.enclave_id:
                enclave_by_type[r.equipment_type_id] = None
        else:
            enclave_by_type[r.equipment_type_id] = r.enclave_id
    lines = _compare(db, expected, actual, enclave_by_type)
    if any(l.delta < 0 for l in lines):
        status_value = "short"
    elif any(l.delta > 0 for l in lines):
        status_value = "over"
    else:
        status_value = "complete"

    def_variance: list[UtcCompletenessLine] = []
    if utc.utc_def_id is not None:
        doctrine: dict[int, int] = {}
        for line in (
            db.query(UtcDefLine).filter(UtcDefLine.utc_def_id == utc.utc_def_id).all()
        ):
            doctrine[line.equipment_type_id] = (
                doctrine.get(line.equipment_type_id, 0) + line.quantity
            )
        # Reuse the same shape with doctrine as the baseline: `expected` here
        # is what the def calls for and `actual` is what we planned to bring.
        def_variance = [
            l for l in _compare(db, doctrine, expected, enclave_by_type)
            if l.delta != 0
        ]

    return UtcCompletenessOut(
        utc_instance_id=utc.id,
        status=status_value,
        lines=lines,
        def_variance=def_variance,
        unsupported_enclave_ids=_unsupported_enclaves(db, utc, expected_rows),
    )


# ---------- package instances ----------


@router.get("/packages", response_model=list[PackageInstanceOut])
def list_packages(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    rows = (
        db.query(PackageInstance)
        .filter(PackageInstance.workspace_id == workspace.id)
        .order_by(PackageInstance.name)
        .all()
    )
    return [_package_out(db, r) for r in rows]


@router.post(
    "/packages", response_model=PackageInstanceOut, status_code=status.HTTP_201_CREATED
)
def create_package(
    body: PackageInstanceIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    row = PackageInstance(workspace_id=workspace.id, **body.model_dump())
    db.add(row)
    db.flush()
    notify(background_tasks)
    return _package_out(db, row)


@router.patch("/packages/{package_id}", response_model=PackageInstanceOut)
def patch_package(
    package_id: int,
    body: PackageInstancePatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    row = _load_package(db, package_id, workspace)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.flush()
    notify(background_tasks)
    return _package_out(db, row)


@router.delete("/packages/{package_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_package(
    package_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_package(db, package_id, workspace)
    # Deleting a package does not delete its UTCs — the FK is SET NULL, so
    # they carry on as standalone deployments. Recording how many were cut
    # loose is the only way to explain later why they have no package.
    orphaned = (
        db.query(UtcInstance)
        .filter(UtcInstance.package_instance_id == row.id)
        .count()
    )
    record_action(
        db,
        action_slug="package.deleted",
        workspace_id=workspace.id,
        subject_kind=SubjectKinds.PACKAGE_INSTANCE,
        subject_id=row.id,
        subject_label=row.name,
        user_id=current_user.id,
        note=(
            f"{orphaned} UTC{'' if orphaned == 1 else 's'} kept, now standalone"
            if orphaned
            else "No UTCs were attached"
        ),
    )
    db.delete(row)
    notify(background_tasks)


# ---------- UTC instances ----------


@router.get("/utcs", response_model=list[UtcInstanceOut])
def list_utcs(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    site_id: int | None = Query(default=None),
    _=Depends(requires("viewer")),
):
    q = db.query(UtcInstance).filter(UtcInstance.workspace_id == workspace.id)
    if site_id is not None:
        q = q.filter(UtcInstance.site_id == site_id)
    rows = q.order_by(UtcInstance.site_id, UtcInstance.display_order, UtcInstance.name).all()
    equipment_by_utc, links = _utc_role_context(db, workspace)
    return [_utc_out(db, r, equipment_by_utc, links) for r in rows]


@router.get("/utcs/{utc_id}", response_model=UtcInstanceOut)
def get_utc(
    utc_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    """One deployed UTC, with `derived_role` resolved like the list does.

    The role comes from the link graph, so it needs the same context the list
    builds — a UTC read on its own must not report a different role than the
    same UTC read in a list.
    """
    row = _load_utc(db, utc_id, workspace)
    equipment_by_utc, links = _utc_role_context(db, workspace)
    return _utc_out(db, row, equipment_by_utc, links)


@router.post("/utcs", response_model=UtcInstanceOut, status_code=status.HTTP_201_CREATED)
def create_utc(
    body: UtcInstanceIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    _site_in_workspace(db, body.site_id, workspace)
    if body.package_instance_id is not None:
        _load_package(db, body.package_instance_id, workspace)
    row = UtcInstance(workspace_id=workspace.id, **body.model_dump())
    db.add(row)
    db.flush()
    notify(background_tasks)
    return _utc_out(db, row)


@router.patch("/utcs/{utc_id}", response_model=UtcInstanceOut)
def patch_utc(
    utc_id: int,
    body: UtcInstancePatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    row = _load_utc(db, utc_id, workspace)
    data = body.model_dump(exclude_unset=True)
    if data.get("site_id") is not None:
        _site_in_workspace(db, data["site_id"], workspace)
    for k, v in data.items():
        setattr(row, k, v)
    # Moving a UTC moves its gear — the denormalized site_id on equipment
    # exists for query speed, not as an independent fact, so it must follow.
    if data.get("site_id") is not None:
        db.query(Equipment).filter(Equipment.utc_instance_id == row.id).update(
            {"site_id": data["site_id"]}, synchronize_session=False
        )
    db.flush()
    notify(background_tasks)
    equipment_by_utc, links = _utc_role_context(db, workspace)
    return _utc_out(db, row, equipment_by_utc, links)


@router.delete("/utcs/{utc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_utc(
    utc_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Delete a deployed UTC.

    Its bulk holdings cascade away with it, but the serialized gear does not
    (`equipment.utc_instance_id` is SET NULL) — a radio outlives the UTC it
    came in on, and silently deleting accountable property with a container
    would be indefensible.
    """
    row = _load_utc(db, utc_id, workspace)
    # How much gear is about to be orphaned is the part worth keeping: after
    # the delete nothing connects those rows to the UTC they arrived on.
    detached = (
        db.query(Equipment).filter(Equipment.utc_instance_id == row.id).count()
    )
    site = db.get(Site, row.site_id)
    record_action(
        db,
        action_slug="utc.deleted",
        workspace_id=workspace.id,
        subject_kind=SubjectKinds.UTC_INSTANCE,
        subject_id=row.id,
        second_subject_id=row.site_id,
        subject_label=row.name,
        user_id=current_user.id,
        note=(
            f"{detached} serialized item{'' if detached == 1 else 's'} left registered"
            f" with no UTC at {site.name if site else 'the site'}"
            if detached
            else "No serialized gear was attached"
        ),
    )
    db.delete(row)
    notify(background_tasks)


# ---------- expected contents and completeness ----------


@router.get("/utcs/{utc_id}/lines", response_model=list[UtcInstanceLineOut])
def list_utc_lines(
    utc_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    _load_utc(db, utc_id, workspace)
    rows = (
        db.query(UtcInstanceLine)
        .filter(UtcInstanceLine.utc_instance_id == utc_id)
        .all()
    )
    return [_instance_line_out(db, r) for r in rows]


@router.put("/utcs/{utc_id}/lines", response_model=list[UtcInstanceLineOut])
def replace_utc_lines(
    utc_id: int,
    body: list[UtcInstanceLineIn],
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    """Replace what this UTC is expected to carry.

    Editable after deploy on purpose: "we're leaving the SIPR stack home" is
    sometimes decided mid-mission, and the alternative is an operator staring
    at a permanent shortfall they have no way to acknowledge.
    """
    utc = _load_utc(db, utc_id, workspace)
    # Keyed by (type, enclave), matching the widened unique constraint: the
    # same type under two enclaves is two legitimate lines, not a duplicate.
    merged: dict[tuple[int, int | None], UtcInstanceLineIn] = {}
    for line in body:
        _load_type(db, line.equipment_type_id, workspace)
        if line.quantity < 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Quantity cannot be negative."
            )
        # The unique constraint would reject true duplicates anyway; folding
        # them is friendlier than failing a whole save over a repeated row.
        key = (line.equipment_type_id, line.enclave_id)
        existing = merged.get(key)
        if existing is None:
            merged[key] = line
        else:
            existing.quantity += line.quantity

    db.query(UtcInstanceLine).filter(
        UtcInstanceLine.utc_instance_id == utc.id
    ).delete(synchronize_session=False)
    rows = [
        UtcInstanceLine(
            utc_instance_id=utc.id,
            equipment_type_id=line.equipment_type_id,
            quantity=line.quantity,
            enclave_id=line.enclave_id,
            notes=line.notes,
        )
        for line in merged.values()
    ]
    for row in rows:
        db.add(row)
    db.flush()
    notify(background_tasks)
    return [_instance_line_out(db, r) for r in rows]


@router.get("/utcs/{utc_id}/completeness", response_model=UtcCompletenessOut)
def utc_completeness(
    utc_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    return _completeness(db, _load_utc(db, utc_id, workspace))


# ---------- holdings (the unserialized tier) ----------


@router.get("/utcs/{utc_id}/holdings", response_model=list[EquipmentHoldingOut])
def list_holdings(
    utc_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    _load_utc(db, utc_id, workspace)
    rows = (
        db.query(EquipmentHolding)
        .filter(EquipmentHolding.utc_instance_id == utc_id)
        .all()
    )
    return [_holding_out(db, r) for r in rows]


@router.post(
    "/utcs/{utc_id}/holdings",
    response_model=EquipmentHoldingOut,
    status_code=status.HTTP_201_CREATED,
)
def create_holding(
    utc_id: int,
    body: EquipmentHoldingIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    utc = _load_utc(db, utc_id, workspace)
    _load_type(db, body.equipment_type_id, workspace)
    row = EquipmentHolding(
        workspace_id=workspace.id, utc_instance_id=utc.id, **body.model_dump()
    )
    db.add(row)
    db.flush()
    notify(background_tasks)
    return _holding_out(db, row)


@router.patch("/holdings/{holding_id}", response_model=EquipmentHoldingOut)
def patch_holding(
    holding_id: int,
    body: EquipmentHoldingPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    row = db.get(EquipmentHolding, holding_id)
    if row is None or row.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Holding not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    db.flush()
    notify(background_tasks)
    return _holding_out(db, row)


@router.delete("/holdings/{holding_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holding(
    holding_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    row = db.get(EquipmentHolding, holding_id)
    if row is None or row.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Holding not found")
    db.delete(row)
    notify(background_tasks)


# ---------- the deploy wizard's one-shot endpoint ----------


@router.post("/utcs/deploy", response_model=UtcDeployOut, status_code=status.HTTP_201_CREATED)
def deploy_utc(
    body: UtcDeployIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Create a UTC deployment and everything it implies, atomically.

    Order matters: validate every serial and equipment ID *before* writing any
    of them, so a collision on the last radio doesn't leave the first two
    registered. `get_db` commits on a clean return, so raising anywhere in
    here rolls the whole thing back.
    """
    site = _site_in_workspace(db, body.site_id, workspace)

    # --- resolve or create the package ---
    package: PackageInstance | None = None
    if body.package_instance_id is not None:
        package = _load_package(db, body.package_instance_id, workspace)
    elif body.new_package_name:
        package = PackageInstance(
            workspace_id=workspace.id,
            name=body.new_package_name,
            package_def_id=body.new_package_def_id,
        )
        db.add(package)
        db.flush()

    if body.utc_def_id is not None:
        d = db.get(UtcDef, body.utc_def_id)
        if d is None or (
            d.workspace_id is not None and d.workspace_id != workspace.id
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "UTC definition not found")

    # --- pre-validate all serialized items before writing anything ---
    resolved: list[tuple[EquipmentType, str, object]] = []
    seen_codes: set[str] = set()
    seen_serials: set[str] = set()
    for index, item in enumerate(body.items):
        eq_type = _load_type(db, item.equipment_type_id, workspace)
        if not eq_type.serialized:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Item {index + 1}: '{eq_type.title}' is unserialized — "
                "record it under holdings, not as a serialized item.",
            )
        code, conflict = resolve_code(
            db, workspace.id, eq_type, item.serial_number, item.equipment_code
        )
        # Collisions within this very payload matter as much as collisions
        # against the database — two radios in one UTC can end in 7421.
        if conflict is not None or code in seen_codes:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                {
                    "message": f"Item {index + 1}: equipment ID '{code}' is already in use.",
                    "item_index": index,
                    "requested": code,
                    "suggestion": conflict or f"{code}A",
                },
            )
        if item.serial_number:
            if item.serial_number in seen_serials:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    {
                        "message": f"Item {index + 1}: serial '{item.serial_number}' "
                        "appears twice in this deployment.",
                        "item_index": index,
                    },
                )
            existing = (
                db.query(Equipment.id)
                .filter(
                    Equipment.workspace_id == workspace.id,
                    Equipment.serial_number == item.serial_number,
                )
                .first()
            )
            if existing is not None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    {
                        "message": f"Item {index + 1}: serial '{item.serial_number}' "
                        "is already registered in this workspace.",
                        "item_index": index,
                    },
                )
            seen_serials.add(item.serial_number)
        seen_codes.add(code)
        resolved.append((eq_type, code, item))

    # --- everything validated; now write ---
    utc = UtcInstance(
        workspace_id=workspace.id,
        package_instance_id=package.id if package else None,
        utc_def_id=body.utc_def_id,
        site_id=site.id,
        name=body.name,
        role=body.role,
        notes=body.notes,
    )
    db.add(utc)
    db.flush()

    created: list[Equipment] = []
    # item_index → {capability kind: capability row}, so the wiring step can
    # find the capability the wizard proposed without a second round-trip.
    caps_by_item: dict[int, dict[str, EquipmentCapability]] = {}
    for index, (eq_type, code, item) in enumerate(resolved):
        check_enclave_allowed(db, eq_type, item.enclave_id)
        eq = Equipment(
            workspace_id=workspace.id,
            equipment_type_id=eq_type.id,
            utc_instance_id=utc.id,
            site_id=site.id,
            enclave_id=item.enclave_id,
            equipment_code=code,
            serial_number=item.serial_number,
            status=item.status,
            notes=item.notes,
        )
        db.add(eq)
        db.flush()
        caps = materialize_capabilities(db, eq, eq_type, item.capability_kinds)
        db.flush()
        caps_by_item[index] = {c.kind: c for c in caps}
        created.append(eq)
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

    # Bulk gear is counted per type, and `equipment_holding` is unique on
    # (utc, type) — so two lines of the same type under different enclaves have
    # to fold into one holding. The per-enclave split still reaches the
    # expectation snapshot below, which is where it's meaningful.
    folded: dict[int, EquipmentHoldingIn] = {}
    for holding in body.holdings:
        _load_type(db, holding.equipment_type_id, workspace)
        existing = folded.get(holding.equipment_type_id)
        if existing is None:
            folded[holding.equipment_type_id] = holding.model_copy()
        else:
            existing.authorized_qty += holding.authorized_qty
            existing.on_hand_qty += holding.on_hand_qty
    holdings: list[EquipmentHolding] = []
    for holding in folded.values():
        row = EquipmentHolding(
            workspace_id=workspace.id,
            utc_instance_id=utc.id,
            # `enclave_id` rides along on the payload for the snapshot below,
            # but bulk gear isn't tagged: a box of cables serves every enclave.
            **holding.model_dump(exclude={"enclave_id"}),
        )
        db.add(row)
        holdings.append(row)

    # --- snapshot what this deployment was planned to carry ---
    # Taken from what the operator confirmed in the wizard, NOT from the def:
    # a UTC routinely ships without the stack for an enclave the team isn't
    # supporting, and those omissions are deliberate. Seeding from the def
    # would report them as shortfalls for the life of the deployment.
    # Keyed by (type, enclave) so a UTC bringing NIPR and SIPR switches records
    # them as two lines. Collapsing to one would make "leave the SIPR stack
    # home" unrepresentable in the snapshot the completeness check reads.
    expected: dict[tuple[int, int | None], int] = {}
    for eq_type, _code, item in resolved:
        key = (eq_type.id, item.enclave_id)
        expected[key] = expected.get(key, 0) + 1
    for holding in body.holdings:
        key = (holding.equipment_type_id, holding.enclave_id)
        expected[key] = expected.get(key, 0) + holding.authorized_qty
    for (type_id, enclave_id), quantity in expected.items():
        db.add(
            UtcInstanceLine(
                utc_instance_id=utc.id,
                equipment_type_id=type_id,
                quantity=quantity,
                enclave_id=enclave_id,
            )
        )

    # --- capability wiring ---
    bindings_created = 0
    for wire in body.wiring:
        cap = caps_by_item.get(wire.item_index, {}).get(wire.capability_kind)
        if cap is None:
            # The wizard proposed wiring a capability that wasn't materialized
            # (operator unchecked it on the previous step). Skipping is right:
            # failing the whole deploy over a stale proposal would be hostile.
            continue
        if wire.service_id is not None:
            svc = db.get(Service, wire.service_id)
            if svc is None or svc.site_id != site.id:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Service {wire.service_id} is not at site '{site.name}'.",
                )
            if db.get(CapabilityServiceLink, (cap.id, svc.id)) is None:
                db.add(
                    CapabilityServiceLink(
                        equipment_capability_id=cap.id,
                        service_id=svc.id,
                        role=wire.role,
                    )
                )
                bindings_created += 1
        if wire.gateway_id is not None:
            gw = db.get(Gateway, wire.gateway_id)
            if gw is None or gw.site_id != site.id:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"Gateway {wire.gateway_id} is not at site '{site.name}'.",
                )
            if db.get(CapabilityGatewayLink, (cap.id, gw.id)) is None:
                db.add(
                    CapabilityGatewayLink(
                        equipment_capability_id=cap.id, gateway_id=gw.id
                    )
                )
                bindings_created += 1

    db.flush()

    utc_def = db.get(UtcDef, utc.utc_def_id) if utc.utc_def_id else None
    emit_trigger(
        db,
        "utc.deployed",
        {
            "utc_instance_id": utc.id,
            "utc_name": utc.name,
            "utc_code": utc_def.code if utc_def else None,
            "site_id": site.id,
            "site_name": site.name,
            "role": utc.role,
            "equipment_count": len(created),
            "user_id": current_user.id,
            "username": current_user.username,
            "occurred_at": _now(),
        },
        workspace_id=workspace.id,
    )
    db.flush()
    notify(background_tasks)

    equipment_by_utc, links = _utc_role_context(db, workspace)
    return UtcDeployOut(
        utc_instance=_utc_out(db, utc, equipment_by_utc, links),
        equipment=equipment_out_bulk(db, created),
        holdings=[_holding_out(db, h) for h in holdings],
        bindings_created=bindings_created,
    )
