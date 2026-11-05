# Offline bundle — one portable host, browsers everywhere else

Status: **Phase 1 IMPLEMENTED** (2026-11-05) — `deploy/bundle/compose.prod.yml`,
`deploy/bundle/xcomm`, `GET /healthz`. Phases 2–5 are still planned. See §10
for what phase 1 actually shipped and how it was verified.

## 1. Goal

xcomm runs on one host laptop with no internet at all. Every other machine on
the local network uses it through a browser and installs nothing. When the host
is on commercial Wi-Fi, one command updates it from the GitHub repo.

The same bundle runs in two places:

- **USB stick (Linux)** — boot any laptop from it; the data travels on the stick.
- **Windows** — Podman Desktop or Docker Desktop, installed offline once.

The laptops are unmanaged and the network is unclassified, so there are no
boot, licensing-policy or accreditation constraints to design around.

### Decisions

| Question | Decision |
|---|---|
| Where do update images come from? | **Rebuilt on the host** from the existing `prod` Dockerfile targets. No CI needed. Publishing to GHCR from GitHub Actions is a later option if host builds get slow. |
| Port | **80**, so other machines open `http://xcomm.local` (or the host IP). |
| Repo access | **Public** (checked 2026-11-03: readable without credentials). Updates clone and pull over anonymous HTTPS — no key or token on the host. |
| Station log times | **Zulu and server local time**, side by side on every entry. |

## 2. The bundle is the git checkout

The bundle is a clone of the repo plus files git doesn't track, so updating is
`git pull`:

```
xcomm_hud/                  ← git clone
  deploy/bundle/
    compose.prod.yml        ← new: prod stack, no dev bind mounts
    xcomm                   ← new: CLI (bash); xcomm.ps1 for Windows
  .bundle/                  ← gitignored
    images/xcomm-<sha>.tar  ← all 4 images, for an offline (re)install
    xcomm.env               ← secrets, generated on first run
    backups/                ← database + document backups
    exports/                ← station log PDFs (§7)
```

Data lives in container volumes, never inside the checkout, so a `git pull`
cannot touch it.

## 3. Prod compose file — `deploy/bundle/compose.prod.yml`

- Uses the existing `prod` Dockerfile targets, which install packages at build
  time. The dev setup runs `uv sync` / `npm install` at container start, which
  is the main reason it can't run offline.
- **Pinned images:** a specific `postgres:16.x-alpine` and MinIO release, never
  `:latest`. App images are tagged with the git commit
  (`xcomm-hud-api:<sha>`) plus `:current`.
- **Ports:** only the web UI is published, on `0.0.0.0:80`. The API, Postgres
  and MinIO stay on the internal network — the same shape as `deploy/quadlet/`,
  where the web UI already proxies every API call.
- `restart: unless-stopped` on everything, so the stack returns after a reboot.
- Health checks on Postgres, and a new `GET /healthz` on the API that checks
  the database connection.
- The web UI Dockerfile is on Node 20 while `.nvmrc` pins 22; align them here.

## 4. The `xcomm` command

Bash on Linux, PowerShell on Windows, same subcommands:

| Command | What it does |
|---|---|
| `xcomm start` / `stop` / `status` | Bring the stack up or down. Status shows container health, the URL other machines should use, and the running git commit. |
| `xcomm init` | First run: generate secrets with `scripts/gen-env.sh --prod`, load images from `.bundle/images/` if they aren't loaded, print the admin password once. |
| `xcomm update` | Pull and rebuild (§6). |
| `xcomm backup` / `restore <file>` | `pg_dump` plus a copy of the MinIO bucket, into `.bundle/backups/`. |
| `xcomm save-images` | Write the running images to `.bundle/images/`, so a reinstall needs no internet. |
| `xcomm export-log` | Station log PDF (§7). |

## 5. Making the host easy to find

- **USB/Linux host:** advertise `xcomm.local` over mDNS (avahi). Windows 10+,
  macOS and Linux browsers resolve it. The login screen and `xcomm status` also
  show the host's IP as a fallback.
- **Windows host:** the one-time setup adds a firewall rule for port 80.
  Windows can't easily advertise a `.local` name, so others use the IP that
  `xcomm status` prints.
- **Travel router (recommended):** a DHCP reservation gives the host the same
  IP every time — the most reliable option.
- **No HTTPS in the first version.** Plain HTTP on an isolated network is
  workable; a Caddy proxy with its own certificate can come later.

## 6. Updating when connected — `xcomm update`

1. **Preflight:** GitHub must be reachable and the checkout must have no local
   edits. Otherwise stop and explain why.
2. **Show what's changing:** `git fetch`, list the incoming commits, ask to
   continue.
3. **Back up:** an automatic `xcomm backup`.
4. **Rebuild:** `git pull --ff-only`, then rebuild the API and web UI images on
   the host (downloading what they need over the Wi-Fi). The running images are
   retagged `:previous` first.
5. **Restart:** migrations run automatically when the API starts. Wait for
   `/healthz`.
6. **If the health check fails:** switch back to `:previous` and restore the
   step 3 backup. Restore the backup rather than downgrading migrations — some
   migrations can't be reversed safely.
7. **Re-save offline images** (`save-images`), so the bundle on disk always
   matches what's running.

## 7. Station log export — `xcomm export-log`

A master station log: every event, as a PDF, grouped
**workspace → site → section**, chronological within each section.

```
xcomm export-log                          # every workspace
xcomm export-log --workspace garrison     # one workspace (by slug)
xcomm export-log --workspace garrison --site "Site Alpha"
xcomm export-log --from 2026-11-01 --to 2026-11-07
xcomm export-log --out ~/station-log.pdf  # default: .bundle/exports/station-log-<date>.pdf
```

### Where it runs

The PDF is generated by one module in the API (`api/station_log.py`). It is
reached two ways, so the CLI and the app can never disagree about what a log
contains:

- **CLI:** `xcomm export-log` runs the module inside the API container
  (`podman exec … uv run python -m station_log …`). It needs no login, because
  whoever can run commands on the host already owns the data.
- **App:** `GET /workspaces/{id}/station-log.pdf` (admin only), plus an "Export
  station log" button on the workspace page, so a browser on another machine
  can get the same file.

**PDF library: ReportLab.** Pure Python, wheels on PyPI, no system packages.
WeasyPrint would need Pango and friends in the image. It goes in `uv.lock`
like any other dependency, so it's baked into the image and works offline.

### Grouping

Every event row (`validation` table) is placed by its `subject_kind`:

| Section | Subject kinds | How the site is found |
|---|---|---|
| **Personnel** | `personnel_location` and other personnel events | `personnel_location_event` **at the time of the event** — a person who moved shows up under each site they were at |
| **Equipment** | `equipment`, `equipment_capability`, `equipment_link`, `utc_instance` | The equipment's **current** `site_id` (UTC: its home site). Equipment has no location history, so a moved radio's older events land under its new site. |
| **Site & services** | `site_status`, `site_fpcon`, `site_emcon`, `site`, `service`, `gateway`, `service_gateway` | Delivery / gateway / site row → its site |
| **Workspace-wide** | `exercise`, `mission`, `system`, `team`, `unit`, `work_center`, `document`, `doc_page`, `package_instance`, `equipment_asset`, `workspace` | Not one site — its own section at the end of the workspace |

The personnel and equipment sections are the ones asked for. The site &
services and workspace-wide sections are included because otherwise a
"master" log would silently drop those events.

An event whose subject was deleted keeps its stored `subject_label` and goes
under "Unattributed" at the end of the workspace, rather than being dropped.

### What each entry shows

Date-time in **Zulu and in the host's local time** (e.g.
`031430Z NOV 26 · 09:30 EST`), subject, previous → new status, severity, event
type, who recorded it, and the note. The cover names the host's time zone, so
the local column means the same thing to anyone reading the PDF later. Each entry is marked **log** or **event**
(`record_class`). Edited entries are marked as edited. Hidden entries are left
out unless `--include-hidden` is given, which shows them struck through.

### Document layout

- **Cover:** title, scope (workspaces / site / date range), generated-at time,
  host, and the running git commit.
- **Contents and PDF bookmarks** for each workspace and site, so a long log is
  easy to navigate.
- **Running header** (workspace · site) and page *n of m* on every page.
- Event counts per section in the contents.

### Volume

Events are streamed from the database in time order, not loaded all at once.
ReportLab lays pages out incrementally, so a log of tens of thousands of
entries stays fast.

## 8. Platform wrappers (later phases, same bundle)

- **Windows kit:** a folder with the WSL package (`wsl.x.y.msi`), the Podman
  Desktop or Docker Desktop installer, Git for Windows, and the bundle, plus a
  one-page offline install guide. `xcomm.ps1` handles day-to-day use, and a
  scheduled task starts xcomm at boot. (Docker Desktop is free for personal
  use, education and small businesses under 250 people and $10M revenue;
  Podman Desktop is free regardless.)
- **USB stick:** a bootc Linux image containing Podman, git, avahi and the
  bundle, with data on its own partition. At boot it runs `xcomm start` and
  shows the URL on screen. `xcomm update` works there unchanged.

## 9. Phases

1. Prod compose file, `/healthz`, pinned versions, and `xcomm`
   `start` / `stop` / `status` / `init` / `save-images`.
   **Test:** a clean start on a machine with Wi-Fi turned off, reached from a
   second machine's browser.
2. `update`, `backup`, `restore`, including rollback.
   **Test:** a deliberately broken update rolls back cleanly.
3. `export-log` and the API endpoint / button.
   **Test:** a log for a workspace with personnel who moved between sites puts
   their events under each site in turn.
4. Windows kit and guide.
5. USB image.

### Open

Nothing outstanding.

## 10. Phase 1 — as built

### Quick start on a host

```
deploy/bundle/xcomm build          # with internet: build + pull pinned images
deploy/bundle/xcomm save-images    # keep them in .bundle/images/ for offline reinstalls
deploy/bundle/xcomm init           # secrets, port 80 (asks for sudo once), load images
deploy/bundle/xcomm start          # → http://<host-ip>
deploy/bundle/xcomm enable-boot    # start at every boot, no login needed
```

On a machine with no internet, copy the checkout including `.bundle/images/`
and run `init` then `start`; `init` loads the saved images.

### Differences from the plan

- **MinIO is pinned by digest under a local name.** A saved image file can't
  carry a digest reference — the first fresh-machine test loaded MinIO back
  with no name and the stack couldn't start. `xcomm build` now pulls
  `MINIO_PIN` by digest and tags it `localhost/xcomm-hud-minio:current`, which
  is what the compose file runs. The digest lives only in `deploy/bundle/xcomm`.
- **Port 80 under rootless Podman** needs
  `net.ipv4.ip_unprivileged_port_start=80`. `xcomm init` (or
  `xcomm allow-port-80`) writes it to `/etc/sysctl.d/90-xcomm-hud.conf` with
  sudo. The USB image should bake this in.
- **The backend network is `internal`** — Postgres, MinIO and the API have no
  route out at all. Only the web UI is also on a routable network, because an
  internal network can't publish a port.
- **`/healthz`** sits beside the existing `/health`: `/health` is liveness,
  `/healthz` also checks the database. `xcomm start` and `status` check it
  through the web UI (`/api/be/healthz`), so a pass covers
  web UI → API → Postgres.
- **Images:** uv pinned to 0.13.6; web UI moved to Node 22 to match `.nvmrc`;
  `UV_OFFLINE`/`UV_FROZEN`/`UV_NO_SYNC` set in the API runtime;
  `NEXT_TELEMETRY_DISABLED` in the web UI. The web UI image is 1.5 GB because
  it ships the full `node_modules` — Next's `standalone` output would cut that
  a lot (later).
- **Boot start** is a systemd *user* unit plus `loginctl enable-linger`, so the
  stack comes up after a reboot with nobody logged in.

### Verified (2026-11-05)

- Built from this checkout; images labelled with the git commit.
- Stack starts and answers through the web UI; login works.
- The API container reports *Network is unreachable* for an internet address.
- A browser session across login and four app pages made **zero** requests to
  any host other than the xcomm host.
- **Fresh-machine install:** an empty image store, with only the saved
  `.bundle/images/xcomm-*.tar`, loaded exactly the four images and started the
  stack. `xcomm start` refuses to run with an image missing, so it cannot fall
  back to pulling from a registry.
- A document round-trips through MinIO on the internal network.
- The generated boot unit passes `systemd-analyze --user verify`.

Not yet verified: binding port 80 itself (testing used 8080, since lowering
the port limit needs sudo), and a real reboot with `enable-boot`.

### Testing caveat

Don't run `podman system reset` against a throwaway `--root` to clean up a test
store: rootless Podman shares its lock file (`/dev/shm/libpod_rootless_lock_<uid>`)
across stores, and the reset orphaned every running container in the real
store. Delete the throwaway directory instead.
