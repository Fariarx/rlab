import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import { type ChatMessage, type ConversationSummary, type Project } from "../agent";

/** The detailed sample thread (flaky-test investigation). */
const flakyThread: readonly ChatMessage[] = [
  { id: "u1", role: "user", time: "14:02", text: "Investigate the flaky `auth.login` test and propose a fix." },
  {
    id: "a1",
    role: "agent",
    time: "14:02",
    blocks: [
      {
        kind: "reasoning",
        duration: "6s",
        text: "The suite passes on retry, which smells like a timing dependency. Likely the token-expiry assertion reads the real clock. I'll reproduce, read the test, confirm the clock usage, then switch to fake timers.",
      },
      { kind: "text", text: "I'll reproduce the failure first, then inspect the test and how it measures token expiry." },
      {
        kind: "plan",
        steps: [
          { label: "Reproduce the flake", state: "ok" },
          { label: "Read the failing test", state: "ok" },
          { label: "Patch the clock handling", state: "running" },
          { label: "Verify across runs", state: "pending" },
        ],
      },
      { kind: "command", command: "npm test -- auth.login", state: "ok", exitCode: 0, output: "✓ auth.login (1 retry)\n1 flaky · passed on attempt 2/2" },
      {
        kind: "tool",
        name: "read_file",
        summary: "test/auth/login.test.ts",
        state: "ok",
        duration: "120ms",
        args: { path: "test/auth/login.test.ts", range: "40-72" },
        output: "expect(token.expiresAt).toBeGreaterThan(Date.now() + 3600_000);",
      },
      {
        kind: "search",
        query: "vitest fake timers token expiry flaky",
        state: "ok",
        results: [
          { title: "Vitest — Fake Timers (vi.useFakeTimers)", url: "vitest.dev/api/vi#vi-usefaketimers" },
          { title: "RFC 0042 — deterministic clocks in tests", url: "rlab/rfcs/0042-clocks" },
        ],
      },
      { kind: "text", text: "Root cause confirmed: the test compares `expiresAt` against the real `Date.now()`, so it flakes under load. Switching to fake timers makes it deterministic." },
      {
        kind: "diff",
        file: "test/auth/login.test.ts",
        additions: 4,
        deletions: 2,
        lines: [
          { type: "ctx", text: "describe('auth.login', () => {" },
          { type: "add", text: "  beforeEach(() => vi.useFakeTimers());" },
          { type: "add", text: "  afterEach(() => vi.useRealTimers());" },
          { type: "del", text: "  it('issues a token', async () => {" },
          { type: "add", text: "  it('issues a token', async () => {" },
          { type: "del", text: "    expect(token.expiresAt).toBeGreaterThan(Date.now() + 3600_000);" },
          { type: "add", text: "    expect(token.expiresAt).toBe(NOW + 3600_000);" },
          { type: "ctx", text: "  });" },
        ],
      },
      { kind: "approval", title: "Apply patch to test/auth/login.test.ts?", detail: "Switches the suite to deterministic fake timers (vi.useFakeTimers)." },
      {
        kind: "options",
        prompt: "How thoroughly should I verify the fix?",
        options: [
          { id: "once", label: "Run once", description: "Fast sanity check." },
          { id: "stress", label: "Stress run · 50×", description: "Confirm the flake is gone." },
          { id: "ci", label: "CI only", description: "Defer to the pipeline." },
        ],
      },
      { kind: "status", level: "ok", text: "Patch staged · 1 file changed" },
      { kind: "text", text: "Want me to open a PR with this fix?", streaming: true },
      {
        kind: "suggested",
        actions: [
          { id: "pr", label: "Open PR", icon: <ArrowForwardIcon sx={{ fontSize: 15 }} />, tone: "primary" },
          { id: "rerun", label: "Re-run tests", icon: <RefreshIcon sx={{ fontSize: 15 }} /> },
          { id: "copy", label: "Copy patch", icon: <ContentCopyIcon sx={{ fontSize: 15 }} /> },
        ],
      },
    ],
  },
];

const releaseThread: readonly ChatMessage[] = [
  { id: "u1", role: "user", time: "15:12", text: "Draft release notes for 0.1.69 from the merged PRs." },
  {
    id: "a1",
    role: "agent",
    time: "15:12",
    blocks: [
      { kind: "reasoning", duration: "3s", text: "I'll list merged PRs since the last tag, group them by type, and write a concise changelog." },
      { kind: "command", command: "git log v0.1.68..HEAD --oneline", state: "ok", exitCode: 0, output: "cb1bf3d chore(deps): pin protobufjs\n00598a3 fix: keep Codex hook config\n7cb95e1 fix: pretrust Kanban Codex hooks" },
      { kind: "code", language: "md", code: "## 0.1.69\n- fix: keep Codex hook config before resume\n- fix: pretrust Kanban Codex hooks\n- chore(deps): pin protobufjs to 7.5.8" },
      { kind: "text", text: "Draft is ready. Want me to open a PR updating CHANGELOG.md?", streaming: true },
      { kind: "suggested", actions: [{ id: "pr", label: "Open PR", icon: <ArrowForwardIcon sx={{ fontSize: 15 }} />, tone: "primary" }, { id: "copy", label: "Copy", icon: <ContentCopyIcon sx={{ fontSize: 15 }} /> }] },
    ],
  },
];

/** Generic thread for conversations without a bespoke script. */
export function genericThread(title: string): ChatMessage[] {
  return [
    { id: "u1", role: "user", time: "·", text: title },
    {
      id: "a1",
      role: "agent",
      time: "·",
      blocks: [
        { kind: "reasoning", duration: "2s", text: `Scoping “${title}” — gathering context from the workspace before acting.` },
        { kind: "text", text: `On it. I'll work on “${title}” and report back with concrete changes.` },
        { kind: "suggested", actions: [{ id: "go", label: "Proceed", tone: "primary" }, { id: "scope", label: "Refine scope" }] },
      ],
    },
  ];
}

/** Empty starter thread for a freshly created chat. */
export function starterThread(): ChatMessage[] {
  return [];
}

export const initialChats: readonly ConversationSummary[] = [
  { id: "chat-2", title: "Draft release notes for 0.1.69", snippet: "Writing the changelog…", time: "15:12", status: "running", agent: "codex", unread: true },
  { id: "chat-3", title: "Postgres vs SQLite for us", snippet: "Needs input: expected QPS?", time: "14:05", status: "waiting", agent: "gemini", unread: true },
  { id: "chat-1", title: "Explain our auth flow", snippet: "Walked through the token lifecycle", time: "13:40", status: "done", agent: "claude-code" },
  { id: "chat-5", title: "Summarize incident #4127", snippet: "Failed to fetch the log bundle", time: "Mon", status: "error", agent: "claude-code" },
  { id: "chat-4", title: "Brainstorm onboarding copy", snippet: "Draft saved", time: "Mon", status: "idle", agent: "amp" },
];

export const initialProjects: readonly Project[] = [
  {
    id: "auth-service",
    name: "auth-service",
    path: "/root/workspace/rlab",
    conversations: [
      { id: "c-flaky", title: "Flaky auth.login test", snippet: "Switched the suite to fake timers", time: "14:02", status: "running", agent: "claude-code", unread: true },
      { id: "c-jwt", title: "Rotate JWT secrets", snippet: "Waiting for approval to deploy", time: "11:20", status: "waiting", agent: "codex" },
      { id: "c-rl", title: "Rate-limit middleware", snippet: "Shipped · 6 files changed", time: "Mon", status: "done", agent: "claude-code" },
    ],
  },
  {
    id: "web-ui",
    name: "web-ui",
    path: "/root/workspace/rlab/next-ui",
    conversations: [
      { id: "c-theme", title: "Dark / light theme tokens", snippet: "All tokens migrated", time: "Tue", status: "done", agent: "amp" },
      { id: "c-virt", title: "Virtualize the board list", snippet: "Draft — not started", time: "Tue", status: "idle", agent: "gemini" },
      { id: "c-toast", title: "Fix toast stacking", snippet: "Build failed on CI step 3", time: "Mon", status: "error", agent: "copilot" },
    ],
  },
  {
    id: "infra",
    name: "infra",
    path: "/root/workspace/rlab",
    conversations: [
      { id: "c-tf", title: "Terraform drift", snippet: "Needs input: 2 resources to destroy", time: "Wed", status: "waiting", agent: "codex", unread: true },
      { id: "c-node", title: "Bump Node to 22", snippet: "Queued behind the release", time: "Wed", status: "idle", agent: "claude-code" },
    ],
  },
];

/** Bespoke threads by conversation id; everything else falls back to generic. */
export const scriptedThreads: Record<string, readonly ChatMessage[]> = {
  "c-flaky": flakyThread,
  "chat-2": releaseThread,
};

/** Build the initial thread map for all seeded conversations. */
export function buildInitialThreads(): Record<string, ChatMessage[]> {
  const all: ConversationSummary[] = [...initialChats, ...initialProjects.flatMap((p) => p.conversations)];
  const threads: Record<string, ChatMessage[]> = {};
  for (const conv of all) {
    const scripted = scriptedThreads[conv.id];
    threads[conv.id] = scripted ? [...scripted] : genericThread(conv.title);
  }
  return threads;
}

export function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
