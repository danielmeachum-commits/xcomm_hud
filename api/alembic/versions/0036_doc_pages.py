"""Documentation pages: in-app authored markdown stored in Postgres.

Pages are global (workspace_id NULL, shared across every workspace) or
workspace-scoped; a workspace page shadows a global with the same slug. The
nav tree lives in parent_id + display_order. Seeds two global starter pages so
the docs area isn't empty on first run.

Revision ID: 0036_doc_pages
Revises: 0035_document_versions
Create Date: 2026-07-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0036_doc_pages"
down_revision = "0035_document_versions"
branch_labels = None
depends_on = None


_WELCOME = """\
Welcome to the **xCOMM HUD** documentation. These pages live inside the app and
are gated behind the same sign-in as the rest of the HUD — if you can read this,
you're authenticated.

## What lives here

Operator- and admin-facing reference material: how the hub aggregates status
across sites and services, how events and documents work, and the day-to-day
workflows the HUD supports.

## Editing docs

Documentation is stored in the database and edited **in the app** — no files, no
redeploy. Anyone with the operator or admin role can open a page, click **Edit**,
and write markdown with a live preview beside them. Pages can be shared across
every workspace (global) or scoped to a single workspace.

See [Getting Started](getting-started) for the authoring workflow.
"""

_GETTING_STARTED = """\
Documentation pages are written in **Markdown** and edited directly in the app.
Open any page and press **Edit**, or create a new page from the docs sidebar.

## The editor

The editor is a split view: markdown on the left, a live rendered preview on the
right. As you type, the preview updates so you can see exactly how the page will
look — no need to know markdown by heart.

## Markdown basics

| You write | You get |
| --- | --- |
| `# Heading` | A section heading |
| `**bold**` | **bold** |
| `- item` | A bullet list |
| `[text](url)` | A link |
| `` `code` `` | inline `code` |

Fenced code blocks are syntax-highlighted:

```python
def hello():
    return "world"
```

## Organizing pages

Each page has a **title**, a **slug** (its URL), and an optional **parent** so
you can group related pages in the sidebar. Set a **scope** of *This workspace*
for procedures specific to one workspace, or *Global* for shared reference that
should appear everywhere.
"""


def upgrade() -> None:
    op.create_table(
        "doc_page",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("parent_id", sa.BigInteger(), nullable=True),
        sa.Column("slug", sa.String(160), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "display_order", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            ondelete="CASCADE",
            name="fk_doc_page_workspace",
        ),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["doc_page.id"],
            ondelete="SET NULL",
            name="fk_doc_page_parent",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["user.id"],
            ondelete="SET NULL",
            name="fk_doc_page_created_by",
        ),
        sa.UniqueConstraint("workspace_id", "slug", name="uq_doc_page_ws_slug"),
    )
    op.create_index("ix_doc_page_workspace_id", "doc_page", ["workspace_id"])
    # Postgres treats NULLs as distinct, so the unique constraint above does not
    # prevent duplicate global slugs — enforce those with a partial index.
    op.create_index(
        "uq_doc_page_global_slug",
        "doc_page",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )

    doc_page = sa.table(
        "doc_page",
        sa.column("workspace_id", sa.BigInteger),
        sa.column("parent_id", sa.BigInteger),
        sa.column("slug", sa.String),
        sa.column("title", sa.String),
        sa.column("description", sa.Text),
        sa.column("content", sa.Text),
        sa.column("display_order", sa.Integer),
    )
    op.bulk_insert(
        doc_page,
        [
            {
                "workspace_id": None,
                "parent_id": None,
                "slug": "index",
                "title": "xCOMM HUD Documentation",
                "description": "Overview of the in-app documentation.",
                "content": _WELCOME,
                "display_order": 0,
            },
            {
                "workspace_id": None,
                "parent_id": None,
                "slug": "getting-started",
                "title": "Getting Started",
                "description": "How to author and organize documentation pages.",
                "content": _GETTING_STARTED,
                "display_order": 1,
            },
        ],
    )


def downgrade() -> None:
    op.drop_index("uq_doc_page_global_slug", table_name="doc_page")
    op.drop_index("ix_doc_page_workspace_id", table_name="doc_page")
    op.drop_table("doc_page")
