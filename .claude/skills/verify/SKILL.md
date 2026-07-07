---
name: verify
description: Drive the running xcomm_hud webui in a headless browser to verify UI changes end-to-end (login, navigate, screenshot).
---

# Verify xcomm_hud changes in the running app

## Stack

Dev servers are normally already running (don't restart them):
- webui: http://localhost:3001 (Next.js), api: http://localhost:8001, postgres: 5433

Quick liveness: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001` → 307.

## Login

Admin credentials: username `admin`, password from
`XCOMM_HUD_INITIAL_ADMIN_PASSWORD` in the repo-root `.env` (NOT the README
default). Read it with:
`grep '^XCOMM_HUD_INITIAL_ADMIN_PASSWORD=' .env | cut -d= -f2-`
Login form at `/login` has `input[name=username]`, `input[name=password]`
(a Next server action — after submit, wait for the URL to leave /login).
After login you land on `/w/<workspace>/sites`; take the workspace slug from
the URL (dev data uses `garrison`).

## Headless browser (NixOS — no system chrome)

Playwright browsers are cached in `~/.cache/ms-playwright/` but the full
chromium build is missing shared libs. What works:

1. `npm install playwright-core` in a scratch dir (no browser download).
2. Launch the **headless shell** binary with nix libs:
   - executablePath: `~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell`
   - env `LD_LIBRARY_PATH=/nix/store/r3xzlgl78p1c9fdsp98yabc857fhy4q0-system-path/lib:/nix/store/gp3ppfgjv0kljmk0qi20gkpzi33vgqyq-mesa-libgbm-25.1.0/lib`
   - If a lib is still missing, `find /nix/store -maxdepth 4 -name <lib>` and
     append its dir to LD_LIBRARY_PATH.

## Gotchas

- **Never wait for `networkidle`** — the app keeps a live SSE/pubsub stream
  open, so it never fires. Use `domcontentloaded` + short timeouts.
- Tab-style controls (ViewTabs) are `role="tab"`; use
  `getByRole("tab", { name, exact: true })`.
- Login logs a pageerror `Performance.measure … 'RootRedirect' cannot have a
  negative time stamp` — react-dom's dev-only Server Components performance
  track (unfixed as of react 19.2.7), not app code, absent in prod builds.
- Flows worth driving: /w/&lt;ws&gt;/personnel (grouping tabs + list/graph),
  /w/&lt;ws&gt;/sites/&lt;id&gt;?tab=personnel, service graph on the site Services tab.
