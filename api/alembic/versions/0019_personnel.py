"""Add personnel, work_center, team, and personnel_team tables.

Personnel are a workspace-scoped roster covering uniformed members and DoD
civilians. Work centers are the org-chart bucket (one person to one work
center); teams are an ad-hoc many-to-many overlay across work centers.

Revision ID: 0019_personnel
Revises: 0018_group_order
Create Date: 2026-07-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0019_personnel"
down_revision = "0018_group_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "unit",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("parent_unit_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["parent_unit_id"], ["unit.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "name", name="uq_unit_workspace_name"
        ),
    )
    op.create_index("ix_unit_workspace_id", "unit", ["workspace_id"])
    op.create_index("ix_unit_parent_unit_id", "unit", ["parent_unit_id"])

    op.create_table(
        "work_center",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "name", name="uq_work_center_workspace_name"
        ),
    )
    op.create_index(
        "ix_work_center_workspace_id", "work_center", ["workspace_id"]
    )

    op.create_table(
        "team",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.String(length=16), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "name", name="uq_team_workspace_name"
        ),
    )
    op.create_index("ix_team_workspace_id", "team", ["workspace_id"])

    op.create_table(
        "personnel",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "personnel_type",
            sa.String(length=16),
            nullable=False,
            server_default="military",
        ),
        sa.Column("branch", sa.String(length=24), nullable=True),
        sa.Column("rank", sa.String(length=32), nullable=True),
        sa.Column("last_name", sa.String(length=64), nullable=False),
        sa.Column("first_name", sa.String(length=64), nullable=False),
        sa.Column("cellphone", sa.String(length=32), nullable=True),
        sa.Column("dsn", sa.String(length=32), nullable=True),
        sa.Column("sipr_number", sa.String(length=32), nullable=True),
        sa.Column("email", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("work_center_id", sa.BigInteger(), nullable=True),
        sa.Column("unit_id", sa.BigInteger(), nullable=True),
        sa.Column("supervisor_id", sa.BigInteger(), nullable=True),
        sa.Column("assigned_site_id", sa.BigInteger(), nullable=True),
        sa.Column("room_number", sa.String(length=32), nullable=True),
        sa.Column(
            "current_status",
            sa.String(length=24),
            nullable=False,
            server_default="unknown",
        ),
        sa.Column("current_site_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "current_status_since", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column("current_status_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["work_center_id"], ["work_center.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["unit_id"], ["unit.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["supervisor_id"], ["personnel.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["assigned_site_id"], ["site.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["current_site_id"], ["site.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_personnel_workspace_id", "personnel", ["workspace_id"]
    )
    op.create_index(
        "ix_personnel_current_site_id", "personnel", ["current_site_id"]
    )
    op.create_index(
        "ix_personnel_work_center_id", "personnel", ["work_center_id"]
    )
    op.create_index("ix_personnel_unit_id", "personnel", ["unit_id"])
    op.create_index(
        "ix_personnel_supervisor_id", "personnel", ["supervisor_id"]
    )
    op.create_index(
        "ix_personnel_assigned_site_id", "personnel", ["assigned_site_id"]
    )

    op.create_table(
        "personnel_team",
        sa.Column("personnel_id", sa.BigInteger(), nullable=False),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["personnel_id"], ["personnel.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("personnel_id", "team_id"),
    )
    op.create_index(
        "ix_personnel_team_team_id", "personnel_team", ["team_id"]
    )

    op.create_table(
        "personnel_location_event",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("personnel_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("site_id", sa.BigInteger(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("changed_by_user_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["personnel_id"], ["personnel.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["site_id"], ["site.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["changed_by_user_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_personnel_location_event_personnel_id",
        "personnel_location_event",
        ["personnel_id"],
    )
    op.create_index(
        "ix_personnel_location_event_changed_at",
        "personnel_location_event",
        ["changed_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_personnel_location_event_changed_at",
        table_name="personnel_location_event",
    )
    op.drop_index(
        "ix_personnel_location_event_personnel_id",
        table_name="personnel_location_event",
    )
    op.drop_table("personnel_location_event")
    op.drop_index("ix_personnel_team_team_id", table_name="personnel_team")
    op.drop_table("personnel_team")
    op.drop_index("ix_personnel_current_site_id", table_name="personnel")
    op.drop_index("ix_personnel_assigned_site_id", table_name="personnel")
    op.drop_index("ix_personnel_supervisor_id", table_name="personnel")
    op.drop_index("ix_personnel_unit_id", table_name="personnel")
    op.drop_index("ix_personnel_work_center_id", table_name="personnel")
    op.drop_index("ix_personnel_workspace_id", table_name="personnel")
    op.drop_table("personnel")
    op.drop_index("ix_team_workspace_id", table_name="team")
    op.drop_table("team")
    op.drop_index("ix_work_center_workspace_id", table_name="work_center")
    op.drop_table("work_center")
    op.drop_index("ix_unit_parent_unit_id", table_name="unit")
    op.drop_index("ix_unit_workspace_id", table_name="unit")
    op.drop_table("unit")
