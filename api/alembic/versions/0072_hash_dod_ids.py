"""Store DoD IDs only as a keyed hash.

`person.edipi` and `kiosk_pending_scan.edipi` held the 10-digit number in
plain text. Matching a scan only needs equality, so both become
`edipi_hash` = HMAC-SHA256 under XCOMM_HUD_ID_KEY (see cac.edipi_hash), and
existing numbers are hashed in place. The key must be set when there's
anything to convert; there's no downgrade back to numbers (a hash can't be
reversed), so downgrade clears enrollments instead.

Revision ID: 0072_hash_dod_ids
Revises: 0071_kiosk_pending_scans
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from cac import edipi_hash

revision = "0072_hash_dod_ids"
down_revision = "0071_kiosk_pending_scans"
branch_labels = None
depends_on = None


def _hash_column(table: str) -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(f"SELECT id, edipi FROM {table} WHERE edipi IS NOT NULL")
    ).fetchall()
    for row_id, edipi in rows:
        conn.execute(
            sa.text(f"UPDATE {table} SET edipi_hash = :h WHERE id = :id"),
            {"h": edipi_hash(edipi), "id": row_id},
        )


def upgrade() -> None:
    op.drop_index("uq_person_local_edipi", table_name="person")
    op.drop_index("uq_person_roster_edipi", table_name="person")
    op.add_column("person", sa.Column("edipi_hash", sa.String(64), nullable=True))
    _hash_column("person")
    op.drop_column("person", "edipi")
    op.create_index(
        "uq_person_roster_edipi",
        "person",
        ["edipi_hash"],
        unique=True,
        postgresql_where=sa.text("edipi_hash IS NOT NULL AND workspace_id IS NULL"),
    )
    op.create_index(
        "uq_person_local_edipi",
        "person",
        ["workspace_id", "edipi_hash"],
        unique=True,
        postgresql_where=sa.text(
            "edipi_hash IS NOT NULL AND workspace_id IS NOT NULL"
        ),
    )

    op.drop_constraint("uq_kiosk_pending_card", "kiosk_pending_scan", type_="unique")
    op.add_column(
        "kiosk_pending_scan", sa.Column("edipi_hash", sa.String(64), nullable=True)
    )
    _hash_column("kiosk_pending_scan")
    op.alter_column("kiosk_pending_scan", "edipi_hash", nullable=False)
    op.drop_column("kiosk_pending_scan", "edipi")
    op.create_unique_constraint(
        "uq_kiosk_pending_card", "kiosk_pending_scan", ["workspace_id", "edipi_hash"]
    )


def downgrade() -> None:
    # Hashes can't be turned back into numbers: enrollments and queued cards
    # are cleared, and people re-scan to enroll.
    op.drop_constraint("uq_kiosk_pending_card", "kiosk_pending_scan", type_="unique")
    op.execute("DELETE FROM kiosk_pending_scan")
    op.drop_column("kiosk_pending_scan", "edipi_hash")
    op.add_column(
        "kiosk_pending_scan", sa.Column("edipi", sa.String(10), nullable=False)
    )
    op.create_unique_constraint(
        "uq_kiosk_pending_card", "kiosk_pending_scan", ["workspace_id", "edipi"]
    )

    op.drop_index("uq_person_local_edipi", table_name="person")
    op.drop_index("uq_person_roster_edipi", table_name="person")
    op.drop_column("person", "edipi_hash")
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
