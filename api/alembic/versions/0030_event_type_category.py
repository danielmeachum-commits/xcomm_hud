"""Add category grouping to the event-type catalog.

Grouping by workspace-vs-builtin proved too coarse — exercise lifecycle
types were clumped in with briefs and notes. `category` is a free-form
group name ("Exercise", "Briefing", ...) used by the type pickers and the
management page; null renders under "Other".

Revision ID: 0030_event_type_category
Revises: 0029_event_classification
Create Date: 2026-07-08
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0030_event_type_category"
down_revision = "0029_event_classification"
branch_labels = None
depends_on = None

_SEED_CATEGORIES = [
    ("exercise.%", "Exercise"),
    ("brief.%", "Briefing"),
    ("note.%", "General"),
]


def upgrade() -> None:
    op.add_column(
        "event_type_def",
        sa.Column("category", sa.String(48), nullable=True),
    )
    for pattern, category in _SEED_CATEGORIES:
        op.execute(
            sa.text(
                "UPDATE event_type_def SET category = :cat "
                "WHERE slug LIKE :pattern AND category IS NULL"
            ).bindparams(cat=category, pattern=pattern)
        )


def downgrade() -> None:
    op.drop_column("event_type_def", "category")
