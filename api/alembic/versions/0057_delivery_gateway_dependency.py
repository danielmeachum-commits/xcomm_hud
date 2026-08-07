"""Delivery → gateway dependency, closing the §7 double count.

A capability can bind to both a delivery (`capability_service_link`) and a
gateway (`capability_gateway_link`). That is correct and needs no schema
change — a satcom terminal really is both transport and endpoint. The bug is
what the delivery then does with it: the same radio was counted twice, once
directly against the delivery and once through the gateway.

Under the old whole-set worst-of that was harmless, because worst-of is
idempotent — counting a `degraded` radio twice still yields `degraded`. Under
the redundancy groups added in 0056 it is a live correctness bug. Two groups
that each contain the shared radio look like two independent paths, so best-of
within each group succeeds and the model reports resilience that does not
exist. The whole value of a redundancy group is the claim that its members can
fail independently.

The fix is to let a delivery depend on the GATEWAY rather than reaching past it
to the equipment. `load_backing_for_services` then suppresses any direct
capability binding whose capability also backs a depended-on gateway: the
shared radio is counted exactly once, at the gateway, and the delivery's own
groups go back to being independent.

Structurally this is the doc's observation that a gateway is just a delivery of
a Transport-enclave service. Collapsing Gateway into Service outright is
explicitly out of scope — `gateway.pace` and the service_gateway_status matrix
are load-bearing UI — so this expresses the relationship without the merge.

Two concrete tables over one polymorphic `(target_kind, target_id)`, following
the choice recorded on CapabilityServiceLink: real FKs and real cascades.
`capability_service_link` is the capability half and already carries
`required`/`group_key`, so it is NOT renamed here — the rename the design doc
sketched would have churned every call site for no behavioural gain.

`required` defaults TRUE, the opposite of 0056's column. That one had to
default false because it was added to rows that already existed under the old
advisory contract. This table starts empty, so every row is someone
deliberately saying "this delivery needs this path" and there is no
low-commitment reading to protect.

Revision ID: 0057_delivery_gateway_dependency
Revises: 0056_dependency_chain
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0057_delivery_gateway_dependency"
down_revision = "0056_dependency_chain"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "delivery_gateway_dependency",
        sa.Column("service_delivery_id", sa.BigInteger(), nullable=False),
        sa.Column("gateway_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "required", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("group_key", sa.String(48), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["service_delivery_id"], ["service_delivery.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["gateway_id"], ["gateway.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("service_delivery_id", "gateway_id"),
    )
    # The reverse direction: "which deliveries does this gateway gate?" is what
    # the refresh path needs when a gateway's own chain moves.
    op.create_index(
        "ix_delivery_gateway_dependency_gateway",
        "delivery_gateway_dependency",
        ["gateway_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_delivery_gateway_dependency_gateway",
        table_name="delivery_gateway_dependency",
    )
    op.drop_table("delivery_gateway_dependency")
