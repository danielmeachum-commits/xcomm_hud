"""Unit branch + per-workspace default unit.

Units carry the service branch of the organization (e.g. an Air Force
squadron), which the personnel form uses to prepopulate a new member's
branch once their unit is picked. One unit per workspace can be flagged as
the default — preselected when adding personnel.

Revision ID: 0026_unit_branch_default
Revises: 0025_team_slug_ncoic_leads
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0026_unit_branch_default"
down_revision = "0025_team_slug_ncoic_leads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("unit", sa.Column("branch", sa.String(24), nullable=True))
    op.add_column(
        "unit",
        sa.Column(
            "is_default",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # At most one default unit per workspace.
    op.create_index(
        "uq_unit_workspace_default",
        "unit",
        ["workspace_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )


def downgrade() -> None:
    op.drop_index("uq_unit_workspace_default", table_name="unit")
    op.drop_column("unit", "is_default")
    op.drop_column("unit", "branch")
