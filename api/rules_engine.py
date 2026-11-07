"""Event-condition-action rules engine.

Domain mutations call `emit_trigger(db, trigger, ctx, ...)` at the same
point they used to hand-write feed rows. The engine:

1. loads enabled rules for the trigger (global + current workspace),
2. per rule: applies its named enrichers to the payload, evaluates its
   stored condition tree, and — on a match — runs its action list,
3. writes a RuleExecution row per fired rule.

Everything runs synchronously inside the caller's transaction, so a
mutation and its rule effects commit or roll back together (the same
atomicity the old inline dual-writes had).

Recursion is impossible by construction, with one controlled exception.
Actions marked `mutates` (bulk status changes: personnel end of day,
equipment set status) change things through the same code a person would,
so the triggers that code emits still fire — that is how every change made
by a rule still gets its feed/history row. But a trigger emitted from INSIDE
an action runs only non-mutating actions (create_event): a rule can never
make a change that sets off another change. See `_ACTION_DEPTH`.

Three code registries parameterize the engine; rules stored in the DB
reference them by name:

- TRIGGERS  — what can fire, the payload fields each carries (drives the
              wizard's condition builder), and how a payload maps onto an
              event subject.
- ENRICHERS — named context-expanders ("service_context" adds site/kind/
              PACE, ...). Code-defined on purpose: arbitrary user lookups
              are a performance/injection trap.
- ACTIONS   — named effects. v1 ships `create_event`; notifications,
              webhooks, auto-status changes hang off this seam later.

Conditions are a jsonlogic subset stored as JSONB — see `evaluate_condition`.
"""

from __future__ import annotations

import contextvars
import datetime
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

from action_registry import record_action
from models import (
    EMCON_LEVELS,
    EQUIPMENT_LINK_KINDS,
    EQUIPMENT_STATUS_VALUES,
    FPCON_LEVELS,
    GATEWAY_STATUS_VALUES,
    PERSONNEL_STATUS_VALUES,
    Gateway,
    Personnel,
    Rule,
    RuleExecution,
    SERVICE_STATUS_VALUES,
    SEVERITIES,
    SITE_STATUS_VALUES,
    Service,
    ServiceDelivery,
    Site,
    Team,
    Unit,
    WorkCenter,
    WorkspaceRuleState,
)
from schemas import SubjectKinds

log = logging.getLogger("xcomm_hud.rules")


# --- Condition evaluation (jsonlogic subset) ---
#
# A condition is a nested dict tree:
#   {"==": [{"var": "new_status"}, "down"]}
#   {"and": [ ... ]}, {"or": [ ... ]}, {"!": ...}
#   {"in": [{"var": "new_status"}, ["down", "offline"]]}
#   {"contains": [{"var": "note"}, "outage"]}
#   {">": [...]}, {">=": ...}, {"<": ...}, {"<=": ...}
# `var` resolves dotted paths against the context. Evaluation errors make
# the clause False rather than raising — a malformed rule must never take
# down a mutation.

def _resolve(value: Any, ctx: dict) -> Any:
    if isinstance(value, dict) and "var" in value and len(value) == 1:
        path = value["var"]
        cur: Any = ctx
        for part in str(path).split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                return None
        return cur
    if isinstance(value, dict):
        return evaluate_condition(value, ctx)
    return value


def _as_number(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _compare(op: str, a: Any, b: Any) -> bool:
    na, nb = _as_number(a), _as_number(b)
    if na is not None and nb is not None:
        a, b = na, nb
    elif not (isinstance(a, str) and isinstance(b, str)):
        return False
    if op == ">":
        return a > b
    if op == ">=":
        return a >= b
    if op == "<":
        return a < b
    return a <= b


def evaluate_condition(cond: Any, ctx: dict) -> bool:
    """Evaluate a condition tree; empty/None means "always"."""
    if cond is None or cond == {} or cond == []:
        return True
    if isinstance(cond, bool):
        return cond
    if not isinstance(cond, dict) or len(cond) != 1:
        return bool(cond)
    op, args = next(iter(cond.items()))
    try:
        if op == "and":
            return all(evaluate_condition(c, ctx) for c in args)
        if op == "or":
            return any(evaluate_condition(c, ctx) for c in args)
        if op in ("!", "not"):
            inner = args[0] if isinstance(args, list) else args
            return not evaluate_condition(inner, ctx)
        if op == "var":
            return bool(_resolve(cond, ctx))
        a = _resolve(args[0], ctx)
        b = _resolve(args[1], ctx)
        if op == "==":
            return a == b
        if op == "!=":
            return a != b
        if op == "in":
            return b is not None and a in b
        if op == "contains":
            return a is not None and b is not None and str(b).lower() in str(a).lower()
        if op in (">", ">=", "<", "<="):
            return _compare(op, a, b)
    except (TypeError, ValueError, KeyError, IndexError):
        return False
    log.warning("Unknown condition op %r — treating as no match", op)
    return False


# --- Value expressions (computed fields) ---
#
# The value-producing sibling of `evaluate_condition`: same {"op": [args]}
# shape, but returns data instead of booleans.
#   {"+": [a, b, ...]}, "-", "*", "/"          arithmetic (None on bad input)
#   {"cat": [a, b, ...]}                        string concatenation
#   {"coalesce": [a, b, ...]}                   first non-null argument
#   {"if": [cond, then, else]}                  cond uses evaluate_condition
#   {"upper": x}, {"lower": x}                  string casing
#   {"round": [x, digits]}                      numeric rounding
#   {"rank": [value, [ordered list]]}           index in an ordered scale
#                                               (None when not found)
#   {"var": "path"}                             field lookup
# Anything else (literals, lists) passes through unchanged.

_CONDITION_OPS = {"and", "or", "!", "not", "==", "!=", "in", "contains", ">", ">=", "<", "<="}


def evaluate_value(expr: Any, ctx: dict) -> Any:
    if not isinstance(expr, dict) or len(expr) != 1:
        return expr
    op, args = next(iter(expr.items()))
    if op == "var":
        return _resolve(expr, ctx)
    if op in _CONDITION_OPS:
        return evaluate_condition(expr, ctx)
    try:
        if op == "if":
            cond, then, other = args[0], args[1], args[2] if len(args) > 2 else None
            return evaluate_value(then if evaluate_condition(cond, ctx) else other, ctx)
        if op == "cat":
            return "".join(
                str(v) for v in (evaluate_value(a, ctx) for a in args) if v is not None
            )
        if op == "coalesce":
            for a in args:
                v = evaluate_value(a, ctx)
                if v is not None and v != "":
                    return v
            return None
        if op == "upper":
            v = evaluate_value(args[0] if isinstance(args, list) else args, ctx)
            return str(v).upper() if v is not None else None
        if op == "lower":
            v = evaluate_value(args[0] if isinstance(args, list) else args, ctx)
            return str(v).lower() if v is not None else None
        if op == "round":
            v = _as_number(evaluate_value(args[0], ctx))
            digits = int(args[1]) if len(args) > 1 else 0
            return round(v, digits) if v is not None else None
        if op == "rank":
            # Position of a value in an ordered scale — the one-liner for
            # "is this FPCON an escalation": rank(new) > rank(prev).
            v = evaluate_value(args[0], ctx)
            scale = evaluate_value(args[1], ctx)
            if not isinstance(scale, list) or v not in scale:
                return None
            return scale.index(v)
        if op in ("+", "-", "*", "/"):
            nums = [_as_number(evaluate_value(a, ctx)) for a in args]
            if any(n is None for n in nums) or not nums:
                return None
            acc = nums[0]
            for n in nums[1:]:
                if op == "+":
                    acc += n
                elif op == "-":
                    acc -= n
                elif op == "*":
                    acc *= n
                else:
                    if n == 0:
                        return None
                    acc /= n
            return acc
    except (TypeError, ValueError, KeyError, IndexError):
        return None
    log.warning("Unknown value op %r — returning None", op)
    return None


_COMPUTED_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def apply_computed(rule_computed: list, ctx: dict) -> None:
    """Evaluate a rule's computed fields into the context, in order (later
    fields may reference earlier ones). A failing field becomes None —
    never an error that blocks the mutation."""
    for spec in rule_computed or []:
        name = spec.get("name", "")
        if not _COMPUTED_NAME_RE.match(name):
            continue
        try:
            if spec.get("kind") == "template":
                ctx[name] = render_template(str(spec.get("template") or ""), ctx)
            else:
                ctx[name] = evaluate_value(spec.get("expr"), ctx)
        except Exception:
            log.exception("Computed field %r failed", name)
            ctx[name] = None


# --- Field metadata (drives the wizard's condition builder) ---


def _f(key: str, label: str, type_: str = "string", values: Optional[list] = None) -> dict:
    out: dict[str, Any] = {"key": key, "label": label, "type": type_}
    if values:
        out["values"] = list(values)
    return out


_COMMON_FIELDS = [
    _f("note", "Note"),
    _f("username", "Operator username"),
]


# --- Enrichers ---


def _enrich_service_context(db: Session, ctx: dict) -> dict:
    # `service_id` in a rule context is a delivery id — that is what the
    # triggers have always carried, and what rules were written against.
    delivery = (
        db.get(ServiceDelivery, ctx.get("service_id"))
        if ctx.get("service_id")
        else None
    )
    if delivery is None:
        return {}
    svc = db.get(Service, delivery.service_id)
    site = db.get(Site, delivery.site_id)
    return {
        "site_id": delivery.site_id,
        "site_name": site.name if site else None,
        "service_kind": svc.kind if svc else None,
        "service_category": delivery.category,
        "service_reach": delivery.reach,
        "enabled_pace": delivery.enabled_pace or [],
    }


def _enrich_gateway_context(db: Session, ctx: dict) -> dict:
    gw = db.get(Gateway, ctx.get("gateway_id")) if ctx.get("gateway_id") else None
    if gw is None:
        return {}
    site = db.get(Site, gw.site_id)
    return {
        "site_id": gw.site_id,
        "site_name": site.name if site else None,
        "gateway_kind": gw.kind,
        "gateway_pace": gw.pace,
        "gateway_provider": gw.provider,
    }


def _enrich_site_context(db: Session, ctx: dict) -> dict:
    site = db.get(Site, ctx.get("site_id")) if ctx.get("site_id") else None
    if site is None:
        return {}
    return {
        "site_name": site.name,
        "site_status": site.status,
        "site_fpcon": site.fpcon,
        "site_emcon": site.emcon,
    }


def _enrich_personnel_context(db: Session, ctx: dict) -> dict:
    p = db.get(Personnel, ctx.get("personnel_id")) if ctx.get("personnel_id") else None
    if p is None:
        return {}
    wc = db.get(WorkCenter, p.work_center_id) if p.work_center_id else None
    unit = db.get(Unit, p.person.unit_id) if p.person.unit_id else None
    teams = [t.name for t in p.teams]
    return {
        "work_center": wc.name if wc else None,
        "unit": unit.name if unit else None,
        "teams": teams,
        "rank": p.person.rank,
        "personnel_type": p.person.personnel_type,
        "is_guest": p.is_guest,
        "assigned_site_id": p.assigned_site_id,
    }


@dataclass(frozen=True)
class Enricher:
    key: str
    label: str
    fn: Callable[[Session, dict], dict]
    fields: list = field(default_factory=list)


ENRICHERS: dict[str, Enricher] = {
    e.key: e
    for e in [
        Enricher(
            "service_context",
            "Service context (site, kind, category, PACE)",
            _enrich_service_context,
            [
                _f("site_name", "Site name"),
                _f("service_kind", "Service kind", "enum", ["voice", "data", "other"]),
                _f("service_category", "Service category", "enum", ["critical", "sustainment", "other"]),
                _f("service_reach", "Service reach", "enum", ["local", "external"]),
                _f("enabled_pace", "Enabled PACE tiers", "list"),
            ],
        ),
        Enricher(
            "gateway_context",
            "Gateway context (site, kind, PACE, provider)",
            _enrich_gateway_context,
            [
                _f("site_name", "Site name"),
                _f("gateway_kind", "Gateway kind", "enum", ["milsat", "commercial", "other"]),
                _f("gateway_pace", "Gateway PACE", "enum", ["primary", "alternate", "contingency", "emergency"]),
                _f("gateway_provider", "Gateway provider"),
            ],
        ),
        Enricher(
            "site_context",
            "Site context (status, FPCON, EMCON)",
            _enrich_site_context,
            [
                _f("site_name", "Site name"),
                _f("site_status", "Site status", "enum", list(SITE_STATUS_VALUES)),
                _f("site_fpcon", "Site FPCON", "enum", list(FPCON_LEVELS)),
                _f("site_emcon", "Site EMCON", "enum", list(EMCON_LEVELS)),
            ],
        ),
        Enricher(
            "personnel_context",
            "Personnel context (work center, unit, teams, rank)",
            _enrich_personnel_context,
            [
                _f("work_center", "Work center"),
                _f("unit", "Unit"),
                _f("teams", "Teams", "list"),
                _f("rank", "Rank"),
                _f("personnel_type", "Personnel type", "enum", ["military", "civilian"]),
                _f("is_guest", "Is guest", "bool"),
            ],
        ),
    ]
}


# --- Triggers ---


@dataclass(frozen=True)
class TriggerDef:
    key: str
    label: str
    fields: list
    enrichers: tuple[str, ...]
    # Map a payload onto an event subject for the create_event action.
    subject: Callable[[dict], dict]
    event_type: str = "validation"


TRIGGERS: dict[str, TriggerDef] = {
    t.key: t
    for t in [
        TriggerDef(
            "service.status_changed",
            "Service status changed",
            [
                _f("service_name", "Service name"),
                _f("prev_status", "Previous status", "enum", list(SERVICE_STATUS_VALUES)),
                _f("new_status", "New status", "enum", list(SERVICE_STATUS_VALUES)),
                *_COMMON_FIELDS,
            ],
            ("service_context",),
            lambda ctx: {
                "subject_kind": SubjectKinds.SERVICE,
                "subject_id": ctx.get("service_id"),
            },
        ),
        TriggerDef(
            "gateway.status_changed",
            "Gateway status changed",
            [
                _f("gateway_name", "Gateway name"),
                _f("prev_status", "Previous status", "enum", list(GATEWAY_STATUS_VALUES)),
                _f("new_status", "New status", "enum", list(GATEWAY_STATUS_VALUES)),
                *_COMMON_FIELDS,
            ],
            ("gateway_context",),
            lambda ctx: {
                "subject_kind": SubjectKinds.GATEWAY,
                "subject_id": ctx.get("gateway_id"),
            },
        ),
        TriggerDef(
            "cell.status_changed",
            "Service-via-gateway cell changed",
            [
                _f("service_name", "Service name"),
                _f("gateway_name", "Gateway name"),
                _f("prev_status", "Previous status"),
                _f("new_status", "New status"),
                _f("source_flow", "Source flow", "enum", ["validate", "cascade"]),
                *_COMMON_FIELDS,
            ],
            ("service_context", "gateway_context"),
            lambda ctx: {
                "subject_kind": SubjectKinds.SERVICE_GATEWAY,
                "subject_id": ctx.get("service_id"),
                "second_subject_id": ctx.get("gateway_id"),
                "subject_label": f"{ctx.get('service_name')} via {ctx.get('gateway_name')}",
            },
        ),
        TriggerDef(
            "site.status_changed",
            "Site status changed",
            [
                _f("site_name", "Site name"),
                _f("prev_status", "Previous status", "enum", list(SITE_STATUS_VALUES)),
                _f("new_status", "New status", "enum", list(SITE_STATUS_VALUES)),
                *_COMMON_FIELDS,
            ],
            ("site_context",),
            lambda ctx: {
                "subject_kind": SubjectKinds.SITE_STATUS,
                "subject_id": ctx.get("site_id"),
            },
        ),
        TriggerDef(
            "site.fpcon_changed",
            "Site FPCON changed",
            [
                _f("site_name", "Site name"),
                _f("prev_status", "Previous FPCON", "enum", list(FPCON_LEVELS)),
                _f("new_status", "New FPCON", "enum", list(FPCON_LEVELS)),
                *_COMMON_FIELDS,
            ],
            ("site_context",),
            lambda ctx: {
                "subject_kind": SubjectKinds.SITE_FPCON,
                "subject_id": ctx.get("site_id"),
            },
        ),
        TriggerDef(
            "site.emcon_changed",
            "Site EMCON changed",
            [
                _f("site_name", "Site name"),
                _f("prev_status", "Previous EMCON", "enum", list(EMCON_LEVELS)),
                _f("new_status", "New EMCON", "enum", list(EMCON_LEVELS)),
                *_COMMON_FIELDS,
            ],
            ("site_context",),
            lambda ctx: {
                "subject_kind": SubjectKinds.SITE_EMCON,
                "subject_id": ctx.get("site_id"),
            },
        ),
        TriggerDef(
            "personnel.location_changed",
            "Personnel signed in / out",
            [
                _f("personnel_name", "Person"),
                _f("prev_status", "Previous status", "enum", list(PERSONNEL_STATUS_VALUES)),
                _f("new_status", "New status", "enum", list(PERSONNEL_STATUS_VALUES)),
                # "rule" = changed by a rule action (e.g. ENDEX end of day).
                _f("source_flow", "Source flow", "enum", ["checkin", "bulk", "reset", "rule"]),
                *_COMMON_FIELDS,
            ],
            ("personnel_context", "site_context"),
            lambda ctx: {
                "subject_kind": SubjectKinds.PERSONNEL_LOCATION,
                "subject_id": ctx.get("personnel_id"),
                "second_subject_id": ctx.get("site_id"),
                "subject_label": ctx.get("personnel_name"),
            },
            event_type="personnel",
        ),
        # ---------- Equipment tier ----------
        # Note what is NOT here: there is no trigger that writes service or
        # gateway status from equipment. Equipment status is advisory (see
        # api/equipment_status.py); these triggers record what happened and,
        # in the disagreement case, raise a flag for a human.
        TriggerDef(
            "equipment.status_changed",
            "Equipment status changed",
            [
                _f("equipment_code", "Equipment ID"),
                _f("equipment_title", "Equipment type"),
                _f("prev_status", "Previous status", "enum", list(EQUIPMENT_STATUS_VALUES)),
                _f("new_status", "New status", "enum", list(EQUIPMENT_STATUS_VALUES)),
                # "rule" = set by a rule action, e.g. everything offline at ENDEX.
                _f("source_flow", "Source", "enum", ["manual", "rule"]),
                *_COMMON_FIELDS,
            ],
            ("site_context",),
            lambda ctx: {
                "subject_kind": SubjectKinds.EQUIPMENT,
                "subject_id": ctx.get("equipment_id"),
                "subject_label": ctx.get("equipment_code"),
            },
        ),
        TriggerDef(
            "equipment.capability_status_changed",
            "Equipment capability status changed",
            [
                _f("equipment_code", "Equipment ID"),
                _f("capability_label", "Capability"),
                _f("capability_kind", "Capability kind"),
                _f("prev_status", "Previous status", "enum", list(EQUIPMENT_STATUS_VALUES)),
                _f("new_status", "New status", "enum", list(EQUIPMENT_STATUS_VALUES)),
                # True when this capability backs a service or gateway that is
                # still reported healthy — the condition the advisory rule
                # keys on so it doesn't fire for unbound gear.
                _f("contradicts_reported", "Contradicts reported status", "bool"),
                _f("bound_targets", "Bound services/gateways"),
                *_COMMON_FIELDS,
            ],
            ("site_context",),
            lambda ctx: {
                "subject_kind": SubjectKinds.EQUIPMENT_CAPABILITY,
                "subject_id": ctx.get("capability_id"),
                "second_subject_id": ctx.get("equipment_id"),
                "subject_label": (
                    f"{ctx.get('equipment_code')} {ctx.get('capability_label')}"
                ),
            },
        ),
        TriggerDef(
            "equipment.registered",
            "Equipment registered",
            [
                _f("equipment_code", "Equipment ID"),
                _f("equipment_title", "Equipment type"),
                _f("serial_number", "Serial number"),
                _f("site_name", "Site name"),
                *_COMMON_FIELDS,
            ],
            ("site_context",),
            lambda ctx: {
                "subject_kind": SubjectKinds.EQUIPMENT,
                "subject_id": ctx.get("equipment_id"),
                "subject_label": ctx.get("equipment_code"),
            },
        ),
        TriggerDef(
            "equipment.reassigned",
            "Equipment moved between UTCs",
            [
                _f("equipment_code", "Equipment ID"),
                _f("equipment_title", "Equipment type"),
                _f("serial_number", "Serial number"),
                _f("site_name", "Site name"),
                _f("utc_name", "Moved to UTC"),
                # Null when the gear was idle in the pool rather than taken
                # from a live deployment — which is the unremarkable case, and
                # the one a rule watching for "who lost a radio" wants to skip.
                _f("previous_utc_name", "Taken from UTC"),
                *_COMMON_FIELDS,
            ],
            ("site_context",),
            lambda ctx: {
                "subject_kind": SubjectKinds.EQUIPMENT,
                "subject_id": ctx.get("equipment_id"),
                "second_subject_id": ctx.get("utc_instance_id"),
                "subject_label": ctx.get("equipment_code"),
            },
        ),
        TriggerDef(
            "equipment.link_changed",
            "Equipment link changed",
            [
                _f("a_equipment_code", "From"),
                _f("b_equipment_code", "To"),
                _f("link_kind", "Link kind", "enum", list(EQUIPMENT_LINK_KINDS)),
                _f("prev_status", "Previous status"),
                _f("new_status", "New status"),
                _f("source_flow", "Source flow", "enum", ["create", "update", "delete"]),
                _f("crosses_sites", "Crosses sites", "bool"),
                *_COMMON_FIELDS,
            ],
            (),
            lambda ctx: {
                "subject_kind": SubjectKinds.EQUIPMENT_LINK,
                "subject_id": ctx.get("link_id"),
                "subject_label": (
                    f"{ctx.get('a_equipment_code')} → {ctx.get('b_equipment_code')}"
                ),
            },
            event_type="general",
        ),
        TriggerDef(
            "utc.deployed",
            "UTC deployed",
            [
                _f("utc_name", "UTC name"),
                _f("utc_code", "UTC code"),
                _f("site_name", "Site name"),
                _f("role", "Role", "enum", ["primary", "extension", "independent"]),
                _f("equipment_count", "Serialized items", "number"),
                *_COMMON_FIELDS,
            ],
            ("site_context",),
            lambda ctx: {
                "subject_kind": SubjectKinds.UTC_INSTANCE,
                "subject_id": ctx.get("utc_instance_id"),
                "second_subject_id": ctx.get("site_id"),
                "subject_label": ctx.get("utc_name"),
            },
            event_type="general",
        ),
        TriggerDef(
            # A person logged a custom event (STARTEX, ENDEX, a safety brief…).
            # This is what lets an event DO something: a rule matching
            # type_slug "exercise.endex" can run end of day, set gear offline…
            "event.logged",
            "Custom event logged",
            [
                _f("type_slug", "Event type (slug, e.g. exercise.endex)"),
                _f("severity", "Severity", "enum", list(SEVERITIES)),
                _f("record_class", "Record class", "enum", ["log", "event"]),
                _f("subject_kind", "Attached to (kind)"),
                _f("subject_label", "Attached to"),
                *_COMMON_FIELDS,
            ],
            (),
            lambda ctx: {
                "subject_kind": ctx.get("subject_kind") or SubjectKinds.WORKSPACE,
                "subject_id": ctx.get("subject_id"),
                "subject_label": ctx.get("subject_label"),
            },
            event_type="general",
        ),
    ]
}


# --- Actions ---

_TEMPLATE_RE = re.compile(r"\{([a-z0-9_.]+)\}")


def render_template(template: str, ctx: dict) -> str:
    """Substitute {field} placeholders from the context; unknown fields
    are left as-is so a typo is visible rather than silently blank."""

    def sub(m: re.Match) -> str:
        val = _resolve({"var": m.group(1)}, ctx)
        return str(val) if val is not None else m.group(0)

    return _TEMPLATE_RE.sub(sub, template)


_VALID_SEVERITIES = frozenset(SEVERITIES)


def _action_create_event(db: Session, ctx: dict, params: dict) -> None:
    trigger_def = TRIGGERS[ctx["_trigger"]]
    subject = trigger_def.subject(ctx)
    note = ctx.get("note")
    if params.get("note_template"):
        note = render_template(params["note_template"], ctx)
    # Dynamic severity: read it from a payload/computed field — an
    # escalation-mapping field can drive critical vs info per record.
    # Invalid or missing values fall back to the fixed severity param
    # (and from there to the type default).
    severity = params.get("severity")
    if params.get("severity_from"):
        candidate = ctx.get(params["severity_from"])
        if isinstance(candidate, str) and candidate in _VALID_SEVERITIES:
            severity = candidate
    # Same idea for record class — severe transitions can surface on the
    # timeline while routine ones stay audit-only logs.
    record_class = params.get("record_class")
    if params.get("record_class_from"):
        candidate = ctx.get(params["record_class_from"])
        if candidate in ("log", "event"):
            record_class = candidate
    record_action(
        db,
        action_slug=params.get("type_slug") or "note.general",
        workspace_id=ctx.get("workspace_id"),
        subject_kind=subject["subject_kind"],
        subject_id=subject.get("subject_id"),
        second_subject_id=subject.get("second_subject_id"),
        subject_label=subject.get("subject_label"),
        prev_status=ctx.get("prev_status"),
        status=ctx.get("new_status"),
        user_id=ctx.get("user_id"),
        note=note,
        source=ctx.get("source", "manual"),
        validated_at=ctx.get("occurred_at"),
        event_type=params.get("event_type") or trigger_def.event_type,
        severity=severity,
        record_class=record_class,
    )


@dataclass(frozen=True)
class ActionDef:
    key: str
    label: str
    fn: Callable[[Session, dict, dict], None]
    params: list
    # Changes state (rather than only writing a feed row). Mutating actions
    # run only from a top-level trigger — never from a trigger their own
    # changes emit — which is what keeps rules from cascading.
    mutates: bool = False


# How deep inside a rule action the current emit_trigger is. 0 = a person (or
# the API) caused the trigger; >0 = an action's own change emitted it.
_ACTION_DEPTH: contextvars.ContextVar[int] = contextvars.ContextVar(
    "rule_action_depth", default=0
)


def _rule_summary(db: Session, ctx: dict, message: str) -> None:
    """One feed line per bulk action, so the log says what a rule did as a
    whole ("ENDEX shutdown: 37 equipment set offline") while the per-item
    rows are recorded as routine logs rather than timeline events."""
    record_action(
        db,
        action_slug="rule.bulk_change",
        workspace_id=ctx.get("workspace_id"),
        subject_kind=SubjectKinds.WORKSPACE,
        subject_id=ctx.get("workspace_id"),
        user_id=ctx.get("user_id"),
        note=f"{ctx.get('_rule_name', 'Rule')}: {message}",
        # Same as every other rule-written row. EventOut only allows
        # "manual"/"ingest" — a new value here broke reading the whole feed.
        source=ctx.get("source", "manual"),
        validated_at=ctx.get("occurred_at"),
    )


def _action_personnel_end_of_day(db: Session, ctx: dict, params: dict) -> None:
    """The End of day button, as an action: everyone in the workspace to one
    status (default Unknown), clearing site and expected return."""
    # Imported here: routers.personnel imports this module.
    from models import Personnel as _Personnel
    from routers.personnel import _apply_location_change

    target = params.get("status") or "unknown"
    if target not in PERSONNEL_STATUS_VALUES:
        raise ValueError(f"Unknown personnel status '{target}'")
    when = ctx.get("occurred_at") or datetime.datetime.now(datetime.timezone.utc)
    people = (
        db.query(_Personnel)
        .filter(
            _Personnel.workspace_id == ctx.get("workspace_id"),
            _Personnel.current_status != target,
        )
        .all()
    )
    for p in people:
        _apply_location_change(
            db, p, stat=target, site_id=None, note=None, expected_return_at=None,
            when=when, user_id=ctx.get("user_id"), source_flow="rule",
        )
    _rule_summary(db, ctx, f"{len(people)} people set to {target.replace('_', ' ')}")


def _action_personnel_sign_in_assigned(db: Session, ctx: dict, params: dict) -> None:
    """Start of day: everyone with an assigned site signed in there. People
    without one, and people already on site there, are left as they are."""
    from models import Personnel as _Personnel
    from routers.personnel import _apply_location_change

    when = ctx.get("occurred_at") or datetime.datetime.now(datetime.timezone.utc)
    people = (
        db.query(_Personnel)
        .filter(
            _Personnel.workspace_id == ctx.get("workspace_id"),
            _Personnel.assigned_site_id.is_not(None),
        )
        .all()
    )
    changed = 0
    for p in people:
        if p.current_status == "on_site" and p.current_site_id == p.assigned_site_id:
            continue
        _apply_location_change(
            db, p, stat="on_site", site_id=p.assigned_site_id, note=None,
            expected_return_at=None, when=when, user_id=ctx.get("user_id"),
            source_flow="rule",
        )
        changed += 1
    _rule_summary(db, ctx, f"{changed} people signed in at their assigned site")


# Never touched by a bulk status change: "in maintenance" is a separate fact
# about the gear, and ENDEX/STARTEX must not wipe it.
_BULK_EQUIPMENT_KEEP = ("maintenance",)


def _action_equipment_set_status(db: Session, ctx: dict, params: dict) -> None:
    """Every piece of gear in the workspace to one status (e.g. offline at
    ENDEX, unvalidated at STARTEX). Gear in maintenance is skipped."""
    from models import Equipment as _Equipment
    from routers.equipment import apply_equipment_status

    target = params.get("status")
    if target not in EQUIPMENT_STATUS_VALUES:
        raise ValueError(f"Pick an equipment status (got '{target}')")
    when = ctx.get("occurred_at") or datetime.datetime.now(datetime.timezone.utc)
    rows = (
        db.query(_Equipment)
        .filter(
            _Equipment.workspace_id == ctx.get("workspace_id"),
            _Equipment.status != target,
            _Equipment.status.not_in(_BULK_EQUIPMENT_KEEP),
        )
        .all()
    )
    for eq in rows:
        apply_equipment_status(
            db, eq, status=target, when=when, user_id=ctx.get("user_id"),
            username=ctx.get("username"), note=None,
            workspace_id=ctx.get("workspace_id"), source_flow="rule",
        )
    kept = (
        db.query(_Equipment)
        .filter(
            _Equipment.workspace_id == ctx.get("workspace_id"),
            _Equipment.status.in_(_BULK_EQUIPMENT_KEEP),
        )
        .count()
    )
    msg = f"{len(rows)} equipment set to {target}"
    if kept:
        msg += f" ({kept} in maintenance left as is)"
    _rule_summary(db, ctx, msg)


ACTION_DEFS: dict[str, ActionDef] = {
    a.key: a
    for a in [
        ActionDef(
            "create_event",
            "Create an event / log record",
            _action_create_event,
            [
                _f("type_slug", "Event type (catalog slug)"),
                _f("event_type", "Feed bucket", "enum", ["validation", "general", "personnel"]),
                _f("record_class", "Record class", "enum", ["log", "event"]),
                _f("record_class_from", "Record class from field (overrides fixed class)"),
                _f("severity", "Severity", "enum", ["info", "notice", "warning", "critical"]),
                _f("severity_from", "Severity from field (overrides fixed severity)"),
                _f("note_template", "Note template ({field} placeholders)"),
            ],
        ),
        ActionDef(
            "personnel_end_of_day",
            "Personnel: end of day (everyone to one status)",
            _action_personnel_end_of_day,
            [_f("status", "Set everyone to", "enum", list(PERSONNEL_STATUS_VALUES))],
            mutates=True,
        ),
        ActionDef(
            "personnel_sign_in_assigned",
            "Personnel: sign everyone in at their assigned site",
            _action_personnel_sign_in_assigned,
            [],
            mutates=True,
        ),
        ActionDef(
            "equipment_set_status",
            "Equipment: set all gear to a status (skips maintenance)",
            _action_equipment_set_status,
            [_f("status", "Set all equipment to", "enum", list(EQUIPMENT_STATUS_VALUES))],
            mutates=True,
        ),
    ]
}


# --- The engine ---

# Keys stripped from the RuleExecution context snapshot.
_PRIVATE_KEYS = ("_trigger", "_rule_name")


def _snapshot(ctx: dict) -> dict:
    out = {}
    for k, v in ctx.items():
        if k in _PRIVATE_KEYS:
            continue
        if isinstance(v, (str, int, float, bool, type(None), list)):
            out[k] = v
        else:
            out[k] = str(v)
    return out


def emit_trigger(
    db: Session,
    trigger: str,
    ctx: dict,
    *,
    workspace_id: Optional[int],
) -> None:
    """Fire `trigger` with `ctx` through all matching enabled rules.

    Runs inside the caller's transaction. A rule with on_error="abort"
    re-raises action failures (rolling back the mutation with it); "skip"
    rules log the failure and continue.
    """
    if trigger not in TRIGGERS:
        raise ValueError(f"Unknown trigger '{trigger}'")
    ctx = {**ctx, "_trigger": trigger, "workspace_id": workspace_id}

    rules = (
        db.query(Rule)
        .filter(
            Rule.trigger == trigger,
            Rule.enabled.is_(True),
            (Rule.workspace_id == workspace_id) | (Rule.workspace_id.is_(None)),
        )
        .order_by(Rule.priority, Rule.id)
        .all()
    )

    # A workspace can turn a global built-in off for itself without touching
    # the shared row — honor that here so a disabled default doesn't fire.
    if workspace_id is not None:
        disabled_ids = {
            rid
            for (rid,) in db.query(WorkspaceRuleState.rule_id).filter(
                WorkspaceRuleState.workspace_id == workspace_id,
                WorkspaceRuleState.disabled.is_(True),
            )
        }
        if disabled_ids:
            rules = [r for r in rules if r.id not in disabled_ids]

    for rule in rules:
        rule_ctx = dict(ctx)
        try:
            for name in rule.enrichers or []:
                enricher = ENRICHERS.get(name)
                if enricher is not None:
                    rule_ctx.update(enricher.fn(db, rule_ctx))
            apply_computed(getattr(rule, "computed", None) or [], rule_ctx)
            if not evaluate_condition(rule.conditions, rule_ctx):
                continue
        except Exception:
            log.exception("Rule %s (%s): enrich/condition failed", rule.id, rule.name)
            continue

        execution = RuleExecution(
            rule_id=rule.id,
            workspace_id=workspace_id,
            trigger=trigger,
            status="ok",
            context=_snapshot(rule_ctx),
        )
        depth = _ACTION_DEPTH.get()
        rule_ctx["_rule_name"] = rule.name
        try:
            for step in rule.actions or []:
                action = ACTION_DEFS.get(step.get("action", ""))
                if action is None:
                    raise ValueError(f"Unknown action '{step.get('action')}'")
                if action.mutates and depth > 0:
                    # Emitted by another rule's change — record-keeping only,
                    # so a rule can never set off a chain of changes.
                    log.info("Rule %s: skipped %s (nested trigger)", rule.id, action.key)
                    continue
                token = _ACTION_DEPTH.set(depth + 1)
                try:
                    action.fn(db, rule_ctx, step.get("params") or {})
                finally:
                    _ACTION_DEPTH.reset(token)
        except Exception as err:
            execution.status = "error"
            execution.error = str(err)[:2000]
            db.add(execution)
            if rule.on_error == "abort":
                db.flush()
                raise
            log.exception("Rule %s (%s): action failed (skipped)", rule.id, rule.name)
            continue
        db.add(execution)
    db.flush()


def rules_meta() -> dict:
    """Registry description for the wizard UI."""
    return {
        "triggers": [
            {
                "key": t.key,
                "label": t.label,
                "fields": t.fields,
                "enrichers": list(t.enrichers),
                "event_type": t.event_type,
            }
            for t in TRIGGERS.values()
        ],
        "enrichers": [
            {"key": e.key, "label": e.label, "fields": e.fields}
            for e in ENRICHERS.values()
        ],
        "actions": [
            {"key": a.key, "label": a.label, "params": a.params}
            for a in ACTION_DEFS.values()
        ],
    }
