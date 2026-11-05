"""The global roster: who people are, once for the unit.

`person` is identity (name, rank, unit, contact details, supervisor, command);
each workspace's `personnel` row is that person's part in one picture. Same
global-vs-local shape as work centers: `workspace_id IS NULL` is the shared
roster, a non-null one is a person local to one picture (guests), which this
router doesn't serve — they're edited through personnel.

Anyone can read the roster. Creating or deleting a person needs `admin`;
editing one needs `admin` except for contact details, which operators keep
current since phone numbers change constantly.
"""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Person, Personnel, Unit, User, Workspace
from pubsub import notify
from schemas import (
    PersonIn,
    PersonnelCsvImportOut,
    PersonOut,
    PersonPatch,
    RosterCsvImportIn,
)

router = APIRouter(prefix="/people", tags=["personnel"])

# Identity columns copied straight onto a Person. supervisor_id is identity
# too but callers name it differently (a personnel id in a picture, a person
# id here), so each translates it themselves.
IDENTITY_FIELDS = (
    "personnel_type",
    "is_commander",
    "branch",
    "rank",
    "skill_level",
    "last_name",
    "first_name",
    "cellphone",
    "dsn",
    "sipr_number",
    "email",
    "unit_id",
)
CONTACT_FIELDS = {"cellphone", "dsn", "sipr_number", "email"}

_BRANCHES = {"air_force", "army", "navy", "marines", "space_force", "coast_guard"}


def person_from_csv_row(
    db: Session,
    row: dict[str, str],
    unit_by_name: dict[str, Unit],
    create_missing: bool,
    created_units: list[str],
) -> Person:
    """A new roster person from one CSV row (keys lowercased, values
    stripped, names already checked). Units match by name; a missing one is
    created when `create_missing`, and recorded in `created_units`."""
    personnel_type = row.get("personnel_type") or "military"
    if personnel_type not in {"military", "civilian"}:
        personnel_type = "military"

    branch = row.get("branch") or None
    if branch and branch not in _BRANCHES:
        # Normalize a few common variants; unrecognized -> drop.
        normalized = branch.lower().replace(" ", "_").replace("-", "_")
        if normalized == "marine_corps":
            branch = "marines"
        else:
            branch = normalized if normalized in _BRANCHES else None
    if personnel_type == "military" and branch is None:
        branch = "air_force"

    unit_name = row.get("unit") or ""
    unit_row: Unit | None = None
    if unit_name:
        unit_row = unit_by_name.get(unit_name.lower())
        if unit_row is None and create_missing:
            unit_row = Unit(name=unit_name)
            db.add(unit_row)
            db.flush()
            unit_by_name[unit_name.lower()] = unit_row
            created_units.append(unit_name)

    return Person(
        workspace_id=None,
        personnel_type=personnel_type,
        branch=branch,
        rank=row.get("rank") or None,
        last_name=row["last_name"],
        first_name=row["first_name"],
        cellphone=row.get("cellphone") or None,
        dsn=row.get("dsn") or None,
        sipr_number=row.get("sipr_number") or None,
        email=row.get("email") or None,
        unit_id=unit_row.id if unit_row else None,
    )


def changed_fields(person: Person, data: dict) -> dict:
    """The subset of `data` that would actually change `person`. Forms send
    every field back, so permission checks look only at real changes."""
    return {k: v for k, v in data.items() if getattr(person, k) != v}


def require_identity_write(person: Person, changes: dict, user: User) -> None:
    """Global identity beyond contact details is admin-only; a local (guest)
    person belongs to one picture and follows its operator rules."""
    if person.workspace_id is not None or user.role == "admin":
        return
    locked = sorted(set(changes) - CONTACT_FIELDS)
    if locked:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only an admin can change a roster person's "
            + ", ".join(f.replace("_", " ") for f in locked),
        )


def validate_unit(db: Session, unit_id: int | None) -> None:
    if unit_id is not None and db.get(Unit, unit_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unit not found")


def ensure_commander_slot(
    db: Session, unit_id: int | None, keep_person_id: int | None
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
    q = db.query(Person).filter(
        Person.unit_id == unit_id,
        Person.is_commander.is_(True),
    )
    if keep_person_id is not None:
        q = q.filter(Person.id != keep_person_id)
    existing = q.first()
    if existing is not None:
        unit = db.get(Unit, unit_id)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{existing.last_name}, {existing.first_name} is already the "
            f"commander of {unit.name if unit else 'that unit'} — unassign "
            "them first.",
        )


def check_commander(db: Session, person: Person, changes: dict) -> None:
    """Re-check the slot whenever the person will be a commander and either
    the flag or their unit is changing (moving units carries command into the
    new unit, which may already have one)."""
    if changes.get("is_commander", person.is_commander) and (
        "is_commander" in changes or "unit_id" in changes
    ):
        ensure_commander_slot(
            db, changes.get("unit_id", person.unit_id), keep_person_id=person.id
        )


def _load(db: Session, person_id: int) -> Person:
    person = db.get(Person, person_id)
    if person is None or person.workspace_id is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Person not found")
    return person


def _validate_supervisor(
    db: Session, supervisor_id: int | None, self_id: int | None
) -> None:
    if supervisor_id is None:
        return
    if supervisor_id == self_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "A person cannot be their own supervisor",
        )
    sup = db.get(Person, supervisor_id)
    if sup is None or sup.workspace_id is not None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Supervisor not found"
        )


def _outs(db: Session, people: list[Person]) -> list[PersonOut]:
    refs: dict[int, list[dict]] = {p.id: [] for p in people}
    if people:
        rows = (
            db.query(Personnel.person_id, Personnel.id, Workspace)
            .join(Workspace, Workspace.id == Personnel.workspace_id)
            .filter(Personnel.person_id.in_(refs))
            .order_by(Workspace.name)
            .all()
        )
        for person_id, personnel_id, ws in rows:
            refs[person_id].append(
                {
                    "workspace_id": ws.id,
                    "slug": ws.slug,
                    "name": ws.name,
                    "personnel_id": personnel_id,
                }
            )
    outs = []
    for p in people:
        out = PersonOut.model_validate(p)
        out.workspaces = refs[p.id]
        outs.append(out)
    return outs


@router.get("", response_model=list[PersonOut])
def list_people(
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    people = (
        db.query(Person)
        .filter(Person.workspace_id.is_(None))
        .order_by(Person.last_name, Person.first_name)
        .all()
    )
    return _outs(db, people)


@router.post("", response_model=PersonOut, status_code=status.HTTP_201_CREATED)
def create_person(
    body: PersonIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    validate_unit(db, body.unit_id)
    _validate_supervisor(db, body.supervisor_id, self_id=None)
    if body.is_commander:
        ensure_commander_slot(db, body.unit_id, keep_person_id=None)
    person = Person(workspace_id=None, **body.model_dump())
    db.add(person)
    db.flush()
    notify(background_tasks)
    return _outs(db, [person])[0]


@router.patch("/{person_id}", response_model=PersonOut)
def patch_person(
    person_id: int,
    body: PersonPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(requires("operator")),
):
    person = _load(db, person_id)
    changes = changed_fields(person, body.model_dump(exclude_unset=True))
    require_identity_write(person, changes, current_user)
    validate_unit(db, changes.get("unit_id"))
    if "supervisor_id" in changes:
        _validate_supervisor(db, changes["supervisor_id"], self_id=person.id)
    check_commander(db, person, changes)
    for k, v in changes.items():
        setattr(person, k, v)
    db.flush()
    notify(background_tasks)
    return _outs(db, [person])[0]


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_person(
    person_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    """Refuses while the person is in any picture: removing them there keeps
    each workspace's own call about its history."""
    person = _load(db, person_id)
    names = [
        ws.name
        for ws in db.query(Workspace)
        .join(Personnel, Personnel.workspace_id == Workspace.id)
        .filter(Personnel.person_id == person.id)
        .order_by(Workspace.name)
        .all()
    ]
    if names:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Still in " + ", ".join(names)
            + " — remove them there first.",
        )
    db.delete(person)
    notify(background_tasks)


@router.post(
    "/import-csv",
    response_model=PersonnelCsvImportOut,
    status_code=status.HTTP_201_CREATED,
)
def import_roster_csv(
    body: RosterCsvImportIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    """Load people onto the roster ahead of any workspace. See
    RosterCsvImportIn docs."""
    reader = csv.DictReader(io.StringIO(body.csv_text))
    if reader.fieldnames is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "CSV has no header row"
        )
    headers = {(h or "").strip().lower() for h in reader.fieldnames}
    missing = {"first_name", "last_name"} - headers
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Missing required CSV columns: {', '.join(sorted(missing))}",
        )

    unit_by_name = {u.name.lower(): u for u in db.query(Unit).all()}
    existing = {
        (p.last_name.lower(), p.first_name.lower(), (p.rank or "").lower())
        for p in db.query(Person).filter(Person.workspace_id.is_(None))
    }

    imported = 0
    skipped = 0
    created_units: list[str] = []
    errors: list[str] = []
    for idx, raw in enumerate(reader, start=2):  # header is line 1
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        if not (row.get("first_name") and row.get("last_name")):
            skipped += 1
            errors.append(f"line {idx}: missing first_name or last_name")
            continue
        key = (
            row["last_name"].lower(),
            row["first_name"].lower(),
            (row.get("rank") or "").lower(),
        )
        if body.skip_existing and key in existing:
            skipped += 1
            errors.append(
                f"line {idx}: {row['last_name']}, {row['first_name']} is "
                "already on the roster"
            )
            continue
        db.add(
            person_from_csv_row(
                db, row, unit_by_name, body.create_missing, created_units
            )
        )
        existing.add(key)
        imported += 1

    db.flush()
    notify(background_tasks)
    return PersonnelCsvImportOut(
        imported=imported,
        skipped=skipped,
        created_units=created_units,
        errors=errors,
    )
