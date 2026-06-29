"""Worst-of status rollup helpers."""

from __future__ import annotations

# Order from worst to best. "unknown" is treated as worse than "up" but better
# than degraded/down so a brand-new resource doesn't drag siblings down.
_RANK = {"down": 0, "degraded": 1, "unknown": 2, "up": 3}


def worst_of(states: list[str]) -> str:
    if not states:
        return "unknown"
    return min(states, key=lambda s: _RANK.get(s, _RANK["unknown"]))


def service_status(component_states: list[tuple[str, bool]], manual_override: bool, current: str) -> str:
    """Compute service status.

    component_states is a list of (equipment_status, required_flag) tuples.
    If manual_override is set, the stored `current` status wins.
    Otherwise: worst-of required components; if no required components and
    optional ones exist, worst-of those; if no components, 'unknown'.
    """
    if manual_override:
        return current
    required = [s for s, req in component_states if req]
    if required:
        return worst_of(required)
    optional = [s for s, _ in component_states]
    return worst_of(optional)


def utc_status(equipment_states: list[str]) -> str:
    return worst_of(equipment_states)


def site_status(child_states: list[str]) -> str:
    return worst_of(child_states)
