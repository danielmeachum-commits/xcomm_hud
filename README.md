# xcomm_hud

Parent aggregator app for the scoi family. Where scoi runs per-enclave for ops
teams, xcomm_hud sits above it as a leadership-facing dashboard, designed to
aggregate manually-entered (and eventually pushed) data across many enclaves.

## What it tracks

- **Sites** — physical locations.
- **UTCs** — equipment packages under a site. *Optional* — equipment can also be
  shared / unassigned.
- **Equipment** — routers, switches, servers, crypto devices, phones, etc. Lives
  at a site, optionally inside a UTC.
- **Services** — logical services (VoIP, data, video, crypto, …) with a hosting
  type (self / cloud / hybrid). A service can pull components from many UTCs or
  sites; status rolls up as worst-of required components.
- **Enclave sources** — registry of upstream scoi instances and their ingest
  tokens (stub for future push from scoi enclaves).

## Stack

- **api/** — FastAPI + SQLAlchemy 2 + Alembic + Postgres 16.
- **webui/** — Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn/ui.
- **Compose** — `podman-compose.yml` brings up Postgres (host port 5433), API
  (8001), and MinIO (9000/9001); the webui runs on the host (3001) so it can
  run side-by-side with a local scoi stack.

## Quickstart

```sh
./scripts/setup.sh        # or: npm run setup
```

Safe to re-run. It checks for podman and a compose provider
(`sudo apt install podman-compose`), writes `.env` with generated secrets if
there isn't one, and installs the webui's dependencies. Then:

```sh
podman-compose -f podman-compose.yml up --build
npm --prefix webui run dev:host          # in a second terminal
```

Open <http://localhost:3001> and sign in with the initial admin
(`admin` / `changeme` by default — change in `.env`).

## Running in production

The whole stack runs as systemd services through Podman Quadlet — unit files
live in `deploy/quadlet/`.

```sh
./scripts/install-services.sh              # rootless user services (default)
sudo ./scripts/install-services.sh         # or system services
./scripts/install-services.sh --port 8080  # publish the webui elsewhere
```

The first run generates secrets — including a random admin password — into
`~/.config/xcomm-hud/xcomm-hud.env` (`/etc/xcomm-hud/` as root). Re-run after
pulling new code to rebuild the api and webui images and restart them; data
volumes are left alone. `--uninstall` removes the units but keeps the data.

For rootless services to start at boot and survive logout, enable lingering
once: `sudo loginctl enable-linger $USER`. Only the webui is published; put a
reverse proxy in front of it for TLS.

## First-run walkthrough

1. **Add a site** at `/sites` (e.g. "Site Alpha", classification U).
2. Open the site → **Add UTC** (e.g. "UTC-1") → **Add equipment** under it.
3. Add a second piece of equipment with no UTC; it lands in the
   *Shared / unassigned* bucket on the site page.
4. **Add a service** at `/services` (e.g. "VoIP-East", kind `voip`, hosting
   `hybrid`, leave `site_id` empty for cross-site).
5. Open the service detail → **Attach equipment** from multiple sites/UTCs.
6. Toggle equipment status; service rollup updates worst-of.
7. As admin, create an **enclave source** via `POST /enclave-sources` (admin
   API) to receive a one-time ingest token. Use it with
   `POST /ingest` (header `X-Ingest-Token: <token>`).

## What's stubbed

- `/ingest` validates the token and logs the payload, but does not write
  through to equipment/services yet.
- No scoi-side push job exists yet — wire that up when you're ready to
  switch from manual input to live aggregation.
- No map rendering for site `lat`/`lon` (data is captured, view is TODO).
- No timeline view over `status_event` yet.
