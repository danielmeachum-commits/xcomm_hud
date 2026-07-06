"""Add guest/visitor flag and contact fields to personnel.

Guests are checked in and tracked like any roster member (on-site list,
accountability, check-out) but are flagged so they can be kept out of the
permanent roster. `affiliation` records their org/unit; `escort` the on-site
point of contact hosting them.

Revision ID: 0022_personnel_guest
Revises: 0021_widen_subject_kind
Create Date: 2026-07-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0022_personnel_guest"
down_revision = "0021_widen_subject_kind"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "personnel",
        sa.Column(
            "is_guest",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "personnel",
        sa.Column("affiliation", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "personnel",
        sa.Column("escort", sa.String(length=128), nullable=True),
    )
    # Drop the server_default now that existing rows are backfilled — new rows
    # get their default from the app layer, matching the other boolean columns.
    op.alter_column("personnel", "is_guest", server_default=None)


def downgrade() -> None:
    op.drop_column("personnel", "escort")
    op.drop_column("personnel", "affiliation")
    op.drop_column("personnel", "is_guest")
