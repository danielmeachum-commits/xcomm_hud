"""Personnel commander flag.

One person per workspace can be designated the commander — everyone rolls
up under them in the chain of command, and the UI marks them with a gold
star wherever their name appears. A partial unique index enforces the
one-per-workspace rule at the database level; the API rejects a second
commander with a friendly error before it ever hits the index.

Revision ID: 0027_personnel_commander
Revises: 0026_unit_branch_default
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0027_personnel_commander"
down_revision = "0026_unit_branch_default"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "personnel",
        sa.Column(
            "is_commander",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # At most one commander per workspace.
    op.create_index(
        "uq_personnel_workspace_commander",
        "personnel",
        ["workspace_id"],
        unique=True,
        postgresql_where=sa.text("is_commander"),
    )


def downgrade() -> None:
    op.drop_index("uq_personnel_workspace_commander", table_name="personnel")
    op.drop_column("personnel", "is_commander")
