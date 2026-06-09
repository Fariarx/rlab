# rlab (next-ui) — agent workspace

rlab is the product in this directory: a single-page **agent workspace** (Chats/Projects) that drives four CLI/SDK coding agents. Stack: **Vite 8 + React 19 + MUI v9 + Emotion + MobX**. This file is rlab-specific tribal knowledge; the repo-root `AGENTS.md` (one level up) holds the wider Kanban monorepo conventions (TypeScript principles, code-quality rules, web-ui styling) — follow those too.

This file is high-signal, not comprehensive. Add to it when something was non-obvious, took several tries, or touched files you wouldn't have guessed.

## Architecture
- **Frontend**: SPA under `src/`. Routing is a hash-switch (`#/kit`, etc.). App state lives in a MobX store (`src/components/workspace/use-workspace.ts`) and is persisted server-side as **one JSON blob** (`workspace-state.json`).
- **Backend**: `vite-agents-plugin.ts` — a Vite plugin that serves `/api/*` via connect middleware in **both** `configureServer` (dev) and `configurePreviewServer` (prod preview). There is no separate server process; `bin/rlab.mjs` runs `vite preview`.
- **Deploy mental model — read this before redeploying:**
  - **Backend** changes (`vite-agents-plugin.ts`) load **from source on restart, no rebuild** — `vite preview` loads the plugin TS at boot. Just `sudo systemctl restart rlab`.
  - **Frontend** changes (anything under `src/`) **need `npm run build`** — they're bundled into `dist/`, which preview serves statically. Forgetting this means prod silently runs the old UI.

## Agents
Four agents, dispatched in the `/api/run` handler:
- **claude-code** — `@anthropic-ai/claude-agent-sdk` `query()` in-process. Options built in `buildClaudeSdkOptions`. Prefer SDK-provided types/settings over re-deriving them.
- **codex / gemini** — spawned CLIs; their NDJSON streams are translated per-agent into the normalized `RunEvent` stream.
- **opencode** — driven through its **HTTP server** (`opencode serve` + `POST /session/{id}/message`), NOT `opencode run --format json`, which drops the assistant text part for some models. See `runOpenCodeServer`.

### Sessions / resume
Native resume per agent (continuity without replaying the transcript): Claude `options.resume`; Codex `exec resume <uuid>`; Gemini `--session-id` (new) / `--resume`; OpenCode reuse the `ses_…` id. The conversation stores `sessionId` + `sessionAgent`. On an agent switch native resume is impossible, so the transcript is replayed (`buildAgentPrompt`) behind a confirmation popup. Resume sends only the new user text — input tokens stay tiny, the history is loaded server-side as cache reads.

### Background runs + reload reattach
A run started with a full binding (conversationId / runId / userMessageId+Time / agentMessageId+Time — all six required by `backgroundBindingFromParsed`) keeps running server-side after the client disconnects (in-memory `backgroundRunHandles`, persisted per event). **On reload, reattach from the SERVER's `/api/runs` list (`refreshBackgroundRuns`), NOT the persisted conversation status** — a live run waiting for tool approval can read `error`/no-`activeRunId` in saved state, which the old gate skipped. A streaming run re-asserts `status: running` + `activeRunId` on every event (`backgroundRunStatusPatch`) so a stale "interrupted" reconcile can't strand a still-working agent (blank running indicator, no stop button).

### Context window / limits (cost)
Per-message limit drain is dominated by **cacheRead = context size × tool round-trips**. We pass **`settings: { autoCompactEnabled: true }`** to the Claude SDK because the headless SDK does NOT auto-compact by default (the interactive CLI does); without it a resumed long session re-reads the full uncompacted history on every round-trip — millions of cache-read tokens per message. Codex/Gemini/OpenCode auto-compact internally. The composer menu shows context-window fill via `contextTokens` = input+cache of the turn's **final** model call (captured in the Claude translator from the last `assistant` message — NOT the turn-summed `cacheReadTokens`). The biggest cost lever is keeping conversations short (fresh chats), not forcing more tool parallelism (Claude already batches independent calls; we auto-approve in parallel).
- **Compaction controls (composer)**: auto-compact + the compaction window are **per-conversation** (`ConversationSummary.compaction`, sent on every run as `autoCompact`/`compactWindow`; the SDK keys are `settings.autoCompactEnabled` / `settings.autoCompactWindow`, both on the SDK `Settings` type — window defaults to the model's full window via `contextWindowForModel`). A small ring next to the composer options button shows fill % (`ContextGauge`), and over 100% a warning offers compaction. **Manual compaction sends the agent's compact slash command as a turn on the resumed session** — Claude/Codex/OpenCode `/compact`, Gemini `/compress` (`compactCommandForAgent`). Claude's SDK processes `/compact` natively; for the other agents it's best-effort (may land as a literal message). `runTurn(id, msg, { promptOverride })` decouples the visible bubble text from the command actually sent.

## Running it (commands)
Run everything from this directory.
```bash
npm run dev          # dev server → http://localhost:5187 (vite, host 0.0.0.0)
npm run typecheck    # tsc --noEmit
npm run lint         # biome lint src  (lint only; formatter off; code is 2-space — don't reformat)
npm test             # NODE_ENV=test vitest run  (WITHOUT NODE_ENV=test the suite fails)
npm run build        # tsc --noEmit && vite build  → bundles the frontend into dist/
npm run smoke:agents # quick agent smoke run
```
`npm install` drops devDeps unless you pass `--include=dev`.

### Deploy to prod
The prod service is named **`rlab`** (not `rlab-prod` or anything else).
```bash
# backend change (vite-agents-plugin.ts) — restart picks it up from source, no build:
sudo systemctl restart rlab
# frontend change (anything under src/) — MUST build first, else prod silently runs the old UI:
npm run build && sudo systemctl restart rlab
```

### Health / debugging
```bash
systemctl is-active rlab
curl -s http://127.0.0.1:4280/api/agents            # all 4 agents should be "available"
sudo journalctl -u rlab -n 30 --no-pager            # logs on failure
# live-test a run:
curl -s -X POST http://127.0.0.1:4280/api/run -H "Content-Type: application/json" \
  -d '{"agent":"claude-code","model":"default","reasoning":"default","mode":"default","accessMode":"unrestricted","cwd":"/tmp","prompt":"say ok"}'
```

### Dev loop
edit → `npm run typecheck` → `npm test` → (if you touched `src/`) `npm run build` → `sudo systemctl restart rlab` → `curl …/api/agents` and reload the page to verify. Do not commit unless asked.

## Prod
- systemd unit `rlab`: `User=kanban` (NOT root), `HOST=127.0.0.1`, `PORT=4280`, `RLAB_DATA_DIR=/home/kanban/.rlab-prod`, `NODE_ENV=production`, runs `bin/rlab.mjs`. `RLAB_DEMO=1` seeds demo data.
- Bound to localhost only; public access goes through Caddy with a token-in-link login that sets a cookie. Agents run as `kanban` (their creds live under `/home/kanban`). Never run the service as root.

## Gotchas
- **`src/components/ui/` re-exports MUI v9 directly** (`Button`, `Switch`, `TextField`, `CircularProgress`, …). So use the **MUI** API here, NOT the Tailwind `ui` primitives the repo-root `AGENTS.md` describes (that doc is the `web-ui`/kanban Button with `variant="default|primary|danger|ghost"`, `icon`, `fill` — wrong project). In next-ui it's `variant="contained|outlined|text"`, `size="small"`, `startIcon`, `fullWidth`. And MUI v9 dropped `inputProps`: pass `slotProps={{ input: {…} }}` (Switch/checkbox) or `slotProps={{ htmlInput: {…} }}` (TextField) instead — `inputProps` is a type error.
- `pkill -f "<pattern matching the running shell>"` self-matches and exits 143/144 — run the remaining steps of a chained command separately.
- **The prod worktree is shared.** If another agent edits these files concurrently, your edits or a `dist` rebuild can be clobbered — check `git status` / mtimes before assuming an unexpected change is yours.
- react-virtuoso (chat thread) calls `computeItemKey`/`itemContent` with an out-of-range `undefined` item during data transitions — guard the deref or one bad index white-screens the whole thread.
- The single state blob can grow to multiple MB on a long thread → slow first load; favour fresh conversations + compaction.
- Native folder pickers (`zenity`/`kdialog`) are absent on headless remote Linux — use manual path entry, don't require desktop packages.

## Where things are
Source:
- `vite-agents-plugin.ts` — the entire backend (run dispatch, per-agent translators, sessions, background runs, limits, browser bridge).
- `src/components/workspace/use-workspace.ts` — MobX store, persistence, background-run reattach.
- `src/components/workspace/run-agent.ts` — client run stream + event→block mapping.
- `src/components/agent/` — chat rendering (`Message`, `Conversation`, `parts`, `Composer`).
- `bin/rlab.mjs` — prod entrypoint (`vite preview`).

Runtime (prod):
- Ports: dev `5187`, prod `4280` (localhost only; public via Caddy + token-in-link).
- `/home/kanban/.rlab-prod/workspace-state.json` — the single state blob (all conversations + threads).
- `/home/kanban/.rlab-prod/run-audit.ndjson` — per-run audit log; `…/attachments/` — uploaded files.
- `/home/kanban/.claude/projects/<project-hash>/<session-id>.jsonl` — Claude session transcripts (for resume).
