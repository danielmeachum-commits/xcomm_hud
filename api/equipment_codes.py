"""Generating and de-conflicting equipment IDs.

The convention in the field is `R` plus the last four of the serial — R7421
for an AN/PRC-117G ending 7421 — with the prefix varying by category (K for an
RF kit, C for crypto, S for a switch). The prefix lives on `equipment_type`.

Two deliberate choices:

* The code is *generated as a default but stored as a real editable column*.
  Deriving it on read would mean gear with no serial has no ID, and would make
  the ID silently change if someone corrected a typo'd serial — but the ID is
  what's written on the tape on the case, so it must not move on its own.

* Collisions are surfaced, never auto-resolved. Two radios whose serials end
  in the same four digits is common enough to plan for, but silently
  registering the second one as R7421A when the operator typed R7421 would put
  a different ID in the database than on the case. The API returns 409 with a
  suggestion and the caller confirms.
"""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from models import Equipment, EquipmentType

_NON_ALNUM = re.compile(r"[^A-Z0-9]")
# A–Z then AA, AB, … — enough headroom that the loop below always terminates
# well before it, but bounded so a bug can't spin forever.
_MAX_SUFFIX_ATTEMPTS = 200


def generate_code(equipment_type: EquipmentType, serial_number: str | None) -> str:
    """Propose `<prefix><last 4 of serial>`, uppercased and stripped.

    With no serial there is nothing to derive from, so the caller gets the
    bare prefix back and is expected to require manual entry — returning
    something like "R" alone is a clear signal to the UI, not a usable ID.
    """
    prefix = (equipment_type.id_prefix or "R").upper()
    if not serial_number:
        return prefix
    cleaned = _NON_ALNUM.sub("", serial_number.upper())
    return f"{prefix}{cleaned[-4:]}" if cleaned else prefix


def code_taken(db: Session, workspace_id: int, code: str, exclude_id: int | None = None) -> bool:
    q = db.query(Equipment.id).filter(
        Equipment.workspace_id == workspace_id,
        Equipment.equipment_code == code,
    )
    if exclude_id is not None:
        q = q.filter(Equipment.id != exclude_id)
    return db.query(q.exists()).scalar()


def suggest_free_code(db: Session, workspace_id: int, base: str) -> str:
    """First unused `base`, `baseA`, `baseB`, … for a 409 response body.

    Only ever offered as a suggestion — the caller decides.
    """
    if not code_taken(db, workspace_id, base):
        return base
    for i in range(_MAX_SUFFIX_ATTEMPTS):
        # A..Z, then AA..AZ, BA.. — plain base-26 with an A-based alphabet.
        suffix = ""
        n = i
        while True:
            suffix = chr(ord("A") + (n % 26)) + suffix
            n = n // 26 - 1
            if n < 0:
                break
        candidate = f"{base}{suffix}"
        if not code_taken(db, workspace_id, candidate):
            return candidate
    # Pathological: fall back to something guaranteed unique rather than
    # returning a colliding suggestion.
    return f"{base}-{db.query(Equipment).count() + 1}"


def resolve_code(
    db: Session,
    workspace_id: int,
    equipment_type: EquipmentType,
    serial_number: str | None,
    requested: str | None,
    exclude_id: int | None = None,
) -> tuple[str, str | None]:
    """Settle on the code to store.

    Returns `(code, conflict_suggestion)`. A non-None suggestion means the
    code is taken and the caller should 409 rather than write — this function
    never silently renames.
    """
    code = (requested or generate_code(equipment_type, serial_number)).strip().upper()
    if code_taken(db, workspace_id, code, exclude_id=exclude_id):
        return code, suggest_free_code(db, workspace_id, code)
    return code, None
