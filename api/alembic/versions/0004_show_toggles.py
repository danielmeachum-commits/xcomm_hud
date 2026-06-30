"""Per-site toggles for showing FPCON / EMCON.

Revision ID: 0004_show_toggles
Revises: 0003_fpcon_emcon_validation
Create Date: 2026-06-30
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_show_toggles"
down_revision = "0003_fpcon_emcon_validation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("site") as b:
        b.add_column(
            sa.Column(
                "show_fpcon",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            )
        )
        b.add_column(
            sa.Column(
                "show_emcon",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("site") as b:
        b.drop_column("show_emcon")
        b.drop_column("show_fpcon")
