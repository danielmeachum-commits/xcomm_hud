"""Canonical global built-in rules — the single source of truth.

These are the "default rules" every workspace sees: global rows
(workspace_id NULL, is_builtin) that record validations, sign-ins, and
posture changes to the feed. They live here, in code, because code is the
only thing shared identically across every deployment — so a change here
propagates everywhere on the next boot, with no per-environment drift.

`_reconcile_default_rules` (api/main.py) upserts these into the `rule`
table on startup, matching each spec to its row by the stable `key` and
overwriting only when `version` is higher. To change a default everywhere:
edit the spec and bump its `version`. To retire one: delete the spec — the
reconcile disables (never deletes) the orphaned row, preserving history.

Admins don't edit these in place; a workspace turns one off for itself via
WorkspaceRuleState, or duplicates it into an editable workspace rule.

Each dict's keys are exactly Rule(...) constructor kwargs.
"""

from __future__ import annotations

from typing import Any


def _create_event(
    type_slug: str, event_type: str, record_class: str, severity: str
) -> list[dict[str, Any]]:
    return [
        {
            "action": "create_event",
            "params": {
                "type_slug": type_slug,
                "event_type": event_type,
                "record_class": record_class,
                "severity": severity,
            },
        }
    ]


# Shared defaults for every spec below. `on_error="abort"` preserves the old
# dual-write atomicity (if the feed row fails, the mutation rolls back with
# it); priority 10 keeps built-ins ahead of typical workspace rules.
_COMMON = {
    "enrichers": [],
    "computed": [],
    "enabled": True,
    "is_builtin": True,
    "on_error": "abort",
    "priority": 10,
}


# Severity-bearing alert defaults (below) are supplementary, not core
# bookkeeping: on_error="skip" so a bad template or missing field can never
# roll back the underlying status change, and a lower priority so they run
# after the record-keepers. Each still sets its own enrichers/computed.
_ALERT = {
    "enabled": True,
    "is_builtin": True,
    "on_error": "skip",
    "priority": 20,
}


DEFAULT_RULES: list[dict[str, Any]] = [
    {
        **_COMMON,
        "key": "record-service-validations",
        "version": 1,
        "name": "Record service validations",
        "description": "Append a feed record whenever a service status is validated.",
        "trigger": "service.status_changed",
        "conditions": None,
        "actions": _create_event("service.validate", "validation", "log", "info"),
    },
    {
        **_COMMON,
        "key": "record-gateway-validations",
        "version": 1,
        "name": "Record gateway validations",
        "description": "Append a feed record whenever a gateway status is validated.",
        "trigger": "gateway.status_changed",
        "conditions": None,
        "actions": _create_event("gateway.validate", "validation", "log", "info"),
    },
    {
        **_COMMON,
        "key": "record-cell-validations",
        "version": 1,
        "name": "Record cell validations",
        "description": "Append a feed record whenever a service-via-gateway cell is validated.",
        "trigger": "cell.status_changed",
        "conditions": None,
        "actions": _create_event("cell.validate", "validation", "log", "info"),
    },
    {
        **_COMMON,
        "key": "record-site-status-changes",
        "version": 1,
        "name": "Record site status changes",
        "description": "Surface site posture changes as timeline events.",
        "trigger": "site.status_changed",
        "conditions": None,
        "actions": _create_event("site.status", "validation", "event", "notice"),
    },
    {
        **_COMMON,
        "key": "record-fpcon-changes",
        "version": 1,
        "name": "Record FPCON changes",
        "description": "Surface FPCON changes as warning events on the timeline.",
        "trigger": "site.fpcon_changed",
        "conditions": None,
        "actions": _create_event("site.fpcon", "validation", "event", "warning"),
    },
    {
        **_COMMON,
        "key": "record-emcon-changes",
        "version": 1,
        "name": "Record EMCON changes",
        "description": "Surface EMCON changes as warning events on the timeline.",
        "trigger": "site.emcon_changed",
        "conditions": None,
        "actions": _create_event("site.emcon", "validation", "event", "warning"),
    },
    {
        **_COMMON,
        "key": "record-personnel-signins",
        "version": 1,
        "name": "Record personnel sign-ins",
        "description": (
            "Append a feed record for check-ins/outs — except end-of-day roster "
            "resets, which would flood the feed with one row per person."
        ),
        "trigger": "personnel.location_changed",
        "conditions": {"!=": [{"var": "source_flow"}, "reset"]},
        "actions": _create_event("personnel.checkin", "personnel", "log", "info"),
    },
    # --- Severity-bearing alerts (promoted from garrison workspace rules) ---
    {
        **_ALERT,
        "key": "service-outage-alarm",
        "version": 1,
        "name": "Service outage alarm",
        "description": "Raise a critical timeline event when a service drops from up straight to down/offline.",
        "trigger": "service.status_changed",
        "conditions": {
            "and": [
                {"in": [{"var": "new_status"}, ["down", "offline"]]},
                {"==": [{"var": "prev_status"}, "up"]},
            ]
        },
        "enrichers": ["service_context"],
        "computed": [],
        "actions": [
            {
                "action": "create_event",
                "params": {
                    "severity": "critical",
                    "type_slug": "note.general",
                    "record_class": "event",
                    "note_template": "{service_name} at {site_name} went from {prev_status} to {new_status}",
                },
            }
        ],
    },
    {
        **_ALERT,
        "key": "fpcon-escalation-watch",
        "version": 1,
        "name": "FPCON escalation watch",
        "description": "Flag a critical event only when FPCON escalates — the new level ranks higher than the previous one.",
        "trigger": "site.fpcon_changed",
        "conditions": {"==": [{"var": "escalation"}, "yes"]},
        "enrichers": [],
        "computed": [
            {
                "name": "new_rank",
                "kind": "expr",
                "expr": {
                    "rank": [
                        {"var": "new_status"},
                        ["normal", "alpha", "bravo", "charlie", "delta"],
                    ]
                },
            },
            {
                "name": "prev_rank",
                "kind": "expr",
                "expr": {
                    "rank": [
                        {"var": "prev_status"},
                        ["normal", "alpha", "bravo", "charlie", "delta"],
                    ]
                },
            },
            {
                "name": "escalation",
                "kind": "expr",
                "expr": {
                    "if": [
                        {">": [{"var": "new_rank"}, {"var": "prev_rank"}]},
                        "yes",
                        "no",
                    ]
                },
            },
        ],
        "actions": [
            {
                "action": "create_event",
                "params": {
                    "severity": "critical",
                    "type_slug": "site.fpcon",
                    "note_template": "{site_name} FPCON escalated from {prev_status} to {new_status}",
                },
            }
        ],
    },
    {
        **_ALERT,
        "key": "gateway-degraded-performance",
        "version": 1,
        "name": "Site Gateway Degraded Performance",
        "description": "Warn on the timeline when a gateway goes degraded — dependent services may be unstable.",
        "trigger": "gateway.status_changed",
        "conditions": {"==": [{"var": "new_status"}, "degraded"]},
        "enrichers": ["gateway_context"],
        "computed": [],
        "actions": [
            {
                "action": "create_event",
                "params": {
                    "severity": "warning",
                    "type_slug": "gateway.validate",
                    "record_class": "event",
                    "note_template": "{site_name}: {gateway_pace} gateway {gateway_name} has degraded performance. Dependent services may be unstable.",
                },
            }
        ],
    },
    {
        **_ALERT,
        "key": "cell-available-via-gateway",
        "version": 1,
        "name": "Cell Is Available thru Gateway",
        "description": "Notice event when a service-via-gateway cell recovers from down/offline back to available.",
        "trigger": "cell.status_changed",
        "conditions": {
            "and": [
                {"in": [{"var": "new_status"}, ["up", "active", "ready", "online", "standby"]]},
                {"in": [{"var": "prev_status"}, ["down", "offline", "unknown"]]},
            ]
        },
        "enrichers": ["gateway_context"],
        "computed": [],
        "actions": [
            {
                "action": "create_event",
                "params": {
                    "severity": "notice",
                    "type_slug": "cell.validate",
                    "record_class": "event",
                },
            }
        ],
    },
]
