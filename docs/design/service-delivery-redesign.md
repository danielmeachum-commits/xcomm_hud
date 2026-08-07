# Service / ServiceDelivery redesign

Status: **largely built**. §1–§5 and §8 shipped in migrations 0054–0056; §6 was
decided (both options, see the DECIDED note there) and shipped in 0053+0055.
§7 — gateway dependency targets, and with it the shared-component double count —
is the one substantive piece still open. See "Still open" under §3b.

This doc covers the model change only. The link editor (step 1) and the
UTC/site decoupling (step 2) are prerequisites that need no schema change and
are tracked in §9.

---

## 1. Problem statement

`Service.site_id` is `NOT NULL` (`api/models.py:296`) and is the service's only
identity. There is no uniqueness constraint on the table at all — `Gateway` has
`uq_gateway_site_name` (`api/models.py:345`) but `Service` has no
`__table_args__`, and `create_service` (`api/routers/services.py:128`) performs
no duplicate check.

That single column conflates *what a service is* with *where you can get it*,
and produces all three observed symptoms:

**Equipment serving multiple sites has nowhere to bind.** A capability binds to
a service through `CapabilityServiceLink` (`api/models.py:2049`), and a service
lives at exactly one site. The far end of an RF shot can only be represented by
minting a second, unrelated service row at the far site.

**Extensions have to be modeled as their own UTC.** `UtcInstance.site_id` is
`NOT NULL` (`api/models.py:1793`), so the only site handle the deploy wizard
has is the UTC's. Gear at the far end needs a site, so it needs its own UTC.

**Two sites' "NIPR Web" are unrelated rows.** Nothing can answer "is NIPR up
anywhere" or "what breaks if this shot drops" without heuristics over names.

Note this is *not* what `move_service` (`api/routers/services.py:283`) does —
that is a `display_order` swap within a site's lane, not a relocation. There is
currently no way to move a service between sites at all.

---

## 2. Target model

Split identity from delivery:

```
Service          (workspace_id, enclave_id, name)        -- "NIPR Web", one row
  └ ServiceDelivery (service_id, site_id, status, ...)   -- one per site it reaches
```

Today's `service` table *is* the delivery table; it gets renamed and a thin
identity table is minted above it.

### Column assignment

This is not a free choice — several columns are load-bearing per-site and must
stay on the delivery.

| Column | Lands on | Why |
|---|---|---|
| `name`, `kind`, `category`, `icon`, `description` | `Service` | Identity. Same everywhere. |
| `enclave_id` | `Service` | Part of identity (see grouping key, §8). |
| `service_template_id` | `Service` | Catalog provenance. |
| `enabled_pace` | **`ServiceDelivery`** | Drives `relevant_gateways` (`api/effective.py:92`) and `materialize_cells` (`api/effective.py:281`). Gateways are per-site, so PACE fan-out is per-site. |
| `reach` | **`ServiceDelivery`** | Drives canvas lane layout per site (`api/routers/canvas.py:54`). A service can be local at its source site and external at an extension. |
| `display_order` | **`ServiceDelivery`** | Ordering is within a site's list. |
| `status`, `validated_at`, `validated_by_user_id`, `notes` | **`ServiceDelivery`** | The per-site claim. |

New on `ServiceDelivery`:

- `source: Literal["local", "extended"]` — is this site the origin, or is it
  reached over a link from elsewhere.
- `status_mode`, `derived_changed_at` — see §4, §5.

`CapabilityServiceLink.service_id` repoints to `service_delivery.id`. This is
the change that makes the far-end binding expressible: Site B's delivery of
NIPR Web is backed by the far-end RFK plus the local switch, while Site A's is
backed by the source gear.

### Enclave stays a tag

`Enclave` remains workspace-global and hierarchical (`api/models.py:1350`). It
does **not** become a containment level under `Site`. The model's own docstring
is explicit that it is a tag, and a network spanning sites is the entire point
of it — making enclaves per-site would require duplicate enclave rows and would
destroy "SIPR is one thing."

**Sites → Enclaves → Services → Equipment is a navigation projection**, computed
over `(delivery.site_id, service.enclave_id, service, bindings)`. It is a view
shape, not a schema hierarchy.

---

## 3. Dependency chain — SHIPPED (0056)

Two columns on the binding:

```
required:  bool         -- does this gate the service at all
group_key: str | null   -- bindings sharing a key are OR'd (best-of)
```

Evaluation: groups AND together (worst-of across groups); within a group,
best-of. A null `group_key` means the binding is its own group. Non-required
bindings still appear in `DerivedStatus.backing` (`api/schemas.py:2240`) but
never move the derived value — they are context, not gates.

### Why the boolean alone is insufficient

`worst_status()` (`api/equipment_status.py:85`) is worst-of across everything
bound. A bare `required` flag keeps that, giving pure AND semantics. Two radios
on the same shot: one dies, and the service reports **down** when the truth is
**degraded**.

That is precisely the failure the advisory contract was built to avoid — the
`disagrees()` docstring (`api/equipment_status.py:101`) already reasons about
not training people to ignore the badge. A status that goes red on every
single-radio failure in a redundant pair gets muted within a week.

`group_key` buys PACE-style redundancy for one nullable column and no new table.

---

## 4. Derived status — SHIPPED (0056)

Add `status_mode: Literal["reported", "derived"]` to `ServiceDelivery` **and**
to `Gateway`, independently switchable. Per-row, not global — some deliveries
have a complete required set and some never will.

### The critical constraint: derived mode skips the write cascades

`clamp_cells_for_service` (`api/effective.py:237`) and
`reset_cells_for_gateway` (`api/effective.py:203`) **mutate stored cell rows**.
`reset_cells_for_gateway` goes further and nulls `validated_at` /
`validated_by_user_id` (`api/effective.py:248-249`).

Today both fire only from validation endpoints — `services.py:250` and
`gateways.py:181` — which is human action at human frequency. If local service
status became derived, that cascade would start firing at **equipment-flap
frequency**. A radio oscillating degraded→up→degraded would repeatedly clamp
cells and, on the gateway side, blank the operator's entire matrix and destroy
their validations.

So the rule is:

> **In derived mode, the write cascade does not run.** Read-time R10/R11 does
> the work instead.

`effective_cell_status` (`api/effective.py:73`) and
`_cell_contribution_to_rollup` (`api/effective.py:100`) are pure functions that
already apply R10/R11 correctly on display without touching the database. The
cascade helpers are write-time duplicates that exist to make the stored value
match. In derived mode we simply stop writing and let the read-time clamp
apply.

This makes derived mode **the removal of a write path, not a new pipeline** —
strictly safer than what runs today, and much less to audit.

The mechanism already exists: both validation endpoints take `body.cascade`
and the operator can already uncheck "cascade to cells". Derived mode is
effectively `cascade=False` forced, plus a computed value.

**Cells stay human-validated, always.** Nothing in derived mode writes
`service_gateway_status`. Equipment knows what each end can do; only a person
knows whether traffic actually crosses.

### What survives of the advisory-only contract

`api/equipment_status.py` opens with a 37-line rationale for equipment never
writing status. It gives two arguments. This plan resolves them differently and
the distinction matters:

**Argument 1 (cell-blanking churn) — SURVIVES, fully.** The concern that
`cell_status_from_gateway` (`api/effective.py:183`) blanks every cell to
`unknown` on any status change that isn't `ready`/`down`/`offline` is still
correct, and is exactly why the write cascade is disabled in derived mode
rather than repointed. This argument is not weakened; it is honored by
construction. Do not let cascade-on-derive creep back in.

**Argument 2 (provenance) — DISSOLVED.** The concern was that a
machine-derived value erases the human attribution in `validated_by_user_id`.
But `EquipmentCapability` carries its own `validated_at` /
`validated_by_user_id` (`api/models.py:2010-2015`). Attribution does not
vanish — it moves down one level, to whoever validated the gear. The chain is
still fully attributed, just at a finer grain.

The deeper reason the advisory-only contract was right *at the time*: the
binding carried no intent. Worst-of over everything bound is a guess. Once
`required` exists, the derived value is a claim about a **stated dependency**,
and that earns it the right to be authoritative.

### Vocabulary mismatch (must be handled)

Three status vocabularies are involved and they do not align
(`api/schemas.py:10-51`):

| Vocabulary | Values |
|---|---|
| `ServiceStatusValue` | up, degraded, down, unknown, offline, setup |
| `GatewayStatusValue` | active, ready, degraded, down, offline, setup — **no `unknown`** |
| `CellStatusValue` | ServiceStatus + ready |
| `EquipmentStatusValue` | up, degraded, down, maintenance, offline, unknown — no setup/ready |

`toTargetStatus` in `webui/components/equipment/derived-status-badge.tsx:32`
already does this mapping for the advisory badge (gateway says "active" where
equipment says "up"; neither service nor gateway has "maintenance", so it maps
to "degraded"). Derived mode must move that mapping **server-side** — it
becomes a correctness concern, not a display convenience.

Note the asymmetry: **`GatewayStatusValue` has no `unknown`**. A derived
gateway with nothing to say has no value to fall back to. This is a genuine
complication for gateway-derive and feeds directly into §6.

---

## 5. Manual override — SHIPPED (0056)

**No new override columns.** `ServiceDelivery` already inherits `status`,
`validated_at`, `validated_by_user_id` from today's `service` row. An override
*is* a validation — it goes through the existing endpoint under the operator's
own name, reusing the whole existing path.

Add one column: `derived_changed_at`. The rule:

```
validated_at > derived_changed_at  →  show the human value
otherwise                          →  show derived
```

An override sticks, and lapses the next time the equipment picture *actually
changes* — with an event on the feed. That matches how operators reason: "I
know the radio reads down, the service is fine" is a claim about current
conditions, not standing policy.

**Rejected: sticky-until-cleared.** Requires an explicit clear action nobody
performs, and quietly strands stale green services after the world moves on.

**Rejected: one-shot with a stored `override_against_derived` value.** Same
behavior as the timestamp comparison but with an extra column and a second
thing to keep in sync.

Events: reuse `service.status_changed` (emitted at
`api/routers/services.py:216`). A derived transition emits with a
`source_flow` marker, matching the existing `"cascade"` convention at
`api/routers/services.py:265`.

---

## 6. OPEN: `unknown` → `unvalidated`

**This decision is not made.** Raised last in discussion; recorded here for a
decision before the migration is written.

### The problem

`unknown` currently means two different things:

1. **"No information yet"** — never validated. `materialize_cells`
   (`api/effective.py:281`) seeds every new cell to `unknown`.
2. **"We looked and can't tell"** — an actual assessment.

The conflation is already visible in the code as special-casing. `unknown` is
exempt from ordering in **two separate rank tables**:

- `effective.STATUS_RANK` (`api/effective.py:43`) — "`unknown` is exempt from
  ordering (represents 'no information', so it does not constrain anything and
  is not treated as 'worst')".
- `equipment_status.EQUIPMENT_STATUS_RANK` (`api/equipment_status.py:57`) —
  same carve-out, independently written.

It is further special-cased in `clamp_by_local` (`api/effective.py:60`),
`_cell_contribution_to_rollup` (`api/effective.py:100`, where unknown cells are
treated optimistically as inheriting local status), `clamp_cells_for_service`
(`api/effective.py:237`), and `worst_status` (`api/equipment_status.py:85`).
Six sites, all working around one overloaded value.

Derived mode makes it worse. A required capability that was simply never
validated is a **hole in the dependency chain**, not a status. Rolling it into
the same value as "assessed and inconclusive" means the derived number cannot
distinguish "this service is fine" from "we have no idea and never checked."

### Options

**(a) Rename `unknown` → `unvalidated`.** Honest about the dominant meaning
(the seed value). Cheap in code, but a wide-blast rename across four
vocabularies, the `AnyStatusValue` union (`api/schemas.py:24`), event rows that
reuse the status column, and every webui pill. Loses the ability to say "looked,
inconclusive" — though nothing expresses that today anyway.

**(b) Split into two values** — `unvalidated` and `unknown`. Most expressive,
most expensive. Adds a seventh value to vocabularies that are already
awkwardly non-aligned, and every one of the six special-case sites above has to
decide about both. `GatewayStatusValue` has neither today, so it would gain two.

**(c) Keep `unknown` as the status; carry unvalidated-count as a separate
completeness signal.** Status vocabulary is untouched. The derived value keeps
today's skip-unknown behavior (a `worst_status()` that returned `unknown`
because one capability was never validated would make derived useless on day
one). Alongside the status, surface *"3 required capabilities unvalidated"* —
modeled on the existing UTC completeness panel, which already establishes this
exact "here is what we don't know" pattern separate from status.

### DECIDED — (c) **and** (a), 2026-08-06

Both, not either. `unknown` is renamed to `unvalidated` (migration
`0053_unvalidated_status`), *and* the unvalidated-count ships as a separate
completeness signal on `DerivedStatus` rather than as a status value. The
rename makes the six carve-outs self-documenting — "`unvalidated` carries no
ordering" is obviously true where "`unknown` carries no ordering" was
arguable — and the separate signal keeps ignorance out of the vocabulary
entirely, which is what (c) was for.

Option (b) was rejected: it would have added a seventh value to vocabularies
that are already non-aligned, and nothing in the system has ever produced
"assessed, inconclusive". If that is ever wanted it is a new value, not this
one reinterpreted.

Three things the rename had to get right, all now in the migration:

- **Personnel keep `unknown`.** `PersonnelStatusValue.unknown` means "never
  signed in" — a fact about a person, not an unvalidated assessment. The two
  shared one entry in `AnyStatusValue`, which now carries both. The
  `validation` rewrite is filtered by `subject_kind`, or it would have
  relabelled 25 personnel history rows with something false.
- **Gateways get `ready`, not `unvalidated`.** `GATEWAY_STATUS_VALUES` never
  had a seed value; a gateway's "nothing said yet" is PACE standby. This
  surfaced a live bug: `gateway.status` defaulted to `'unknown'` in both the
  model and the DB, a value its own output schema rejects. Unreachable through
  the API, but any direct insert wrote a row that fails on read. Also fixed
  `events.py`'s revert path, which used one hardcoded `"unknown"` for every
  subject kind and so wrote that impossible value into gateways.
- **History is relabelled, not deleted.** Renaming a value to a new label for
  the same concept makes the rewrite faithful; deleting the rows would destroy
  an audit trail whose entire purpose is attribution. Verified to round-trip
  through `downgrade`.

---

## 3b. What actually shipped, and what it cost

`required` defaults to FALSE. Every binding made before 0056 was created under
the advisory contract, where binding meant "related" — promoting them wholesale
to hard dependencies would have made derived status fire on gear nobody
declared essential. A workspace that never touches the checkboxes keeps exactly
the advisory it had: `build_derived` falls back to the old whole-set worst-of
when nothing is marked required.

`derive_from_chain` is worst-of across groups, best-of within one. Verified
against the case that motivated `group_key` at all: two radios sharing a key,
one dead, derives `up` — a bare boolean would have said `down`.

`resolve_status` is the only place mode is interpreted. Derived loses to a
newer operator validation and falls back to reported when the chain has no
opinion, so a delivery with one unvalidated required capability keeps its
reported status and shows the hole beside it rather than blanking.

`derived_status` is STORED, not recomputed on read, because
`derived_changed_at` must be stamped when the value moves and detecting that
during a GET would mean writing on a read. `refresh_derived` runs on the
capability-validation path — the only thing that can move a chain — and stamps
only on a real change, since that timestamp is what an override is measured
against.

The cascade suppression is two one-line guards (`status_mode != "derived"`) in
`validate_service` and `validate_gateway`. That is the whole of it: the
read-time R10/R11 functions were already pure, so derived mode really is the
removal of a write path.

### Still open

- ~~**Gateway dependency targets** (§7).~~ **SHIPPED (0057)** — see below.
- **Gateway `status_mode` has no UI.** The column, the resolution and the
  cascade suppression are all in place and the endpoint exists, but nothing in
  the webui switches it. Deliberate: gateway-derive is the riskier half, and it
  should not be one click away until the delivery side has been used in anger.

## 7. Gateway-as-service — the double count — SHIPPED (0057)

Structurally, **a gateway is a delivery of a Transport-enclave service.** That
is why `Transport` sits at the top of the enclave tree with no color
(`api/alembic/versions/0049_transport_black.py`) — it is not a data network.

This is where the shared-equipment case bites. `CapabilityGatewayLink`
(`api/models.py:2071`) and `CapabilityServiceLink` (`api/models.py:2049`) are
separate join tables both keyed on `equipment_capability_id`, so one capability
can bind to both. That already works and needs no schema change — a satcom
terminal that is both transport and endpoint just gets two bindings.

The problem is that it then **counts twice**: once directly against the
delivery, once through the gateway's cell. Under worst-of that is harmless
(idempotent). Under redundancy groups (§3) it becomes a live bug — two
"independent" paths that share a component, and the model claims resilience
that does not exist.

### Not in scope: collapsing Gateway into Service

`gateway.pace` and the `service_gateway_status` matrix are working,
load-bearing UI — `webui/components/sites/site-matrix.tsx` alone is 1570 lines.
Collapsing them is a second migration stacked on this one. **Explicitly
deferred.**

### In scope: delivery → gateway dependency

Let a delivery declare a `required` / `group_key` dependency whose target is a
**gateway** rather than a capability. Same evaluation rules. The shared radio is
then counted once, at the gateway, and the delivery depends on the gateway
rather than reaching past it to the equipment.

This means the dependency edge is polymorphic over target. Precedent argues
against a `(target_kind, target_id)` table — the comment at
`api/models.py:2044` records the deliberate choice of two concrete join tables
over one polymorphic one, for real FKs and real cascades. Follow that: two
tables, `delivery_capability_dependency` and `delivery_gateway_dependency`,
sharing the `required` / `group_key` columns.

### What shipped

Two concrete tables as planned, with **one deviation**: only
`delivery_gateway_dependency` is new. `capability_service_link` *is* the
capability half — it has carried `required`/`group_key` since 0056 — so it was
not renamed to `delivery_capability_dependency`. The rename would have churned
every call site for no behavioural gain.

- **`DeliveryGatewayDependency`** (`api/models.py`), migration
  `0057_delivery_gateway_dependency`. `required` defaults **True** here, unlike
  0056's column: this table starts empty, so every row is a deliberate
  declaration and there is no legacy advisory reading to protect.
- **Suppression is the actual fix.** `_shadowed_capabilities`
  (`api/equipment_status.py`) resolves, per delivery, which capabilities also
  back a depended-on gateway. Those bindings keep their `required` flag and
  stay in `backing` carrying `superseded_by_gateway_id`, but `gates()` skips
  them, so the shared component votes exactly once — at the gateway. Showing
  them beats hiding them: the dependency did not vanish, it moved up a level.
- **Group keys share one namespace.** A capability and a gateway can sit in the
  same redundancy group, so "this radio or the Starlink path" is expressible.
- **What a gateway contributes.** Its own capability-derived value when it has
  one, else its reported status mapped into equipment vocabulary via
  `_GATEWAY_TO_EQUIPMENT`. The fallback is what makes this useful on day one —
  almost no gateway has capabilities bound yet, and a dependency that
  contributed nothing until someone wired the gear would be inert. A required
  gateway with *no* opinion counts toward `required_unvalidated`, so it reads
  as a hole rather than disappearing.
- **`ready` → `up`.** The one judgment call. A gateway on PACE standby is a
  path that works and simply is not carrying traffic. Anything worse defeats
  the case the groups exist for: primary down, sat phone ready should read as a
  live alternate, not an outage. (`setup` → `maintenance`, matching how
  `_REPORTED_RANK` already scores both at 4.)
- **One level deep, always.** Gateways depend on capabilities, never on other
  gateways. The chain cannot recurse or cycle.
- **Cascade.** `refresh_derived` now pulls in every delivery depending on a
  touched gateway, so a capability bound only to the gateway still moves the
  deliveries that declared they need it.
- **API.** `GET/PUT/DELETE /services/{id}/gateway-dependencies[/{gateway_id}]`.
  Deliberately *not* restricted to same-site gateways — a delivery at an
  extension reaching back through the primary's transport is the case this
  exists for, and it is the same cross-site reasoning that lets the far end of
  a shot back a near-end service.
- **UI.** `webui/components/services/gateway-dependency-editor.tsx` on the
  service settings tab; `derived-status-badge.tsx` renders the transport paths
  and marks superseded capabilities "via gateway".

Still deferred: collapsing Gateway into Service (above), and there is no
migration of existing double-counted bindings — nothing to migrate, since
declaring a dependency is what triggers suppression.

---

## 8. Migration — SHIPPED (0054)

Next revision: **`0053_service_delivery`**, `down_revision =
"0052_enclave_classification"` (latest confirmed in
`api/alembic/versions/`).

Likely split across more than one revision given the data hazards below; number
sequentially from 0053.

### Mechanical path

1. Rename `service` → `service_delivery`. All existing rows are deliveries.
2. Create `service` with `(workspace_id, enclave_id, name)` +
   `kind, category, icon, description, service_template_id`.
3. Mint `service` rows by grouping deliveries on
   `(workspace_id, enclave_id, name)`.
4. Add `service_delivery.service_id` FK; backfill from the grouping.
5. Drop the identity columns from `service_delivery`; keep the per-site ones
   (§2 table).
6. Repoint `capability_service_link.service_id` → `service_delivery.id`
   (values are unchanged — the rows kept their IDs through the rename, so this
   is a constraint retarget, not a data rewrite).
7. Repoint `service_gateway_status.service_id` → `service_delivery.id`. Same
   property. Note both `0014_service_gateway_status.py` and
   `0042_equipment_bindings_links.py` created FKs against `service.id` and both
   need retargeting.
8. Add `status_mode`, `derived_changed_at`, `source` to `service_delivery`.
9. Add dependency tables (§7).

Steps 6–7 are cheap precisely because step 1 is a rename, not a copy. Do not
be tempted to create a fresh delivery table and copy rows — that invalidates
every existing FK value and the audit trail in `Event.subject_id`.

### Data hazards

**No uniqueness constraint exists today.** `service` has none (§1), and
`create_service` does not check. Two rows named "NIPR Web" at the *same site*
are already possible in production data. Grouping on
`(workspace_id, enclave_id, name)` would collapse them into one service with
**two deliveries at the same site** — so `(service_id, site_id)` cannot be
unique on `service_delivery`, or the migration must dedupe first. Query the
dev DB before choosing; do not assume the data is clean.

**Null `enclave_id`.** `Service.enclave_id` is nullable (`api/models.py:313`)
and inherits from the template only when one was named
(`api/routers/services.py:157-160`). If the key is
`(workspace_id, enclave_id, name)`, every null-enclave service groups on
`(ws, NULL, name)` — and in Postgres `NULL` is distinct in a unique index
unless `NULLS NOT DISTINCT` is specified. Two null-enclave "NIPR Web" rows at
different sites would **fail to group**, producing two services where one was
intended. Decide explicitly: either backfill enclaves before grouping, or use
`NULLS NOT DISTINCT`, or group on `COALESCE(enclave_id, 0)`.

**Cross-enclave name collisions.** "Web" on NIPR and "Web" on SIPR correctly
become two services under this key. Verify that is actually true of the data —
if operators have been disambiguating in the name ("NIPR Web" / "SIPR Web")
*and* setting `enclave_id`, the key is redundant but harmless. If some rows use
one convention and some the other, grouping is inconsistent.

**`ServiceTemplate.enclave_id` inheritance.** Templates are where the NIPR/SIPR
split has always lived (`api/models.py:285`). A service created before
`enclave_id` existed (pre-0048) may have a null enclave but a template that
carries one. Consider backfilling `service.enclave_id` from
`service_template.enclave_id` as a pre-step, which also shrinks the null-enclave
hazard above.

**Export/import format.** `ExportedService` (`api/schemas.py:271`) is keyed by
`site_name` and the import side builds
`service_id_by_key: dict[tuple[str, str], int]` keyed on
`(site_name, service_name)` (`api/routers/workspaces.py:1354`, consumed at
`:1747` to rebind capabilities). This serialization format bakes in the
site+name identity. It is a **versioned external artifact** — bumping it needs
a compatibility shim for previously exported workspaces, or an explicit
decision to break old exports.

**Workspace clone.** `api/routers/workspaces.py:249-272` builds
`service_id_map` during clone and `:636-643` uses it to remap
`CapabilityServiceLink` rows. Clone must be updated to duplicate the
service/delivery pair correctly — a cloned workspace needs its own `service`
rows, not shared ones.

### Call sites

API, by weight of `service_id` / `Service.site_id` references:

| File | Refs | Nature |
|---|---|---|
| `api/routers/services.py` | 24 | CRUD, validate (cascade caller), move, delete |
| `api/routers/equipment.py` | 20 | capability bind/unbind (`:689`, `:721`), backing rollup |
| `api/routers/workspaces.py` | 16 | clone, export, import — see hazards above |
| `api/routers/service_gateway_status.py` | 8 | cell CRUD; `:70` checks `enabled_pace` |
| `api/routers/canvas.py` | 6 | `:54-55` groups services by site for the canvas |
| `api/routers/status.py` | 5 | `:38,50` rollup by site |
| `api/equipment_status.py` | 5 | `load_backing_for_services` (`:120`) |
| `api/routers/deployments.py` | 4 | `:918` cross-site rejection (see §9 step 2) |
| `api/effective.py` | 4 | R8–R11 helpers |
| `api/rules_engine.py` | 3 | `:276` service facts, `:425,457` subject_id |
| `api/routers/gateways.py` | 3 | validate cascade (`:181`) |
| `api/routers/events.py` | 2 | subject resolution |
| `api/schemas.py` | 2 | `ServiceOut`, `ExportedService` |

WebUI:

- `webui/lib/types.ts:190-215` — `Service` interface, `site_id` at `:193`
- `webui/components/sites/site-matrix.tsx` (1570 lines) — the PACE matrix, largest surface
- `webui/components/sites/site-detail-client.tsx` (769)
- `webui/components/services/service-detail-client.tsx` (428)
- `webui/components/services/service-form.tsx` (399)
- `webui/components/sites/site-canvas.tsx`, `node-action-sheet.tsx`
- `webui/components/services/service-status-pill.tsx` — 8 callers
- `webui/components/equipment/derived-status-badge.tsx` — `toTargetStatus` moves server-side (§4)
- `webui/components/equipment/deploy-utc-wizard.tsx` — wiring step becomes delivery-shaped
- `webui/app/(authed)/w/[workspace]/services/page.tsx`, `services/[id]/page.tsx`, `sites/[id]/page.tsx`

No test coverage was found for the derived-status or service-status components.

---

## 9. Sequencing

### Step 1 — Link editor *(in progress, main session)*

Independent of everything else. `equipment_link` (`api/models.py:2092`) is the
declared truth about topology including cross-site, has full CRUD at
`/topology/links` (`api/routers/equipment_topology.py:123-261`), and
`NetworkCanvas` already renders it — but nothing in the UI can *create* a row.
The graph looks absent because it is empty.

Files: `webui/components/equipment/network-canvas.tsx`,
`api/routers/equipment_topology.py`. **Being edited concurrently — do not
touch.**

### Step 2 — Decouple UTC from a single site

No schema change. `Equipment.site_id` is already independent of
`utc_instance_id` (`api/models.py:1908-1915`, denormalized on purpose), and
`derive_utc_role` (`api/equipment_status.py:203`) already computes
primary-vs-extension from the link graph. `utc_instance.site_id` becomes "home
site"; presence derives from the distinct sites of the UTC's equipment.

- `api/routers/deployments.py:918,934` — drop the cross-site rejection
  (`svc.site_id != site.id` / `gw.site_id != site.id`). Note the bind endpoint
  at `api/routers/equipment.py:706` already allows cross-site binds — it only
  checks workspace membership — so these three disagree today.
- `api/routers/deployments.py:492-496` — patching a UTC's `site_id` currently
  bulk-updates every piece of its equipment's `site_id`. This directly
  contradicts per-gear placement and must become opt-in.
- `api/routers/deployments.py:115-117` already computes `site_ids` for a
  package from its UTCs — the multi-site shape exists at the package tier and
  is the precedent to follow.
- Completeness / enclave roster views: derive sites from gear.
- `webui/components/equipment/deploy-utc-wizard.tsx`,
  `utc-detail-client.tsx`, `equipment-page-client.tsx`.

Retires extension-as-its-own-UTC.

### Step 3 — This migration

§8. Depends on the §6 decision.

### Step 4 — Enclave layer on the network canvas

Falls out of steps 1 and 3. Three layers over data that already exists —
physical (`equipment_link` as-is), network (filter to one enclave), service
(delivery nodes with backing chains). Rendering and filtering only.

Files: `webui/components/equipment/network-canvas.tsx`,
`api/routers/equipment_topology.py` (`/topology/network` at `:327`).
