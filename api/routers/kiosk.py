"""CAC check-in stations: card readers at doors, independent of the web app.

Admins create a station per entry point, bound to one site; the station gets
a token, shown once. Anything holding the token — the bundled kiosk page
(webui/public/kiosk.html), or any other client — sends `X-Station-Token`
and posts each scan to `/kiosk/scan`. No user login is involved, so a busy
door doesn't need an operator at a keyboard.

A scan resolves the card to a person by DoD ID (EDIPI — see api/cac.py) and
signs them in or out at the station's site:

  * toggle (default): on site here → checked out; anywhere else → checked in
    here. Someone still checked in at another site is moved: one history
    event ends the old site and starts this one, in one transaction.
  * in / out: for separate entry and exit doors; a scan that would change
    nothing reports "already".

A repeat scan of the same card at the same station within REPEAT_WINDOW is
ignored — people double-tap, and a toggle door would otherwise sign them
straight back out. The personnel row is locked for the change so two doors
scanning one card at once can't interleave.
"""

from __future__ import annotations

import datetime
import hashlib
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from cac import CacScan, describe_shape, edipi_hash, parse_cac
from db import get_db
from deps import get_current_workspace, requires
from models import (
    CheckinStation,
    KioskPendingScan,
    Person,
    Personnel,
    PersonnelLocationEvent,
    Site,
    User,
    Workspace,
)
from personnel_data import person_display_name
from pubsub import notify
from routers.people import ensure_edipi_free
from routers.personnel import _apply_location_change, create_personnel
from schemas import (
    CheckinStationIn,
    CheckinStationOut,
    CheckinStationPatch,
    CheckinStationTokenOut,
    CheckinActivityOut,
    KioskGuestIn,
    KioskLinkIn,
    KioskNewPersonIn,
    KioskPendingOut,
    KioskResolveOut,
    KioskScanIn,
    KioskScanOut,
    KioskStationOut,
    PersonnelIn,
)

log = logging.getLogger("xcomm_hud.kiosk")

REPEAT_WINDOW = datetime.timedelta(seconds=20)
# Unresolved unrecognized cards (which hold the name and rank read off the
# card) are deleted after this.
PENDING_TTL = datetime.timedelta(days=7)
# How far back a kiosk may replay a scan it queued while offline.
MAX_QUEUED_AGE = datetime.timedelta(hours=24)
CHECKOUT_STATUS = "off_site"

stations_router = APIRouter(prefix="/checkin-stations", tags=["checkin-stations"])
kiosk_router = APIRouter(prefix="/kiosk", tags=["kiosk"])
pending_router = APIRouter(prefix="/kiosk-pending", tags=["kiosk"])
activity_router = APIRouter(prefix="/checkin-activity", tags=["kiosk"])


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_token() -> str:
    return "xks_" + secrets.token_urlsafe(24)


def _station_out(s: CheckinStation, token: str | None = None) -> dict:
    out = {
        "id": s.id,
        "workspace_id": s.workspace_id,
        "site_id": s.site_id,
        "site_name": s.site.name,
        "name": s.name,
        "mode": s.mode,
        "token_hint": s.token_hint,
        "disabled": s.disabled,
        "last_seen_at": s.last_seen_at,
        "created_at": s.created_at,
    }
    if token is not None:
        out["token"] = token
    return out


def _site_here(db: Session, workspace: Workspace, site_id: int) -> Site:
    site = db.get(Site, site_id)
    if site is None or site.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Site not found")
    return site


def _load_station(db: Session, sid: int, workspace: Workspace) -> CheckinStation:
    s = db.get(CheckinStation, sid)
    if s is None or s.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Station not found")
    return s


# ---------------------------------------------------------------- admin


@stations_router.get("", response_model=list[CheckinStationOut])
def list_stations(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    rows = (
        db.query(CheckinStation)
        .filter(CheckinStation.workspace_id == workspace.id)
        .order_by(CheckinStation.name)
        .all()
    )
    return [_station_out(s) for s in rows]


@stations_router.post(
    "", response_model=CheckinStationTokenOut, status_code=status.HTTP_201_CREATED
)
def create_station(
    body: CheckinStationIn,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    site = _site_here(db, workspace, body.site_id)
    token = _new_token()
    s = CheckinStation(
        workspace_id=workspace.id,
        site_id=site.id,
        site=site,
        name=body.name.strip(),
        mode=body.mode,
        token_hash=_hash(token),
        token_hint=token[-4:],
    )
    db.add(s)
    db.flush()
    return _station_out(s, token)


@stations_router.patch("/{sid}", response_model=CheckinStationOut)
def patch_station(
    sid: int,
    body: CheckinStationPatch,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    s = _load_station(db, sid, workspace)
    data = body.model_dump(exclude_unset=True)
    if data.get("site_id") is not None:
        s.site = _site_here(db, workspace, data.pop("site_id"))
    if data.get("name") is not None:
        s.name = data.pop("name").strip()
    for k, v in data.items():
        if v is not None:
            setattr(s, k, v)
    db.flush()
    return _station_out(s)


@stations_router.post("/{sid}/rotate-token", response_model=CheckinStationTokenOut)
def rotate_station_token(
    sid: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    """Issue a new token; the old one stops working immediately (a lost or
    stolen kiosk)."""
    s = _load_station(db, sid, workspace)
    token = _new_token()
    s.token_hash = _hash(token)
    s.token_hint = token[-4:]
    db.flush()
    return _station_out(s, token)


@stations_router.delete("/{sid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_station(
    sid: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    db.delete(_load_station(db, sid, workspace))


# ---------------------------------------------------------------- kiosk


def current_station(
    db: Session = Depends(get_db),
    x_station_token: str = Header(default=""),
) -> CheckinStation:
    if not x_station_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing station token")
    s = (
        db.query(CheckinStation)
        .filter(CheckinStation.token_hash == _hash(x_station_token))
        .first()
    )
    if s is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown station token")
    if s.disabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This station is disabled")
    s.last_seen_at = _now()
    return s


@kiosk_router.get("/station", response_model=KioskStationOut)
def kiosk_station(
    db: Session = Depends(get_db),
    station: CheckinStation = Depends(current_station),
):
    ws = db.get(Workspace, station.workspace_id)
    return {
        "name": station.name,
        "mode": station.mode,
        "site_id": station.site_id,
        "site_name": station.site.name,
        "workspace_name": ws.name if ws else "",
    }


def _find_personnel(
    db: Session, workspace_id: int, hashed: str
) -> tuple[Optional[Personnel], Optional[Person]]:
    """The personnel row for this DoD ID in the station's picture (roster
    person first, then a local guest); else any roster person with it."""
    rows = (
        db.query(Personnel)
        .join(Person, Person.id == Personnel.person_id)
        .filter(Personnel.workspace_id == workspace_id, Person.edipi_hash == hashed)
        .order_by(Person.workspace_id.is_not(None))
        .all()
    )
    if rows:
        return rows[0], rows[0].person
    roster = (
        db.query(Person)
        .filter(Person.edipi_hash == hashed, Person.workspace_id.is_(None))
        .first()
    )
    return None, roster


def _queue_unrecognized(
    db: Session,
    station: CheckinStation,
    scan: CacScan,
    hashed: str,
    person: Optional[Person],
    when: datetime.datetime,
    expired: bool,
) -> None:
    """Upsert the operator queue row for this card in this workspace. A
    later scan moves it to the latest door; a Code 39 scan never erases
    name data an earlier PDF417 scan supplied."""
    _purge_stale_pending(db, station.workspace_id)
    row = (
        db.query(KioskPendingScan)
        .filter(
            KioskPendingScan.workspace_id == station.workspace_id,
            KioskPendingScan.edipi_hash == hashed,
        )
        .with_for_update(of=KioskPendingScan)
        .first()
    )
    if row is None:
        row = KioskPendingScan(
            workspace_id=station.workspace_id,
            edipi_hash=hashed,
            scan_count=0,
            first_scanned_at=when,
            last_scanned_at=when,
        )
        db.add(row)
    row.kind = "not_in_workspace" if person is not None else "unknown_card"
    row.person_id = person.id if person is not None else None
    row.station_id = station.id
    row.site_id = station.site_id
    row.scan_count = (row.scan_count or 0) + 1
    row.last_scanned_at = max(row.last_scanned_at, when)
    row.card_expired = expired
    for field in (
        "first_name",
        "last_name",
        "middle_initial",
        "rank",
        "pay_grade",
        "branch",
        "is_civilian",
    ):
        value = getattr(scan, field)
        if value is not None:
            setattr(row, field, value)
    db.flush()


def _purge_stale_pending(db: Session, workspace_id: int) -> None:
    db.query(KioskPendingScan).filter(
        KioskPendingScan.workspace_id == workspace_id,
        KioskPendingScan.last_scanned_at < _now() - PENDING_TTL,
    ).delete(synchronize_session=False)


def _who(person: Person) -> str:
    name = person_display_name(person)
    return f"{person.rank} {name}" if person.rank else name


@kiosk_router.post("/scan", response_model=KioskScanOut)
def kiosk_scan(
    body: KioskScanIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    station: CheckinStation = Depends(current_station),
):
    """One card scan. Always 200 with a `result` the kiosk renders, so a
    scan problem never looks like a network failure (which a kiosk queues
    and retries)."""
    now = _now()
    when = now
    if body.scanned_at is not None:
        at = body.scanned_at
        if at.tzinfo is None:
            at = at.replace(tzinfo=datetime.timezone.utc)
        # Clamp a kiosk clock that's ahead; ignore one that's absurdly behind.
        if now - MAX_QUEUED_AGE <= at <= now:
            when = at

    scan = parse_cac(body.code)
    if scan is None:
        shape = describe_shape(body.code)
        if body.diag:
            shape += f" kiosk[{body.diag}]"
        log.warning("kiosk unreadable scan at %s: %s", station.name, shape)
        return KioskScanOut(
            result="unreadable",
            message="Couldn't read that card. Scan the barcode on the front, "
            "or type the 10-digit DoD ID.",
            scan_shape=shape,
        )
    expired = scan.is_expired(when.date())

    hashed = edipi_hash(scan.edipi)
    p, person = _find_personnel(db, station.workspace_id, hashed)
    if p is None:
        _queue_unrecognized(db, station, scan, hashed, person, when, expired)
        notify(background_tasks)
        then = (
            "notified." if station.mode == "out" else "notified and will sign you in."
        )
        if person is not None:
            return KioskScanOut(
                result="not_in_workspace",
                message=f"You're not on this list yet — the desk has been {then}",
                name=_who(person),
                card_expired=expired,
            )
        return KioskScanOut(
            result="unknown_card",
            message=f"Card not recognized — the desk has been {then}",
            name=scan.display_name,
            rank=scan.rank,
            card_expired=expired,
        )

    # Serialize concurrent scans of the same person (two doors, one card).
    p = (
        db.query(Personnel)
        .filter(Personnel.id == p.id)
        .with_for_update(of=Personnel)
        .populate_existing()
        .one()
    )
    site_name = station.site.name
    base = dict(
        name=_who(p.person),
        rank=p.person.rank,
        personnel_id=p.id,
        card_expired=expired,
    )

    if p.current_status_since is not None and when < p.current_status_since:
        # A queued offline scan that a newer change has overtaken.
        return KioskScanOut(
            result="stale",
            message="Older scan ignored — status has changed since.",
            status=p.current_status,
            at=p.current_status_since,
            **base,
        )

    last = (
        db.query(PersonnelLocationEvent)
        .filter(PersonnelLocationEvent.personnel_id == p.id)
        .order_by(PersonnelLocationEvent.changed_at.desc())
        .first()
    )
    if (
        last is not None
        and last.station_id == station.id
        and when - last.changed_at < REPEAT_WINDOW
    ):
        verb = "in" if p.current_status == "on_site" else "out"
        return KioskScanOut(
            result="already",
            message=f"Already checked {verb}.",
            status=p.current_status,
            site_name=site_name if verb == "in" else None,
            at=last.changed_at,
            **base,
        )

    here = p.current_status == "on_site" and p.current_site_id == station.site_id
    elsewhere_id = (
        p.current_site_id
        if p.current_status == "on_site" and not here
        else None
    )
    if station.mode == "toggle":
        going_in = not here
    elif station.mode == "in":
        going_in = True
        if here:
            return KioskScanOut(
                result="already",
                message=f"Already checked in at {site_name}.",
                status=p.current_status,
                site_name=site_name,
                at=p.current_status_since,
                **base,
            )
    else:  # out
        going_in = False
        if p.current_status != "on_site":
            return KioskScanOut(
                result="already",
                message="Already checked out.",
                status=p.current_status,
                at=p.current_status_since,
                **base,
            )

    note = f"Scanned at {station.name}"
    _apply_location_change(
        db,
        p,
        stat="on_site" if going_in else CHECKOUT_STATUS,
        site_id=station.site_id if going_in else None,
        note=note,
        expected_return_at=None,
        when=when,
        user_id=None,
        source_flow="kiosk",
        station_id=station.id,
    )
    db.flush()
    notify(background_tasks)

    if not going_in:
        return KioskScanOut(
            result="checked_out",
            message=f"Checked out of {site_name}.",
            status=CHECKOUT_STATUS,
            from_site_name=site_name,
            at=when,
            **base,
        )
    if elsewhere_id is not None:
        prev = db.get(Site, elsewhere_id)
        prev_name = prev.name if prev else "another site"
        return KioskScanOut(
            result="moved",
            message=f"Checked out of {prev_name} and into {site_name}.",
            status="on_site",
            site_name=site_name,
            from_site_name=prev_name,
            at=when,
            **base,
        )
    return KioskScanOut(
        result="checked_in",
        message=f"Checked in at {site_name}.",
        status="on_site",
        site_name=site_name,
        at=when,
        **base,
    )


@kiosk_router.post("/guest", response_model=KioskScanOut)
def kiosk_guest(
    body: KioskGuestIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    station: CheckinStation = Depends(current_station),
):
    """A visitor without a CAC: queue them for the desk, who signs them in
    as a guest (or finds them on the roster). A repeat press by the same
    name at the same door within a few minutes updates the request."""
    now = _now()
    last = body.last_name.strip()
    first = body.first_name.strip()
    row = (
        db.query(KioskPendingScan)
        .filter(
            KioskPendingScan.workspace_id == station.workspace_id,
            KioskPendingScan.kind == "guest_request",
            KioskPendingScan.station_id == station.id,
            func.lower(KioskPendingScan.last_name) == last.lower(),
            func.lower(func.coalesce(KioskPendingScan.first_name, "")) == first.lower(),
            KioskPendingScan.last_scanned_at > now - datetime.timedelta(minutes=10),
        )
        .first()
    )
    if row is None:
        _purge_stale_pending(db, station.workspace_id)
        row = KioskPendingScan(
            workspace_id=station.workspace_id,
            kind="guest_request",
            edipi_hash=None,
            scan_count=0,
            first_scanned_at=now,
            last_scanned_at=now,
        )
        db.add(row)
    row.station_id = station.id
    row.site_id = station.site_id
    row.last_name = last
    row.first_name = first or None
    row.affiliation = (body.affiliation or "").strip() or None
    row.escort = (body.visiting or "").strip() or None
    row.scan_count = (row.scan_count or 0) + 1
    row.last_scanned_at = now
    db.flush()
    notify(background_tasks)
    return KioskScanOut(
        result="guest_request",
        message="Thanks — the desk has been notified and will sign you in.",
        name=f"{last}, {first}".rstrip(", "),
        at=now,
    )


# ------------------------------------------------- unrecognized-card queue
#
# Cards a station couldn't place wait here for an operator, who decides who
# the card belongs to — never the kiosk, which is unattended. Resolving
# enrolls the DoD ID and (unless the door was exit-only) signs the person in
# at the site and time of their latest scan.


def _pending_out(db: Session, row: KioskPendingScan, workspace_id: int) -> dict:
    suggestions: list[dict] = []
    if row.kind in ("unknown_card", "guest_request") and row.last_name:
        matches = (
            db.query(Person)
            .filter(
                Person.workspace_id.is_(None),
                Person.edipi_hash.is_(None),
                func.lower(Person.last_name) == row.last_name.lower(),
            )
            .order_by(Person.first_name)
            .limit(8)
            .all()
        )
        here = {
            pid
            for (pid,) in db.query(Personnel.person_id).filter(
                Personnel.workspace_id == workspace_id,
                Personnel.person_id.in_([m.id for m in matches] or [0]),
            )
        }
        first = (row.first_name or "").lower()
        matches.sort(key=lambda m: (m.first_name.lower() != first, m.id not in here))
        suggestions = [
            {
                "person_id": m.id,
                "name": person_display_name(m),
                "rank": m.rank,
                "branch": m.branch,
                "unit_id": m.unit_id,
                "in_workspace": m.id in here,
            }
            for m in matches
        ]
    return {
        "id": row.id,
        "kind": row.kind,
        "person_id": row.person_id,
        "person_name": _who(row.person) if row.person is not None else None,
        "station_name": row.station.name if row.station is not None else None,
        "site_id": row.site_id,
        "site_name": row.site.name if row.site is not None else None,
        "can_sign_in": row.site_id is not None
        and (row.station is None or row.station.mode != "out"),
        "first_name": row.first_name,
        "last_name": row.last_name,
        "middle_initial": row.middle_initial,
        "rank": row.rank,
        "pay_grade": row.pay_grade,
        "branch": row.branch,
        "is_civilian": row.is_civilian,
        "affiliation": row.affiliation,
        "escort": row.escort,
        "card_expired": row.card_expired,
        "scan_count": row.scan_count,
        "first_scanned_at": row.first_scanned_at,
        "last_scanned_at": row.last_scanned_at,
        "suggestions": suggestions,
    }


def _load_pending(db: Session, pid: int, workspace: Workspace) -> KioskPendingScan:
    row = (
        db.query(KioskPendingScan)
        .filter(KioskPendingScan.id == pid)
        .with_for_update(of=KioskPendingScan)
        .first()
    )
    if row is None or row.workspace_id != workspace.id:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "That scan was already handled or dismissed",
        )
    return row


def _finish(
    db: Session,
    row: KioskPendingScan,
    p: Personnel,
    sign_in: bool,
    user: User,
    background_tasks: BackgroundTasks,
) -> dict:
    """Sign the person in where and when they scanned, drop the queue row."""
    signed = False
    site_name = row.site.name if row.site is not None else None
    can = row.site_id is not None and (
        row.station is None or row.station.mode != "out"
    )
    if sign_in and can:
        if p.current_status == "on_site" and p.current_site_id == row.site_id:
            signed = True
        elif p.current_status_since is None or row.last_scanned_at >= p.current_status_since:
            where = row.station.name if row.station is not None else site_name
            _apply_location_change(
                db,
                p,
                stat="on_site",
                site_id=row.site_id,
                note=f"Scanned at {where} — enrolled at the desk",
                expected_return_at=None,
                when=row.last_scanned_at,
                user_id=user.id,
                source_flow="kiosk",
                station_id=row.station_id,
            )
            signed = True
    db.delete(row)
    db.flush()
    notify(background_tasks)
    return {
        "personnel_id": p.id,
        "name": _who(p.person),
        "signed_in": signed,
        "site_name": site_name if signed else None,
    }


@pending_router.get("", response_model=list[KioskPendingOut])
def list_pending(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    _purge_stale_pending(db, workspace.id)
    rows = (
        db.query(KioskPendingScan)
        .filter(KioskPendingScan.workspace_id == workspace.id)
        .order_by(KioskPendingScan.last_scanned_at.desc())
        .all()
    )
    return [_pending_out(db, r, workspace.id) for r in rows]


@pending_router.post("/{pid}/link", response_model=KioskResolveOut)
def link_pending(
    pid: int,
    body: KioskLinkIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(requires("operator")),
):
    """The card is this roster person's: record their DoD ID, add them to
    this picture if needed, and sign them in."""
    row = _load_pending(db, pid, workspace)
    person = db.get(Person, body.person_id)
    if person is None or person.workspace_id is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Person not found")
    if row.edipi_hash is not None:
        if person.edipi_hash is not None and person.edipi_hash != row.edipi_hash:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{person_display_name(person)} already has a different DoD ID.",
            )
        ensure_edipi_free(
            db, row.edipi_hash, workspace_id=None, keep_person_id=person.id
        )
        person.edipi_hash = row.edipi_hash
    p = (
        db.query(Personnel)
        .filter(
            Personnel.workspace_id == workspace.id,
            Personnel.person_id == person.id,
        )
        .first()
    )
    if p is None:
        out = create_personnel(
            PersonnelIn(person_id=person.id),
            background_tasks,
            db=db,
            workspace=workspace,
            _=user,
        )
        p = db.get(Personnel, out["id"])
    return _finish(db, row, p, body.sign_in, user, background_tasks)


def _create_from_pending(
    pid: int,
    body: KioskNewPersonIn,
    guest: bool,
    background_tasks: BackgroundTasks,
    db: Session,
    workspace: Workspace,
    user: User,
) -> dict:
    row = _load_pending(db, pid, workspace)
    if row.kind == "not_in_workspace" and not guest:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This card is already on the roster — add that person instead.",
        )
    out = create_personnel(
        PersonnelIn(
            personnel_type=body.personnel_type,
            is_guest=guest,
            branch=body.branch,
            rank=body.rank or None,
            skill_level=body.skill_level,
            last_name=body.last_name.strip(),
            first_name=body.first_name,
            unit_id=body.unit_id,
            work_center_id=body.work_center_id,
            affiliation=(body.affiliation or None) if guest else None,
            escort=(body.escort or None) if guest else None,
        ),
        background_tasks,
        db=db,
        workspace=workspace,
        _=user,
    )
    p = db.get(Personnel, out["id"])
    # The queue holds only the card's hash, so it's attached after creation
    # (a guest request has no card).
    if row.edipi_hash is not None:
        ensure_edipi_free(
            db,
            row.edipi_hash,
            workspace_id=workspace.id if guest else None,
            keep_person_id=p.person_id,
        )
        p.person.edipi_hash = row.edipi_hash
    return _finish(db, row, p, body.sign_in, user, background_tasks)


@pending_router.post("/{pid}/roster", response_model=KioskResolveOut)
def add_pending_to_roster(
    pid: int,
    body: KioskNewPersonIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(requires("operator")),
):
    """A new roster person with this card, added to this picture."""
    return _create_from_pending(
        pid, body, False, background_tasks, db, workspace, user
    )


@pending_router.post("/{pid}/guest", response_model=KioskResolveOut)
def add_pending_as_guest(
    pid: int,
    body: KioskNewPersonIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(requires("operator")),
):
    """A guest of this picture with this card — their next scan here is
    recognized, without putting them on the unit's roster."""
    return _create_from_pending(
        pid, body, True, background_tasks, db, workspace, user
    )


@pending_router.delete("/{pid}", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_pending(
    pid: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    db.delete(_load_pending(db, pid, workspace))
    db.flush()
    notify(background_tasks)


# ------------------------------------------------------ activity log
#
# Door activity lives in the app, not on the kiosk screen: a kiosk shows
# only the person in front of it, and the desk (CFP) gets the running log.


@activity_router.get("", response_model=list[CheckinActivityOut])
def checkin_activity(
    since: Optional[datetime.datetime] = None,
    hours: Optional[int] = None,
    station_id: Optional[int] = None,
    limit: int = 300,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    """Kiosk check-ins and check-outs (and desk enrollments that signed
    someone in from the queue), newest first. `since` defaults to 24 hours
    ago (or `hours` back). A check-in is a "moved" when the person's
    previous status was on site somewhere else."""
    if since is None:
        since = _now() - datetime.timedelta(hours=max(1, min(hours or 24, 24 * 366)))
    elif since.tzinfo is None:
        since = since.replace(tzinfo=datetime.timezone.utc)
    limit = max(1, min(limit, 1000))
    ev = PersonnelLocationEvent
    window = {
        "partition_by": ev.personnel_id,
        "order_by": (ev.changed_at, ev.id),
    }
    lagged = (
        select(
            ev.id,
            ev.personnel_id,
            ev.status,
            ev.site_id,
            ev.station_id,
            ev.changed_at,
            ev.changed_by_user_id,
            func.lag(ev.status).over(**window).label("prev_status"),
            func.lag(ev.site_id).over(**window).label("prev_site_id"),
        )
        .join(Personnel, Personnel.id == ev.personnel_id)
        .where(Personnel.workspace_id == workspace.id)
        .subquery()
    )
    q = select(lagged).where(
        lagged.c.station_id.is_not(None), lagged.c.changed_at >= since
    )
    if station_id is not None:
        q = q.where(lagged.c.station_id == station_id)
    rows = db.execute(
        q.order_by(lagged.c.changed_at.desc(), lagged.c.id.desc()).limit(limit)
    ).all()

    people = {
        p.id: p
        for p in db.query(Personnel).filter(
            Personnel.id.in_({r.personnel_id for r in rows} or {0})
        )
    }
    site_ids = {r.site_id for r in rows} | {r.prev_site_id for r in rows}
    sites = {
        s.id: s.name
        for s in db.query(Site).filter(Site.id.in_({i for i in site_ids if i} or {0}))
    }
    stations = {
        s.id: s.name
        for s in db.query(CheckinStation).filter(
            CheckinStation.workspace_id == workspace.id
        )
    }
    out = []
    for r in rows:
        p = people.get(r.personnel_id)
        if p is None:
            continue
        prev_here = r.prev_status == "on_site" and r.prev_site_id is not None
        if r.status == "on_site":
            moved = prev_here and r.prev_site_id != r.site_id
            action = "moved" if moved else "in"
            from_site = sites.get(r.prev_site_id) if moved else None
        else:
            action = "out"
            from_site = sites.get(r.prev_site_id) if prev_here else None
        out.append(
            {
                "id": r.id,
                "at": r.changed_at,
                "personnel_id": p.id,
                "name": _who(p.person),
                "is_guest": p.is_guest,
                "action": action,
                "site_name": sites.get(r.site_id),
                "from_site_name": from_site,
                "station_id": r.station_id,
                "station_name": stations.get(r.station_id),
                "enrolled_at_desk": r.changed_by_user_id is not None,
            }
        )
    return out
