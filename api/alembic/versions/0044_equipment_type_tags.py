"""Add a free-form `tags` list to the equipment catalog.

The catalog already carries the facets the system reasons about — `category`
drives icons and grouping, `serialized` decides whether an item gets a serial
and an ID prefix. What it had no room for is the arbitrary stuff a unit tracks
about a model of gear: "cci", "hand-receipt", "low-power", "shop-stock". Those
were turning into requests for new boolean columns, one per unit, none of which
the system would ever branch on.

`tags` is that escape hatch, and deliberately nothing more: JSONB list of
lowercased strings, no separate tag table, no per-workspace vocabulary. The UI
suggests tags already in use so the vocabulary converges without being
enforced. Nothing in the backend branches on a tag value — if behavior ever
needs to hang off one, that is the signal it deserves a real column.

Existing rows get `[]`, so the badges the UI derives (Bulk, Global) are
untouched — those stay derived from `serialized` and `workspace_id`.

Revision ID: 0044_equipment_type_tags
Revises: 0043_equipment_event_types
Create Date: 2026-08-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0044_equipment_type_tags"
down_revision = "0043_equipment_event_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "equipment_type",
        sa.Column(
            "tags",
            JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    # GIN makes "every type tagged cci" a index scan rather than a table scan
    # once a workspace has a few hundred catalog rows.
    op.create_index(
        "ix_equipment_type_tags",
        "equipment_type",
        ["tags"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_equipment_type_tags", table_name="equipment_type")
    op.drop_column("equipment_type", "tags")
