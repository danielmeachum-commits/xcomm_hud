"""Advisory equipment-derived status.

Read this before wiring equipment into anything that writes.

The rest of the app resolves status by cascade: a gateway status change snaps
its cells (R8/R9/R10 in api/effective.py), a local service change clamps them
(R11). Equipment deliberately does NOT join that cascade. It computes a
*derived* status — the worst status across the capabilities bound to a service
or gateway — and hands it back alongside the reported status for a human to
look at. Nothing here mutates a Service, Gateway, or ServiceGatewayStatus, and
nothing here should ever be called from a write path in effective.py.

Two reasons, both load-bearing:

1. `cell_status_from_gateway` blanks every cell for a gateway to `unvalidated` on
   any status change that isn't `ready`/`down`/`offline`. If equipment drove
   gateway status, a radio flapping between up and degraded would repeatedly
   wipe the operator's entire matrix and demand re-validation of paths nobody
   touched.

2. Every status in this system is attributed — `validated_by_user_id` records
   who is accountable for the claim "this path works". Silently replacing that
   with a machine-derived value destroys the provenance the model exists to
   keep.

So the contract is: we show `reported` and `derived` side by side, badge the
disagreement, and let the operator apply it through the normal validation
endpoint under their own name. A seeded rule
(`equipment.derived.disagreement`) additionally drops a warning on the feed so
a quiet disagreement doesn't sit unnoticed.

If a true cascade is ever wanted, it belongs in rules_engine.py as an action —
not here, and not as a schema change.

This module is deliberately separate from effective.py so that the import
graph makes the boundary obvious: effective.py never imports this.
"""

from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session

from models import (
    CapabilityGatewayLink,
    CapabilityServiceLink,
    Equipment,
    EquipmentCapability,
)

# Worst-of ordering for equipment. Higher rank = worse. `maintenance` sits
# between `degraded` and `down`: gear that is deliberately off the line is
# worse than gear limping along, but it isn't a failure. `unvalidated` is exempt
# from ordering entirely — it means "no information", not "worst case" —
# which mirrors how effective.STATUS_RANK treats it.
EQUIPMENT_STATUS_RANK: dict[str, int] = {
    "up": 1,
    "degraded": 2,
    "maintenance": 3,
    "down": 4,
    "offline": 5,
}

# How a reported service/gateway status compares to a derived equipment
# status. Both vocabularies are mapped onto one scale so `disagrees` can be
# computed without pretending "active" and "up" are different things.
_REPORTED_RANK: dict[str, int] = {
    "up": 1,
    "active": 1,
    "ready": 2,
    "degraded": 3,
    "setup": 4,
    "maintenance": 4,
    "down": 5,
    "offline": 6,
}


def _rank(status: str) -> int:
    """Rank an equipment status; unranked (i.e. `unvalidated`) sorts as 0."""
    return EQUIPMENT_STATUS_RANK.get(status, 0)


def worst_status(statuses: Iterable[str]) -> Optional[str]:
    """Worst of the given equipment statuses, ignoring `unvalidated`.

    Returns None when there is nothing to say — no capabilities at all, or
    every one of them `unvalidated`. None means "no opinion", and the UI renders
    that as no advisory rather than as a problem.
    """
    worst: Optional[str] = None
    for status in statuses:
        if _rank(status) == 0:
            continue
        if worst is None or _rank(status) > _rank(worst):
            worst = status
    return worst


def disagrees(reported: str, derived: Optional[str]) -> bool:
    """True when the equipment says things are meaningfully worse.

    One-directional on purpose. Equipment looking *better* than the reported
    status is not a disagreement worth flagging: an operator may have marked a
    service down for a reason the equipment tier cannot see (a crypto fill
    that never happened, a frequency deconfliction, a customer outage
    upstream). Flagging that would train people to ignore the badge.
    """
    if derived is None:
        return False
    if reported not in _REPORTED_RANK:
        return False
    derived_as_reported = _REPORTED_RANK.get(derived)
    if derived_as_reported is None:
        return False
    return derived_as_reported > _REPORTED_RANK[reported]


def load_backing_for_services(
    db: Session, service_ids: list[int]
) -> dict[int, list[dict]]:
    """`{service_id: [backing capability dicts]}` in one query.

    Bulk-loaded rather than per-service because the site detail page and the
    topology bundle both need every service at once; an N+1 here would be felt
    immediately on a site with a full FCP.
    """
    if not service_ids:
        return {}
    rows = (
        db.query(CapabilityServiceLink, EquipmentCapability, Equipment)
        .join(
            EquipmentCapability,
            EquipmentCapability.id == CapabilityServiceLink.equipment_capability_id,
        )
        .join(Equipment, Equipment.id == EquipmentCapability.equipment_id)
        .filter(CapabilityServiceLink.service_id.in_(service_ids))
        .all()
    )
    out: dict[int, list[dict]] = {}
    for link, capability, equipment in rows:
        out.setdefault(link.service_id, []).append(
            {
                "capability_id": capability.id,
                "equipment_id": equipment.id,
                "equipment_code": equipment.equipment_code,
                "label": capability.label,
                "kind": capability.kind,
                "status": capability.status,
                "role": link.role,
            }
        )
    return out


def load_backing_for_gateways(
    db: Session, gateway_ids: list[int]
) -> dict[int, list[dict]]:
    """`{gateway_id: [backing capability dicts]}` in one query."""
    if not gateway_ids:
        return {}
    rows = (
        db.query(CapabilityGatewayLink, EquipmentCapability, Equipment)
        .join(
            EquipmentCapability,
            EquipmentCapability.id == CapabilityGatewayLink.equipment_capability_id,
        )
        .join(Equipment, Equipment.id == EquipmentCapability.equipment_id)
        .filter(CapabilityGatewayLink.gateway_id.in_(gateway_ids))
        .all()
    )
    out: dict[int, list[dict]] = {}
    for link, capability, equipment in rows:
        out.setdefault(link.gateway_id, []).append(
            {
                "capability_id": capability.id,
                "equipment_id": equipment.id,
                "equipment_code": equipment.equipment_code,
                "label": capability.label,
                "kind": capability.kind,
                "status": capability.status,
                "role": None,
            }
        )
    return out


def build_derived(reported: str, backing: list[dict]) -> dict:
    """Assemble the advisory payload for one service or gateway.

    Shape matches schemas.DerivedStatus.
    """
    derived = worst_status(item["status"] for item in backing)
    return {
        "reported": reported,
        "derived": derived,
        "disagrees": disagrees(reported, derived),
        "backing": backing,
    }


def derive_utc_role(
    utc_instance_id: int,
    equipment_ids_by_utc: dict[int, set[int]],
    links: list,
) -> Optional[str]:
    """What the link graph says this UTC is, independent of its declared role.

    - `extension` when something outside this UTC feeds into it over a
      directional (`a_to_b`) link.
    - `primary` when it feeds another UTC that way.
    - `independent` when it has cross-UTC links but no directional ones —
      peers, not a hierarchy.
    - None when there are no cross-UTC links at all, i.e. not enough
      information. The UI shows nothing rather than guessing, since a UTC
      whose links simply haven't been entered yet must not read as
      "independent, confirmed".

    A UTC can be fed *and* feed onward (a mid-chain relay); `extension` wins,
    because what matters operationally is that it depends on someone upstream.
    """
    mine = equipment_ids_by_utc.get(utc_instance_id, set())
    if not mine:
        return None

    feeds_in = False
    feeds_out = False
    has_cross_link = False

    for link in links:
        a_mine = link.a_equipment_id in mine
        b_mine = link.b_equipment_id in mine
        if a_mine == b_mine:
            # Wholly internal, or wholly unrelated to this UTC.
            continue
        has_cross_link = True
        if link.direction != "a_to_b":
            continue
        if b_mine:
            feeds_in = True
        else:
            feeds_out = True

    if feeds_in:
        return "extension"
    if feeds_out:
        return "primary"
    if has_cross_link:
        return "independent"
    return None
