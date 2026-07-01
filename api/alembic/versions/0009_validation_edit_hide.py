"""Add edited_at / hidden_at columns to validation for event management.

Enables edit-note and admin soft-delete on the events log without breaking the
append-only audit guarantee — rows are never physically mutated in ways that
change what happened; hidden rows are just filtered from the default feed.

Revision ID: 0009_validation_edit_hide
Revises: 0008_gateway_active_ready
Create Date: 2026-07-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0009_validation_edit_hide"
down_revision = "0008_gateway_active_ready"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "validation",
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "validation",
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "validation",
        sa.Column(
            "hidden_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("user.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("validation", "hidden_by_user_id")
    op.drop_column("validation", "hidden_at")
    op.drop_column("validation", "edited_at")
