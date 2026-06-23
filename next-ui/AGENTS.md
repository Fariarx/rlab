# rlab (next-ui) — agent workspace

rlab is the product in this directory: a single-page **agent workspace** (Chats/Projects) that drives four CLI/SDK coding agents. Stack: **Vite 8 + React 19 + MUI v9 + Emotion + MobX**. This file is rlab-specific tribal knowledge; the repo-root `AGENTS.md` (one level up) holds the wider Kanban monorepo conventions (TypeScript principles, code-quality rules, web-ui styling) — follow those too.

This file is high-signal, not comprehensive. Add to it when something was non-obvious, took several tries, or touched files you wouldn't have guessed.

## Architecture
- **Frontend**: SPA under `src`. Routing is a hash-switch (`#/kit`, etc.). App state lives in a MobX store (`src/components/workspace/use-workspace.ts`) and is persisted server-side in an **embedded SQLite database** (`workspace.db`, WAL) — see `workspace-db.ts`. The tree is normalized into `projects`/`conversations`/`messages`/`composer_drafts`/`kv` rows, and message threads load lazily: **`GET /api/workspace` returns a shell** (conversation summaries, projects, drafts, settings) with only the **selected** conversation's thread; other threads load on open via **`GET /api/thread?conversationId=…`** (client `loadThread`, tracked by `fullyLoadedThreadIds`; full-text search first `loadAllThreads`). Do **not** add a UI path that writes the whole workspace back. Full workspace writes are intentionally disabled: `PUT /api/workspace` returns 410, and the client must persist via `POST /api/workspace/mutations` with row-level operations (`upsertConversation`, `deleteConversation`, `upsertMessage`, `replaceConversationThread`, etc.). `initializeWorkspaceStateInDb` is insert-only for an empty DB; there must be no function that can delete/rewrite all projects/conversations/messages from a client payload. The streaming hot path upserts only the single changed message + conversation row. `node:sqlite` is loaded via `process.getBuiltinModule` so bundlers don't choke on the experimental built-in.
- **MobX frontend state**: prefer class stores with explicit `makeObservable(this, { ... })` annotations (`observable`, `computed`, `action.bound`) over React hook state for coordinated app/UI state. Do not use `makeAutoObservable` in new stores. Components that read store data must be wrapped in `observer()`; hooks may create/mount a store, but must not bridge MobX updates through `reaction + setState`.
- **Backend**: `vite-agents-plugin.ts` owns the `/api/*`, `/preview-proxy/*`, terminal WS, agent, wakeup, git, and browser-preview runtime. In dev it is mounted as a Vite plugin. In prod it is mounted by the compiled Node runtime server (`dist-server/prod-server.mjs`) through `attachRlabApi`; Vite is not part of the long-lived prod process.
- **Deploy mental model — read this before redeploying:**
  - **Any prod code change** needs `npm run build` before restart. Frontend bundles into `dist/`; backend runtime bundles into `dist-server/`.
- `bin/rlab.mjs` refuses to start without `dist-server/prod-server.mjs`; it must never run `vite build` inside the prod service.
- A plain `sudo systemctl restart rlab` is only valid for config/data-only restarts when the built artifacts are already current.
- `/api/agents` is intentionally cheap: it reports PATH/env availability only. Live model discovery is `/api/agents?live=1` and must stay manual/user-triggered; running it on startup or periodic background refresh inflates the long-lived Node RSS because V8 keeps the expanded heap.

## Agents
Four agents, dispatched in the `/api/run` handler:
- **claude-code / codex / gemini** — spawned CLIs; their NDJSON streams are translated per-agent into the normalized `RunEvent` stream. Claude runs via `claude -p --output-format stream-json`; do not reintroduce Anthropic SDK layers for chat runs or model discovery. Claude model choices are CLI aliases discovered from the installed CLI binary metadata.
- **opencode** — driven through its **HTTP server** (`opencode serve` + `POST /session/{id}/message`), NOT `opencode run --format json`, which drops the assistant text part for some models. See `runOpenCodeServer`.
- OpenCode can persist `reasoning`/`tool` parts to `~/.local/share/opencode/opencode.db` and then fail the HTTP message request with a low-signal `fetch failed`. `runOpenCodeServer` must recover same-run assistant parts from that SQLite session before surfacing the transport error; otherwise the chat loses the actual reasoning/tool history even though OpenCode wrote it.

### Sessions / resume
Native resume per agent (continuity without replaying the transcript): Claude `--resume <uuid>`; Codex `exec resume <uuid>`; Gemini `--session-id` (new) / `--resume`; OpenCode reuse the `ses_…` id. The conversation stores `sessionId` + `sessionAgent`. On an agent switch native resume is impossible, so the transcript is replayed (`buildAgentPrompt`) behind a confirmation popup. Resume sends only the new user text — input tokens stay tiny, the history is loaded server-side as cache reads.

### Background runs + reload reattach
A run started with a full binding (conversationId / runId / userMessageId+Time / agentMessageId+Time — all six required by `backgroundBindingFromParsed`) keeps running server-side after the client disconnects (in-memory `backgroundRunHandles`, persisted per event). **On reload, reattach from the SERVER's `/api/runs` list (`refreshBackgroundRuns`), NOT the persisted conversation status** — a live run waiting for tool approval can read `error`/no-`activeRunId` in saved state, which the old gate skipped. A streaming run re-asserts `status: running` + `activeRunId` on every event (`backgroundRunStatusPatch`) so a stale "interrupted" reconcile can't strand a still-working agent (blank running indicator, no stop button).
- **Pending message queue is server-owned.** Do not reintroduce a client in-memory FIFO for messages typed while an agent is running. Queued turns live in SQLite (`pending_turns` + `pending_queue_state`) and are mutated only through `/api/queue`; the client may mirror the snapshot for UI, but it must never dispatch queued runs itself. Server drain claims one row (`queued` → `dispatching`), starts `/api/run`, deletes the row once the run is accepted, pauses/requeues only if the run was not accepted, and `resetDispatchingPendingTurns()` requeues half-claimed rows on restart. Stop/cancel pauses the server queue so a user stop cannot immediately launch the next queued turn.

### Context window / limits (cost)
Per-message limit drain is dominated by **cacheRead = context size × tool round-trips**. Claude auto-compact settings are passed to the CLI with `--settings '{"autoCompactEnabled":true}'` plus `autoCompactWindow` when set; keep this on the CLI invocation, not in an SDK layer. Codex/Gemini/OpenCode auto-compact internally. The composer menu shows context-window fill via `contextTokens` = input+cache of the turn's **final** model call (captured in the Claude translator from the last `assistant` message — NOT the turn-summed `cacheReadTokens`). The biggest cost lever is keeping conversations short (fresh chats), not forcing more tool parallelism.
- **Compaction controls (composer)**: auto-compact + the compaction window are **per-conversation** (`ConversationSummary.compaction`, sent on every run as `autoCompact`/`compactWindow`; Claude CLI receives them through `--settings`). A small ring next to the composer options button shows fill % (`ContextGauge`), and over 100% a warning offers compaction. **Manual compaction sends the agent's compact slash command as a turn on the resumed session** — Claude/Codex/OpenCode `/compact`, Gemini `/compress` (`compactCommandForAgent`). `runTurn(id, msg, { promptOverride })` decouples the visible bubble text from the command actually sent. **Two gotchas (cost real debugging):** (1) a `/compact` turn streams NO chat content — its summary/confirmation lives only in the `result` message, which the translator otherwise drops, leaving an empty agent bubble that renders as TypingDots forever (`Message.tsx` shows dots for any `blocks.length===0`). The translator tracks `ClaudeStreamState.producedContent` and surfaces `result` text as a status when a successful turn produced nothing. (2) NEVER start a compaction while a run is active — `runTurn` cancels the in-flight run and resuming the same native session under a second concurrent claude process strands BOTH turns. `compactConversation` bails if `this.runs.has(id)` and the composer disables the trigger while `running`.

## Running it (commands)
Run everything from this directory.
```bash
npm run dev          # dev server → http://localhost:5187 (vite, host 0.0.0.0)
npm run typecheck    # tsc --noEmit
npm run lint         # biome lint src  (lint only; formatter off; code is 2-space — don't reformat)
npm test             # NODE_ENV=test vitest run  (WITHOUT NODE_ENV=test the suite fails)
npm run build        # tsc --noEmit && vite build && server build → dist/ + dist-server/
npm run serve        # production runtime from dist/ + dist-server/ (no Vite)
npm run smoke:agents # quick agent smoke run
```
`npm install` drops devDeps unless you pass `--include=dev`.

### Deploy to prod
The prod service is named **`rlab`** (not `rlab-prod` or anything else).
```bash
# code change — MUST build first, else prod runs the old client/server bundle:
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
edit → `npm run typecheck` → `npm test` → `npm run build` → `sudo systemctl restart rlab` → `curl …/api/agents` and reload the page to verify. Do not commit unless asked.
- Agent shell commands launched from the production chat inherit prod env (`RLAB_DATA_DIR=/home/kanban/.rlab-prod`, `PORT=4280`, `NODE_ENV=production`). Keep dev/test scripts explicitly pinned to non-prod data dirs (currently `.data-dev` / `.data-test`) and do not run raw `vite`/`vitest` from an rlab chat without setting `RLAB_DATA_DIR`, or the dev process can read/write prod SQLite/agent-limit files.

## Prod
- systemd unit `rlab`: `User=kanban` (NOT root), `HOST=127.0.0.1`, `PORT=4280`, `RLAB_DATA_DIR=/home/kanban/.rlab-prod`, `NODE_ENV=production`, runs `bin/rlab.mjs`. `RLAB_DEMO=1` seeds demo data.
- Bound to localhost only; public access goes through Caddy with a token-in-link login that sets a cookie. Agents run as `kanban` (their creds live under `/home/kanban`). Never run the service as root.

## Gotchas
- **Frequent `Workspace save failed (502)` = the event loop is blocked by persistence, NOT a proxy fault.** This was the JSON-blob era: the whole state was rewritten on every streamed token, so a few-MB state + a streaming run pinned the loop (sync `JSON.stringify` of MBs) and every UI `PUT /api/workspace` queued behind it → Caddy **502** (and `GET /api/health` taking 20s while `storage.ok` is `true`). The fix is the current SQLite row store (`workspace-db.ts`): the streaming hot path now upserts one message row (~KBs), not the whole tree. If 502s ever recur, confirm it's the loop (not the proxy) with `ps -o %cpu` on the rlab node (spinning) and the listen-socket backlog `ss -ltn 'sport = :4280'` (a non-zero `Recv-Q` = the loop isn't accepting), then look for whatever is doing O(state) sync work per event.
- **`src/components/ui/` re-exports MUI v9 directly** (`Button`, `Switch`, `TextField`, `CircularProgress`, …). So use the **MUI** API here, NOT the Tailwind `ui` primitives the repo-root `AGENTS.md` describes (that doc is the `web-ui`/kanban Button with `variant="default|primary|danger|ghost"`, `icon`, `fill` — wrong project). In next-ui it's `variant="contained|outlined|text"`, `size="small"`, `startIcon`, `fullWidth`. And MUI v9 dropped `inputProps`: pass `slotProps={{ input: {…} }}` (Switch/checkbox) or `slotProps={{ htmlInput: {…} }}` (TextField) instead — `inputProps` is a type error.
- `pkill -f "<pattern matching the running shell>"` self-matches and exits 143/144 — run the remaining steps of a chained command separately.
- **The prod worktree is shared.** If another agent edits these files concurrently, your edits or a `dist` rebuild can be clobbered — check `git status` / mtimes before assuming an unexpected change is yours.
- react-virtuoso (chat thread) calls `computeItemKey`/`itemContent` with an out-of-range `undefined` item during data transitions — guard the deref or one bad index white-screens the whole thread.
- Full-screen overlays opened from chat messages (image lightbox, future context menus) must render through a portal. Message rows use transform-based entrance animations (`rise`), and transformed ancestors make `position: fixed` descendants size against the message box instead of the viewport.
- `useI18n()` without an `I18nProvider` returns a fresh fallback object/function each render (common in tests using `renderWithTheme`). Do not put `t` directly in deps for effects that fetch and then write state; keep the current translator in a ref, or the effect can loop forever after each resolved fetch.
- The single state blob can grow to multiple MB on a long thread → slow first load; favour fresh conversations + compaction.
- Native folder pickers (`zenity`/`kdialog`) are absent on headless remote Linux — use manual path entry, don't require desktop packages.

## Where things are
Source:
- `vite-agents-plugin.ts` — the entire backend (run dispatch, per-agent translators, sessions, background runs, limits, browser bridge).
- `src/components/workspace/use-workspace.ts` — MobX store, persistence, background-run reattach.
- `src/components/workspace/run-agent.ts` — client run stream + event→block mapping.
- `src/components/agent/` — chat rendering (`Message`, `Conversation`, `parts`, `Composer`).
- `bin/rlab.mjs` — prod entrypoint; imports the compiled `dist-server/prod-server.mjs` and never imports Vite.

Runtime (prod):
- Ports: dev `5187`, prod `4280` (localhost only; public via Caddy + token-in-link).
- `/home/kanban/.rlab-prod/workspace.db` (+ `-wal`/`-shm`) — the SQLite workspace store (all conversations + threads).
- `/home/kanban/.rlab-prod/run-audit.ndjson` — per-run audit log; `…/attachments/` — uploaded files.
- `/home/kanban/.claude/projects/<project-hash>/<session-id>.jsonl` — Claude session transcripts (for resume).
