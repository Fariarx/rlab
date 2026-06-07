# rlab

**rlab** is a local web workspace for running coding agents (Claude Code, Codex,
Gemini, OpenCode) with chat, git, browser preview, and worktrees.

The source lives in [`next-ui/`](./next-ui). The repository root only provides
convenience scripts that delegate to it.

## Quick start

```bash
npm run install:all   # install rlab dependencies
npm run dev           # dev server  -> http://localhost:5187
npm start             # production server -> http://0.0.0.0:4280
```

…or run the published package directly:

```bash
npx rlab
```

See **[next-ui/README.md](./next-ui/README.md)** for full documentation:
requirements, the production server, the demo-data flag (`RLAB_DEMO`), data
location (`RLAB_DATA_DIR`), and how to run it as a service.

## Root scripts

| Script                  | Delegates to rlab        |
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
