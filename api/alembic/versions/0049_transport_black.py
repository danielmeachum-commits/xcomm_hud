"""Give the transport enclave a color: black.

0047 seeded Transport with no color, on the reading that operators describe it
as the colorless layer everything else rides on. In practice they want it to
render like the others, just in black.

Stored literally as #000000. The UI treats very dark colors as neutral and
renders them from theme tokens rather than the raw hex, so "black" reads as the
foreground color — black on light, near-white on dark — instead of vanishing
against a dark canvas.

Only touches the seeded global row, and only if it is still colorless, so a
workspace that has already picked something keeps it.

Revision ID: 0049_transport_black
Revises: 0048_enclave_tags
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0049_transport_black"
down_revision = "0048_enclave_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE enclave SET color = '#000000'
             WHERE name = 'Transport'
               AND workspace_id IS NULL
               AND color IS NULL
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE enclave SET color = NULL
             WHERE name = 'Transport'
               AND workspace_id IS NULL
               AND color = '#000000'
            """
        )
    )
