# rlab — agent workspace

A local web UI for running coding agents (Claude Code, Codex, Gemini, OpenCode)
with chat, git, browser preview, and worktrees. It is a self-contained
Vite + React single-page app whose `/api` backend is provided by a Vite plugin
(`vite-agents-plugin.ts`), so the same process serves the UI and talks to the
agent CLIs installed on your machine.

> Single-user, local-first. The server has no authentication and is meant to be
> run by one person on their own machine (or behind their own tunnel/VPN).
> Multi-user support is not implemented yet.

## Requirements

- **Node.js >= 20**
- One or more **agent CLIs on your `PATH`** for live runs. Detected automatically
  at `GET /api/agents`:
  - `claude` — Claude Code
  - `codex` — Codex
  - `gemini` — Gemini
  - `opencode` — OpenCode

  The app still loads if none are installed; agents simply show as unavailable.

## Quick start (production)

The fastest way to run a production instance:

```bash
# from a published package
npx rlab

# …or from a checkout of this folder
npm install
npm start
```

`npm start` (and the `npx` bin) runs `bin/rlab.mjs`, which:

1. builds the app once if no `dist/` is present (subsequent starts reuse it), and
2. serves the built SPA **and** the `/api` backend on a single port.

By default it binds `http://0.0.0.0:4280`. Override with environment variables:

| Variable          | Default      | Purpose                                                            |
| ----------------- | ------------ | ------------------------------------------------------------------ |
| `PORT`            | `4280`       | Port to bind.                                                      |
| `HOST`            | `0.0.0.0`    | Interface to bind (`127.0.0.1` to keep it local-only).            |
| `RLAB_DEMO`    | _(unset)_    | Set to `1` to seed demo conversations on first run.               |
| `RLAB_DATA_DIR`| `./.data`    | Where persisted workspace state is stored (relative or absolute). |

```bash
PORT=8080 HOST=127.0.0.1 npm start
```

### Empty by default

In production the workspace starts **empty** — no fake conversations or
projects. State is persisted to `RLAB_DATA_DIR` (`.data/` by default) the
first time the server runs. To preview the app with sample data, start it with
`RLAB_DEMO=1` (this only affects the *first* seed; an existing state file is
always loaded as-is).

### Running as a service

`bin/rlab.mjs` is a plain long-running Node process, so it wraps cleanly in
`systemd`, `pm2`, Docker, etc. Point `RLAB_DATA_DIR` at a writable data volume
and set `PORT`/`HOST` as needed. Example `systemd` unit:

```ini
[Service]
ExecStart=/usr/bin/npx rlab
Environment=PORT=4280
Environment=HOST=127.0.0.1
Environment=RLAB_DATA_DIR=/var/lib/rlab
Restart=on-failure
```

## Development

```bash
npm install
npm run dev      # http://localhost:5187
```

The dev server seeds **demo conversations** automatically (dev mode implies
`RLAB_DEMO`), so you have something to look at immediately.

> **Restart caveat:** the `/api` backend lives in `vite-agents-plugin.ts`. Vite
> HMR does **not** reload plugin middleware, so changes to that file (or anything
> it imports on the server side) require a full dev-server restart to take effect.

## Scripts

| Script                 | What it does                                                    |
| ---------------------- | -------------------------------------------------------------- |
| `npm run dev`          | Dev server with HMR on port 5187 (demo data seeded).           |
| `npm run build`        | Type-check and build the production bundle into `dist/`.       |
| `npm start`            | Build-if-needed and serve the prod SPA + API (`bin/rlab.mjs`). |
| `npm run serve`        | Serve an existing `dist/` via `vite preview`.                  |
| `npm run typecheck`    | `tsc --noEmit`.                                                 |
| `npm run lint`         | Biome lint over `src` (`lint:fix` to auto-fix).                |
| `npm test`             | Vitest unit/integration suite.                                 |
| `npm run test:e2e`     | Playwright smoke tests (builds + serves, then drives a browser). |

## Project layout

- `src/` — the React app (components, theme, i18n, workspace state).
- `vite-agents-plugin.ts` — the `/api` backend: agent detection, runs, git,
  browser preview, workspace persistence.
- `bin/rlab.mjs` — the production launcher.
- `tests/` — Vitest specs; `tests/e2e/` — Playwright specs.
