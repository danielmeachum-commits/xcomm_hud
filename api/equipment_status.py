"""Advisory equipment-derived status.

Read this before wiring equipment into anything that writes.

The rest of the app resolves status by cascade: a gateway status change snaps
its cells (R8/R9/R10 in api/effective.py), a local service change clamps them
(R11). Equipment deliberately does NOT join that cascade. It computes a
*derived* status — the worst status across the capabilities bound to a service
or gateway — and hands it back alongside the reported status for a human to
look at. Nothing here mutates a Service, Gateway, or ServiceGatewayStatus, and
nothing here should ever be called from a write path in effective.py.

Two reasons, both load-bearing:

1. `cell_status_from_gateway` blanks every cell for a gateway to `unvalidated` on
   any status change that isn't `ready`/`down`/`offline`. If equipment drove
   gateway status, a radio flapping between up and degraded would repeatedly
   wipe the operator's entire matrix and demand re-validation of paths nobody
   touched.

2. Every status in this system is attributed — `validated_by_user_id` records
   who is accountable for the claim "this path works". Silently replacing that
   with a machine-derived value destroys the provenance the model exists to
   keep.

So the contract is: we show `reported` and `derived` side by side, badge the
disagreement, and let the operator apply it through the normal validation
endpoint under their own name. A seeded rule
(`equipment.derived.disagreement`) additionally drops a warning on the feed so
a quiet disagreement doesn't sit unnoticed.

If a true cascade is ever wanted, it belongs in rules_engine.py as an action —
not here, and not as a schema change.

This module is deliberately separate from effective.py so that the import
graph makes the boundary obvious: effective.py never imports this.
"""

from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session

from models import (
    CapabilityGatewayLink,
    CapabilityServiceLink,
    DeliveryGatewayDependency,
    Equipment,
    EquipmentCapability,
)

# Worst-of ordering for equipment. Higher rank = worse. `maintenance` sits
# between `degraded` and `down`: gear that is deliberately off the line is
# worse than gear limping along, but it isn't a failure. `unvalidated` is exempt
# from ordering entirely — it means "no information", not "worst case" —
# which mirrors how effective.STATUS_RANK treats it.
EQUIPMENT_STATUS_RANK: dict[str, int] = {
    "up": 1,
    "degraded": 2,
    "maintenance": 3,
    "down": 4,
    "offline": 5,
}

# How a reported service/gateway status compares to a derived equipment
# status. Both vocabularies are mapped onto one scale so `disagrees` can be
# computed without pretending "active" and "up" are different things.
_REPORTED_RANK: dict[str, int] = {
    "up": 1,
    "active": 1,
    "ready": 2,
    "degraded": 3,
    "setup": 4,
    "maintenance": 4,
    "down": 5,
    "offline": 6,
}


def _rank(status: str) -> int:
    """Rank an equipment status; unranked (i.e. `unvalidated`) sorts as 0."""
    return EQUIPMENT_STATUS_RANK.get(status, 0)


def worst_status(statuses: Iterable[str]) -> Optional[str]:
    """Worst of the given equipment statuses, ignoring `unvalidated`.

    Returns None when there is nothing to say — no capabilities at all, or
    every one of them `unvalidated`. None means "no opinion", and the UI renders
    that as no advisory rather than as a problem.
    """
    worst: Optional[str] = None
    for status in statuses:
        if _rank(status) == 0:
            continue
        if worst is None or _rank(status) > _rank(worst):
            worst = status
    return worst


def disagrees(reported: str, derived: Optional[str]) -> bool:
    """True when the equipment says things are meaningfully worse.

    One-directional on purpose. Equipment looking *better* than the reported
    status is not a disagreement worth flagging: an operator may have marked a
    service down for a reason the equipment tier cannot see (a crypto fill
    that never happened, a frequency deconfliction, a customer outage
    upstream). Flagging that would train people to ignore the badge.
    """
    if derived is None:
        return False
    if reported not in _REPORTED_RANK:
        return False
    derived_as_reported = _REPORTED_RANK.get(derived)
    if derived_as_reported is None:
        return False
    return derived_as_reported > _REPORTED_RANK[reported]


def load_backing_for_services(
    db: Session, service_ids: list[int]
) -> dict[int, list[dict]]:
    """`{service_id: [backing capability dicts]}` in one query.

    Bulk-loaded rather than per-service because the site detail page and the
    topology bundle both need every service at once; an N+1 here would be felt
    immediately on a site with a full FCP.
    """
    if not service_ids:
        return {}
    rows = (
        db.query(CapabilityServiceLink, EquipmentCapability, Equipment)
        .join(
            EquipmentCapability,
            EquipmentCapability.id == CapabilityServiceLink.equipment_capability_id,
        )
        .join(Equipment, Equipment.id == EquipmentCapability.equipment_id)
        .filter(CapabilityServiceLink.service_delivery_id.in_(service_ids))
        .all()
    )
    # Which capabilities does each delivery already reach through a declared
    # gateway dependency? Those must not ALSO count directly — see
    # _shadowed_capabilities for why this is a correctness fix and not tidying.
    shadowed = _shadowed_capabilities(db, service_ids)
    out: dict[int, list[dict]] = {}
    for link, capability, equipment in rows:
        delivery_id = link.service_delivery_id
        out.setdefault(delivery_id, []).append(
            {
                "capability_id": capability.id,
                "equipment_id": equipment.id,
                "equipment_code": equipment.equipment_code,
                "label": capability.label,
                "kind": capability.kind,
                "status": capability.status,
                # Where the gear physically is. A capability backing a
                # delivery from ANOTHER site is the signature of an extension
                # — the far end of a shot backing the near end's service —
                # and the site matrix reads this to show that reach.
                "site_id": equipment.site_id,
                "role": link.role,
                "required": link.required,
                "group_key": link.group_key,
                "superseded_by_gateway_id": shadowed.get(delivery_id, {}).get(
                    capability.id
                ),
            }
        )
    return out


def _shadowed_capabilities(
    db: Session, service_ids: list[int]
) -> dict[int, dict[int, int]]:
    """`{delivery_id: {capability_id: gateway_id}}` — the §7 double count.

    A capability that backs a gateway a delivery depends on is already
    accounted for at that gateway. Counting it a second time directly against
    the delivery was harmless under whole-set worst-of, which is idempotent,
    but redundancy groups made it a real bug: the shared radio lands in two
    groups, best-of clears each one independently, and the chain claims two
    resilient paths where one component sits under both.

    So the direct binding loses its vote and keeps its visibility. It stays in
    `backing` carrying the gateway that took over, which is the honest thing to
    show an operator — the dependency did not disappear, it moved up a level.
    """
    if not service_ids:
        return {}
    rows = (
        db.query(
            DeliveryGatewayDependency.service_delivery_id,
            CapabilityGatewayLink.equipment_capability_id,
            CapabilityGatewayLink.gateway_id,
        )
        .join(
            CapabilityGatewayLink,
            CapabilityGatewayLink.gateway_id == DeliveryGatewayDependency.gateway_id,
        )
        .filter(DeliveryGatewayDependency.service_delivery_id.in_(service_ids))
        .all()
    )
    out: dict[int, dict[int, int]] = {}
    for delivery_id, capability_id, gateway_id in rows:
        # First gateway wins if a capability somehow backs two depended-on
        # gateways. Which one is arbitrary; that it is counted once is not.
        out.setdefault(delivery_id, {}).setdefault(capability_id, gateway_id)
    return out


# Gateways speak active/ready/…, equipment speaks up/degraded/…. The chain is
# computed entirely in equipment vocabulary, so a gateway dependency has to be
# translated on the way in. The design doc flagged moving this mapping
# server-side as a correctness concern rather than a display convenience;
# this is that move for the dependency direction.
#
# `ready` → `up` is the one real judgment call. A gateway on PACE standby is a
# path that works and simply isn't carrying traffic, and treating it as
# anything worse defeats the case redundancy groups exist for: "Primary ISP or
# Sat Phone", primary down, sat phone ready, should read as a live alternate
# rather than an outage. `setup` → `maintenance` because both mean
# deliberately off the line, which is also how _REPORTED_RANK already scores
# them (both 4).
_GATEWAY_TO_EQUIPMENT: dict[str, str] = {
    "active": "up",
    "ready": "up",
    "degraded": "degraded",
    "setup": "maintenance",
    "down": "down",
    "offline": "offline",
}


def load_gateway_backing_for_services(
    db: Session, service_ids: list[int]
) -> dict[int, list[dict]]:
    """`{delivery_id: [backing gateway dicts]}` — the §7 dependency edge.

    Each depended-on gateway contributes its OWN capability-derived value when
    it has one, and its reported status mapped into equipment vocabulary when
    it does not. The fallback is what makes the feature useful on day one:
    almost no gateway has capabilities bound to it yet, and a dependency that
    contributed nothing until someone wired up the gear would be inert.

    One level deep, always. Gateways depend on capabilities, never on other
    gateways, so this never recurses and the chain cannot cycle.
    """
    if not service_ids:
        return {}
    from models import Gateway  # local: avoid an import cycle

    deps = (
        db.query(DeliveryGatewayDependency, Gateway)
        .join(Gateway, Gateway.id == DeliveryGatewayDependency.gateway_id)
        .filter(DeliveryGatewayDependency.service_delivery_id.in_(service_ids))
        .all()
    )
    if not deps:
        return {}

    # Resolve every depended-on gateway's own chain in one pass, rather than
    # per delivery — a site's deliveries mostly point at the same few gateways.
    gateway_ids = sorted({gw.id for _dep, gw in deps})
    gateway_backing = load_backing_for_gateways(db, gateway_ids)

    out: dict[int, list[dict]] = {}
    for dep, gateway in deps:
        from_chain = build_derived(
            gateway.status, gateway_backing.get(gateway.id, [])
        )["derived"]
        contributed = from_chain or _GATEWAY_TO_EQUIPMENT.get(gateway.status)
        out.setdefault(dep.service_delivery_id, []).append(
            {
                "gateway_id": gateway.id,
                "name": gateway.name,
                "pace": gateway.pace,
                "reported_status": gateway.status,
                "contributed_status": contributed,
                "from_chain": from_chain is not None,
                "required": dep.required,
                "group_key": dep.group_key,
            }
        )
    return out


def load_backing_for_gateways(
    db: Session, gateway_ids: list[int]
) -> dict[int, list[dict]]:
    """`{gateway_id: [backing capability dicts]}` in one query."""
    if not gateway_ids:
        return {}
    rows = (
        db.query(CapabilityGatewayLink, EquipmentCapability, Equipment)
        .join(
            EquipmentCapability,
            EquipmentCapability.id == CapabilityGatewayLink.equipment_capability_id,
        )
        .join(Equipment, Equipment.id == EquipmentCapability.equipment_id)
        .filter(CapabilityGatewayLink.gateway_id.in_(gateway_ids))
        .all()
    )
    out: dict[int, list[dict]] = {}
    for link, capability, equipment in rows:
        out.setdefault(link.gateway_id, []).append(
            {
                "capability_id": capability.id,
                "equipment_id": equipment.id,
                "equipment_code": equipment.equipment_code,
                "label": capability.label,
                "kind": capability.kind,
                "status": capability.status,
                "site_id": equipment.site_id,
                "role": None,
            }
        )
    return out


def best_status(statuses: Iterable[str]) -> Optional[str]:
    """Best of the given equipment statuses, ignoring `unvalidated`.

    The OR half of the dependency chain: within a redundancy group, one live
    path is enough. Returns None when the group has no opinion at all.
    """
    best: Optional[str] = None
    for status in statuses:
        if _rank(status) == 0:
            continue
        if best is None or _rank(status) < _rank(best):
            best = status
    return best


def gates(item: dict) -> bool:
    """Does this backing item actually move the number?

    Two ways to be present without voting. Not `required` — the binding is
    context, and saying "this is related" must never be the same act as saying
    "this must be up". Or superseded — the capability backs a gateway this
    delivery already depends on, so its vote is cast there instead; counting it
    here as well is the §7 double count.
    """
    return bool(item.get("required")) and item.get("superseded_by_gateway_id") is None


def derive_from_chain(
    backing: list[dict], gateway_backing: Optional[list[dict]] = None
) -> Optional[str]:
    """Worst-of across groups, best-of within a group.

    Only `required` bindings gate. Everything else stays in `backing` for the
    operator to see but never moves the number — binding a capability to say
    "this is related" must not be the same act as saying "this must be up".

    Grouping is what makes the checkbox safe. Two radios on one shot get the
    same `group_key`, so losing one is degraded rather than down; a bare
    boolean would have reported down and taught people to ignore the badge.
    A null key means the binding is its own group, which is the common case.

    Gateway dependencies (§7) join the same group namespace, so a group can mix
    "this radio" with "the Starlink path" and still mean one live member is
    enough. They contribute an already-translated equipment status — see
    `load_gateway_backing_for_services`.

    Returns None when nothing required has anything to say — the caller
    renders that as no opinion rather than as a problem.
    """
    groups: dict[object, list[str]] = {}
    for index, item in enumerate(backing):
        if not gates(item):
            continue
        # Null key → its own group, keyed by position so it cannot collide
        # with a real group name.
        key = item.get("group_key") or ("__solo__", index)
        groups.setdefault(key, []).append(item["status"])
    for index, item in enumerate(gateway_backing or []):
        if not item.get("required"):
            continue
        status = item.get("contributed_status")
        if status is None:
            continue
        # Offset the solo key so a gateway and a capability at the same index
        # land in different groups.
        key = item.get("group_key") or ("__solo_gw__", index)
        groups.setdefault(key, []).append(status)
    if not groups:
        return None
    # Each group contributes its BEST (redundancy satisfied by any one member);
    # the service is only as good as its worst group (all groups needed).
    return worst_status(
        status for status in (best_status(v) for v in groups.values()) if status
    )


def build_derived(
    reported: str,
    backing: list[dict],
    gateway_backing: Optional[list[dict]] = None,
) -> dict:
    """Assemble the advisory payload for one service or gateway.

    Shape matches schemas.DerivedStatus.

    Two numbers, deliberately separate. `derived` skips `unvalidated` when
    computing a value — a chain that returned `unvalidated` because one
    capability was never checked would be useless on day one. The hole is
    reported alongside instead, as a count: ignorance is not a status, and
    folding it into the status vocabulary is what produced the carve-outs this
    module and effective.py both had to write.
    """
    gateway_backing = gateway_backing or []
    gated = [b for b in backing if gates(b)]
    gated_gateways = [g for g in gateway_backing if g.get("required")]
    # Fall back to the old whole-set worst-of when nothing has been marked
    # required, so a workspace that never touches the checkboxes keeps exactly
    # the advisory it had before. A superseded binding is excluded even from
    # this fallback: worst-of is idempotent, so it changes no value today, but
    # letting it back in would reintroduce the double count the moment someone
    # ticks a box.
    derived = (
        derive_from_chain(backing, gateway_backing)
        if gated or gated_gateways
        else worst_status(
            item["status"]
            for item in backing
            if item.get("superseded_by_gateway_id") is None
        )
    )
    unvalidated = [b for b in gated if _rank(b["status"]) == 0]
    # A required gateway with nothing to say is a hole in the chain too — it
    # would otherwise vanish silently, which is exactly the failure the
    # unvalidated count exists to prevent.
    silent_gateways = [
        g for g in gated_gateways if g.get("contributed_status") is None
    ]
    return {
        "reported": reported,
        "derived": derived,
        "disagrees": disagrees(reported, derived),
        "backing": backing,
        "backing_gateways": gateway_backing,
        "required_total": len(gated) + len(gated_gateways),
        "required_unvalidated": len(unvalidated) + len(silent_gateways),
        "unvalidated_labels": [
            f"{b['equipment_code']} {b['label']}" for b in unvalidated
        ]
        + [f"{g['name']} (gateway)" for g in silent_gateways],
    }


def derive_utc_role(
    utc_instance_id: int,
    equipment_ids_by_utc: dict[int, set[int]],
    links: list,
) -> Optional[str]:
    """What the link graph says this UTC is, independent of its declared role.

    - `extension` when something outside this UTC feeds into it over a
      directional (`a_to_b`) link.
    - `primary` when it feeds another UTC that way.
    - `independent` when it has cross-UTC links but no directional ones —
      peers, not a hierarchy.
    - None when there are no cross-UTC links at all, i.e. not enough
      information. The UI shows nothing rather than guessing, since a UTC
      whose links simply haven't been entered yet must not read as
      "independent, confirmed".

    A UTC can be fed *and* feed onward (a mid-chain relay); `extension` wins,
    because what matters operationally is that it depends on someone upstream.
    """
    mine = equipment_ids_by_utc.get(utc_instance_id, set())
    if not mine:
        return None

    feeds_in = False
    feeds_out = False
    has_cross_link = False

    for link in links:
        a_mine = link.a_equipment_id in mine
        b_mine = link.b_equipment_id in mine
        if a_mine == b_mine:
            # Wholly internal, or wholly unrelated to this UTC.
            continue
        has_cross_link = True
        if link.direction != "a_to_b":
            continue
        if b_mine:
            feeds_in = True
        else:
            feeds_out = True

    if feeds_in:
        return "extension"
    if feeds_out:
        return "primary"
    if has_cross_link:
        return "independent"
    return None


# ---------- derived mode: resolution and refresh ----------
#
# The module docstring above still holds, with one boundary moved. Its two
# arguments were provenance and cell-blanking. Provenance is answered: every
# equipment_capability carries its own validated_by_user_id, so in derived mode
# accountability moves DOWN a level rather than vanishing, and the binding now
# says which capabilities were declared essential — so the number is a claim
# about a stated dependency, not a guess over whatever happened to be bound.
#
# The cell-blanking argument is untouched and still governs: derived mode must
# never drive the write cascades. `clamp_cells_for_service` mutates stored cell
# rows and `reset_cells_for_gateway` nulls validated_at/validated_by, and those
# run at operator frequency today. Letting equipment drive them would run them
# at flap frequency and wipe the matrix. Derived mode therefore SUPPRESSES the
# cascade rather than triggering it; the pure read-time functions in
# effective.py already apply R10/R11 on display, so nothing is lost. Derived
# mode is the removal of a write path, not the addition of one.


def resolve_status(
    reported: str,
    status_mode: str,
    derived: Optional[str],
    validated_at,
    derived_changed_at,
) -> str:
    """What to actually show for a delivery or gateway.

    In `reported` mode, the human value — unchanged behaviour.

    In `derived` mode the chain wins, except:

    - when it has no opinion (`derived is None`), the reported value stands.
      A service with nothing required bound must not blank itself.
    - when the operator has validated more recently than the derived value last
      moved, their override wins. It lapses the next time the equipment picture
      actually changes, which is what makes "I know the radio reads down, the
      service is fine" a claim about now rather than standing policy.
    """
    if status_mode != "derived" or derived is None:
        return reported
    if validated_at is not None and derived_changed_at is not None:
        if validated_at > derived_changed_at:
            return reported
    return derived


def refresh_derived(db: Session, delivery_ids: list[int], gateway_ids: list[int], now):
    """Recompute stored derived values, stamping when one actually moves.

    Called from the capability write path — the only thing that can move a
    chain. Stamps `derived_changed_at` ONLY on a real change, because that
    timestamp is what an operator override is compared against: touching it on
    every save would expire every override immediately.

    Writes nothing but `derived_status`/`derived_changed_at`. It does not touch
    status, and it does not cascade.
    """
    from models import Gateway, ServiceDelivery  # local: avoid an import cycle

    changed = []
    # Gateways first, so `changed` reads in dependency order. Correctness does
    # not rest on it: load_gateway_backing_for_services recomputes each
    # gateway's chain from its capabilities rather than reading the stored
    # derived_status, so a delivery cannot pick up a stale value either way.
    if gateway_ids:
        backing = load_backing_for_gateways(db, gateway_ids)
        for row in db.query(Gateway).filter(Gateway.id.in_(gateway_ids)):
            value = build_derived(row.status, backing.get(row.id, []))["derived"]
            if value != row.derived_status:
                row.derived_status = value
                row.derived_changed_at = now
                changed.append(("gateway", row.id, value))

    # Pull in every delivery that depends on one of the touched gateways, even
    # if the caller never named it. The capability that was just edited may be
    # bound only to the gateway, and the delivery's dependency is precisely the
    # claim that this should reach it.
    delivery_ids = list(delivery_ids)
    if gateway_ids:
        dependents = (
            db.query(DeliveryGatewayDependency.service_delivery_id)
            .filter(DeliveryGatewayDependency.gateway_id.in_(gateway_ids))
            .distinct()
        )
        seen = set(delivery_ids)
        for (delivery_id,) in dependents:
            if delivery_id not in seen:
                seen.add(delivery_id)
                delivery_ids.append(delivery_id)

    if delivery_ids:
        backing = load_backing_for_services(db, delivery_ids)
        gateway_backing = load_gateway_backing_for_services(db, delivery_ids)
        for row in db.query(ServiceDelivery).filter(
            ServiceDelivery.id.in_(delivery_ids)
        ):
            value = build_derived(
                row.status,
                backing.get(row.id, []),
                gateway_backing.get(row.id, []),
            )["derived"]
            if value != row.derived_status:
                row.derived_status = value
                row.derived_changed_at = now
                changed.append(("delivery", row.id, value))
    return changed
