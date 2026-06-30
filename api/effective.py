"""Effective status helpers.

An external service rides one or more PACE-tier gateways (`service.enabled_pace`).
If *none* of the gateways it could ride are live (active or degraded), it
cannot actually be reached and should display as `down`. Computed server-side
so /status/rollup and the canvas agree.
"""

from __future__ import annotations

from models import Gateway, Service


# Gateways in these states are passing real traffic; anything else (ready,
# down, offline, setup) does not actively serve an external service.
LIVE_GATEWAY_STATUSES = ("active", "degraded")


def relevant_gateways(service: Service, gateways: list[Gateway]) -> list[Gateway]:
    """Subset of site gateways whose PACE tier this service is enabled for."""
    enabled = service.enabled_pace or []
    if not enabled:
        return []
    return [g for g in gateways if g.pace in enabled]


def any_path_available(gateways: list[Gateway]) -> bool:
    return any(g.status in LIVE_GATEWAY_STATUSES for g in gateways)


def effective_service_status(service: Service, site_gateways: list[Gateway]) -> str:
    # `offline` (intentionally off) and `setup` (being brought online) are
    # operator-controlled states that shouldn't be overridden by gateway state.
    if service.status in ("offline", "setup"):
        return service.status
    if service.reach == "external":
        candidates = relevant_gateways(service, site_gateways)
        # No enabled gateways at all → operator hasn't picked any path; nothing
        # to cascade. Empty candidates from a non-empty enabled list, however,
        # means every enabled tier is missing — treat as no path.
        if (service.enabled_pace or []) and not any_path_available(candidates):
            if service.status in ("up", "degraded"):
                return "down"
    return service.status
