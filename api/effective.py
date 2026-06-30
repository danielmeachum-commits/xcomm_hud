"""Effective status helpers.

When all gateways at a site are `down`, the site's external services cannot
actually be reached regardless of their stored status — they should display as
`down`. We compute this server-side so /status/rollup and /canvas/map agree.
"""

from __future__ import annotations

from models import Gateway, Service


def all_gateways_down(gateways: list[Gateway]) -> bool:
    if not gateways:
        # No gateways at all → can't claim "external is down because of them";
        # treat as not-blocking (operator decides).
        return False
    return all(g.status == "down" for g in gateways)


def effective_service_status(service: Service, site_gateways: list[Gateway]) -> str:
    if service.reach == "external" and all_gateways_down(site_gateways):
        return "down"
    return service.status
