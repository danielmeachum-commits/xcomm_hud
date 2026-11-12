"""CAC check-in: DoD ID on person, check-in stations, station on history.

A station is a card reader at a door, bound to one site, that signs people
in/out by scanning their CAC — independent of the web app, authenticated by
its own token. See api/routers/kiosk.py and api/cac.py.

Revision ID: 0070_cac_checkin_stations
Revises: 0069_same_device_cells
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0070_cac_checkin_stations"
down_revision = "0069_same_device_cells"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("person", sa.Column("edipi", sa.String(10), nullable=True))
    op.create_index(
        "uq_person_roster_edipi",
        "person",
        ["edipi"],
        unique=True,
        postgresql_where=sa.text("edipi IS NOT NULL AND workspace_id IS NULL"),
    )
    op.create_index(
        "uq_person_local_edipi",
        "person",
        ["workspace_id", "edipi"],
        unique=True,
        postgresql_where=sa.text("edipi IS NOT NULL AND workspace_id IS NOT NULL"),
    )

    op.create_table(
        "checkin_station",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "workspace_id",
            sa.BigInteger,
            sa.ForeignKey("workspace.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "site_id",
            sa.BigInteger,
            sa.ForeignKey("site.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column(
            "mode", sa.String(8), nullable=False, server_default=sa.text("'toggle'")
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("token_hint", sa.String(8), nullable=False),
        sa.Column(
            "disabled", sa.Boolean, nullable=False, server_default=sa.text("false")
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_checkin_station_workspace_id", "checkin_station", ["workspace_id"]
    )
    op.create_index("ix_checkin_station_site_id", "checkin_station", ["site_id"])

    op.add_column(
        "personnel_location_event",
        sa.Column(
            "station_id",
            sa.BigInteger,
            sa.ForeignKey("checkin_station.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("personnel_location_event", "station_id")
    op.drop_index("ix_checkin_station_site_id", table_name="checkin_station")
    op.drop_index("ix_checkin_station_workspace_id", table_name="checkin_station")
    op.drop_table("checkin_station")
    op.drop_index("uq_person_local_edipi", table_name="person")
    op.drop_index("uq_person_roster_edipi", table_name="person")
    op.drop_column("person", "edipi")
