"""Effective status helpers.

The matrix view models per-(service, gateway) reachability as its own
`service_gateway_status` cell — the operator's last validated answer to
"does this service work through this gateway right now?". This module
holds the rules that translate stored cell state + local service state +
gateway state into what actually gets displayed, and the cascade helpers
called by the validation endpoints.

Rules (see the design conversation for the full ruleset):

    R8/R9/R10  Gateway status change → cells snap to a derived state:
               active/degraded/setup → unknown (needs re-validation);
               ready → ready; down/offline → matching down/offline.
    R10        Gateway or local `down`/`offline` overrides the displayed
               cell no matter what's stored — you cannot report a working
               path over a dead gateway or a dead service.
    R11        Cell effective status is clamped to be no better than the
               local service status. `unknown` is exempt (means "no info",
               not "worst case").

Rollup semantics for the top-level `service.effective_status` are
preserved so the list and graph views keep working: it's the best cell
effective status across the service's enabled PACE tiers, and rolls up
to `down` when no live path exists (same "no path → down" behaviour as
before this refactor).
"""

from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session

from models import Gateway, Service, ServiceGatewayStatus


# Operational quality ordering used by R11. Lower rank = better. `unknown`
# is exempt from ordering (represents "no information", so it does not
# constrain anything and is not treated as "worst").
STATUS_RANK: dict[str, int] = {
    "up": 1,
    "ready": 2,
    "degraded": 3,
    "setup": 4,
    "down": 5,
    "offline": 6,
}


def _rank(status: str) -> int:
    """Rank for comparison, treating unranked values as "unknown"."""
    return STATUS_RANK.get(status, 0)


# ---------- Cell effective status (R10 + R11) ----------

def clamp_by_local(cell_status: str, local_status: str) -> str:
    """R11: cap the cell to be no better than the local service status.

    `unknown` on either side is exempt (no constraint). Otherwise, if the
    cell ranks better than local, return local.
    """
    if cell_status == "unknown" or local_status == "unknown":
        return cell_status
    if _rank(cell_status) < _rank(local_status):
        return local_status
    return cell_status


def effective_cell_status(
    cell_status: str, local_service_status: str, gateway_status: str
) -> str:
    """Displayed status for a single (service × gateway) intersection.

    Applied in order:
      1. Gateway `down`/`offline` → returns the gateway status (R10).
      2. Local `down`/`offline` → returns the local status (R10).
      3. Otherwise clamp the stored cell state by the local status (R11).
    """
    if gateway_status in ("down", "offline"):
        return gateway_status
    if local_service_status in ("down", "offline"):
        return local_service_status
    return clamp_by_local(cell_status, local_service_status)


# ---------- Rollup used by services / canvas / status routers ----------

def relevant_gateways(service: Service, gateways: Iterable[Gateway]) -> list[Gateway]:
    """Subset of site gateways whose PACE tier this service is enabled for."""
    enabled = service.enabled_pace or []
    if not enabled:
        return []
    return [g for g in gateways if g.pace in enabled]


def _cell_contribution_to_rollup(
    cell_status: str, local_status: str, gateway_status: str
) -> Optional[str]:
    """What this cell contributes to `service.effective_status`.

    Returns `None` when the cell offers no reachable path (gateway or
    local dead). `unknown` cells over a live gateway are treated
    optimistically as "inheriting the local status" so a freshly
    migrated site — where every cell defaults to `unknown` — doesn't
    turn every service red in the list and graph views. Once the
    operator validates a cell explicitly, its stored status takes over.
    """
    if gateway_status in ("down", "offline"):
        return None
    if local_status in ("down", "offline"):
        return None
    if cell_status == "unknown":
        return local_status
    return clamp_by_local(cell_status, local_status)


def effective_service_status(
    service: Service,
    site_gateways: list[Gateway],
    cells_by_gateway_id: Optional[dict[int, ServiceGatewayStatus]] = None,
) -> str:
    """Roll per-cell effective statuses up to a single service status.

    Behaviour is stable across the migration: when a caller doesn't yet
    supply cell state (canvas/status routers pre-frontend rewire), the
    result matches the pre-matrix "any live gateway on an enabled tier
    keeps the stored status; else force down" rule. When cells are
    provided, unknown cells over a live gateway contribute optimistically
    (see `_cell_contribution_to_rollup`) so a fresh install doesn't
    regress list/graph rendering.
    """
    # Operator-controlled states are never overridden.
    if service.status in ("offline", "setup"):
        return service.status

    enabled = service.enabled_pace or []
    # No PACE dependencies → not routed through a gateway; local status
    # is authoritative.
    if not enabled:
        return service.status

    candidates = relevant_gateways(service, site_gateways)
    if not candidates:
        # No gateway on any enabled tier — treat as "no path".
        if service.status in ("up", "degraded"):
            return "down"
        return service.status

    # Legacy fallback when the caller hasn't loaded cells yet.
    if cells_by_gateway_id is None:
        live = any(g.status in ("active", "degraded") for g in candidates)
        if not live and service.status in ("up", "degraded"):
            return "down"
        return service.status

    # Per-cell rollup — pick the best contribution across all candidate
    # gateways. `None` = dead path (not counted).
    best: Optional[str] = None
    for gw in candidates:
        cell = cells_by_gateway_id.get(gw.id)
        cell_status = cell.status if cell else "unknown"
        contribution = _cell_contribution_to_rollup(
            cell_status, service.status, gw.status
        )
        if contribution is None or contribution == "unknown":
            continue
        if best is None or _rank(contribution) < _rank(best):
            best = contribution

    if best is None:
        if service.status in ("up", "degraded"):
            return "down"
        return service.status
    return best


# ---------- Cascade helpers (called by validation endpoints) ----------

def cell_status_from_gateway(new_gateway_status: str) -> str:
    """R8/R9/R10: the derived cell status implied by a new gateway status.

    - `down`/`offline` → matching status (R10)
    - `ready`         → `ready` (R9; PACE standby, no re-validation needed)
    - anything else   → `unknown` (R8; force operator to re-validate the path)
    """
    if new_gateway_status in ("down", "offline"):
        return new_gateway_status
    if new_gateway_status == "ready":
        return "ready"
    return "unknown"


def reset_cells_for_gateway(
    db: Session, gateway_id: int, new_gateway_status: str
) -> None:
    """Snap every cell for this gateway to its post-status-change value.

    Wipes the cell's own validated_at / validated_by since the operator's
    prior validation no longer represents current reality. Called from
    the gateway validation endpoint when the "cascade to cells" checkbox
    is left checked.
    """
    new_cell_status = cell_status_from_gateway(new_gateway_status)
    db.query(ServiceGatewayStatus).filter(
        ServiceGatewayStatus.gateway_id == gateway_id
    ).update(
        {
            ServiceGatewayStatus.status: new_cell_status,
            ServiceGatewayStatus.validated_at: None,
            ServiceGatewayStatus.validated_by_user_id: None,
        },
        synchronize_session=False,
    )


def clamp_cells_for_service(
    db: Session, service_id: int, new_local_status: str
) -> None:
    """R10/R11 cascade when a local service status is validated downward.

    - Local `down`/`offline` (R10): force every cell for this service to
      match the local status — no path can survive a dead service.
    - Local `unknown`: no cascade (unknown carries no ordering).
    - Otherwise (R11): clamp cells that rank better than the new local.

    Cells at `unknown` are left alone in the R11 branch — unknown is not
    "worse than degraded", it's "no info", so it isn't upgraded either.
    """
    if new_local_status in ("down", "offline"):
        db.query(ServiceGatewayStatus).filter(
            ServiceGatewayStatus.service_id == service_id
        ).update(
            {ServiceGatewayStatus.status: new_local_status},
            synchronize_session=False,
        )
        return
    if new_local_status == "unknown":
        return

    local_rank = _rank(new_local_status)
    cells = (
        db.query(ServiceGatewayStatus)
        .filter(ServiceGatewayStatus.service_id == service_id)
        .all()
    )
    for cell in cells:
        if cell.status == "unknown":
            continue
        if _rank(cell.status) < local_rank:
            cell.status = new_local_status


def materialize_cells(
    db: Session, service: Service, site_gateways: list[Gateway]
) -> dict[int, ServiceGatewayStatus]:
    """Ensure a cell exists for every (service, gateway) pair whose PACE
    aligns with the service's enabled tiers. Missing cells are inserted
    with status='unknown'. Returns a `{gateway_id: cell}` map.
    """
    candidates = relevant_gateways(service, site_gateways)
    existing = {
        c.gateway_id: c
        for c in db.query(ServiceGatewayStatus).filter(
            ServiceGatewayStatus.service_id == service.id
        )
    }
    for gw in candidates:
        if gw.id not in existing:
            cell = ServiceGatewayStatus(
                service_id=service.id,
                gateway_id=gw.id,
                status="unknown",
            )
            db.add(cell)
            existing[gw.id] = cell
    return existing
