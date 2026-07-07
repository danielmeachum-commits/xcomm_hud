"""Add optional AFSC skill level to personnel.

Air Force enlisted members carry a skill level in their AFSC (1 Helper,
3 Apprentice, 5 Journeyman, 7 Craftsman, 9 Superintendent). Nullable —
only meaningful for enlisted ranks, and typically defaulted from grade
(E-4 & below 5, E-5/E-6 7, E-7+ 9) in the UI.

Revision ID: 0024_personnel_skill_level
Revises: 0023_personnel_event_type
Create Date: 2026-07-06
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0024_personnel_skill_level"
down_revision = "0023_personnel_event_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "personnel",
        sa.Column("skill_level", sa.SmallInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("personnel", "skill_level")
