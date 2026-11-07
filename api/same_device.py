"""Same-device cells: when a gateway IS the device providing a service.

A 117G radio doing MUOS voice is both the MUOS gateway and the voice service
on that path. Without this, the RF team saying "MUOS voice is up, verified to
the far end" meant three validations of one fact: the gateway, the service's
local status, then the cell. With the cell marked `same_device`:

1. Validating the gateway sets the cell to match (`sync_cells_for_gateway`),
   whether or not "cascade to cells" is ticked — it is the same fact.
2. The cell isn't capped by the service's local status (effective.py): the
   radio is its own local end.
3. When EVERY enabled path of a service is same-device, the service's local
   status follows the best of those cells (`refresh_linked_local`). It is
   stored, not just displayed, so the overview, canvas, rules and the summary
   report all agree without knowing about the link.

Per cell, not per service: one service can run over several PACE tiers, some
through the device itself (MUOS) and some through separate gear (VoSIP over
SATCOM). Only the linked paths follow the gateway; local status still governs
the rest, and a service with any unlinked path keeps a hand-validated local.

A cell can still be validated by hand ("radio's up, voice isn't") — that
stands until the gateway is validated again.
"""
from __future__ import annotations

import datetime
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from effective import STATUS_RANK, relevant_gateways
from models import Gateway, Service, ServiceDelivery, ServiceGatewayStatus
from rules_engine import emit_trigger

# Gateway status -> the cell status it means for the device's own service.
# `ready` (PACE standby) is absent on purpose: like the ordinary cascade (R9),
# standby doesn't invalidate what was last validated on the path.
_GATEWAY_TO_CELL = {
    "active": "up",
    "degraded": "degraded",
    "down": "down",
    "offline": "offline",
    "setup": "setup",
}


def gateway_status_to_cell(gateway_status: str) -> Optional[str]:
    return _GATEWAY_TO_CELL.get(gateway_status)


def sync_cells_for_gateway(
    db: Session, gateway: Gateway, when: datetime.datetime, user_id: Optional[int]
) -> list[tuple[ServiceGatewayStatus, str, str]]:
    """Set every same-device cell of this gateway to the gateway's meaning.

    Stamped with the gateway validation's time and author: it is the same
    validation. Returns (cell, prev, new) for cells whose status changed, so
    the caller can emit their triggers.
    """
    new_status = gateway_status_to_cell(gateway.status)
    if new_status is None:
        return []
    changed = []
    for cell in db.query(ServiceGatewayStatus).filter(
        ServiceGatewayStatus.gateway_id == gateway.id,
        ServiceGatewayStatus.same_device.is_(True),
    ):
        prev = cell.status
        cell.status = new_status
        cell.validated_at = when
        cell.validated_by_user_id = user_id
        if prev != new_status:
            changed.append((cell, prev, new_status))
    return changed


def linked_local_status(
    db: Session, delivery: ServiceDelivery, site_gateways: Optional[list[Gateway]] = None
) -> Optional[str]:
    """The local status a fully same-device service follows, or None when
    the service has any path that isn't same-device (local stays manual).

    Best of the linked cells; `unvalidated` only if none of them is known.
    """
    if site_gateways is None:
        site_gateways = db.query(Gateway).filter(Gateway.site_id == delivery.site_id).all()
    paths = relevant_gateways(delivery, site_gateways)
    if not paths:
        return None
    cells = {
        c.gateway_id: c
        for c in db.query(ServiceGatewayStatus).filter(
            ServiceGatewayStatus.service_delivery_id == delivery.id
        )
    }
    linked = [cells.get(g.id) for g in paths]
    if any(c is None or not c.same_device for c in linked):
        return None
    known = [c.status for c in linked if c.status != "unvalidated"]
    if not known:
        return "unvalidated"
    return min(known, key=lambda s: STATUS_RANK.get(s, 99))


def refresh_linked_local(
    db: Session,
    delivery_ids: Iterable[int],
    when: datetime.datetime,
    user_id: Optional[int],
    username: Optional[str],
    workspace_id: int,
) -> list[ServiceDelivery]:
    """Write the followed local status onto every fully same-device service
    among `delivery_ids` whose stored local status differs. Emits
    service.status_changed (source_flow "same_device") for each, so the
    change is in the feed and history like any validation."""
    changed = []
    for delivery in db.query(ServiceDelivery).filter(
        ServiceDelivery.id.in_(set(delivery_ids))
    ):
        target = linked_local_status(db, delivery)
        if target is None or target == delivery.status:
            continue
        service = db.get(Service, delivery.service_id)
        emit_trigger(
            db,
            "service.status_changed",
            {
                "service_id": delivery.id,
                "service_name": service.name if service else None,
                "prev_status": delivery.status,
                "new_status": target,
                "source_flow": "same_device",
                "note": "Follows its same-device gateway path(s)",
                "user_id": user_id,
                "username": username,
                "occurred_at": when,
            },
            workspace_id=workspace_id,
        )
        delivery.status = target
        delivery.validated_at = when
        delivery.validated_by_user_id = user_id
        changed.append(delivery)
    return changed
