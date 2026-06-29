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
  (8001), and the webui (3001) so it can run side-by-side with a local scoi
  stack.

## Quickstart

```sh
cp .env.example .env

# generate XCOMM_HUD_SECRET_KEY and paste into .env:
python3 -c 'import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())'

podman-compose up --build
```

Open <http://localhost:3001> and sign in with the initial admin
(`admin` / `changeme` by default — change in `.env`).

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
