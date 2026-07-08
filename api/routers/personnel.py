"""Personnel CRUD + CSV bulk import.

Personnel are a workspace-scoped roster. Team assignments live on the
`personnel_team` join and are exposed on read as `team_ids` for a compact
UI-friendly shape.
"""

from __future__ import annotations

import csv
import datetime
import io

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from auth import get_current_user
from rules_engine import emit_trigger
from models import (
    Personnel,
    PersonnelLocationEvent,
    PersonnelTeam,
    Site,
    Team,
    Unit,
    User,
    WorkCenter,
    Workspace,
)
from pubsub import notify
from schemas import (
    PersonnelCheckInBulkIn,
    PersonnelCheckInIn,
    PersonnelCsvImportIn,
    PersonnelCsvImportOut,
    PersonnelIn,
    PersonnelLocationEventOut,
    PersonnelOut,
    PersonnelPatch,
    PersonnelResetIn,
    PersonnelResetOut,
)

router = APIRouter(prefix="/personnel", tags=["personnel"])


def _to_out(p: Personnel) -> dict:
    """Serialize a Personnel row with team_ids resolved from the join."""
    return {
        "id": p.id,
        "workspace_id": p.workspace_id,
        "personnel_type": p.personnel_type,
        "is_guest": p.is_guest,
        "is_commander": p.is_commander,
        "affiliation": p.affiliation,
        "escort": p.escort,
        "branch": p.branch,
        "rank": p.rank,
        "skill_level": p.skill_level,
        "last_name": p.last_name,
        "first_name": p.first_name,
        "cellphone": p.cellphone,
        "dsn": p.dsn,
        "sipr_number": p.sipr_number,
        "email": p.email,
        "notes": p.notes,
        "work_center_id": p.work_center_id,
        "unit_id": p.unit_id,
        "supervisor_id": p.supervisor_id,
        "assigned_site_id": p.assigned_site_id,
        "room_number": p.room_number,
        "team_ids": [t.id for t in p.teams],
        "current_status": p.current_status,
        "current_site_id": p.current_site_id,
        "current_status_since": p.current_status_since,
        "current_status_note": p.current_status_note,
        "expected_return_at": p.expected_return_at,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


def _resolve_checkin_site(
    db: Session, workspace: Workspace, stat: str, site_id: int | None
) -> int | None:
    """on_site/traveling carry a site (required + must be in-workspace); every
    other status is site-less, so drop any site the client sent."""
    if stat in ("on_site", "traveling"):
        if site_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"site_id is required when status is {stat}",
            )
        site = db.get(Site, site_id)
        if site is None or site.workspace_id != workspace.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Site not found"
            )
        return site_id
    return None


def _apply_location_change(
    db: Session,
    p: Personnel,
    *,
    stat: str,
    site_id: int | None,
    note: str | None,
    expected_return_at,
    when,
    user_id: int | None,
    source_flow: str = "checkin",
) -> None:
    """Append a PersonnelLocationEvent (append-only history), update the
    denormalized current_* fields, and emit the location-changed trigger.
    `source_flow` ("checkin" | "bulk" | "reset") rides on the trigger
    payload so rules can distinguish flows — the seeded feed rule skips
    "reset" to avoid flooding the Events page with one row per person.
    """
    prev_status = p.current_status
    db.add(
        PersonnelLocationEvent(
            personnel_id=p.id,
            status=stat,
            site_id=site_id,
            note=note,
            expected_return_at=expected_return_at,
            changed_at=when,
            changed_by_user_id=user_id,
        )
    )
    emit_trigger(
        db,
        "personnel.location_changed",
        {
            "personnel_id": p.id,
            "personnel_name": f"{p.last_name}, {p.first_name}",
            "prev_status": prev_status,
            "new_status": stat,
            "site_id": site_id,
            "source_flow": source_flow,
            "note": note,
            "user_id": user_id,
            "occurred_at": when,
        },
        workspace_id=p.workspace_id,
    )
    p.current_status = stat
    p.current_site_id = site_id
    p.current_status_since = when
    p.current_status_note = note
    p.expected_return_at = expected_return_at


def _load(db: Session, pid: int, workspace: Workspace) -> Personnel:
    p = db.get(Personnel, pid)
    if p is None or p.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Personnel not found")
    return p


def _validate_refs(
    db: Session,
    workspace: Workspace,
    *,
    work_center_id: int | None,
    unit_id: int | None,
    supervisor_id: int | None,
    assigned_site_id: int | None,
    self_id: int | None,
) -> None:
    if work_center_id is not None:
        wc = db.get(WorkCenter, work_center_id)
        if wc is None or wc.workspace_id != workspace.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Work center not found"
            )
    if unit_id is not None:
        u = db.get(Unit, unit_id)
        if u is None or u.workspace_id != workspace.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Unit not found"
            )
    if supervisor_id is not None:
        if self_id is not None and supervisor_id == self_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "A person cannot be their own supervisor",
            )
        sup = db.get(Personnel, supervisor_id)
        if sup is None or sup.workspace_id != workspace.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Supervisor not found"
            )
    if assigned_site_id is not None:
        s = db.get(Site, assigned_site_id)
        if s is None or s.workspace_id != workspace.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Assigned site not found"
            )


def _ensure_commander_slot(
    db: Session, unit_id: int | None, keep_id: int | None
) -> None:
    """A commander must belong to a unit, and each unit has at most one.
    The UI hides the toggle when the slot is taken, and a partial unique
    index backstops the rule, but this turns a race into a readable error
    instead of an IntegrityError."""
    if unit_id is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "A commander must belong to a unit — pick a unit first.",
        )
    q = db.query(Personnel).filter(
        Personnel.unit_id == unit_id,
        Personnel.is_commander.is_(True),
    )
    if keep_id is not None:
        q = q.filter(Personnel.id != keep_id)
    existing = q.first()
    if existing is not None:
        unit = db.get(Unit, unit_id)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{existing.last_name}, {existing.first_name} is already the "
            f"commander of {unit.name if unit else 'that unit'} — unassign "
            "them first.",
        )


def _resolve_teams(
    db: Session, workspace: Workspace, team_ids: list[int]
) -> list[Team]:
    if not team_ids:
        return []
    teams = (
        db.query(Team)
        .filter(Team.id.in_(team_ids), Team.workspace_id == workspace.id)
        .all()
    )
    if len(teams) != len(set(team_ids)):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "One or more teams not found in this workspace",
        )
    return teams


@router.get("", response_model=list[PersonnelOut])
def list_personnel(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    people = (
        db.query(Personnel)
        .filter(Personnel.workspace_id == workspace.id)
        .order_by(Personnel.last_name, Personnel.first_name)
        .all()
    )
    return [_to_out(p) for p in people]


@router.post("", response_model=PersonnelOut, status_code=status.HTTP_201_CREATED)
def create_personnel(
    body: PersonnelIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    _validate_refs(
        db,
        workspace,
        work_center_id=body.work_center_id,
        unit_id=body.unit_id,
        supervisor_id=body.supervisor_id,
        assigned_site_id=body.assigned_site_id,
        self_id=None,
    )
    if body.is_commander:
        _ensure_commander_slot(db, body.unit_id, keep_id=None)
    teams = _resolve_teams(db, workspace, body.team_ids)
    data = body.model_dump(exclude={"team_ids"})
    p = Personnel(workspace_id=workspace.id, **data)
    p.teams = teams
    db.add(p)
    db.flush()
    notify(background_tasks)
    return _to_out(p)


@router.get("/{pid}", response_model=PersonnelOut)
def get_personnel(
    pid: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    return _to_out(_load(db, pid, workspace))


@router.patch("/{pid}", response_model=PersonnelOut)
def patch_personnel(
    pid: int,
    body: PersonnelPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    p = _load(db, pid, workspace)
    data = body.model_dump(exclude_unset=True)
    _validate_refs(
        db,
        workspace,
        work_center_id=data.get("work_center_id", p.work_center_id),
        unit_id=data.get("unit_id", p.unit_id),
        supervisor_id=data.get("supervisor_id", p.supervisor_id),
        assigned_site_id=data.get("assigned_site_id", p.assigned_site_id),
        self_id=p.id,
    )
    # Re-check the commander slot whenever the person will be a commander and
    # either the flag or their unit is changing (moving units carries command
    # into the new unit, which may already have one).
    if data.get("is_commander", p.is_commander) and (
        "is_commander" in data or "unit_id" in data
    ):
        _ensure_commander_slot(
            db, data.get("unit_id", p.unit_id), keep_id=p.id
        )
    team_ids = data.pop("team_ids", None)
    for k, v in data.items():
        setattr(p, k, v)
    if team_ids is not None:
        p.teams = _resolve_teams(db, workspace, team_ids)
    db.flush()
    notify(background_tasks)
    return _to_out(p)


@router.delete("/{pid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_personnel(
    pid: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    p = _load(db, pid, workspace)
    # Break any supervisor pointers that reference this person before delete;
    # ondelete=SET NULL would handle it, but flushing here keeps the ORM state
    # consistent for the notify payload.
    db.query(Personnel).filter(Personnel.supervisor_id == p.id).update(
        {Personnel.supervisor_id: None}
    )
    db.delete(p)
    notify(background_tasks)


@router.post("/{pid}/checkin", response_model=PersonnelOut)
def checkin_personnel(
    pid: int,
    body: PersonnelCheckInIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
):
    """Sign a person in / out. Appends a PersonnelLocationEvent and updates
    the denormalized current_* fields on the Personnel row.
    """
    p = _load(db, pid, workspace)
    target_site_id = _resolve_checkin_site(db, workspace, body.status, body.site_id)
    when = body.changed_at or datetime.datetime.now(datetime.timezone.utc)
    _apply_location_change(
        db,
        p,
        stat=body.status,
        site_id=target_site_id,
        note=body.note,
        expected_return_at=body.expected_return_at,
        when=when,
        user_id=current_user.id,
    )
    db.flush()
    notify(background_tasks)
    return _to_out(p)


@router.post("/checkin-bulk", response_model=list[PersonnelOut])
def checkin_bulk(
    body: PersonnelCheckInBulkIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
):
    """Apply the same status to many people in one transaction. Powers multi
    check-in / check-out and roll-call musters. Silently ignores ids that
    aren't in this workspace so a stale client list doesn't fail the batch.
    """
    target_site_id = _resolve_checkin_site(db, workspace, body.status, body.site_id)
    when = body.changed_at or datetime.datetime.now(datetime.timezone.utc)
    people = (
        db.query(Personnel)
        .filter(
            Personnel.workspace_id == workspace.id,
            Personnel.id.in_(body.person_ids),
        )
        .all()
        if body.person_ids
        else []
    )
    for p in people:
        _apply_location_change(
            db,
            p,
            stat=body.status,
            site_id=target_site_id,
            note=body.note,
            expected_return_at=body.expected_return_at,
            when=when,
            user_id=current_user.id,
            source_flow="bulk",
        )
    db.flush()
    notify(background_tasks)
    return [_to_out(p) for p in people]


@router.post("/reset", response_model=PersonnelResetOut)
def reset_statuses(
    body: PersonnelResetIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """End-of-day reset: set every person in the workspace to `status`
    (default 'unknown'), clearing site and expected-return. Skips people
    already at the target status, and skips the workspace event feed so a
    daily reset doesn't flood the Events page (history rows are still written).
    """
    when = datetime.datetime.now(datetime.timezone.utc)
    people = (
        db.query(Personnel)
        .filter(
            Personnel.workspace_id == workspace.id,
            Personnel.current_status != body.status,
        )
        .all()
    )
    for p in people:
        _apply_location_change(
            db,
            p,
            stat=body.status,
            site_id=None,
            note=None,
            expected_return_at=None,
            when=when,
            user_id=current_user.id,
            source_flow="reset",
        )
    db.flush()
    notify(background_tasks)
    return {"reset": len(people)}


@router.get(
    "/{pid}/history",
    response_model=list[PersonnelLocationEventOut],
)
def list_personnel_history(
    pid: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    _load(db, pid, workspace)  # 404 if not in workspace
    return (
        db.query(PersonnelLocationEvent)
        .filter(PersonnelLocationEvent.personnel_id == pid)
        .order_by(PersonnelLocationEvent.changed_at.desc())
        .limit(max(1, min(500, limit)))
        .all()
    )


CSV_COLUMNS = {
    "first_name",
    "last_name",
    "personnel_type",
    "branch",
    "rank",
    "cellphone",
    "dsn",
    "sipr_number",
    "email",
    "notes",
    "work_center",
    "unit",
    "room_number",
}
REQUIRED_CSV_COLUMNS = {"first_name", "last_name"}


@router.post(
    "/import-csv",
    response_model=PersonnelCsvImportOut,
    status_code=status.HTTP_201_CREATED,
)
def import_personnel_csv(
    body: PersonnelCsvImportIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    """Bulk create personnel from a CSV blob. See PersonnelCsvImportIn docs."""
    reader = csv.DictReader(io.StringIO(body.csv_text))
    if reader.fieldnames is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "CSV has no header row"
        )
    headers = {(h or "").strip().lower() for h in reader.fieldnames}
    missing = REQUIRED_CSV_COLUMNS - headers
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Missing required CSV columns: {', '.join(sorted(missing))}",
        )

    # Pre-load existing work centers / units for name lookup.
    wc_by_name = {
        wc.name.lower(): wc
        for wc in db.query(WorkCenter)
        .filter(WorkCenter.workspace_id == workspace.id)
        .all()
    }
    unit_by_name = {
        u.name.lower(): u
        for u in db.query(Unit)
        .filter(Unit.workspace_id == workspace.id)
        .all()
    }

    imported = 0
    skipped = 0
    created_wc: list[str] = []
    created_units: list[str] = []
    errors: list[str] = []

    for idx, raw in enumerate(reader, start=2):  # header is line 1
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        first_name = row.get("first_name") or ""
        last_name = row.get("last_name") or ""
        if not first_name or not last_name:
            skipped += 1
            errors.append(f"line {idx}: missing first_name or last_name")
            continue

        personnel_type = row.get("personnel_type") or "military"
        if personnel_type not in {"military", "civilian"}:
            personnel_type = "military"

        branch = row.get("branch") or None
        if branch and branch not in {
            "air_force",
            "army",
            "navy",
            "marines",
            "space_force",
            "coast_guard",
        }:
            # Normalize a few common variants; unrecognized -> drop.
            normalized = branch.lower().replace(" ", "_").replace("-", "_")
            if normalized in {
                "air_force",
                "army",
                "navy",
                "marines",
                "marine_corps",
                "space_force",
                "coast_guard",
            }:
                branch = "marines" if normalized == "marine_corps" else normalized
            else:
                branch = None
        if personnel_type == "military" and branch is None:
            branch = "air_force"

        wc_name = row.get("work_center") or ""
        wc_row: WorkCenter | None = None
        if wc_name:
            wc_row = wc_by_name.get(wc_name.lower())
            if wc_row is None and body.create_missing:
                wc_row = WorkCenter(workspace_id=workspace.id, name=wc_name)
                db.add(wc_row)
                db.flush()
                wc_by_name[wc_name.lower()] = wc_row
                created_wc.append(wc_name)

        unit_name = row.get("unit") or ""
        unit_row: Unit | None = None
        if unit_name:
            unit_row = unit_by_name.get(unit_name.lower())
            if unit_row is None and body.create_missing:
                unit_row = Unit(workspace_id=workspace.id, name=unit_name)
                db.add(unit_row)
                db.flush()
                unit_by_name[unit_name.lower()] = unit_row
                created_units.append(unit_name)

        p = Personnel(
            workspace_id=workspace.id,
            personnel_type=personnel_type,
            branch=branch,
            rank=row.get("rank") or None,
            last_name=last_name,
            first_name=first_name,
            cellphone=row.get("cellphone") or None,
            dsn=row.get("dsn") or None,
            sipr_number=row.get("sipr_number") or None,
            email=row.get("email") or None,
            notes=row.get("notes") or None,
            work_center_id=wc_row.id if wc_row else None,
            unit_id=unit_row.id if unit_row else None,
            room_number=row.get("room_number") or None,
        )
        db.add(p)
        imported += 1

    db.flush()
    notify(background_tasks)
    return PersonnelCsvImportOut(
        imported=imported,
        skipped=skipped,
        created_work_centers=created_wc,
        created_units=created_units,
        errors=errors,
    )
