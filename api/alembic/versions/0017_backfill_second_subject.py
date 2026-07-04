"""Backfill second_subject_id on existing service_gateway cell events.

Cells created before 0016 stored the gateway only in ``subject_label``
("svc via gw"). This walks those rows, joins service→site→gateway on
matching label, and populates the new column so history-by-cell surfaces
pre-migration events too.

Revision ID: 0017_backfill_second_subject
Revises: 0016_event_second_subject
Create Date: 2026-07-01
"""

from __future__ import annotations

from alembic import op


revision = "0017_backfill_second_subject"
down_revision = "0016_event_second_subject"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE validation v
        SET second_subject_id = g.id
        FROM service s
        JOIN gateway g ON g.site_id = s.site_id
        WHERE v.subject_kind = 'service_gateway'
          AND v.subject_id = s.id
          AND v.subject_label = s.name || ' via ' || g.name
          AND v.second_subject_id IS NULL
        """
    )


def downgrade() -> None:
    # Not distinguishable from rows written natively at 0016+, so downgrade
    # is a no-op — leaving the column populated is safe.
    pass
