"""Seed event-type catalog rows for the equipment tier.

Without these the equipment slugs render in the feed as bare strings with no
icon, label, or category — the same gap that made the system record types look
missing before 0033. These are `is_system` rows: visible and stylable in the
Event Types catalog and pickable in rule actions, but hidden from the manual
"Log event" picker, because nobody hand-logs "a capability changed status".

Classification precedence is unchanged (rule params > action_registry defaults
> catalog), so these rows carry display metadata, not behavior.

Note `equipment.capability.status` is the one that matters operationally: it
is the record that a specific port on a specific box went down, which is what
the advisory rule keys off when a bound gateway is still reported active.

Revision ID: 0043_equipment_event_types
Revises: 0042_equipment_bindings_links
Create Date: 2026-08-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0043_equipment_event_types"
down_revision = "0042_equipment_bindings_links"
branch_labels = None
depends_on = None

# slug, label, category, record_class, severity, icon, kinds
_EQUIPMENT_TYPES = [
    (
        "equipment.status",
        "Equipment status change",
        "Equipment",
        "event",
        "notice",
        "radio",
        ["equipment"],
    ),
    (
        "equipment.capability.status",
        "Capability status change",
        "Equipment",
        "event",
        "notice",
        "activity",
        ["equipment_capability"],
    ),
    (
        "equipment.registered",
        "Equipment registered",
        "Equipment",
        "log",
        "info",
        "package-plus",
        ["equipment"],
    ),
    (
        "equipment.link.changed",
        "Equipment link changed",
        "Equipment",
        "event",
        "notice",
        "cable",
        ["equipment_link"],
    ),
    (
        "utc.deployed",
        "UTC deployed",
        "Equipment",
        "event",
        "notice",
        "boxes",
        ["utc_instance"],
    ),
    (
        "equipment.derived.disagreement",
        "Equipment disagrees with reported status",
        "Equipment",
        "event",
        "warning",
        "triangle-alert",
        ["equipment_capability"],
    ),
]

_SLUGS = tuple(row[0] for row in _EQUIPMENT_TYPES)


def upgrade() -> None:
    table = sa.table(
        "event_type_def",
        sa.column("workspace_id", sa.BigInteger()),
        sa.column("slug", sa.String()),
        sa.column("label", sa.String()),
        sa.column("category", sa.String()),
        sa.column("record_class", sa.String()),
        sa.column("default_severity", sa.String()),
        sa.column("icon", sa.String()),
        sa.column("allowed_subject_kinds", JSONB()),
        sa.column("is_builtin", sa.Boolean()),
        sa.column("is_system", sa.Boolean()),
    )
    op.bulk_insert(
        table,
        [
            {
                "workspace_id": None,
                "slug": slug,
                "label": label,
                "category": category,
                "record_class": record_class,
                "default_severity": severity,
                "icon": icon,
                "allowed_subject_kinds": kinds,
                "is_builtin": True,
                "is_system": True,
            }
            for slug, label, category, record_class, severity, icon, kinds in _EQUIPMENT_TYPES
        ],
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM event_type_def "
            "WHERE workspace_id IS NULL AND slug IN :slugs"
        ).bindparams(sa.bindparam("slugs", value=_SLUGS, expanding=True))
    )
