# kanban

This repository's product is **[next-ui](./next-ui)** — a local web workspace for
running coding agents (Claude Code, Codex, Gemini, OpenCode) with chat, git,
browser preview, and worktrees.

Everything lives in [`next-ui/`](./next-ui). The root only provides convenience
scripts that delegate to it.

## Quick start

```bash
npm run install:all   # installs next-ui dependencies
npm run dev           # dev server  -> http://localhost:5187
npm start             # production server -> http://0.0.0.0:4280
```

See **[next-ui/README.md](./next-ui/README.md)** for full documentation:
requirements, the production server, the demo-data flag (`NEXT_UI_DEMO`), data
location (`NEXT_UI_DATA_DIR`), and how to run it as a service.

## Root scripts

| Script                  | Delegates to next-ui     |
| ----------------------- | ------------------------ |
| `npm run install:all`   | `npm install`            |
| `npm run dev`           | `npm run dev`            |
| `npm run build`         | `npm run build`          |
| `npm start`             | `npm start`              |
| `npm run typecheck`     | `npm run typecheck`      |
| `npm run lint`          | `npm run lint`           |
| `npm test`              | `npm run test`           |
| `npm run test:e2e`      | `npm run test:e2e`       |

## License

Apache-2.0 — see [LICENSE](./LICENSE).
