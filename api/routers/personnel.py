"""Personnel CRUD + CSV bulk import.

A personnel row is someone's part in this workspace's picture; who they are
lives on the global `person` (see routers/people.py). Reads flatten the two
into one shape, and writes split a body between them: identity fields go to
the person — shared with every other picture they're in, so changing more
than contact details on a roster person needs `admin` — and the rest stay
here. Team assignments live on the `personnel_team` join and are exposed on
read as `team_ids` for a compact UI-friendly shape.
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
    Person,
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
from routers.people import (
    IDENTITY_FIELDS,
    changed_fields,
    check_commander,
    ensure_commander_slot,
    require_identity_write,
    validate_unit,
)
from routers.work_centers import load_visible as load_work_center
from routers.work_centers import visible_to as work_centers_visible_to
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


# Columns that belong to this picture rather than the person.
PICTURE_FIELDS = (
    "is_guest",
    "affiliation",
    "escort",
    "notes",
    "work_center_id",
    "assigned_site_id",
    "room_number",
)


def _ids_by_person(db: Session, workspace_id: int) -> dict[int, int]:
    """person id → personnel id within one workspace, for translating the
    roster's supervisor pointers into this picture."""
    return dict(
        db.query(Personnel.person_id, Personnel.id)
        .filter(Personnel.workspace_id == workspace_id)
        .all()
    )


def _supervisor_here(db: Session, p: Personnel) -> int | None:
    sup = p.person.supervisor_id
    if sup is None:
        return None
    return (
        db.query(Personnel.id)
        .filter(Personnel.workspace_id == p.workspace_id, Personnel.person_id == sup)
        .scalar()
    )


def _to_out(p: Personnel, supervisor_id: int | None) -> dict:
    """Serialize a Personnel row flattened with its person, team_ids resolved
    from the join. `supervisor_id` is already translated to this picture."""
    person = p.person
    return {
        "id": p.id,
        "workspace_id": p.workspace_id,
        "person_id": person.id,
        "personnel_type": person.personnel_type,
        "is_guest": p.is_guest,
        "is_commander": person.is_commander,
        "affiliation": p.affiliation,
        "escort": p.escort,
        "branch": person.branch,
        "rank": person.rank,
        "skill_level": person.skill_level,
        "last_name": person.last_name,
        "first_name": person.first_name,
        "cellphone": person.cellphone,
        "dsn": person.dsn,
        "sipr_number": person.sipr_number,
        "email": person.email,
        "notes": p.notes,
        "work_center_id": p.work_center_id,
        "unit_id": person.unit_id,
        "supervisor_id": supervisor_id,
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


def _out(db: Session, p: Personnel) -> dict:
    return _to_out(p, _supervisor_here(db, p))


def _outs(db: Session, people: list[Personnel], workspace: Workspace) -> list[dict]:
    ids = _ids_by_person(db, workspace.id)
    return [_to_out(p, ids.get(p.person.supervisor_id)) for p in people]


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
            "personnel_name": f"{p.person.last_name}, {p.person.first_name}",
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


def _validate_picture_refs(
    db: Session,
    workspace: Workspace,
    *,
    work_center_id: int | None,
    assigned_site_id: int | None,
) -> None:
    if work_center_id is not None:
        if load_work_center(db, work_center_id, workspace) is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Work center not found"
            )
    if assigned_site_id is not None:
        s = db.get(Site, assigned_site_id)
        if s is None or s.workspace_id != workspace.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Assigned site not found"
            )


def _resolve_supervisor(
    db: Session,
    workspace: Workspace,
    supervisor_id: int | None,
    self_person_id: int | None,
) -> int | None:
    """Clients name a supervisor by their personnel id in this picture; the
    roster stores the person. Returns that person's id."""
    if supervisor_id is None:
        return None
    sup = db.get(Personnel, supervisor_id)
    if sup is None or sup.workspace_id != workspace.id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Supervisor not found"
        )
    if self_person_id is not None and sup.person_id == self_person_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "A person cannot be their own supervisor",
        )
    return sup.person_id


def _in_other_pictures(db: Session, p: Personnel) -> bool:
    return (
        db.query(Personnel.id)
        .filter(Personnel.person_id == p.person_id, Personnel.id != p.id)
        .first()
        is not None
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
        .join(Person, Person.id == Personnel.person_id)
        .filter(Personnel.workspace_id == workspace.id)
        .order_by(Person.last_name, Person.first_name)
        .all()
    )
    return _outs(db, people, workspace)


@router.post("", response_model=PersonnelOut, status_code=status.HTTP_201_CREATED)
def create_personnel(
    body: PersonnelIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    _validate_picture_refs(
        db,
        workspace,
        work_center_id=body.work_center_id,
        assigned_site_id=body.assigned_site_id,
    )
    teams = _resolve_teams(db, workspace, body.team_ids)
    if body.person_id is not None:
        # Add from the roster: who they are is already settled.
        if body.is_guest:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Guests aren't on the roster — add them by name instead.",
            )
        person = db.get(Person, body.person_id)
        if person is None or person.workspace_id is not None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Person not found"
            )
        already = (
            db.query(Personnel.id)
            .filter(
                Personnel.workspace_id == workspace.id,
                Personnel.person_id == person.id,
            )
            .first()
        )
        if already is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{person.last_name}, {person.first_name} is already in "
                "this workspace.",
            )
    else:
        if not body.last_name or not body.first_name:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "first_name and last_name are required",
            )
        validate_unit(db, body.unit_id)
        if body.is_commander:
            ensure_commander_slot(db, body.unit_id, keep_person_id=None)
        person = Person(
            # A guest is local to this picture; everyone else joins the roster.
            workspace_id=workspace.id if body.is_guest else None,
            supervisor_id=_resolve_supervisor(
                db, workspace, body.supervisor_id, self_person_id=None
            ),
            **{f: getattr(body, f) for f in IDENTITY_FIELDS},
        )
        db.add(person)
    p = Personnel(
        workspace_id=workspace.id,
        person=person,
        **{f: getattr(body, f) for f in PICTURE_FIELDS},
    )
    p.teams = teams
    db.add(p)
    db.flush()
    notify(background_tasks)
    return _out(db, p)


@router.get("/{pid}", response_model=PersonnelOut)
def get_personnel(
    pid: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    return _out(db, _load(db, pid, workspace))


@router.patch("/{pid}", response_model=PersonnelOut)
def patch_personnel(
    pid: int,
    body: PersonnelPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    p = _load(db, pid, workspace)
    person = p.person
    data = body.model_dump(exclude_unset=True)
    team_ids = data.pop("team_ids", None)

    changes = changed_fields(
        person, {k: v for k, v in data.items() if k in IDENTITY_FIELDS}
    )
    if "supervisor_id" in data and data["supervisor_id"] != _supervisor_here(db, p):
        changes["supervisor_id"] = _resolve_supervisor(
            db, workspace, data["supervisor_id"], self_person_id=person.id
        )
    require_identity_write(person, changes, current_user)
    validate_unit(db, changes.get("unit_id"))
    check_commander(db, person, changes)

    picture = {k: v for k, v in data.items() if k in PICTURE_FIELDS}
    _validate_picture_refs(
        db,
        workspace,
        work_center_id=picture.get("work_center_id", p.work_center_id),
        assigned_site_id=picture.get("assigned_site_id", p.assigned_site_id),
    )
    if "is_guest" in picture and picture["is_guest"] != p.is_guest:
        # Guest-ness decides whether the person is on the roster at all.
        if picture["is_guest"]:
            if _in_other_pictures(db, p):
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "This person is in other workspaces too, so they can't "
                    "become a guest of this one.",
                )
            person.workspace_id = workspace.id
        else:
            person.workspace_id = None

    for k, v in changes.items():
        setattr(person, k, v)
    for k, v in picture.items():
        setattr(p, k, v)
    if team_ids is not None:
        p.teams = _resolve_teams(db, workspace, team_ids)
    db.flush()
    notify(background_tasks)
    return _out(db, p)


@router.delete("/{pid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_personnel(
    pid: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    """Removes the person from this picture. A roster person stays on the
    roster; a guest, who exists only here, goes entirely."""
    p = _load(db, pid, workspace)
    person = p.person
    db.delete(p)
    if person.workspace_id is not None:
        db.flush()
        db.delete(person)
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
    return _out(db, p)


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
    return _outs(db, people, workspace)


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
    "person_id",
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
    # A sheet of roster ids can stand without names.
    missing = REQUIRED_CSV_COLUMNS - headers if "person_id" not in headers else set()
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Missing required CSV columns: {', '.join(sorted(missing))}",
        )

    # Pre-load existing work centers / units for name lookup.
    wc_by_name = {
        wc.name.lower(): wc
        for wc in db.query(WorkCenter)
        .filter(work_centers_visible_to(workspace))
        .all()
    }
    unit_by_name = {
        u.name.lower(): u for u in db.query(Unit).all()
    }

    in_picture = {
        pid
        for (pid,) in db.query(Personnel.person_id).filter(
            Personnel.workspace_id == workspace.id
        )
    }

    imported = 0
    skipped = 0
    created_wc: list[str] = []
    created_units: list[str] = []
    errors: list[str] = []

    for idx, raw in enumerate(reader, start=2):  # header is line 1
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}

        person: Person | None = None
        if row.get("person_id"):
            # A roster id links the person as they are; the row's identity
            # columns are ignored.
            try:
                person = db.get(Person, int(row["person_id"]))
            except ValueError:
                person = None
            if person is None or person.workspace_id is not None:
                skipped += 1
                errors.append(f"line {idx}: no roster person {row['person_id']}")
                continue
            if person.id in in_picture:
                skipped += 1
                errors.append(
                    f"line {idx}: {person.last_name}, {person.first_name} "
                    "is already in this workspace"
                )
                continue

        first_name = row.get("first_name") or ""
        last_name = row.get("last_name") or ""
        if person is None and (not first_name or not last_name):
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
                # A shop nobody has yet is added locally — the import speaks
                # for this picture, not for the shared list.
                wc_row = WorkCenter(workspace_id=workspace.id, name=wc_name)
                db.add(wc_row)
                db.flush()
                wc_by_name[wc_name.lower()] = wc_row
                created_wc.append(wc_name)

        unit_name = row.get("unit") or ""
        unit_row: Unit | None = None
        if unit_name and person is None:
            unit_row = unit_by_name.get(unit_name.lower())
            if unit_row is None and body.create_missing:
                unit_row = Unit(name=unit_name)
                db.add(unit_row)
                db.flush()
                unit_by_name[unit_name.lower()] = unit_row
                created_units.append(unit_name)

        if person is None:
            person = Person(
                workspace_id=None,
                personnel_type=personnel_type,
                branch=branch,
                rank=row.get("rank") or None,
                last_name=last_name,
                first_name=first_name,
                cellphone=row.get("cellphone") or None,
                dsn=row.get("dsn") or None,
                sipr_number=row.get("sipr_number") or None,
                email=row.get("email") or None,
                unit_id=unit_row.id if unit_row else None,
            )
            db.add(person)
        p = Personnel(
            workspace_id=workspace.id,
            person=person,
            notes=row.get("notes") or None,
            work_center_id=wc_row.id if wc_row else None,
            room_number=row.get("room_number") or None,
        )
        db.add(p)
        in_picture.add(person.id)
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
