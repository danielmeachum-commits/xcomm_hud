"""Feed-row construction + slug classification defaults.

`record_action` is the single place Event rows are built. It classifies
the row (log vs event, severity, event_type) from, in precedence order:
explicit keyword overrides (used by rule action params), the `ACTIONS`
defaults below (system action slugs), or the `EventTypeDef` catalog
(user-declarable types like STARTEX or custom per-workspace types).

*When* rows get created is not decided here — that's the rules engine
(api/rules_engine.py): mutations emit triggers and seeded/custom rules
call the `create_event` action, which lands in `record_action`. Manual
event logging (POST /events) also calls it directly.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from models import Event, EventTypeDef


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


@dataclass(frozen=True)
class Action:
    record_class: str  # "log" | "event"
    severity: str  # "info" | "notice" | "warning" | "critical"
    event_type: str = "validation"
    kinds: tuple[str, ...] = ()


# Default classification for system action slugs. Rules may override any
# of these per-row via record_action's keyword overrides.
ACTIONS: dict[str, Action] = {
    "service.validate": Action(
        record_class="log", severity="info", kinds=("service",)
    ),
    "gateway.validate": Action(
        record_class="log", severity="info", kinds=("gateway",)
    ),
    "cell.validate": Action(
        record_class="log", severity="info", kinds=("service_gateway",)
    ),
    "site.status": Action(
        record_class="event", severity="notice", kinds=("site_status",)
    ),
    "site.fpcon": Action(
        record_class="event", severity="warning", kinds=("site_fpcon",)
    ),
    "site.emcon": Action(
        record_class="event", severity="warning", kinds=("site_emcon",)
    ),
    "personnel.checkin": Action(
        record_class="log",
        severity="info",
        event_type="personnel",
        kinds=("personnel_location",),
    ),
}


def lookup_catalog_type(
    db: Session, workspace_id: Optional[int], type_slug: str
) -> Optional[EventTypeDef]:
    """Resolve a declarable type: workspace-scoped rows shadow globals."""
    q = db.query(EventTypeDef).filter(
        EventTypeDef.slug == type_slug,
        EventTypeDef.retired_at.is_(None),
    )
    if workspace_id is not None:
        row = q.filter(EventTypeDef.workspace_id == workspace_id).first()
        if row is not None:
            return row
    return q.filter(EventTypeDef.workspace_id.is_(None)).first()


def record_action(
    db: Session,
    *,
    action_slug: str,
    workspace_id: Optional[int],
    subject_kind: str,
    subject_id: Optional[int] = None,
    second_subject_id: Optional[int] = None,
    subject_label: Optional[str] = None,
    prev_status: Optional[str] = None,
    status: Optional[str] = None,
    user_id: Optional[int] = None,
    note: Optional[str] = None,
    source: str = "manual",
    validated_at: Optional[datetime.datetime] = None,
    event_type: Optional[str] = None,
    severity: Optional[str] = None,
    record_class: Optional[str] = None,
) -> Event:
    """Append the feed row for an action.

    Classification (record_class / severity / event_type) comes from the
    slug's registry defaults, falling back to the EventTypeDef catalog for
    declarable types; explicit keyword arguments override either — that's
    how rule action params retune e.g. a validation's severity per rule.
    """
    resolved_class = "log"
    resolved_severity = "info"
    resolved_event_type = "validation"

    action = ACTIONS.get(action_slug)
    if action is not None:
        resolved_class = action.record_class
        resolved_severity = action.severity
        resolved_event_type = action.event_type
    else:
        type_def = lookup_catalog_type(db, workspace_id, action_slug)
        if type_def is not None:
            resolved_class = type_def.record_class
            resolved_severity = type_def.default_severity
            resolved_event_type = "general"

    if event_type is not None:
        resolved_event_type = event_type
    if severity is not None:
        resolved_severity = severity
    if record_class is not None:
        resolved_class = record_class

    row = Event(
        event_type=resolved_event_type,
        workspace_id=workspace_id,
        record_class=resolved_class,
        severity=resolved_severity,
        type_slug=action_slug,
        validated_at=validated_at or _now(),
        subject_kind=subject_kind,
        subject_id=subject_id,
        second_subject_id=second_subject_id,
        subject_label=subject_label,
        prev_status=prev_status,
        status=status,
        source=source,
        validated_by_user_id=user_id,
        note=note,
    )
    db.add(row)
    db.flush()
    return row
