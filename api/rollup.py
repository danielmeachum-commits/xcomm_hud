"""Worst-of status rollup helpers.

With the simplified model, the only rollup is site = worst-of(its services).
"""

from __future__ import annotations

# "unknown" sits between down/degraded and up so a brand-new resource doesn't
# drag siblings down to a red state.
_RANK = {"down": 0, "degraded": 1, "unknown": 2, "up": 3}


def worst_of(states: list[str]) -> str:
    if not states:
        return "unknown"
    return min(states, key=lambda s: _RANK.get(s, _RANK["unknown"]))


def site_status(service_states: list[str]) -> str:
    return worst_of(service_states)
