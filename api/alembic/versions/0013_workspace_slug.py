"""Add slug column to workspace for URL routing.

Slugs are lowercased, hyphenated derivatives of the workspace name; unique
per instance and frozen after creation. Existing rows are backfilled from
their current name — the default "Garrison" workspace becomes "garrison".

Revision ID: 0013_workspace_slug
Revises: 0012_workspaces
Create Date: 2026-07-01
"""

from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op


revision = "0013_workspace_slug"
down_revision = "0012_workspaces"
branch_labels = None
depends_on = None


_SLUGIFY_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    s = _SLUGIFY_RE.sub("-", text.lower()).strip("-")
    return (s[:64].rstrip("-") or "workspace")


def upgrade() -> None:
    op.add_column(
        "workspace",
        sa.Column("slug", sa.String(160), nullable=True),
    )

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, name FROM workspace ORDER BY id")).all()
    seen: set[str] = set()
    for row_id, name in rows:
        base = _slugify(name)
        candidate = base
        n = 2
        while candidate in seen:
            candidate = f"{base}-{n}"
            n += 1
        seen.add(candidate)
        conn.execute(
            sa.text("UPDATE workspace SET slug = :slug WHERE id = :id").bindparams(
                slug=candidate, id=row_id
            )
        )

    op.alter_column("workspace", "slug", nullable=False)
    op.create_unique_constraint("uq_workspace_slug", "workspace", ["slug"])


def downgrade() -> None:
    op.drop_constraint("uq_workspace_slug", "workspace", type_="unique")
    op.drop_column("workspace", "slug")
