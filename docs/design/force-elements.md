# Equipment kits — deploying the gear we already own

Status: **SHIPPED** (2026-08-08), migrations 0058 and 0059.

§1–§8 describe the workspace-scoped first cut (0058). **§9 supersedes its
scoping**: kits are global, pinning a global property book, and deploy
materializes into a workspace. Read §9 before trusting §2's table or §3's
conflict discussion.

Prompted by: *"We have a finite amount of equipment and I think it may be easier
in the deployment if we don't have to put in serial numbers every time. It would
be helpful to save a package that has all of the expected UTCs and the
serialized equipment, so that the deployment doesn't have to configure all of
that again — it can just check off the actual items that will be used."*

---

## 1. Problem statement

The deploy wizard is **create-only**. `deploy_utc` (`api/routers/deployments.py:736`)
registers a brand-new `Equipment` row for every serialized line, and explicitly
rejects any serial that already exists in the workspace:

```python
# deployments.py:818
if existing is not None:
    raise HTTPException(409, {"message": f"Item {index + 1}: serial '{...}' "
                                         "is already registered in this workspace."})
```

So the second deployment of the same physical radio is **impossible through the
wizard**. The operator's options today are all bad: hand-edit the equipment row
to re-point it, delete and re-register it (losing its history and validation
state), or invent a fake serial. In a finite-pool unit — which is every real
unit — that is the normal case, not the edge case.

The irony is that the storage model is already built for reuse and nothing
consumes it:

- `Equipment` is **workspace-scoped**, not UTC-scoped. `utc_instance_id` is
  nullable (`api/models.py:2057`).
- `delete_utc` deliberately *releases* gear back to the pool rather than
  deleting it — "a radio outlives the UTC it came in on, and silently deleting
  accountable property with a container would be indefensible"
  (`deployments.py:539`).

Teardown already returns gear to the pool, and `EquipmentPatch` already accepts
`utc_instance_id` (`api/schemas.py:2121`) — so re-pointing a radio at a new UTC
is a supported write *one item at a time*. There is simply no path that picks
the pool back up **during a deploy**.

That is worth stating precisely, because it is the actual workaround in use
today: deploy the UTC with no serialized gear, then PATCH each radio
individually from the equipment list. It works, it is exactly the tedium the
request describes, and it means the reassign write path is already proven — §3
is mostly a matter of reaching it from the deploy payload.

Two gaps, and the first blocks the second:

- **G1 — no way to deploy existing gear.** Every serialized line must be a new
  registration.
- **G2 — no saved roster.** Nothing records "our FCP is *these* UTCs carrying
  *these* serials," so the configuration is rebuilt by hand every time.

---

## 2. Target model

Doctrine and reality are already separated, and the split is load-bearing
(`UtcInstanceLine`'s docstring, `api/models.py:1957`, is the clearest statement
of it). Kits slot in as a fourth layer between doctrine and deployment:

| layer | table | holds | scope |
| --- | --- | --- | --- |
| doctrine | `utc_def`, `package_def` | types + quantities | global **or** workspace |
| **kit** *(new)* | `equipment_kit` | **specific serials** | workspace |
| plan | `utc_instance_line` | what we meant to bring | one deployment |
| reality | `equipment`, `equipment_holding` | what is actually there | one deployment |

**A kit is not a `PackageDef` field.** `package_def.workspace_id` is nullable
(`models.py:1819`) — package definitions can be global catalog entries, and
serial numbers must never live on a row that another workspace can read.
Doctrine says *a Flyaway Comms Package carries two AN/TSC-198s*; a kit says
*ours are S/N 4417 and S/N 4420*. Those are different facts with different
owners and different lifetimes.

### New tables

```
equipment_kit
  id, workspace_id → workspace (CASCADE)
  package_def_id  → package_def (SET NULL, nullable)   -- doctrine this kit realizes
  name, description, retired_at, created_at, updated_at
  UNIQUE (workspace_id, name)

equipment_kit_utc            -- one queued UTC per row; quantity is expressed
  id, kit_id → equipment_kit (CASCADE)                 -- as repeated rows, so each
  utc_def_id → utc_def (SET NULL, nullable)            -- gets its own pinned gear
  name, role_hint, display_order

equipment_kit_item           -- the pinned serials
  id, kit_utc_id → equipment_kit_utc (CASCADE)
  equipment_id → equipment (CASCADE)                   -- gear sold off leaves the kit
  display_order
  UNIQUE (kit_utc_id, equipment_id)

equipment_kit_bulk           -- bulk is counted, never pinned
  id, kit_utc_id → equipment_kit_utc (CASCADE)
  equipment_type_id → equipment_type (RESTRICT)
  quantity, enclave_id → enclave (SET NULL, nullable)
  UNIQUE (kit_utc_id, equipment_type_id, enclave_id)
```

Two deliberate choices:

**`utc_def_id` is nullable.** Hand-built UTCs are a first-class path in the
wizard today (`deploy-utc-wizard.tsx:392` — "Building by hand: there is no bill
of materials to derive from"). A kit captured from one must survive.

**No `enclave_id` on `equipment_kit_item`.** The gear already carries its own
(`equipment.enclave_id`, `models.py:2069`). Snapshotting it here would create a
second source of truth that drifts the moment someone re-tags a radio.

### Pinning is non-exclusive

The same TACLANE belongs to the FCP kit *and* the JIP kit. A unit that owns one
of something puts it in every kit that would use it — that is what owning one
means. The constraint is not "which kits may list it" but "which live
deployment currently holds it," and that is enforced at deploy, not at pin.

---

## 3. Deploy from inventory (G1)

`UtcDeployItemIn` gains `equipment_id: int | None`.

When set, the item is a **claim on existing gear** rather than a registration:

- `serial_number`, `equipment_code`, and `capability_kinds` are ignored — the
  row already has them, and its capabilities are already materialized
  (`EquipmentCapability`, `models.py:2132`). Re-picking them would silently
  overwrite an operator's earlier edit, like the deleted `los_rf` on a kit that
  shipped without its antenna.
- Validation, in the existing pre-write pass (`deployments.py:773-829`, which
  already resolves everything before touching the database): same workspace,
  type matches the line, and not claimed twice within the same payload. Being
  held by another live UTC is explicitly *not* a validation failure — see the
  conflict policy below.
- The write reassigns `utc_instance_id`, `site_id`, and `enclave_id` instead of
  inserting.
- Emit `equipment.reassigned`, not `equipment.registered` — the radio is not new
  and the feed should not claim it is. New event type, per
  `docs`/`event_type_def` conventions.

### Conflict policy — DECIDED 2026-08-08: warn and proceed

If R7421 is already held by a live UTC, the deploy **takes it** and reports what
it took. No 409, no second click.

An earlier draft of this section argued for blocking, on the grounds that
letting gear be claimed freely would make two UTCs both report complete on one
physical radio. **That was wrong**, and the reason matters:
`equipment.utc_instance_id` is a single nullable FK (`models.py:2057`) — a radio
is in exactly one UTC or none, structurally. Reassigning it does not duplicate
it; it *moves* it, and the UTC that lost it drops below its `UtcInstanceLine`
snapshot and reads as a shortfall from that moment. The accounting stays honest
on its own, without a gate.

So the requirement is disclosure, not prevention:

- The pool picker and the kit's Serialized step label held gear inline —
  *"R7421 · held by FCP-2 (Site Bravo)"* — so the operator sees it before
  choosing, not after.
- `UtcDeployOut` returns a `reassigned` list (equipment ID, previous UTC,
  previous site). The wizard's Review step surfaces it as a plain statement of
  what moved.
- Each move emits `equipment.reassigned` carrying both UTCs, so the feed shows
  the gear leaving one deployment and arriving at another.

This is the right default for a finite pool: the gear moving between packages
*is* the normal workflow, and a unit that owns one TACLANE should not have to
tear down last week's deployment before standing up this week's.

---

## 4. Kit → deployment (G2)

The wizard's first step already chooses between a package definition, an
existing package instance, and nothing (`deploy-utc-wizard.tsx:181`). Add
**kit** as a fourth source.

Selecting one queues a draft per `equipment_kit_utc`, exactly as
`draftsFromPackageDef` does today (`deploy-utc-wizard.tsx:259`) — but with the
Serialized step already populated and every pinned item **checked**.

The Serialized step becomes three row states instead of one:

| state | shows | operator action |
| --- | --- | --- |
| **pinned** (from kit) | ID, serial, current holder | uncheck to leave it home |
| **from pool** | picker filtered to the line's type, unassigned gear first | pick one |
| **new** | today's serial + ID fields | type it |

Unchecking a pinned item is not an error — it is the "we're leaving the SIPR
stack home" case the snapshot model was built for. It simply does not reach
`UtcInstanceLine`, so completeness measures against what was actually brought,
which is the contract `UtcInstanceLine`'s docstring already commits to.

Everything downstream is unchanged: the enclave filter, the wiring proposals
(`proposeWiring`, `deploy-utc-wizard.tsx:448`), and the expectation snapshot all
operate on the resolved item list without caring how each row got there.

---

## 5. How kits actually get made

**Capture from a live deployment.** A "Save as kit" action on a `PackageInstance`
walks its UTCs, pins every attached `Equipment` row, and copies bulk quantities
off `EquipmentHolding`.

This is the path that matters. Configure the FCP once by hand — which the
operator has to do anyway the first time — then save it. Authoring a kit from
an empty form is supported by the same tables, but nobody will do it, and the
feature should not be designed around the path nobody takes.

**Refresh from a deployment.** Re-capturing onto an existing kit updates the
pins after the real-world set changes (a radio goes to depot, a replacement
arrives). Cheaper than editing pin-by-pin.

---

## 6. Sequencing

**Step 1 — deploy from inventory.** `equipment_id` on the deploy payload, the
reassign path, the conflict 409, and the pool picker in the Serialized step. No
migration beyond the new event type. This is independently valuable and is most
of the user's actual pain: *"we already own this radio"* stops being a dead end,
kit or no kit.

**Step 2 — kit tables + CRUD.** Migration 0058. List, read, rename, retire.

**Step 3 — capture from deployment.** "Save as kit" and refresh. Kits become
reachable without an authoring UI.

**Step 4 — kit as a wizard source.** The fourth source and the three-state
Serialized step.

**Step 5 — kit health.** What is pinned, what is currently deployed elsewhere,
what has been retired out from under the kit. The finite-pool question turned
into a screen: *can we actually field this package right now?*

Steps 1 and 2–4 are separable. If only one thing gets built, it should be step 1.

---

## 7. Decisions

1. **Scope — DECIDED 2026-08-08: build steps 1–5.** The full feature, not a
   staged rollout. Sequencing in §6 still governs the order of work.
2. **Conflict policy — DECIDED 2026-08-08: warn and proceed.** See §3, which
   also records why the blocking argument was unsound.

### Still open

1. **Do kits pin bulk quantities?** Recommended yes (`equipment_kit_bulk`) —
   otherwise every deployment re-enters cable and battery counts, which is the
   same retyping complaint one tier down.
3. **Retire vs. delete kits.** `retired_at` matches `package_def`
   (`models.py:1828`); recommended for consistency.
4. **Does a kit pin a site?** Recommended no. The same FCP deploys wherever it
   is sent, and `UtcInstance.site_id` is a per-deployment fact.

---

## 8. What shipped, 2026-08-08

All five steps, in one pass. Migration **0058**.

### API

* `equipment_kit` / `equipment_kit_utc` / `equipment_kit_item` /
  `equipment_kit_bulk` (`api/models.py`), plus the `equipment_kit` subject kind
  and the `equipment.reassigned`, `kit.saved`, `kit.deleted` event types.
* `UtcDeployItemIn.equipment_id` and the reassign path in `deploy_utc`
  (`api/routers/deployments.py`). Validated in the existing pre-write pass, so
  a bad claim still writes nothing. Rejects a type mismatch (409) and the same
  item claimed twice in one payload (409); does **not** reject gear held by
  another live UTC — see §3.
* `UtcDeployOut.reassigned`, the disclosure list.
* `api/routers/equipment_kits.py` — list/get/create/patch/delete, wholesale
  `PUT /kits/{id}/utcs`, `POST /kits/capture`, `POST /kits/{id}/refresh`.

### Web UI

* Deploy wizard: **From a kit** as a fourth package source; the Serialized step
  rebuilt around three row states (pinned, pulled from the pool, newly
  registered) with an include checkbox per row; a pool picker on every
  serialized row, sorted idle-first and labelled with the current holder;
  review-step disclosure of what will move; a post-deploy summary of what
  actually did.
* **Kits** tab on `/equipment`, with the fieldability chips (ready in the pool
  / out on another deployment / no longer in inventory) and an expandable
  roster.
* **Save as kit** on each package in the UTCs tab, which also offers to refresh
  an existing kit rather than accumulate near-duplicates.

### Things worth remembering

**Wiring indices are positional.** `CapabilityWiring.item_index` points into the
payload's `items` array, so unchecking a row shifts every index after it. The
wizard renumbers on build (`buildPayload`) and drops wiring proposed for rows
that are no longer going. Getting this wrong wires the wrong box to the wrong
service, silently.

**Claimed rows must not consume proposed equipment IDs.** `proposedCodes`
disambiguates new registrations against each other and against the workspace;
letting claimed gear into that pool made new gear renumber to dodge a collision
with itself.

**Capabilities come off the gear, not the type.** A claimed row reads
`equipment.capabilities`, because that box may have had one deleted. The server
ignores `capability_kinds` for claimed items for the same reason.

### Verified

Against the dev DB (rolled back): capture pins 9 items across 2 UTCs with bulk;
a deploy claiming 4 of them creates **no** new `equipment` rows, reports 4
moves, and leaves the source UTC at `status=short` with correct per-type deltas;
type mismatch and duplicate claim both 409. Driven in the browser: kit capture,
the Kits tab and its chips, kit-sourced deploy through to review, including the
include-checkbox counter (`4 of 4 going` → `3 of 4 going`) and the
eight-item move disclosure.

### Still open

The `retired` flag on kits has no UI — `PATCH /kits/{id}` accepts it, but the
Kits tab only offers delete. Fine while a workspace has a handful of kits;
worth a filter once it doesn't.


---

## 9. Re-scope: global kits over a property book — SHIPPED (0059)

0058 scoped kits to a workspace. That was one level too low, and the app
already said so: the workspaces admin page describes a workspace as *"one
operating picture"* and tells you to *"duplicate a workspace to seed the next
exercise."* A workspace is an exercise, not a tenant. The radio in the rack is
a fact about the unit, so a kit describing the unit's gear belongs in the
global tier beside enclaves and the equipment catalog.

### The obstacle, and why the fix is a new layer

`equipment` is workspace-scoped — workspace-unique serial and equipment ID, and
a NOT NULL `site_id` pointing at a workspace's site. A global kit cannot pin one
of those rows. Three ways out were considered:

| | approach | verdict |
| --- | --- | --- |
| A | global kit holds types + quantities only | within a rounding error of `PackageDef`; doesn't stop anyone retyping serials, so it fails the original ask |
| B | `equipment` itself becomes global, one assignment | delivers the ask, but a single `utc_instance_id` makes the pool exclusive across workspaces — you could not plan next month's exercise with gear currently deployed |
| **C** | **global `equipment_asset`; workspaces materialize from it** | **shipped** |

**DECIDED 2026-08-08: C.** The deciding question was what it means for one
radio to appear in two workspaces, and the answer is *nothing* — they are
separate pictures, and planning one while another is live is routine. B would
have encoded a false exclusivity. C keeps workspace `equipment` exactly as it
was, so topology, completeness, wiring and status code are untouched.

### The model

```
equipment_asset              -- the property book: one row per box the unit owns
  id, equipment_type_id → equipment_type (RESTRICT)
  equipment_code UNIQUE, serial_number UNIQUE-when-present
  notes, retired_at
equipment_asset_capability   -- which capabilities THIS box has (no status)
  asset_id → equipment_asset (CASCADE), kind, display_order

equipment.asset_id           -- which asset this picture's row came from (SET NULL)
equipment_kit.workspace_id   -- now NULLABLE; NULL = global, admin-managed
equipment_kit_item.asset_id  -- pins an ASSET, not a workspace equipment row
```

`equipment_asset_capability` deliberately carries **no status**. Status is a
fact about a deployment ("the data port is down at Bravo"); the same box can be
healthy in one picture and degraded in another. What belongs on the asset is
only the shape of the box, so a kit that shipped without its antenna
materializes without `los_rf` everywhere it lands.

`equipment.asset_id` is SET NULL, not CASCADE: striking a box from the property
book must never delete an operating picture's record of having used it.

### Materialize, don't move

`UtcDeployItemIn.asset_id` creates *this workspace's* row from the asset,
carrying its serial, ID and capabilities. It is find-or-create: redeploying the
same kit into the same picture moves the row it already made rather than
registering the radio twice.

Three item paths now exist, and they are genuinely different:

* `asset_id` — materialize from the property book (the kit path)
* `equipment_id` — claim a row this workspace already registered, moving it
  between UTCs (§3's warn-and-proceed, unchanged, still within one workspace)
* neither — register something new

Only the middle one moves anything, and only ever within one workspace.

### What the operator sees

* **Admin → Property book**: the unit's gear, with "in use by" naming every
  picture holding each box. `Import from this workspace` promotes serials a
  workspace already typed — matching by serial then equipment ID, linking
  rather than duplicating, so running it twice is a no-op. That is the bridge
  from pre-0059 data.
* **Kits tab**: kits are marked Global, and the health chips became
  free / in use / struck from the property book. "In use" is not a shortage —
  the gear is still deployable here.
* **Deploy wizard**: the Serialized picker is grouped `Property book` /
  `Already in this workspace`, and a kit-pinned row says either "Free" or
  "Also in Fort Pickett." Review lists shared boxes under *"also in another
  workspace"*, distinct from the *"will move here"* list, because nothing is
  taken.

Enclave selection, service and gateway matching, and wiring are unchanged and
still happen per deployment — a global kit knows nothing about any workspace's
networks, which is exactly why `equipment_kit_item` stores no `enclave_id` and
kit-sourced rows arrive with the enclave unset.

### Things worth remembering

**Global rows can only reference global rows.** A global kit's bulk line may
only point at a global enclave; pointing at one workspace's enclave would break
the kit for every other picture. Enforced in `_write_kit_utcs`.

**Capture promotes.** "Save as kit" now walks the package's gear into the
property book before pinning it, so a workspace that predates assets
contributes its serials once. An equipment ID that already exists globally
under a *different* serial is refused rather than merged — that is two boxes
colliding in the namespace, not one box.

**Admin gates the global tier**, matching `equipment_catalog._require_write`
and `enclaves._require_write`. Workspace-local kits remain possible via
`?local=true` and need only operator.

### Verified

Against the dev DB (rolled back): import promotes 10 items and is idempotent on
a second run; capture produces a global kit (`workspace_id IS NULL`); the kit is
visible from a second workspace with `in_this_workspace=false`; deploying it
there materializes 6 rows **while the first workspace keeps all 10** — the
shared-pool property C exists for; the pin then reports commitments in both
pictures; redeploying into the same workspace reuses rather than duplicating;
and a non-admin is 403'd from writing a global kit. Driven in the browser:
property book page and import (10 added), global kit saved and marked Global,
the same kit listed and selectable from `fort-pickett`.

### Still open

`equipment_asset` has no bulk-edit or CSV import — fine for a few hundred boxes
entered once, worth revisiting at property-book scale. And `retired` on kits
still has no UI (carried over from §8).
