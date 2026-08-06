"""Finish the `unknown` → `unvalidated` rename inside JSONB payloads.

0053 renamed the value everywhere it lived in a `status` COLUMN and missed
every place it lived inside JSON. Three of them, found when the post-0054
verification tried to serialize a rollup:

1. `service_template.allowed_statuses` — a JSONB array of status values.
   This one failed loudly: ServiceRollup rejects `'unknown'` now, so any
   service built from one of the three affected templates blew up
   `/status/rollup` with a literal_error. Loud is the good case.

2. `rule.conditions` — two rules match on
   `prev_status in ["down", "offline", "unknown"]`. These fail SILENTLY: no
   error, the rule simply stops firing for a transition it was written to
   catch, and the feed quietly loses the "came back up from unvalidated"
   notice nobody would think to go looking for.

3. `rule.computed` — three severity expressions branch on
   `new_status in ["degraded", "unknown"]`. Also silent, and worse than a
   missing row: a transition into unvalidated would be scored `info` by the
   fallback instead of `warning`.

Scoped by trigger rather than rewritten blindly. `personnel.location_changed`
rules are excluded because PersonnelStatusValue keeps its own `unknown`
("never signed in"), and a blanket text replace would have silently rewritten
a rule about people into one about equipment. No personnel rule holds the
value today; the filter is there so that stays true if one is added before
this migration runs somewhere else.

Revision ID: 0055_unvalidated_in_jsonb
Revises: 0054_service_delivery_split
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0055_unvalidated_in_jsonb"
down_revision = "0054_service_delivery_split"
branch_labels = None
depends_on = None

# Everything except personnel — see the module docstring.
_EXCLUDED_TRIGGER = "personnel.location_changed"


def _swap(old: str, new: str) -> None:
    op.execute(
        sa.text(
            "UPDATE service_template "
            "SET allowed_statuses = replace(allowed_statuses::text, :old, :new)::jsonb "
            "WHERE allowed_statuses::text LIKE :like"
        ).bindparams(old=f'"{old}"', new=f'"{new}"', like=f'%"{old}"%')
    )
    for column in ("conditions", "computed"):
        op.execute(
            sa.text(
                f"UPDATE rule SET {column} = "  # noqa: S608 - fixed column list
                f"replace({column}::text, :old, :new)::jsonb "
                f"WHERE {column}::text LIKE :like AND trigger <> :excluded"
            ).bindparams(
                old=f'"{old}"',
                new=f'"{new}"',
                like=f'%"{old}"%',
                excluded=_EXCLUDED_TRIGGER,
            )
        )


def upgrade() -> None:
    _swap("unknown", "unvalidated")


def downgrade() -> None:
    _swap("unvalidated", "unknown")
