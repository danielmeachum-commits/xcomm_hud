"""Rename the `unknown` status seed to `unvalidated`.

`unknown` meant two things that behave differently: "nobody has said anything
yet" (the seed every new row and cell gets) and "we looked and can't tell" (an
actual assessment). Only the first has ever existed in this system, and the
code says so in six places — every rank table and clamp in effective.py carves
it out because it carries no ordering and constrains nothing. Two separate
rank tables wrote that carve-out independently. The name now matches what the
value has always meant, and the exemptions read as self-evident rather than
arguable.

Nothing here expresses "assessed, inconclusive". If that is ever wanted it is
a NEW value, not this one reinterpreted.

Three things this migration is careful about:

1. **Personnel keep `unknown`.** PersonnelStatusValue's `unknown` means the
   person has never signed in — a fact about a human's whereabouts, not an
   unvalidated assessment. It shares nothing with this value but the English
   word. The `validation` rewrite is therefore filtered by subject_kind, or it
   would relabel 25 personnel history rows with something false.

2. **Gateways get `ready`, not `unvalidated`.** GATEWAY_STATUS_VALUES has
   never contained a seed value; a gateway's "nothing said yet" is PACE
   standby — available, not carrying. The `gateway.status` column nonetheless
   defaulted to `'unknown'`, a value its own output schema rejects. No row
   ever reached it (the API always supplies a status) but a direct insert
   would have written a row that fails on read. Fixed here rather than left.

3. **History is relabelled, not deleted.** `validation` rows record what a
   status was at a point in time. Since this renames a value to a new label
   for the same concept, rewriting them is faithful; deleting them would
   destroy an audit trail whose entire purpose is attribution.

Revision ID: 0053_unvalidated_status
Revises: 0052_enclave_classification
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0053_unvalidated_status"
down_revision = "0052_enclave_classification"
branch_labels = None
depends_on = None


# Tables whose `status` column carries the seed value.
_STATUS_TABLES = (
    "service",
    "service_gateway_status",
    "equipment",
    "equipment_capability",
    "equipment_link",
)

# Event subject kinds whose `unknown` is the status seed. Anything else —
# personnel_location above all — keeps its own meaning.
_PERSONNEL_KIND = "personnel_location"


def upgrade() -> None:
    for table in _STATUS_TABLES:
        op.execute(
            sa.text(
                f"UPDATE {table} SET status = 'unvalidated' "  # noqa: S608 - fixed list
                "WHERE status = 'unknown'"
            )
        )
        op.alter_column(table, "status", server_default="unvalidated")

    # See note 2. Any row that somehow holds the impossible value becomes the
    # gateway equivalent of "nothing said yet".
    op.execute(
        sa.text("UPDATE gateway SET status = 'ready' WHERE status = 'unknown'")
    )
    op.alter_column("gateway", "status", server_default="ready")

    # See notes 1 and 3.
    for column in ("status", "prev_status"):
        op.execute(
            sa.text(
                f"UPDATE validation SET {column} = 'unvalidated' "  # noqa: S608
                f"WHERE {column} = 'unknown' AND subject_kind <> :personnel"
            ).bindparams(personnel=_PERSONNEL_KIND)
        )


def downgrade() -> None:
    # Safe without a subject_kind filter in either direction: personnel never
    # held `unvalidated`, so nothing of theirs is caught going back.
    for column in ("status", "prev_status"):
        op.execute(
            sa.text(
                f"UPDATE validation SET {column} = 'unknown' "  # noqa: S608
                f"WHERE {column} = 'unvalidated'"
            )
        )

    op.alter_column("gateway", "status", server_default="unknown")

    for table in _STATUS_TABLES:
        op.alter_column(table, "status", server_default="unknown")
        op.execute(
            sa.text(
                f"UPDATE {table} SET status = 'unknown' "  # noqa: S608
                "WHERE status = 'unvalidated'"
            )
        )
