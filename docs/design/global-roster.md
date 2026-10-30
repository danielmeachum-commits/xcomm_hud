# Global roster — people as facts about the unit

Status: **IMPLEMENTED** (2026-10-30), migration 0067. Follows 0066, which made
units global and work centers global-or-workspace.

## 1. Problem statement

`personnel.workspace_id` is NOT NULL, so every workspace keeps its own copy of
every person. A workspace is an operating picture, not a tenant (the reasoning
the property book moved on in 0059), and a person is a fact about the unit, not
about one exercise. The per-workspace roster costs us:

- **Retyping.** Standing up an exercise means importing or cloning the roster,
  and a phone number fixed in one picture is still wrong in the others.
- **No identity across pictures.** Nothing says that SSgt Smith in Garrison and
  SSgt Smith in an exercise are the same person, so "where is everyone across
  every deployment" cannot be asked.
- **Workarounds already in the schema.** 0066 had to widen the
  one-commander-per-unit index to `(workspace_id, unit_id)`, because the same
  commander exists once per workspace.

## 2. Model — the property-book split, applied to people

Equipment already answers this: `equipment_asset` is the global box, typed
once, and `equipment` is a workspace's materialization of it. People follow
the same split.

| Global `person` (who they are) | Per-workspace `personnel` (their part in this picture) |
|---|---|
| name, rank, branch, personnel_type, skill_level | `person_id` → person |
| unit_id, is_commander | work_center_id (shops can be local to a workspace) |
| cellphone, dsn, sipr_number, email | assigned_site_id, room_number, notes |
| supervisor_id (→ person) | current_status, current_site_id, current_status_since/note, expected_return_at |
| | team memberships, team work-center leads |
| | is_guest, affiliation, escort |

`personnel` keeps its id and every inbound foreign key
(`personnel_location_event`, team membership, `team_work_center_lead`, site
properties, events whose `subject_kind` is `personnel_location`), so history
stayed in place. `(workspace_id, person_id)` is unique.

`person.workspace_id` takes the enclave shape: NULL is the shared roster, a
workspace id is a person local to that picture. Guests are the local ones — a
visitor escorted through one exercise isn't on the unit's books. Deleting a
guest deletes their person; removing a roster person from a workspace leaves
them on the roster.

## 3. Decisions

- **Identity is the row id.** Nothing matches people by name, rank or email.
  The 0067 backfill made one person per existing personnel row, reusing its
  id; two rows that were the same human in different workspaces became two
  people. Linking someone into another picture is deliberate: "Add from
  roster" on the Personnel page, or a `person_id` column in the CSV import.
  Where the backfill left two commanders of one unit, the lowest id kept it.
- **Supervisor is global** (organizational). The API speaks personnel ids in
  each picture: `PersonnelOut.supervisor_id` is the supervisor's row in this
  workspace, null if they aren't in it, and a patch that sends the same null
  back leaves the roster pointer alone. A per-workspace override can be added
  if deployments turn out to need a different chain.
- **Who edits:** operators can add people and keep contact details current;
  name, type, branch, rank, skill level, unit, command and supervisor of a
  roster person need `admin`, since they change every picture at once. Guests
  follow the workspace's operator rules. Deleting from the roster needs
  `admin` and is refused while the person is in any workspace.
- **The shop stays per picture**: a work center can be local to one
  workspace, and a global row can't point at something only one picture sees.

## 4. Where it lives

- `routers/people.py` — `/people`: the roster with each person's workspaces,
  plus the shared identity rules (`IDENTITY_FIELDS`, the commander slot, the
  admin check) that `routers/personnel.py` reuses.
- `routers/personnel.py` — reads flatten person + personnel; writes split a
  body between them. `POST` with `person_id` links a roster person.
- `routers/workspaces.py` — duplicate shares roster people and copies guests;
  export carries identity by value; import adds new roster people (it can't
  know an id from another instance, so importing into the same instance
  duplicates people).
- Web UI — Global → Personnel → Roster (`/admin/roster`), "Add from roster"
  on the Personnel page, and the personnel form locks shared fields for
  non-admins.

## 5. Not done

- No edit form on the roster page itself: a person in no workspace can only be
  added to one or deleted.
- No merge tool for duplicates the backfill or an import created.
- Export bundles don't carry `is_guest`, so imported guests land on the roster
  (true before 0067 as well).
