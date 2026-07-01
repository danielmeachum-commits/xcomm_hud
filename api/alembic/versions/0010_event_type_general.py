"""Generalize the events table beyond validations.

Adds:
  - event_type: high-level bucket (validation | general). Backfilled to
    'validation' for all existing rows.
  - subject_label: free-text subject for kinds that do not resolve to a DB row
    (system / mission / exercise).

Loosens:
  - status: was NOT NULL — now NULL is allowed so an event can be a pure note
    without recording a state change.
  - subject_id: was NOT NULL — now NULL is allowed for subject-less events
    (again, for the free-text kinds).

Revision ID: 0010_event_type_general
Revises: 0009_validation_edit_hide
Create Date: 2026-07-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0010_event_type_general"
down_revision = "0009_validation_edit_hide"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "validation",
        sa.Column(
            "event_type",
            sa.String(length=16),
            nullable=False,
            server_default="validation",
        ),
    )
    op.add_column(
        "validation",
        sa.Column("subject_label", sa.Text(), nullable=True),
    )
    op.alter_column("validation", "status", existing_type=sa.String(length=16), nullable=True)
    op.alter_column("validation", "subject_id", existing_type=sa.BigInteger(), nullable=True)


def downgrade() -> None:
    op.alter_column("validation", "subject_id", existing_type=sa.BigInteger(), nullable=False)
    op.alter_column("validation", "status", existing_type=sa.String(length=16), nullable=False)
    op.drop_column("validation", "subject_label")
    op.drop_column("validation", "event_type")
