"""Team slug/NCOIC + per-team work-center leads.

Teams gain a short slug ("FCP1") shown where the full name is too long, and
an NCOIC (a personnel FK, SET NULL so a departing NCOIC doesn't take the
team with them). A new join table records the team's designated lead for
each work center it draws members from — leads are scoped per team, so
FCP1's Tech Control lead can differ from FCP2's.

Revision ID: 0025_team_slug_ncoic_leads
Revises: 0024_personnel_skill_level
Create Date: 2026-07-06
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0025_team_slug_ncoic_leads"
down_revision = "0024_personnel_skill_level"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("team", sa.Column("slug", sa.String(16), nullable=True))
    op.add_column("team", sa.Column("ncoic_id", sa.BigInteger(), nullable=True))
    op.create_unique_constraint(
        "uq_team_workspace_slug", "team", ["workspace_id", "slug"]
    )
    op.create_foreign_key(
        "fk_team_ncoic_personnel",
        "team",
        "personnel",
        ["ncoic_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "team_work_center_lead",
        sa.Column(
            "team_id",
            sa.BigInteger(),
            sa.ForeignKey("team.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "work_center_id",
            sa.BigInteger(),
            sa.ForeignKey("work_center.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "personnel_id",
            sa.BigInteger(),
            sa.ForeignKey("personnel.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("team_work_center_lead")
    op.drop_constraint("fk_team_ncoic_personnel", "team", type_="foreignkey")
    op.drop_constraint("uq_team_workspace_slug", "team", type_="unique")
    op.drop_column("team", "ncoic_id")
    op.drop_column("team", "slug")
