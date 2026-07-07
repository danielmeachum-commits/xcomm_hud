"""Commander is per unit, not per workspace.

A workspace aggregates multiple units, and each unit has its own
OIC/commander — so the one-commander rule scopes to the unit. A commander
must belong to a unit (the API enforces it; rows without a unit are cleared
here). The partial unique index moves from workspace_id to unit_id.

Revision ID: 0028_commander_per_unit
Revises: 0027_personnel_commander
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0028_commander_per_unit"
down_revision = "0027_personnel_commander"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("uq_personnel_workspace_commander", table_name="personnel")
    op.execute(
        "UPDATE personnel SET is_commander = false "
        "WHERE is_commander AND unit_id IS NULL"
    )
    # At most one commander per unit.
    op.create_index(
        "uq_personnel_unit_commander",
        "personnel",
        ["unit_id"],
        unique=True,
        postgresql_where=sa.text("is_commander AND unit_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_personnel_unit_commander", table_name="personnel")
    op.create_index(
        "uq_personnel_workspace_commander",
        "personnel",
        ["workspace_id"],
        unique=True,
        postgresql_where=sa.text("is_commander"),
    )
