"""Widen validation.subject_kind for personnel_location events.

The baseline created validation.subject_kind as VARCHAR(16). The personnel
sign-in/out feature writes Event rows with subject_kind="personnel_location"
(18 chars), which overflows the column so every check-in POST fails with
"value too long for type character varying(16)". Widen to 32.

Revision ID: 0021_widen_subject_kind
Revises: 0020_personnel_expected_return
Create Date: 2026-07-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0021_widen_subject_kind"
down_revision = "0020_personnel_expected_return"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "validation",
        "subject_kind",
        existing_type=sa.String(length=16),
        type_=sa.String(length=32),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "validation",
        "subject_kind",
        existing_type=sa.String(length=32),
        type_=sa.String(length=16),
        existing_nullable=False,
    )
