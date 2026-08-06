"""Dependency chain on capability bindings, and optional derived status.

Two features that only make sense together.

**The chain.** `capability_service_link` gains `required` and `group_key`.
Required bindings gate the service; everything else stays visible as context
but never moves the number — binding a capability to record "this is related"
must not be the same act as declaring "this must be up".

`group_key` is not optional polish. A bare `required` boolean gives pure AND
semantics, so two radios on one shot would report the service DOWN the moment
either died, when the truth is degraded. That is precisely the cry-wolf
failure the advisory contract in equipment_status.py was written to avoid, so
the checkbox does not ship without a way to say "either of these will do".
Required bindings sharing a key are OR'd (best-of); groups AND together
(worst-of); a null key means the binding is its own group.

`required` defaults to FALSE. Every binding that exists today was made under
the old advisory contract, where binding meant "related", and promoting them
wholesale to hard dependencies would make derived status start firing on gear
nobody ever declared essential.

**Derived mode.** `service_delivery` and `gateway` each gain `status_mode`,
`derived_status` and `derived_changed_at`, independently switchable.

`reported` is unchanged behaviour. `derived` makes the chain's answer the
displayed status. This is only defensible because the chain now carries
intent: a worst-of over whatever happened to be bound was a guess, but a
worst-of over what someone checked off is a claim about a stated dependency.
Provenance survives too — every equipment_capability carries its own
validated_by_user_id, so accountability moves down a level rather than
vanishing.

What derived mode must never do is WRITE. `clamp_cells_for_service` mutates
stored cells and `reset_cells_for_gateway` additionally nulls
validated_at/validated_by; both run at operator frequency today, and letting
equipment drive them would run them at flap frequency and wipe the matrix. So
derived mode SUPPRESSES the cascade instead of triggering it, and the pure
read-time functions in effective.py apply R10/R11 on display exactly as
before. Derived mode is the removal of a write path, not the addition of one.

`derived_status` is stored rather than recomputed on read so that
`derived_changed_at` can be stamped when the value actually moves — detecting
that during a GET would mean writing on a read. It is refreshed on the
capability-validation path, the only thing that can move a chain, and stamped
only on a real change, because that timestamp is what an operator override is
measured against: touching it on every save would expire every override.

Revision ID: 0056_dependency_chain
Revises: 0055_unvalidated_in_jsonb
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0056_dependency_chain"
down_revision = "0055_unvalidated_in_jsonb"
branch_labels = None
depends_on = None

_DERIVED_TABLES = ("service_delivery", "gateway")


def upgrade() -> None:
    op.add_column(
        "capability_service_link",
        sa.Column(
            "required", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "capability_service_link", sa.Column("group_key", sa.String(48), nullable=True)
    )
    # Partial: only required bindings are ever grouped, and the index exists to
    # make "everything gating this delivery" cheap.
    op.create_index(
        "ix_capability_service_link_required",
        "capability_service_link",
        ["service_delivery_id"],
        postgresql_where=sa.text("required"),
    )

    for table in _DERIVED_TABLES:
        op.add_column(
            table,
            sa.Column(
                "status_mode",
                sa.String(16),
                nullable=False,
                server_default="reported",
            ),
        )
        op.add_column(table, sa.Column("derived_status", sa.String(16), nullable=True))
        op.add_column(
            table,
            sa.Column("derived_changed_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    for table in _DERIVED_TABLES:
        op.drop_column(table, "derived_changed_at")
        op.drop_column(table, "derived_status")
        op.drop_column(table, "status_mode")

    op.drop_index(
        "ix_capability_service_link_required", table_name="capability_service_link"
    )
    op.drop_column("capability_service_link", "group_key")
    op.drop_column("capability_service_link", "required")
