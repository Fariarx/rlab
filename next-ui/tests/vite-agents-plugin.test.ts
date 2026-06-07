import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  agentStatusForDetection,
  agentCliInfoForDetection,
  agentConfigErrorStatus,
  appendJsonBodyChunk,
  attachmentUploadErrorStatus,
  buildClaudeRunArgs,
  buildClaudeSdkOptions,
  browserBridgePromptAppendix,
  buildCodexRunArgs,
  buildGeminiRunArgs,
  buildGitCommitArgs,
  buildGitPushArgs,
  buildOpenCodeRunArgs,
  createRunApprovalHandler,
  createAmpStreamTranslator,
  createClaudeStreamTranslator,
  createCodexStreamTranslator,
  createCursorStreamTranslator,
  createGeminiStreamTranslator,
  createOpenCodeStreamTranslator,
  createQwenStreamTranslator,
  activeBackgroundRunUpdateFromState,
  activeBackgroundRunSnapshotsFromHandles,
  applyBrowserStorageSnapshot,
  appendRunAuditEvent,
  BROWSER_ACTION_TIMEOUT_MS,
  browserPreviewActionFailureResult,
  parseRunApprovalPayload,
  parseRunCancelPayload,
  parseRunInputPayload,
  parseAttachmentUploadPayload,
  parseBrowserActionPayload,
  parseBrowserSessionPayload,
  parseBrowserSyncPayload,
  parseAgentConfigPayload,
  parseAgentInstallPayload,
  parseGitStatusPorcelain,
  parseGitCwdPayload,
  parseGitFilePayload,
  parseGitCommitPayload,
  gitErrorStatus,
  gitPushRequestErrorStatus,
  jsonBodyReadErrorStatus,
  parseProjectDirectoryPayload,
  parseRunRequestPayload,
  agentInstallErrorStatus,
  applyRunApprovalDecisionState,
  applyRunInputSelectionState,
  cancelBackgroundRunState,
  cancelBackgroundRunRequestState,
  finishBackgroundRunState,
  mergeWorkspacePutState,
  listMentionableFiles,
  reconcileStaleBackgroundRuns,
  hasGeminiStoredAuthAt,
  installCommandForAgent,
  JSON_CONTENT_TYPE,
  parseCodexModelsOutput,
  parseClaudeAgentsOutput,
  parseOpenCodeAgentsOutput,
  parseOpenCodeModelsOutput,
  prioritizeBrowserPreviewDomTargets,
  resolveAgentInstallLaunch,
  resolveBinOnPath,
  resolveLaunchCommand,
  resolvePendingRunApproval,
  resolvePendingRunInput,
  runControlErrorStatus,
  settleEarlyBackgroundRunState,
  shouldUseShellForBin,
  storageHealthSnapshot,
  validateRunAccessModeForAgent,
  withStorageFileLock,
  windowsCommandLine,
  writeJsonFileAtomic,
  writeAgentSecretConfig,
  workspacePutErrorStatus,
  type BackgroundRunBinding,
  type BackgroundRunHandle,
  visibleAgentDetectionIds,
  readRunAuditEvents,
} from "../vite-agents-plugin";
import { buildInitialWorkspaceState } from "../src/components/workspace/workspace-state";
import { type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { type AgentProfile } from "../src/components/agent";

describe("vite agents plugin", () => {
  it("does not import client UI modules into the dev-server runtime", () => {
    const source = readFileSync("vite-agents-plugin.ts", "utf8");

    expect(source).not.toContain('from "./src/components/workspace/app-settings"');
    expect(source).not.toContain('from "./src/components/workspace/workspace-state"');
    expect(source).not.toContain('from "./src/components/workspace/sample-data"');
    expect(source).not.toContain('from "./src/i18n/I18nProvider"');
  });

  it("only exposes the supported visible agents in backend discovery", () => {
    expect(visibleAgentDetectionIds()).toEqual(["claude-code", "codex", "gemini", "opencode"]);
  });

  it("writes JSON atomically and keeps a backup of the previous payload", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-atomic-json-"));
    try {
      const file = join(dir, "state.json");
      writeJsonFileAtomic(file, { version: 1 });
      writeJsonFileAtomic(file, { version: 2 });

      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 2 });
      expect(JSON.parse(readFileSync(`${file}.bak`, "utf8"))).toEqual({ version: 1 });
      expect(existsSync(`${file}.tmp`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not depend on a fixed atomic temp path during storage writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-atomic-json-temp-"));
    try {
      const file = join(dir, "state.json");
      mkdirSync(`${file}.tmp`);

      writeJsonFileAtomic(file, { version: 1 });

      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1 });
      expect(statSync(`${file}.tmp`).isDirectory()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects concurrent storage writes while a lock file is held", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-storage-lock-"));
    try {
      const lockFile = join(dir, "state.lock");

      withStorageFileLock(lockFile, () => {
        expect(() => withStorageFileLock(lockFile, () => undefined)).toThrow("Storage state is locked.");
      });

      expect(existsSync(lockFile)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports storage and visible-agent health without exposing hidden agents", () => {
    const snapshot = storageHealthSnapshot();

    expect(snapshot.storage.stateFile).toContain("workspace-state.json");
    expect(snapshot.storage.ok).toBe(true);
    expect(snapshot.agents.visible).toEqual(["claude-code", "codex", "gemini", "opencode"]);
  });

  it("appends run audit events as NDJSON without storing prompt text", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-run-audit-"));
    try {
      const auditFile = join(dir, "audit.ndjson");

      appendRunAuditEvent(auditFile, {
        type: "run_started",
        agent: "codex",
        accessMode: "unrestricted",
        cwd: "C:/repo",
        model: "gpt-5.5",
        reasoning: "high",
        mode: "default",
        prompt: "secret task text",
      });

      const events = readRunAuditEvents(auditFile);
      expect(events).toEqual([
        expect.objectContaining({
          type: "run_started",
          agent: "codex",
          accessMode: "unrestricted",
          cwd: "C:/repo",
          model: "gpt-5.5",
          reasoning: "high",
          mode: "default",
        }),
      ]);
      expect(JSON.stringify(events)).not.toContain("secret task text");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats a ChatGPT-authenticated Codex CLI as available without API key env", () => {
    const codexDetect = {
      bins: ["codex"],
      env: ["OPENAI_API_KEY", "CODEX_API_KEY"],
      hasAuth: () => true,
    };

    expect(agentStatusForDetection(codexDetect, true, { env: {} }, {})).toBe("available");
    expect(agentStatusForDetection({ ...codexDetect, hasAuth: () => false }, true, { env: {} }, {})).toBe("needs-setup");
  });

  it("detects Gemini OAuth credentials without API key env", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-gemini-auth-"));
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "settings.json"), JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } }), "utf8");
      writeFileSync(
        join(dir, "oauth_creds.json"),
        JSON.stringify({
          access_token: "access",
          refresh_token: "refresh",
          id_token: "id",
        }),
        "utf8",
      );

      expect(hasGeminiStoredAuthAt(dir)).toBe(true);
      expect(
        agentStatusForDetection(
          {
            bins: ["gemini"],
            env: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"],
            hasAuth: () => hasGeminiStoredAuthAt(dir),
          },
          true,
          { env: {} },
          {},
        ),
      ).toBe("available");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns concrete CLI metadata for agent picker discovery", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-cli-discovery-"));
    try {
      const cliPath = join(dir, "codex");
      writeFileSync(cliPath, "", "utf8");

      expect(
        agentCliInfoForDetection(
          "codex",
          {
            bins: ["codex"],
            env: ["OPENAI_API_KEY", "CODEX_API_KEY"],
            hasAuth: () => false,
          },
          { env: {} },
          {},
          dir,
          "linux",
        ),
      ).toEqual({
        status: "needs-setup",
        bins: ["codex"],
        resolvedBin: cliPath,
        runAdapter: true,
        selectable: true,
        env: ["OPENAI_API_KEY", "CODEX_API_KEY"],
        installCommand: "npm install -g @openai/codex@latest",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps hidden agents unsupported even if their executable is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-amp-discovery-"));
    try {
      const cliPath = join(dir, "amp");
      writeFileSync(cliPath, "", "utf8");

      expect(
        agentCliInfoForDetection(
          "amp",
          {
            bins: ["amp"],
            env: ["AMP_API_KEY"],
          },
          { env: { AMP_API_KEY: "amp-test" } },
          {},
          dir,
          "linux",
        ),
      ).toMatchObject({
        status: "unsupported",
        bins: ["amp"],
        resolvedBin: cliPath,
        runAdapter: false,
        selectable: false,
        env: ["AMP_API_KEY"],
        installCommand: null,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses live model catalogs from Codex and OpenCode CLIs", () => {
    expect(
      parseOpenCodeModelsOutput(
        [
          "opencode/deepseek-v4-flash-free",
          "anthropic/claude-opus-4-7",
          "anthropic/claude-opus-4-7-fast",
          "lmstudio/qwen/qwen3-coder-30b",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { id: "opencode/deepseek-v4-flash-free", label: "Deepseek V4 Flash Free", value: "opencode/deepseek-v4-flash-free" },
      { id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7", value: "anthropic/claude-opus-4-7" },
      { id: "anthropic/claude-opus-4-7-fast", label: "Claude Opus 4.7 Fast", value: "anthropic/claude-opus-4-7-fast" },
      { id: "lmstudio/qwen/qwen3-coder-30b", label: "Qwen3 Coder 30B", value: "lmstudio/qwen/qwen3-coder-30b" },
    ]);

    expect(
      parseCodexModelsOutput(
        JSON.stringify({
          models: [
            {
              slug: "gpt-5.5",
              display_name: "GPT-5.5",
              supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "xhigh" }],
            },
          ],
        }),
      ),
    ).toEqual({
      models: [{ id: "gpt-5.5", label: "GPT-5.5", value: "gpt-5.5" }],
      reasoning: [
        { id: "low", label: "Low", value: "low" },
        { id: "medium", label: "Medium", value: "medium" },
        { id: "xhigh", label: "Extra High", value: "xhigh" },
      ],
    });
  });

  it("parses live OpenCode agents as chat work modes", () => {
    expect(
      parseOpenCodeAgentsOutput(`build (primary)
explore (subagent)
general (subagent)
plan (primary)
summary (primary)
title (primary)
compaction (primary)
custom-reviewer (subagent)
`),
    ).toEqual([
      { id: "build", label: "Build", value: "build" },
      { id: "explore", label: "Explore", value: "explore" },
      { id: "general", label: "General", value: "general" },
      { id: "plan", label: "Plan", value: "plan" },
      { id: "summary", label: "Summary", value: "summary" },
      { id: "custom-reviewer", label: "Custom Reviewer", value: "custom-reviewer" },
    ]);
  });

  it("parses live Claude Code agents as chat work modes", () => {
    expect(
      parseClaudeAgentsOutput(`4 active agents

Built-in agents:
  Explore · haiku
  general-purpose · inherit
  Plan · inherit
  Goal · inherit
  statusline-setup · sonnet
`),
    ).toEqual([
      { id: "claude-agent:Explore", label: "Explore", value: "Explore" },
      { id: "claude-agent:general-purpose", label: "General Purpose", value: "general-purpose" },
      { id: "claude-agent:Goal", label: "Goal", value: "Goal" },
    ]);
  });

  it("resolves Windows command shims before PowerShell scripts for agent spawns", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-path-"));
    try {
      writeFileSync(join(dir, "codex.ps1"), "", "utf8");
      writeFileSync(join(dir, "codex.cmd"), "", "utf8");

      // Resolve against an isolated dir (no host PATH) so the assertion is deterministic.
      expect(resolveBinOnPath("codex", dir, "win32")).toBe(join(dir, "codex.cmd"));
      expect(resolveBinOnPath("codex", dir, "linux")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses a shell for Windows command shims", () => {
    expect(shouldUseShellForBin("C:\\nvm4w\\nodejs\\codex.cmd")).toBe(process.platform === "win32");
    expect(shouldUseShellForBin("C:\\tools\\codex.exe")).toBe(false);
  });

  it("quotes Windows command shim arguments with spaces", () => {
    expect(windowsCommandLine("C:\\nvm4w\\nodejs\\codex.cmd", ["exec", "--json", "Say exactly: hi"])).toBe(
      '"C:\\nvm4w\\nodejs\\codex.cmd" "exec" "--json" "Say exactly: hi"',
    );
  });

  it("launches npm command shims through node instead of cmd argument splitting", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-shim-"));
    try {
      const script = join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
      mkdirSync(join(dir, "node_modules", "@openai", "codex", "bin"), { recursive: true });
      writeFileSync(join(dir, "node.exe"), "", "utf8");
      writeFileSync(join(dir, "codex.cmd"), '"%dp0%\\node.exe" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*', "utf8");

      const launch = resolveLaunchCommand(join(dir, "codex.cmd"), ["exec", "Say exactly: hi"], "win32");

      expect(launch).toEqual({ command: join(dir, "node.exe"), args: [script, "exec", "Say exactly: hi"] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unwraps npm command shims that point to extensionless bin scripts", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-opencode-shim-"));
    try {
      const script = join(dir, "node_modules", "opencode-ai", "bin", "opencode");
      mkdirSync(join(dir, "node_modules", "opencode-ai", "bin"), { recursive: true });
      writeFileSync(join(dir, "node.exe"), "", "utf8");
      writeFileSync(
        join(dir, "opencode.cmd"),
        'IF EXIST "%dp0%\\node.exe" (\n  SET "_prog=%dp0%\\node.exe"\n)\n"%_prog%" "%dp0%\\node_modules\\opencode-ai\\bin\\opencode" %*',
        "utf8",
      );

      const launch = resolveLaunchCommand(join(dir, "opencode.cmd"), ["run", "Say exactly: hi"], "win32");

      expect(launch).toEqual({ command: join(dir, "node.exe"), args: [script, "run", "Say exactly: hi"] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves agent install commands through the same Windows-safe shim launcher", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-install-shim-"));
    try {
      const script = join(dir, "node_modules", "npm", "bin", "npm-cli.js");
      mkdirSync(join(dir, "node_modules", "npm", "bin"), { recursive: true });
      writeFileSync(join(dir, "node.exe"), "", "utf8");
      writeFileSync(join(dir, "npm.cmd"), '"%dp0%\\node.exe" "%dp0%\\node_modules\\npm\\bin\\npm-cli.js" %*', "utf8");

      const launch = resolveAgentInstallLaunch("opencode", [dir, process.env.PATH ?? ""].join(delimiter), "win32");

      expect(installCommandForAgent("opencode")).toEqual(["npm", "install", "-g", "opencode-ai@latest"]);
      expect(launch).toEqual({
        command: join(dir, "node.exe"),
        args: [script, "install", "-g", "opencode-ai@latest"],
        displayCommand: "npm install -g opencode-ai@latest",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("starts Claude with partial message streaming enabled", () => {
    expect(buildClaudeRunArgs({ prompt: "hello" })).toEqual([
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      "plan",
    ]);
  });

  it("builds Claude args with an exact selected model ID", () => {
    expect(buildClaudeRunArgs({ prompt: "hello", model: "claude-opus-4-8", reasoning: "high", mode: "default", accessMode: "read-only" })).toEqual([
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model",
      "claude-opus-4-8",
      "--effort",
      "high",
      "--permission-mode",
      "plan",
    ]);
  });

  it("passes selected Claude Code agent modes to the CLI and SDK", () => {
    expect(buildClaudeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "claude-agent:Goal", accessMode: "unrestricted" })).toEqual([
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--agent",
      "Goal",
      "--permission-mode",
      "acceptEdits",
    ]);

    expect(
      buildClaudeSdkOptions(
        { agent: "claude-code", model: "default", reasoning: "default", mode: "claude-agent:Goal", prompt: "hello", accessMode: "unrestricted" },
        "C:/repo",
        new AbortController(),
        (() => Promise.resolve({ behavior: "deny", message: "test" })) satisfies CanUseTool,
      ),
    ).toMatchObject({ agent: "Goal" });
  });

  it("translates Claude text deltas without duplicating the final assistant message", () => {
    const translate = createClaudeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hel" },
          },
        }),
      ),
    ).toEqual([{ type: "text", text: "hel" }]);

    expect(
      translate(
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "lo" },
          },
        }),
      ),
    ).toEqual([{ type: "text", text: "lo" }]);

    expect(
      translate(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "hello" }],
          },
        }),
      ),
    ).toEqual([]);
  });

  it("keeps complete assistant text when partial events are absent", () => {
    const translate = createClaudeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "hello" }],
          },
        }),
      ),
    ).toEqual([{ type: "text", text: "hello" }]);
  });

  it("translates streamed tool input updates", () => {
    const translate = createClaudeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            index: 1,
            content_block: { type: "tool_use", id: "tool-1", name: "Bash", input: {} },
          },
        }),
      ),
    ).toEqual([{ type: "tool", id: "tool-1", name: "Bash", summary: "", args: {} }]);

    expect(
      translate(
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 1,
            delta: { type: "input_json_delta", partial_json: "{\"command\":\"npm test\"}" },
          },
        }),
      ),
    ).toEqual([{ type: "tool", id: "tool-1", name: "Bash", summary: "npm test", args: { command: "npm test" } }]);
  });

  it("maps Claude plan, search, and edit tools into rich chat events", () => {
    const translate = createClaudeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "todo-1",
                name: "TodoWrite",
                input: {
                  todos: [
                    { content: "Inspect auth tests", status: "completed" },
                    { content: "Patch flaky retry", status: "in_progress" },
                  ],
                },
              },
            ],
          },
        }),
      ),
    ).toEqual([
      {
        type: "plan",
        id: "todo-1",
        steps: [
          { label: "Inspect auth tests", state: "ok" },
          { label: "Patch flaky retry", state: "running" },
        ],
      },
    ]);

    expect(
      translate(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "search-1",
                name: "WebSearch",
                input: { query: "vite kanban agent protocol" },
              },
            ],
          },
        }),
      ),
    ).toEqual([{ type: "search", id: "search-1", query: "vite kanban agent protocol", state: "running", results: [] }]);

    expect(
      translate(
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "search-1",
                content: JSON.stringify({ results: [{ title: "Vibe Kanban", url: "https://github.com/BloopAI/vibe-kanban" }] }),
              },
            ],
          },
        }),
      ),
    ).toEqual([
      {
        type: "search",
        id: "search-1",
        query: "vite kanban agent protocol",
        state: "ok",
        results: [{ title: "Vibe Kanban", url: "https://github.com/BloopAI/vibe-kanban" }],
      },
    ]);
  });

  it("translates Claude permission requests into approval events", () => {
    const translate = createClaudeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "permission_request",
          id: "approval-1",
          tool_name: "Bash",
          input: { command: "npm test" },
        }),
      ),
    ).toEqual([{ type: "approval", id: "approval-1", title: "Approve Bash?", detail: "npm test" }]);
  });

  it("builds Codex args with the selected model and reasoning effort", () => {
    expect(buildCodexRunArgs({ prompt: "hello", model: "gpt-5.5", reasoning: "high", mode: "default", accessMode: "read-only" })).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--model",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="high"',
      "hello",
    ]);
  });

  it("builds Codex review mode through the real review subcommand", () => {
    expect(buildCodexRunArgs({ prompt: "review auth changes", model: "gpt-5.5", reasoning: "high", mode: "review", accessMode: "read-only" })).toEqual([
      "exec",
      "review",
      "--json",
      "--skip-git-repo-check",
      "--model",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="high"',
      "review auth changes",
    ]);
  });

  it("builds Codex plan mode as a read-only planning run", () => {
    const args = buildCodexRunArgs({ prompt: "fix flaky auth tests", model: "default", reasoning: "default", mode: "plan", accessMode: "unrestricted" });

    expect(args.slice(0, 5)).toEqual(["exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check"]);
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args.at(-1)).toContain("Plan mode is active.");
    expect(args.at(-1)).toContain("fix flaky auth tests");
  });

  it("maps agent access mode into CLI safety flags", () => {
    expect(buildClaudeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted" })).toContain("acceptEdits");
    expect(buildClaudeRunArgs({ prompt: "hello", model: "opus", reasoning: "max", mode: "plan", accessMode: "unrestricted" })).toEqual([
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model",
      "opus",
      "--effort",
      "max",
      "--permission-mode",
      "plan",
    ]);
    expect(buildCodexRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted" })).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "hello",
    ]);
    expect(buildGeminiRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted" })).toContain("yolo");
  });

  it("allows unrestricted runs for every RUN adapter without a live permission bridge", () => {
    expect(validateRunAccessModeForAgent("claude-code", "unrestricted")).toBeNull();
    expect(validateRunAccessModeForAgent("codex", "read-only")).toBeNull();
    expect(validateRunAccessModeForAgent("codex", "unrestricted")).toBeNull();
    expect(validateRunAccessModeForAgent("gemini", "unrestricted")).toBeNull();
    expect(validateRunAccessModeForAgent("opencode", "unrestricted")).toBeNull();
  });

  it("builds Gemini args with the selected model", () => {
    expect(buildGeminiRunArgs({ prompt: "hello", model: "gemini-2.5-flash", reasoning: "default", mode: "default", accessMode: "read-only" })).toEqual([
      "--prompt",
      "hello",
      "--output-format",
      "stream-json",
      "--approval-mode",
      "plan",
      "--skip-trust",
      "--model",
      "gemini-2.5-flash",
    ]);
  });

  it("builds Gemini args with newer explicit model choices", () => {
    expect(buildGeminiRunArgs({ prompt: "hello", model: "gemini-3-pro-preview", reasoning: "default", mode: "default", accessMode: "read-only" })).toContain("gemini-3-pro-preview");
    expect(buildGeminiRunArgs({ prompt: "hello", model: "gemini-2.5-flash-lite", reasoning: "default", mode: "default", accessMode: "read-only" })).toContain("gemini-2.5-flash-lite");
  });

  it("maps Gemini work modes into real approval modes", () => {
    expect(buildGeminiRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "auto-edit", accessMode: "unrestricted" })).toEqual([
      "--prompt",
      "hello",
      "--output-format",
      "stream-json",
      "--approval-mode",
      "auto_edit",
      "--skip-trust",
    ]);
    expect(buildGeminiRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "plan", accessMode: "unrestricted" })).toContain("plan");
    expect(buildGeminiRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "yolo", accessMode: "unrestricted" })).toContain("yolo");
  });

  it("builds OpenCode args with a concrete default model, reasoning variant, and no permission bypass", () => {
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "default", reasoning: "high", mode: "default", accessMode: "read-only" })).toEqual([
      "run",
      "--format",
      "json",
      "--thinking",
      "--model",
      "opencode/deepseek-v4-flash-free",
      "--variant",
      "high",
      "hello",
    ]);
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted" })).toContain("--dangerously-skip-permissions");
  });

  it("builds OpenCode args with selected provider/model IDs", () => {
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "anthropic-claude-opus-4-7", reasoning: "default", mode: "default", accessMode: "read-only" })).toEqual([
      "run",
      "--format",
      "json",
      "--thinking",
      "--model",
      "anthropic/claude-opus-4-7",
      "hello",
    ]);
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "opencode-big-pickle", reasoning: "default", mode: "default", accessMode: "read-only" })).toContain("opencode/big-pickle");
  });

  it("passes direct runtime provider/model IDs through to OpenCode", () => {
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "anthropic/claude-custom-lab", reasoning: "default", mode: "default", accessMode: "read-only" })).toContain("anthropic/claude-custom-lab");
  });

  it("maps OpenCode work modes into the real agent flag", () => {
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "explore", accessMode: "read-only" })).toEqual([
      "run",
      "--format",
      "json",
      "--thinking",
      "--agent",
      "explore",
      "--model",
      "opencode/deepseek-v4-flash-free",
      "hello",
    ]);
  });

  it("translates Codex JSONL events into normalized run events", () => {
    const translate = createCodexStreamTranslator();

    expect(translate(JSON.stringify({ type: "turn.started" }))).toEqual([{ type: "status", level: "info", text: "codex turn started" }]);
    expect(translate(JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "hello" } }))).toEqual([{ type: "text", text: "hello" }]);
    expect(translate(JSON.stringify({ type: "agent_message", message: "hello" }))).toEqual([{ type: "text", text: "hello" }]);
    expect(translate(JSON.stringify({ type: "turn.failed", error: { message: "model unsupported" } }))).toEqual([{ type: "error", text: "model unsupported" }]);
  });

  it("translates Amp Claude-compatible stream JSON into normalized run events", () => {
    const translate = createAmpStreamTranslator();

    expect(translate(JSON.stringify({ type: "system", subtype: "init", cwd: "/repo", session_id: "T-1", tools: ["Read"], mcp_servers: [], reasoning_effort: "high" }))).toEqual([
      { type: "status", level: "info", text: "model · agent" },
    ]);
    expect(translate(JSON.stringify({ type: "assistant", message: { type: "message", role: "assistant", content: [{ type: "thinking", thinking: "scan" }, { type: "text", text: "done" }], stop_reason: "end_turn" } }))).toEqual([
      { type: "reasoning", text: "scan" },
      { type: "text", text: "done" },
    ]);
    expect(translate(JSON.stringify({ type: "result", subtype: "success", duration_ms: 10, is_error: false, num_turns: 1, result: "done", session_id: "T-1" }))).toEqual([
      { type: "done", costUsd: undefined, usage: undefined },
    ]);
  });

  it("translates Qwen stream JSON into normalized run events", () => {
    const translate = createQwenStreamTranslator();

    expect(translate(JSON.stringify({ type: "system", subtype: "session_start", model: "qwen3-coder-plus", session_id: "T-1" }))).toEqual([
      { type: "status", level: "info", text: "model · qwen3-coder-plus" },
    ]);
    expect(translate(JSON.stringify({ type: "assistant", message: { type: "message", role: "assistant", content: [{ type: "text", text: "done" }], usage: { totalTokens: 12 } } }))).toEqual([
      { type: "text", text: "done" },
    ]);
    expect(translate(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done", usage: { totalTokens: 12 } }))).toEqual([
      { type: "done", costUsd: undefined, usage: { totalTokens: 12 } },
    ]);
  });

  it("translates Cursor stream JSON into normalized run events", () => {
    const translate = createCursorStreamTranslator();

    expect(translate(JSON.stringify({ type: "system", subtype: "init", model: "Claude 4 Sonnet", session_id: "T-1" }))).toEqual([
      { type: "status", level: "info", text: "model · Claude 4 Sonnet" },
    ]);
    expect(translate(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hel" }] } }))).toEqual([{ type: "text", text: "hel" }]);
    expect(translate(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "lo" }] } }))).toEqual([{ type: "text", text: "lo" }]);
    expect(
      translate(
        JSON.stringify({
          type: "tool_call",
          subtype: "started",
          call_id: "cursor-tool-1",
          tool_call: { readToolCall: { args: { path: "README.md" } } },
        }),
      ),
    ).toEqual([{ type: "tool", id: "cursor-tool-1", name: "read", summary: "README.md", args: { path: "README.md" } }]);
    expect(
      translate(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "cursor-tool-1",
          tool_call: { readToolCall: { args: { path: "README.md" }, result: { success: { content: "docs" } } } },
        }),
      ),
    ).toEqual([{ type: "tool_result", id: "cursor-tool-1", ok: true, output: "docs" }]);
    expect(translate(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "hello", duration_ms: 10 }))).toEqual([
      { type: "done", costUsd: undefined, usage: undefined },
    ]);
  });

  it("translates Codex text deltas without duplicating the completed assistant message", () => {
    const translate = createCodexStreamTranslator();

    expect(translate(JSON.stringify({ type: "agent_message_delta", delta: "hel" }))).toEqual([{ type: "text", text: "hel" }]);
    expect(translate(JSON.stringify({ type: "agent_message_delta", delta: "lo" }))).toEqual([{ type: "text", text: "lo" }]);
    expect(translate(JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "hello" } }))).toEqual([]);
  });

  it("translates Codex command execution items into tool events", () => {
    const translate = createCodexStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "item.started",
          item: {
            id: "item_1",
            type: "command_execution",
            command: "powershell -NoProfile -Command Write-Output rlab-smoke",
            aggregated_output: "",
            exit_code: null,
            status: "in_progress",
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool",
        id: "item_1",
        name: "Command",
        summary: "powershell -NoProfile -Command Write-Output rlab-smoke",
        args: { command: "powershell -NoProfile -Command Write-Output rlab-smoke" },
      },
    ]);

    expect(
      translate(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_1",
            type: "command_execution",
            command: "powershell -NoProfile -Command Write-Output rlab-smoke",
            aggregated_output: "rlab-smoke\n",
            exit_code: 0,
            status: "completed",
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool_result",
        id: "item_1",
        ok: true,
        output: "rlab-smoke\n",
      },
    ]);
  });

  it("translates Gemini stream-json messages, thoughts, and tool groups", () => {
    const translate = createGeminiStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "gemini",
          text: "hello",
          thoughts: [{ subject: "Plan", description: "Inspect files first" }],
        }),
      ),
    ).toEqual([
      { type: "reasoning", text: "Plan\nInspect files first" },
      { type: "text", text: "hello" },
    ]);

    expect(
      translate(
        JSON.stringify({
          type: "tool_group",
          tools: [
            {
              callId: "tool-1",
              name: "write_file",
              args: { file_path: "src/new.ts", content: "export const ok = true;" },
              description: "Write src/new.ts",
              status: "success",
              resultDisplay: "created",
            },
          ],
        }),
      ),
    ).toEqual([
      {
        type: "diff",
        id: "tool-1",
        file: "src/new.ts",
        additions: 1,
        deletions: 0,
        lines: [{ type: "add", text: "export const ok = true;" }],
      },
    ]);
  });

  it("translates Codex plan and semantic item events into rich run events", () => {
    const translate = createCodexStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "plan_update",
          plan: [
            { step: "Read failing test", status: "completed" },
            { step: "Apply fix", status: "in_progress" },
          ],
        }),
      ),
    ).toEqual([
      {
        type: "plan",
        steps: [
          { label: "Read failing test", state: "ok" },
          { label: "Apply fix", state: "running" },
        ],
      },
    ]);

    expect(
      translate(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "patch-1",
            type: "file_edit",
            path: "src/auth.ts",
            diff: "@@ -1 +1 @@\n-old\n+new",
            status: "completed",
          },
        }),
      ),
    ).toEqual([
      {
        type: "diff",
        id: "patch-1",
        file: "src/auth.ts",
        additions: 1,
        deletions: 1,
        lines: [
          { type: "del", text: "old" },
          { type: "add", text: "new" },
        ],
      },
    ]);
  });

  it("translates OpenCode todo and tool state updates into rich run events", () => {
    const translate = createOpenCodeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "todo.updated",
            properties: {
              todos: [
                { content: "Inspect workspace", status: "completed" },
                { content: "Patch mapper", status: "pending" },
              ],
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: "plan",
        id: "opencode-todo",
        steps: [
          { label: "Inspect workspace", state: "ok" },
          { label: "Patch mapper", state: "pending" },
        ],
      },
    ]);

    expect(
      translate(
        JSON.stringify({
          type: "message.part.updated",
          part: {
            id: "part-4",
            type: "tool",
            callID: "tool-4",
            tool: "write",
            state: {
              status: "completed",
              input: { file_path: "src/new.ts", content: "export const ok = true;" },
              output: "created",
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: "diff",
        id: "tool-4",
        file: "src/new.ts",
        additions: 1,
        deletions: 0,
        lines: [{ type: "add", text: "export const ok = true;" }],
      },
    ]);
  });

  it("translates OpenCode SDK tool lifecycle events into rich tool events", () => {
    const translate = createOpenCodeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "tool.execute.before",
            properties: {
              tool: "bash",
              callID: "tool-5",
              input: { command: "npm test" },
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool",
        id: "tool-5",
        name: "bash",
        summary: "npm test",
        args: { command: "npm test" },
      },
    ]);

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "tool.execute.after",
            properties: {
              tool: "write",
              callID: "tool-6",
              input: { file_path: "src/new.ts", content: "export const ok = true;" },
              output: "created",
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: "diff",
        id: "tool-6",
        file: "src/new.ts",
        additions: 1,
        deletions: 0,
        lines: [{ type: "add", text: "export const ok = true;" }],
      },
    ]);
  });

  it("clarifies CLI permission denials without attributing them to an app user rejection", () => {
    const codexTranslate = createCodexStreamTranslator();

    expect(
      codexTranslate(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "cmd-permission",
            type: "command_execution",
            command: "Invoke-RestMethod -Uri http://localhost:5187/api/browser/bridge/snapshot?sessionId=c-jwt -OutFile /tmp/snap.json",
            status: "failed",
            exit_code: 1,
            aggregated_output: "The user rejected permission to use this specific tool call.",
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool_result",
        id: "cmd-permission",
        ok: false,
        output: "CLI permission gate denied this tool call before execution. No approval or rejection was recorded in the app.",
      },
    ]);

    const openCodeTranslate = createOpenCodeStreamTranslator();
    expect(
      openCodeTranslate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "tool.execute.after",
            properties: {
              tool: "bash",
              callID: "opencode-permission",
              input: { command: "Invoke-RestMethod -OutFile /tmp/snap.json" },
              output: "The user rejected permission to use this specific tool call.",
              status: "failed",
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool",
        id: "opencode-permission",
        name: "bash",
        summary: "Invoke-RestMethod -OutFile /tmp/snap.json",
        args: {
          command: "Invoke-RestMethod -OutFile /tmp/snap.json",
        },
      },
      {
        type: "tool_result",
        id: "opencode-permission",
        ok: false,
        output: "CLI permission gate denied this tool call before execution. No approval or rejection was recorded in the app.",
      },
    ]);
  });

  it("keeps browser bridge snapshot instructions read-only compatible", () => {
    const prompt = browserBridgePromptAppendix({ sessionId: "c-jwt", baseUrl: "http://localhost:5187" });

    expect(prompt).toContain("Do not write bridge snapshots or responses to disk.");
    expect(prompt).toContain("Do not use -OutFile");
    expect(prompt).toContain("Use in-memory or stdout HTTP calls only");
    expect(prompt).toContain("Supported bridge actions: sync, snapshot, click, type, press, scroll, refresh, select-tab, eval.");
    expect(prompt).toContain("snapshot.activeTabId");
    expect(prompt).toContain("snapshot.tabs");
    expect(prompt).toContain('"type":"select-tab"');
    expect(prompt).toContain("Eval action");
    expect(prompt).not.toContain('selector":"main"');
  });

  it("uses an explicit UTF-8 JSON content type for bridge-friendly clients", () => {
    expect(JSON_CONTENT_TYPE).toBe("application/json; charset=utf-8");
  });

  it("translates single-question events from OpenCode into option blocks", () => {
    const translate = createOpenCodeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "question.asked",
            properties: {
              id: "question-1",
              question: "Which fix should I apply?",
              options: ["Minimal patch", { label: "Refactor module", description: "Larger cleanup" }],
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: "options",
        id: "question-1:q0",
        prompt: "Which fix should I apply?",
        multi: false,
        options: [
          { id: "Minimal patch", label: "Minimal patch" },
          { id: "Refactor module", label: "Refactor module", description: "Larger cleanup" },
        ],
      },
    ]);
  });

  it("translates Codex question items into option blocks", () => {
    const translate = createCodexStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "item.started",
          item: {
            id: "codex-question",
            type: "question",
            prompt: "Which test scope?",
            choices: [{ label: "Unit" }, { label: "Integration", description: "Slower but broader" }],
            multi_select: true,
          },
        }),
      ),
    ).toEqual([
      {
        type: "options",
        id: "codex-question:q0",
        prompt: "Which test scope?",
        multi: true,
        options: [
          { id: "Unit", label: "Unit" },
          { id: "Integration", label: "Integration", description: "Slower but broader" },
        ],
      },
    ]);
  });

  it("translates Gemini question tools into option blocks", () => {
    const translate = createGeminiStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "tool",
          callId: "gemini-question",
          name: "question",
          args: {
            text: "Pick deployment target",
            choices: ["staging", "production"],
          },
        }),
      ),
    ).toEqual([
      {
        type: "options",
        id: "gemini-question:q0",
        prompt: "Pick deployment target",
        multi: false,
        options: [
          { id: "staging", label: "staging" },
          { id: "production", label: "production" },
        ],
      },
    ]);
  });

  it("translates real Gemini headless stream-json without echoing user messages", () => {
    const translate = createGeminiStreamTranslator();

    expect(translate(JSON.stringify({ type: "init", model: "auto-gemini-3" }))).toEqual([{ type: "status", level: "info", text: "model · auto-gemini-3" }]);
    expect(translate(JSON.stringify({ type: "message", role: "user", content: "Say exactly: hi" }))).toEqual([]);
    expect(translate(JSON.stringify({ type: "message", role: "assistant", content: "hi", delta: true }))).toEqual([{ type: "text", text: "hi" }]);
    expect(translate(JSON.stringify({ type: "result", status: "success", stats: { total_tokens: 9653 } }))).toEqual([{ type: "done", usage: { totalTokens: 9653 } }]);
  });

  it("translates Gemini assistant deltas without duplicating the final message", () => {
    const translate = createGeminiStreamTranslator();

    expect(translate(JSON.stringify({ type: "message", role: "assistant", content: "hel", delta: true }))).toEqual([{ type: "text", text: "hel" }]);
    expect(translate(JSON.stringify({ type: "message", role: "assistant", content: "lo", delta: true }))).toEqual([{ type: "text", text: "lo" }]);
    expect(translate(JSON.stringify({ type: "message", role: "assistant", content: "hello" }))).toEqual([]);
  });

  it("translates real OpenCode json events into normalized run events", () => {
    const translate = createOpenCodeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "reasoning",
          part: { id: "part-1", type: "reasoning", text: "Thinking about the prompt." },
        }),
      ),
    ).toEqual([{ type: "reasoning", text: "Thinking about the prompt." }]);
    expect(
      translate(
        JSON.stringify({
          type: "text",
          part: { id: "part-2", type: "text", text: "hi" },
        }),
      ),
    ).toEqual([{ type: "text", text: "hi" }]);
    expect(
      translate(
        JSON.stringify({
          type: "step_finish",
          part: { id: "part-3", type: "step-finish", cost: 0.0017, tokens: { total: 42, input: 30, output: 2, reasoning: 10 } },
        }),
      ),
    ).toEqual([{ type: "done", costUsd: 0.0017, usage: { totalTokens: 42, inputTokens: 30, outputTokens: 2, reasoningTokens: 10 } }]);
  });

  it("translates OpenCode SDK assistant text deltas without duplicating the final part", () => {
    const translate = createOpenCodeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "message.updated",
            properties: {
              info: { id: "message-1", sessionID: "session-1", role: "assistant" },
            },
          },
        }),
      ),
    ).toEqual([]);

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "message.part.updated",
            properties: {
              delta: "hel",
              part: { type: "text", sessionID: "session-1", messageID: "message-1", text: "hel" },
            },
          },
        }),
      ),
    ).toEqual([{ type: "text", text: "hel" }]);

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "message.part.updated",
            properties: {
              delta: "lo",
              part: { type: "text", sessionID: "session-1", messageID: "message-1", text: "hello" },
            },
          },
        }),
      ),
    ).toEqual([{ type: "text", text: "lo" }]);

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "message.part.updated",
            properties: {
              part: { type: "text", sessionID: "session-1", messageID: "message-1", text: "hello" },
            },
          },
        }),
      ),
    ).toEqual([]);
  });

  it("translates OpenCode SDK reasoning deltas without duplicating the final part", () => {
    const translate = createOpenCodeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "message.updated",
            properties: {
              info: { id: "message-2", sessionID: "session-1", role: "assistant" },
            },
          },
        }),
      ),
    ).toEqual([]);

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "message.part.updated",
            properties: {
              delta: "ana",
              part: { type: "reasoning", sessionID: "session-1", messageID: "message-2", text: "ana" },
            },
          },
        }),
      ),
    ).toEqual([{ type: "reasoning", text: "ana" }]);

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "message.part.updated",
            properties: {
              delta: "lyze",
              part: { type: "reasoning", sessionID: "session-1", messageID: "message-2", text: "analyze" },
            },
          },
        }),
      ),
    ).toEqual([{ type: "reasoning", text: "lyze" }]);

    expect(
      translate(
        JSON.stringify({
          type: "sdk_event",
          event: {
            type: "message.part.updated",
            properties: {
              part: { type: "reasoning", sessionID: "session-1", messageID: "message-2", text: "analyze" },
            },
          },
        }),
      ),
    ).toEqual([]);
  });

  it("lists mentionable project files without dependency folders", () => {
    expect(
      listMentionableFiles({
        "/repo": ["src", "node_modules", ".git", "README.md"],
        "/repo/src": ["auth.ts", "app.tsx"],
        "/repo/node_modules": ["ignored.js"],
        "/repo/.git": ["config"],
      }, "/repo"),
    ).toEqual(["README.md", "src/app.tsx", "src/auth.ts"]);
  });

  it("parses git porcelain status with branch divergence and changed files", () => {
    expect(
      parseGitStatusPorcelain([
        "## main...origin/main [ahead 2, behind 1]",
        " M src/auth.ts",
        "A  README.md",
        "?? scratch.txt",
        "R  old-name.ts -> new-name.ts",
      ].join("\n")),
    ).toEqual({
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      clean: false,
      files: [
        { code: " M", label: "Modified", path: "src/auth.ts", gitPath: "src/auth.ts", staged: false, unstaged: true },
        { code: "A ", label: "Added", path: "README.md", gitPath: "README.md", staged: true, unstaged: false },
        { code: "??", label: "Untracked", path: "scratch.txt", gitPath: "scratch.txt", staged: false, unstaged: true },
        { code: "R ", label: "Renamed", path: "old-name.ts -> new-name.ts", gitPath: "new-name.ts", staged: true, unstaged: false },
      ],
    });
  });

  it("builds safe git commit arguments from an explicit message", () => {
    expect(buildGitCommitArgs(" Fix auth login test ")).toEqual(["commit", "-m", "Fix auth login test"]);
    expect(() => buildGitCommitArgs(" ")).toThrow("Commit message is required.");
  });

  it("builds safe git push arguments", () => {
    expect(buildGitPushArgs()).toEqual(["push"]);
  });

  it("validates git cwd payloads without accepting non-object JSON", () => {
    expect(() => parseGitCwdPayload(JSON.stringify("repo"))).toThrow("Invalid git request payload.");
    expect(() => parseGitCwdPayload(JSON.stringify({ cwd: "" }))).toThrow("Project directory is required.");
    expect(parseGitCwdPayload(JSON.stringify({ cwd: " C:\\repo " }))).toEqual({ cwd: "C:\\repo" });
  });

  it("validates git file payloads without accepting non-object JSON", () => {
    expect(() => parseGitFilePayload(JSON.stringify([]))).toThrow("Invalid git request payload.");
    expect(() => parseGitFilePayload(JSON.stringify({ cwd: "C:\\repo", path: "" }))).toThrow("Git file path is required.");
    expect(parseGitFilePayload(JSON.stringify({ cwd: " C:\\repo ", path: " src/auth.ts ", mode: "staged" }))).toEqual({
      cwd: "C:\\repo",
      path: "src/auth.ts",
      mode: "staged",
    });
    expect(parseGitFilePayload(JSON.stringify({ cwd: "C:\\repo", path: "src/auth.ts", mode: "other" })).mode).toBe("worktree");
  });

  it("validates git commit payloads without accepting non-object JSON", () => {
    expect(() => parseGitCommitPayload(JSON.stringify(null))).toThrow("Invalid git request payload.");
    expect(() => parseGitCommitPayload(JSON.stringify({ cwd: "C:\\repo", message: "" }))).toThrow("Commit message is required.");
    expect(parseGitCommitPayload(JSON.stringify({ cwd: " C:\\repo ", message: " ship it " }))).toEqual({
      cwd: "C:\\repo",
      message: "ship it",
    });
  });

  it("classifies git validation errors separately from runtime errors", () => {
    expect(gitErrorStatus(new SyntaxError("Unexpected token"))).toBe(400);
    expect(gitErrorStatus(new Error("Invalid git request payload."))).toBe(400);
    expect(gitErrorStatus(new Error("Project directory is required."))).toBe(400);
    expect(gitErrorStatus(new Error("Git file path contains an invalid null byte."))).toBe(400);
    expect(gitErrorStatus(new Error("EACCES: permission denied"))).toBe(500);
  });

  it("classifies git push request errors without masking runtime failures as bad requests", () => {
    expect(gitPushRequestErrorStatus(new SyntaxError("Unexpected token"))).toBe(400);
    expect(gitPushRequestErrorStatus(new Error("Invalid git request payload."))).toBe(400);
    expect(gitPushRequestErrorStatus(new Error("EACCES: permission denied"))).toBe(500);
  });

  it("bounds streamed JSON request bodies by bytes", () => {
    const first = appendJsonBodyChunk({ body: "", bytes: 0 }, "аб", 4);
    expect(first).toEqual({ body: "аб", bytes: 4 });
    expect(() => appendJsonBodyChunk(first, "!", 4)).toThrow("JSON request body exceeds 4 bytes.");
  });

  it("classifies oversized JSON request bodies separately from stream errors", () => {
    expect(jsonBodyReadErrorStatus(new Error("JSON request body exceeds 4 bytes."))).toBe(413);
    expect(jsonBodyReadErrorStatus(new Error("socket hang up"))).toBe(500);
  });

  it("validates run approval payloads", () => {
    expect(parseRunApprovalPayload(JSON.stringify({ id: "approval-1", decision: "approved" }))).toEqual({
      id: "approval-1",
      decision: "approved",
    });
    expect(() => parseRunApprovalPayload(JSON.stringify({ id: "approval-1", decision: "maybe" }))).toThrow("Invalid approval decision.");
  });

  it("validates run input payloads", () => {
    expect(parseRunInputPayload(JSON.stringify({ id: "toolu_question:q0", selected: ["Summary"] }))).toEqual({
      id: "toolu_question:q0",
      selected: ["Summary"],
    });
    expect(() => parseRunInputPayload(JSON.stringify({ id: "toolu_question:q0", selected: [] }))).toThrow("At least one selected option is required.");
  });

  it("validates run cancel payloads", () => {
    expect(parseRunCancelPayload(JSON.stringify({ runId: "run-1" }))).toEqual({ runId: "run-1" });
    expect(() => parseRunCancelPayload(JSON.stringify({ runId: "" }))).toThrow("Run id is required.");
  });

  it("validates attachment upload payloads without accepting non-object JSON", () => {
    expect(() => parseAttachmentUploadPayload(JSON.stringify("file"))).toThrow("Invalid attachment upload payload.");
    expect(() => parseAttachmentUploadPayload(JSON.stringify({ name: "notes.txt" }))).toThrow("Attachment name and data are required.");
    expect(parseAttachmentUploadPayload(JSON.stringify({ name: " notes.txt ", mimeType: "text/plain", dataBase64: "aGVsbG8=" }))).toEqual({
      name: "notes.txt",
      mimeType: "text/plain",
      dataBase64: "aGVsbG8=",
    });
  });

  it("validates agent config payloads without accepting non-object JSON", () => {
    expect(() => parseAgentConfigPayload(JSON.stringify(null))).toThrow("Invalid agent config payload.");
    expect(() => parseAgentConfigPayload(JSON.stringify({ agent: "", apiKey: "sk-test" }))).toThrow("Agent id is required.");
    expect(() => parseAgentConfigPayload(JSON.stringify({ agent: "qwen", apiKey: "sk-test" }))).toThrow("Agent qwen is not supported.");
    expect(() => parseAgentConfigPayload(JSON.stringify({ agent: "codex", apiKey: "" }))).toThrow("API key is required.");
    expect(parseAgentConfigPayload(JSON.stringify({ agent: " codex ", apiKey: " sk-test " }))).toEqual({
      agent: "codex",
      apiKey: "sk-test",
    });
  });

  it("validates agent install payloads without accepting non-object JSON", () => {
    expect(() => parseAgentInstallPayload(JSON.stringify([]))).toThrow("Invalid agent install payload.");
    expect(() => parseAgentInstallPayload(JSON.stringify({ agent: "" }))).toThrow("Agent id is required.");
    expect(() => parseAgentInstallPayload(JSON.stringify({ agent: "amp" }))).toThrow("Agent amp is not supported.");
    expect(parseAgentInstallPayload(JSON.stringify({ agent: " codex " }))).toEqual({ agent: "codex" });
  });

  it("writes agent secret configs atomically without leaving broad temp files", () => {
    const dir = mkdtempSync(join(tmpdir(), "rlab-agent-config-"));
    try {
      const file = join(dir, "agent-config.json");
      writeAgentSecretConfig({ env: { OLD_KEY: "old" } }, file);
      writeAgentSecretConfig({ env: { OPENAI_API_KEY: "sk-test" } }, file);

      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ env: { OPENAI_API_KEY: "sk-test" } });
      expect(JSON.parse(readFileSync(`${file}.bak`, "utf8"))).toEqual({ env: { OLD_KEY: "old" } });
      expect(existsSync(`${file}.tmp`)).toBe(false);
      if (process.platform !== "win32") {
        expect(statSync(file).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates project directory payloads without accepting non-object JSON", () => {
    expect(() => parseProjectDirectoryPayload(JSON.stringify([]), "path", "Project path is required.")).toThrow("Invalid project directory payload.");
    expect(() => parseProjectDirectoryPayload(JSON.stringify({ path: "" }), "path", "Project path is required.")).toThrow("Project path is required.");
    expect(parseProjectDirectoryPayload(JSON.stringify({ path: " C:\\work\\app " }), "path", "Project path is required.")).toBe("C:\\work\\app");
    expect(parseProjectDirectoryPayload(JSON.stringify({ cwd: " C:\\work\\app " }), "cwd", "Project directory is required.")).toBe("C:\\work\\app");
  });

  it("validates browser preview payloads without guessing URLs or actions", () => {
    expect(parseBrowserSessionPayload(JSON.stringify({ sessionId: " c-jwt ", url: " http://localhost:3000 " }))).toEqual({ sessionId: "c-jwt", url: "http://localhost:3000/" });
    expect(() => parseBrowserSessionPayload(JSON.stringify({ sessionId: "c-jwt", url: "localhost:3000" }))).toThrow("Browser URL must be an absolute http(s) URL or about:blank.");
    expect(() => parseBrowserSessionPayload(JSON.stringify({ url: "http://localhost:3000" }))).toThrow("Browser session id is required.");
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "scroll", deltaY: 400 }))).toEqual({ sessionId: "c-jwt", type: "scroll", deltaY: 400 });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "refresh" }))).toEqual({ sessionId: "c-jwt", type: "refresh" });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", tabId: "tab-2", type: "select-tab" }))).toEqual({ sessionId: "c-jwt", tabId: "tab-2", type: "select-tab" });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "click", x: 12, y: 34 }))).toEqual({ sessionId: "c-jwt", type: "click", x: 12, y: 34 });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "click", target: { selector: "[data-testid=save]" } }))).toEqual({
      sessionId: "c-jwt",
      type: "click",
      target: { selector: "[data-testid=save]" },
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "click", target: { framePath: ["iframe[data-testid=preview-frame]"], selector: "[data-testid=save]" } }))).toEqual({
      sessionId: "c-jwt",
      type: "click",
      target: { framePath: ["iframe[data-testid=preview-frame]"], selector: "[data-testid=save]" },
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "scroll", deltaY: 400, target: { role: "main", name: "Content" } }))).toEqual({
      sessionId: "c-jwt",
      type: "scroll",
      deltaY: 400,
      target: { role: "main", name: "Content" },
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "press", key: "Enter", target: { text: "Search" } }))).toEqual({
      sessionId: "c-jwt",
      type: "press",
      key: "Enter",
      target: { text: "Search" },
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "type", text: "hello", target: { label: "Search" } }))).toEqual({
      sessionId: "c-jwt",
      type: "type",
      text: "hello",
      target: { label: "Search" },
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "type", selector: "input[name=q]", text: "hello" }))).toEqual({ sessionId: "c-jwt", type: "type", selector: "input[name=q]", text: "hello" });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "press", key: "Enter" }))).toEqual({ sessionId: "c-jwt", type: "press", key: "Enter" });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "eval", script: "document.activeElement?.tagName" }))).toEqual({
      sessionId: "c-jwt",
      type: "eval",
      script: "document.activeElement?.tagName",
    });
    expect(() => parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "click" }))).toThrow("Browser click target or x and y are required.");
    expect(() => parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "eval", script: "" }))).toThrow("Browser eval script is required.");
    expect(() => parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "eval", script: "x".repeat(8001) }))).toThrow("Browser eval script must be 8000 characters or less.");
    expect(() => parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "click", target: { selector: "#one", text: "Two" } }))).toThrow("Browser action target must include exactly one locator.");
    expect(parseBrowserSyncPayload(JSON.stringify({ sessionId: "c-jwt", url: " http://localhost:3000 ", localStorage: { theme: "dark" }, sessionStorage: { step: "2" } }))).toEqual({
      sessionId: "c-jwt",
      url: "http://localhost:3000/",
      localStorage: { theme: "dark" },
      sessionStorage: { step: "2" },
    });
    expect(() => parseBrowserSyncPayload(JSON.stringify({ sessionId: "c-jwt", url: "http://localhost:3000", localStorage: { theme: true } }))).toThrow("Browser storage values must be strings.");
  });

  it("builds structured browser action failures with short target-oriented timeout errors", () => {
    expect(BROWSER_ACTION_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    const action = parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "click", target: { selector: "#missing" } }));

    expect(browserPreviewActionFailureResult(action, new Error("locator.click: Timeout 30000ms exceeded."))).toEqual({
      ok: false,
      action: "click",
      target: "selector=#missing",
      error: "Target not found within 5000ms: selector=#missing",
    });
  });

  it("prioritizes editable browser preview DOM targets before sidebar controls", () => {
    const sidebarButtons = Array.from({ length: 90 }, (_, index) => ({
      selector: `button[data-index="${index}"]`,
      tag: "button",
      role: "button",
      text: `Sidebar ${index}`,
      bounds: { x: 0, y: index * 10, width: 100, height: 20 },
    }));
    const composer = {
      selector: "[data-testid=\"composer-input\"]",
      tag: "textarea",
      role: "textbox",
      label: "Написать",
      editable: true,
      disabled: false,
      visible: true,
      placeholder: "Написать",
      ordinal: 90,
      text: "",
      bounds: { x: 320, y: 680, width: 700, height: 40 },
    };

    const targets = prioritizeBrowserPreviewDomTargets([...sidebarButtons, composer], 80);

    expect(targets).toHaveLength(80);
    expect(targets[0]).toMatchObject({ selector: "[data-testid=\"composer-input\"]", role: "textbox", editable: true, disabled: false, visible: true, placeholder: "Написать", ordinal: 90 });
    expect(targets.some((target) => target.selector === "[data-testid=\"composer-input\"]")).toBe(true);
  });

  it("does not apply browser storage to about:blank preview documents", async () => {
    const evaluate = vi.fn<() => Promise<unknown>>(async () => undefined);

    await applyBrowserStorageSnapshot(
      {
        url: () => "about:blank",
        evaluate,
      },
      { localStorage: { theme: "dark" }, sessionStorage: { step: "2" } },
    );

    expect(evaluate).not.toHaveBeenCalled();
  });

  it("does not mask malformed run payloads as an empty prompt", () => {
    expect(parseRunRequestPayload("{")).toEqual({ ok: false, error: "Invalid run request payload." });
    expect(parseRunRequestPayload("[]")).toEqual({ ok: false, error: "Invalid run request payload." });
    expect(parseRunRequestPayload(JSON.stringify("hello"))).toEqual({ ok: false, error: "Invalid run request payload." });
    expect(parseRunRequestPayload(JSON.stringify({ agent: "codex", model: "gpt-5.5", reasoning: "high", mode: "default", accessMode: "unrestricted", prompt: "hello" }))).toMatchObject({
      ok: true,
      agent: "codex",
      model: "gpt-5.5",
      reasoning: "high",
      mode: "default",
      accessMode: "unrestricted",
      prompt: "hello",
    });
    expect(parseRunRequestPayload(JSON.stringify({ agent: "codex", model: "default", reasoning: "default", mode: "review", prompt: "hello" }))).toMatchObject({
      ok: true,
      agent: "codex",
      mode: "review",
      profileValid: true,
    });
  });

  it("rejects removed read-write run requests", () => {
    expect(parseRunRequestPayload(JSON.stringify({ agent: "codex", accessMode: "read-write", prompt: "hello" }))).toMatchObject({
      ok: true,
      accessMode: "read-only",
      accessModeValid: false,
    });
  });

  it("keeps SDK permission callbacks pending until the UI posts a decision", async () => {
    const sentEvents: Array<{ readonly type: string; readonly id?: string; readonly title?: string; readonly detail?: string }> = [];
    const handler = createRunApprovalHandler((event) => sentEvents.push(event));
    const abort = new AbortController();

    const resultPromise = handler("Bash", { command: "npm test" }, {
      signal: abort.signal,
      toolUseID: "toolu_1",
      title: "Claude wants to run Bash",
      description: "Run tests before editing",
    });
    let resolved = false;
    void resultPromise.then(() => {
      resolved = true;
    });

    await Promise.resolve();

    expect(resolved).toBe(false);
    expect(sentEvents).toEqual([
      {
        type: "approval",
        id: "toolu_1",
        title: "Claude wants to run Bash",
        detail: "Run tests before editing",
      },
    ]);

    expect(resolvePendingRunApproval({ id: "toolu_1", decision: "approved" })).toEqual({ id: "toolu_1", decision: "approved" });
    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "npm test" },
      toolUseID: "toolu_1",
    });
  });

  it("scopes simultaneous approval callbacks by run id", async () => {
    const runAEvents: Array<{ readonly type: string; readonly id?: string }> = [];
    const runBEvents: Array<{ readonly type: string; readonly id?: string }> = [];
    const runA = createRunApprovalHandler((event) => runAEvents.push(event), "run-a");
    const runB = createRunApprovalHandler((event) => runBEvents.push(event), "run-b");
    const abortA = new AbortController();
    const abortB = new AbortController();

    const resultA = runA("Bash", { command: "npm test" }, { signal: abortA.signal, toolUseID: "toolu_1" });
    const resultB = runB("Bash", { command: "npm run build" }, { signal: abortB.signal, toolUseID: "toolu_1" });

    await Promise.resolve();

    expect(runAEvents).toEqual([expect.objectContaining({ type: "approval", id: "run-a:toolu_1" })]);
    expect(runBEvents).toEqual([expect.objectContaining({ type: "approval", id: "run-b:toolu_1" })]);
    expect(resolvePendingRunApproval({ id: "run-a:toolu_1", decision: "approved" })).toEqual({ id: "run-a:toolu_1", decision: "approved" });
    expect(resolvePendingRunApproval({ id: "run-b:toolu_1", decision: "rejected" })).toEqual({ id: "run-b:toolu_1", decision: "rejected" });
    await expect(resultA).resolves.toEqual({ behavior: "allow", updatedInput: { command: "npm test" }, toolUseID: "toolu_1" });
    await expect(resultB).resolves.toEqual({ behavior: "deny", message: "User rejected this action.", toolUseID: "toolu_1" });
  });

  it("keeps AskUserQuestion callbacks pending until every question receives UI input", async () => {
    const sentEvents: Array<{
      readonly type: string;
      readonly id?: string;
      readonly prompt?: string;
      readonly multi?: boolean;
      readonly options?: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }>;
    }> = [];
    const handler = createRunApprovalHandler((event) => sentEvents.push(event));
    const abort = new AbortController();
    const input = {
      questions: [
        {
          question: "How should I format the output?",
          header: "Format",
          options: [
            { label: "Summary", description: "Brief overview" },
            { label: "Detailed", description: "Full explanation" },
          ],
          multiSelect: false,
        },
        {
          question: "Which sections should I include?",
          header: "Sections",
          options: [
            { label: "Introduction", description: "Opening context" },
            { label: "Conclusion", description: "Final summary" },
          ],
          multiSelect: true,
        },
      ],
    };

    const resultPromise = handler("AskUserQuestion", input, {
      signal: abort.signal,
      toolUseID: "toolu_question",
    });
    let resolved = false;
    void resultPromise.then(() => {
      resolved = true;
    });

    await Promise.resolve();

    expect(resolved).toBe(false);
    expect(sentEvents).toEqual([
      {
        type: "options",
        id: "toolu_question:q0",
        prompt: "How should I format the output?",
        multi: false,
        options: [
          { id: "Summary", label: "Summary", description: "Brief overview" },
          { id: "Detailed", label: "Detailed", description: "Full explanation" },
        ],
      },
      {
        type: "options",
        id: "toolu_question:q1",
        prompt: "Which sections should I include?",
        multi: true,
        options: [
          { id: "Introduction", label: "Introduction", description: "Opening context" },
          { id: "Conclusion", label: "Conclusion", description: "Final summary" },
        ],
      },
    ]);

    expect(resolvePendingRunInput({ id: "toolu_question:q0", selected: ["Summary"] })).toEqual({
      id: "toolu_question:q0",
      selected: ["Summary"],
    });
    expect(resolved).toBe(false);
    expect(resolvePendingRunInput({ id: "toolu_question:q1", selected: ["Introduction", "Conclusion"] })).toEqual({
      id: "toolu_question:q1",
      selected: ["Introduction", "Conclusion"],
    });

    await expect(resultPromise).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        questions: input.questions,
        answers: {
          "How should I format the output?": "Summary",
          "Which sections should I include?": ["Introduction", "Conclusion"],
        },
      },
      toolUseID: "toolu_question",
    });
  });

  it("scopes simultaneous AskUserQuestion callbacks by run id", async () => {
    const runAEvents: Array<{ readonly type: string; readonly id?: string }> = [];
    const runBEvents: Array<{ readonly type: string; readonly id?: string }> = [];
    const runA = createRunApprovalHandler((event) => runAEvents.push(event), "run-a");
    const runB = createRunApprovalHandler((event) => runBEvents.push(event), "run-b");
    const input = {
      questions: [
        {
          question: "Pick output format",
          options: [{ label: "Summary" }, { label: "Detailed" }],
        },
      ],
    };

    const resultA = runA("AskUserQuestion", input, { signal: new AbortController().signal, toolUseID: "toolu_question" });
    const resultB = runB("AskUserQuestion", input, { signal: new AbortController().signal, toolUseID: "toolu_question" });

    await Promise.resolve();

    expect(runAEvents).toEqual([expect.objectContaining({ type: "options", id: "run-a:toolu_question:q0" })]);
    expect(runBEvents).toEqual([expect.objectContaining({ type: "options", id: "run-b:toolu_question:q0" })]);
    expect(resolvePendingRunInput({ id: "run-a:toolu_question:q0", selected: ["Summary"] })).toEqual({ id: "run-a:toolu_question:q0", selected: ["Summary"] });
    expect(resolvePendingRunInput({ id: "run-b:toolu_question:q0", selected: ["Detailed"] })).toEqual({ id: "run-b:toolu_question:q0", selected: ["Detailed"] });
    await expect(resultA).resolves.toEqual({
      behavior: "allow",
      updatedInput: { questions: input.questions, answers: { "Pick output format": "Summary" } },
      toolUseID: "toolu_question",
    });
    await expect(resultB).resolves.toEqual({
      behavior: "allow",
      updatedInput: { questions: input.questions, answers: { "Pick output format": "Detailed" } },
      toolUseID: "toolu_question",
    });
  });

  it("persists approval decisions and option selections in workspace state", () => {
    const state = buildInitialWorkspaceState();
    const pendingState = {
      ...state,
      chats: state.chats.map((conversation) => (conversation.id === "chat-2" ? { ...conversation, status: "waiting" as const } : conversation)),
      threads: {
        ...state.threads,
        "chat-2": [
          ...state.threads["chat-2"],
          {
            id: "a-pending-input",
            role: "agent" as const,
            blocks: [
              { kind: "approval" as const, id: "approval-1", title: "Approve Bash?", detail: "npm test" },
              {
                kind: "options" as const,
                id: "toolu_question:q0",
                prompt: "How should I format it?",
                options: [
                  { id: "Summary", label: "Summary" },
                  { id: "Detailed", label: "Detailed" },
                ],
              },
            ],
          },
        ],
      },
    };

    const approved = applyRunApprovalDecisionState(pendingState, { id: "approval-1", decision: "approved" });
    const selected = applyRunInputSelectionState(approved, { id: "toolu_question:q0", selected: ["Summary"] });
    const blocks = selected.threads["chat-2"].find((message) => message.id === "a-pending-input")?.blocks;

    expect(selected.chats.find((conversation) => conversation.id === "chat-2")?.status).toBe("running");
    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "approval", id: "approval-1", decision: "approved" }),
        expect.objectContaining({ kind: "options", id: "toolu_question:q0", selected: ["Summary"] }),
      ]),
    );
  });

  it("classifies workspace PUT payload errors separately from server persistence errors", () => {
    expect(workspacePutErrorStatus(new SyntaxError("Unexpected token"))).toBe(400);
    expect(workspacePutErrorStatus(new Error("EACCES: permission denied"))).toBe(500);
  });

  it("classifies run-control payload, pending-request, and persistence errors", () => {
    expect(runControlErrorStatus(new SyntaxError("Unexpected token"))).toBe(400);
    expect(runControlErrorStatus(new Error("Invalid approval decision."))).toBe(400);
    expect(runControlErrorStatus(new Error("Selected options do not match the pending question."))).toBe(400);
    expect(runControlErrorStatus(new Error("No pending approval request for approval-1."))).toBe(404);
    expect(runControlErrorStatus(new Error("No pending input request for toolu_question:q0."))).toBe(404);
    expect(runControlErrorStatus(new Error("EACCES: permission denied"))).toBe(500);
  });

  it("classifies attachment upload parse errors separately from storage errors", () => {
    expect(attachmentUploadErrorStatus(new SyntaxError("Unexpected token"))).toBe(400);
    expect(attachmentUploadErrorStatus(new Error("EACCES: permission denied"))).toBe(500);
  });

  it("classifies agent config parse errors separately from storage errors", () => {
    expect(agentConfigErrorStatus(new SyntaxError("Unexpected token"))).toBe(400);
    expect(agentConfigErrorStatus(new Error("Invalid agent config payload."))).toBe(400);
    expect(agentConfigErrorStatus(new Error("API key is required."))).toBe(400);
    expect(agentConfigErrorStatus(new Error("EACCES: permission denied"))).toBe(500);
  });

  it("classifies agent install parse errors separately from launch errors", () => {
    expect(agentInstallErrorStatus(new SyntaxError("Unexpected token"))).toBe(400);
    expect(agentInstallErrorStatus(new Error("Invalid agent install payload."))).toBe(400);
    expect(agentInstallErrorStatus(new Error("Agent id is required."))).toBe(400);
    expect(agentInstallErrorStatus(new Error("spawn EACCES"))).toBe(500);
  });

  it("keeps server-owned background run fields when applying a stale workspace PUT", () => {
    const current = buildInitialWorkspaceState();
    const serverState = {
      ...current,
      chats: current.chats.map((conversation) =>
        conversation.id === "chat-2"
          ? {
              ...conversation,
              activeRunId: "run-bg",
              status: "running" as const,
              snippet: "server streamed token",
              time: "10:02",
              costUsd: 0.25,
              usage: { totalTokens: 100 },
            }
          : conversation,
      ),
      threads: {
        ...current.threads,
        "chat-2": [
          ...current.threads["chat-2"],
          {
            id: "a-bg",
            role: "agent" as const,
            time: "10:02",
            blocks: [{ kind: "text" as const, text: "server streamed token", streaming: true }],
          },
        ],
      },
    };
    const staleClientState = {
      ...serverState,
      chats: serverState.chats.map((conversation) =>
        conversation.id === "chat-2"
          ? {
              ...conversation,
              title: "Renamed while running",
              activeRunId: "run-bg",
              status: "running" as const,
              snippet: "old client token",
              time: "10:00",
              costUsd: undefined,
              usage: undefined,
            }
          : conversation,
      ),
      threads: {
        ...serverState.threads,
        "chat-2": current.threads["chat-2"],
      },
      settings: {
        ...serverState.settings,
        general: { ...serverState.settings.general, locale: "en" as const },
      },
    };

    const merged = mergeWorkspacePutState(staleClientState, serverState);
    const mergedConversation = merged.chats.find((conversation) => conversation.id === "chat-2");

    expect(mergedConversation).toMatchObject({
      title: "Renamed while running",
      activeRunId: "run-bg",
      status: "running",
      snippet: "server streamed token",
      time: "10:02",
      costUsd: 0.25,
      usage: { totalTokens: 100 },
    });
    expect(merged.threads["chat-2"]).toEqual(serverState.threads["chat-2"]);
    expect(merged.settings.general.locale).toBe("en");
  });

  it("does not resurrect a completed background run when applying a stale workspace PUT", () => {
    const current = buildInitialWorkspaceState();
    const serverState = {
      ...current,
      chats: current.chats.map((conversation) =>
        conversation.id === "chat-2"
          ? {
              ...conversation,
              activeRunId: undefined,
              status: "done" as const,
              snippet: "server final answer",
              time: "10:03",
              costUsd: 0.42,
              usage: { totalTokens: 120, inputTokens: 80, outputTokens: 40 },
            }
          : conversation,
      ),
      threads: {
        ...current.threads,
        "chat-2": [
          ...current.threads["chat-2"],
          { id: "u-bg", role: "user" as const, text: "continue in background", time: "10:00" },
          { id: "a-bg", role: "agent" as const, time: "10:03", blocks: [{ kind: "text" as const, text: "server final answer" }] },
        ],
      },
    };
    const staleClientState = {
      ...serverState,
      chats: serverState.chats.map((conversation) =>
        conversation.id === "chat-2"
          ? {
              ...conversation,
              title: "Renamed while stale",
              activeRunId: "run-bg",
              status: "running" as const,
              snippet: "server streamed token",
              time: "10:01",
              costUsd: undefined,
              usage: undefined,
            }
          : conversation,
      ),
      threads: {
        ...serverState.threads,
        "chat-2": [
          ...current.threads["chat-2"],
          { id: "u-bg", role: "user" as const, text: "continue in background", time: "10:00" },
          { id: "a-bg", role: "agent" as const, time: "10:01", blocks: [{ kind: "text" as const, text: "server streamed token", streaming: true }] },
        ],
      },
      settings: {
        ...serverState.settings,
        general: { ...serverState.settings.general, locale: "en" as const },
      },
    };

    const merged = mergeWorkspacePutState(staleClientState, serverState);
    const mergedConversation = merged.chats.find((conversation) => conversation.id === "chat-2");

    expect(mergedConversation).toMatchObject({
      title: "Renamed while stale",
      activeRunId: undefined,
      status: "done",
      snippet: "server final answer",
      time: "10:03",
      costUsd: 0.42,
      usage: { totalTokens: 120, inputTokens: 80, outputTokens: 40 },
    });
    expect(merged.threads["chat-2"]).toEqual(serverState.threads["chat-2"]);
    expect(merged.settings.general.locale).toBe("en");
  });

  it("marks canceled persisted background runs idle immediately", () => {
    const state = buildInitialWorkspaceState();
    const runningState = {
      ...state,
      chats: state.chats.map((conversation) =>
        conversation.id === "chat-2"
          ? {
              ...conversation,
              activeRunId: "run-bg",
              status: "running" as const,
              snippet: "server streamed token",
              time: "10:02",
            }
          : conversation,
      ),
      threads: {
        ...state.threads,
        "chat-2": [
          ...state.threads["chat-2"],
          {
            id: "a-bg",
            role: "agent" as const,
            time: "10:02",
            blocks: [
              { kind: "reasoning" as const, text: "Still running", active: true },
              { kind: "text" as const, text: "partial", streaming: true },
            ],
          },
        ],
      },
    };

    const canceled = cancelBackgroundRunState(runningState, "run-bg");
    const canceledConversation = canceled.chats.find((conversation) => conversation.id === "chat-2");
    const canceledBlocks = canceled.threads["chat-2"].find((message) => message.id === "a-bg")?.blocks;

    expect(canceledConversation).toMatchObject({
      activeRunId: undefined,
      status: "idle",
      snippet: "Запуск остановлен",
    });
    expect(canceledBlocks).toEqual([
      { kind: "reasoning", text: "Still running", active: false },
      { kind: "text", text: "partial", streaming: false },
      { kind: "status", level: "warn", text: "Запуск остановлен" },
    ]);
  });

  it("cancels a persisted background run even when no in-memory handle exists", () => {
    const state = buildInitialWorkspaceState();
    const runningState = {
      ...state,
      chats: state.chats.map((conversation) =>
        conversation.id === "chat-2"
          ? {
              ...conversation,
              activeRunId: "run-detached",
              status: "running" as const,
              snippet: "still running in persisted state",
              time: "10:02",
            }
          : conversation,
      ),
      threads: {
        ...state.threads,
        "chat-2": [
          ...state.threads["chat-2"],
          {
            id: "a-detached",
            role: "agent" as const,
            time: "10:02",
            blocks: [{ kind: "reasoning" as const, text: "Still running", active: true }],
          },
        ],
      },
    };

    const result = cancelBackgroundRunRequestState(runningState, "run-detached", false);

    expect(result).toMatchObject({ canceled: true, hadHandle: false });
    expect(result.state.chats.find((conversation) => conversation.id === "chat-2")).toMatchObject({
      activeRunId: undefined,
      status: "idle",
      snippet: "Запуск остановлен",
    });
    expect(result.state.threads["chat-2"].find((message) => message.id === "a-detached")?.blocks).toEqual([
      { kind: "reasoning", text: "Still running", active: false },
      { kind: "status", level: "warn", text: "Запуск остановлен" },
    ]);
  });

  it("keeps the canceled status block when a canceled background process finally closes", () => {
    const state = buildInitialWorkspaceState();
    const binding = {
      conversationId: "chat-2",
      runId: "run-bg",
      userMessageId: "u-bg",
      userMessageTime: "10:00",
      agentMessageId: "a-bg",
      agentMessageTime: "10:02",
    };
    const runningState = {
      ...state,
      chats: state.chats.map((conversation) =>
        conversation.id === "chat-2"
          ? {
              ...conversation,
              activeRunId: "run-bg",
              status: "running" as const,
              snippet: "server streamed token",
              time: "10:02",
            }
          : conversation,
      ),
      threads: {
        ...state.threads,
        "chat-2": [
          ...state.threads["chat-2"],
          { id: "u-bg", role: "user" as const, text: "continue in background", time: "10:00" },
          {
            id: "a-bg",
            role: "agent" as const,
            time: "10:02",
            blocks: [
              { kind: "reasoning" as const, text: "Still running", active: true },
              { kind: "text" as const, text: "partial", streaming: true },
            ],
          },
        ],
      },
    };
    const canceledState = cancelBackgroundRunState(runningState, "run-bg");
    const finished = finishBackgroundRunState(
      canceledState,
      binding,
      {
        reasoning: "Still running",
        hasReasoning: true,
        started: true,
        text: "partial",
        hasText: true,
        tools: [],
        diffs: [],
        plans: [],
        codes: [],
        searches: [],
        suggested: [],
        approvals: [],
        options: [],
        statuses: [],
        done: false,
        start: Date.now(),
      },
      true,
    );

    const blocks = finished.threads["chat-2"].find((message) => message.id === "a-bg")?.blocks;

    expect(finished.chats.find((conversation) => conversation.id === "chat-2")).toMatchObject({
      activeRunId: undefined,
      status: "idle",
      snippet: "Запуск остановлен",
    });
    expect(blocks).toEqual([
      { kind: "reasoning", text: "Still running", active: false, duration: expect.stringMatching(/s$/) },
      { kind: "text", text: "partial", streaming: false },
      { kind: "status", level: "warn", text: "Запуск остановлен" },
    ]);
  });

  it("keeps server-owned background conversations that are missing from a stale workspace PUT", () => {
    const current = buildInitialWorkspaceState();
    const serverState = {
      ...current,
      chats: [
        {
          id: "chat-bg",
          title: "Background run",
          snippet: "server streamed token",
          time: "10:02",
          status: "running" as const,
          agent: "claude-code" as const,
          profile: { agent: "claude-code" as const, model: "default", reasoning: "default", mode: "default" as const },
          activeRunId: "run-bg",
        },
        ...current.chats,
      ],
      threads: {
        ...current.threads,
        "chat-bg": [
          { id: "u-bg", role: "user" as const, text: "continue in background", time: "10:00" },
          { id: "a-bg", role: "agent" as const, time: "10:02", blocks: [{ kind: "text" as const, text: "server streamed token", streaming: true }] },
        ],
      },
    };
    const staleClientState = {
      ...serverState,
      chats: current.chats,
      threads: current.threads,
    };

    const merged = mergeWorkspacePutState(staleClientState, serverState);

    expect(merged.chats.find((conversation) => conversation.id === "chat-bg")).toMatchObject({
      activeRunId: "run-bg",
      status: "running",
      snippet: "server streamed token",
    });
    expect(merged.threads["chat-bg"]).toEqual(serverState.threads["chat-bg"]);
  });

  it("keeps server-owned project background conversations that are missing from a stale workspace PUT", () => {
    const current = buildInitialWorkspaceState();
    const serverState = {
      ...current,
      projects: current.projects.map((project) =>
        project.id === "auth-service"
          ? {
              ...project,
              conversations: project.conversations.map((conversation) =>
                conversation.id === "c-flaky"
                  ? {
                      ...conversation,
                      activeRunId: "run-project-bg",
                      status: "running" as const,
                      snippet: "project server token",
                      time: "10:05",
                    }
                  : conversation,
              ),
            }
          : project,
      ),
      threads: {
        ...current.threads,
        "c-flaky": [
          ...current.threads["c-flaky"],
          { id: "a-project-bg", role: "agent" as const, time: "10:05", blocks: [{ kind: "text" as const, text: "project server token", streaming: true }] },
        ],
      },
    };
    const staleClientState = {
      ...serverState,
      projects: serverState.projects.map((project) =>
        project.id === "auth-service"
          ? { ...project, conversations: project.conversations.filter((conversation) => conversation.id !== "c-flaky") }
          : project,
      ),
      threads: {
        ...serverState.threads,
        "c-flaky": current.threads["c-flaky"],
      },
    };

    const merged = mergeWorkspacePutState(staleClientState, serverState);
    const mergedProjectConversation = merged.projects.find((project) => project.id === "auth-service")?.conversations.find((conversation) => conversation.id === "c-flaky");

    expect(mergedProjectConversation).toMatchObject({
      activeRunId: "run-project-bg",
      status: "running",
      snippet: "project server token",
    });
    expect(merged.threads["c-flaky"]).toEqual(serverState.threads["c-flaky"]);
  });

  it("builds Claude SDK options with a live permission handler for unrestricted runs", () => {
    const controller = new AbortController();
    const canUseTool = (() => Promise.resolve({ behavior: "deny", message: "test" })) satisfies CanUseTool;

    expect(
      buildClaudeSdkOptions(
        { agent: "claude-code", model: "default", reasoning: "default", mode: "default", prompt: "hello", accessMode: "unrestricted" },
        "C:/repo",
        controller,
        canUseTool,
      ),
    ).toMatchObject({
      abortController: controller,
      allowedTools: ["Read", "Glob", "Grep", "LS"],
      canUseTool,
      cwd: "C:/repo",
      permissionMode: "default",
      systemPrompt: expect.objectContaining({
        append: expect.stringContaining("AskUserQuestion"),
      }),
      tools: { type: "preset", preset: "claude_code" },
    });

    expect(
      buildClaudeSdkOptions(
        { agent: "claude-code", model: "opus", reasoning: "max", mode: "plan", prompt: "hello", accessMode: "unrestricted" },
        "C:/repo",
        controller,
        canUseTool,
      ),
    ).toMatchObject({
      effort: "max",
      model: "opus",
      permissionMode: "plan",
      tools: ["Read", "Glob", "Grep", "LS", "AskUserQuestion"],
    });
  });

  it("marks persisted active background runs as interrupted when no server handle owns them", () => {
    const state = buildInitialWorkspaceState();
    const reconciled = reconcileStaleBackgroundRuns(
      {
        ...state,
        chats: state.chats.map((conversation) =>
          conversation.id === "chat-2" ? { ...conversation, activeRunId: "run-stale", status: "running", snippet: "Still running" } : conversation,
        ),
        projects: state.projects.map((project) =>
          project.id === "auth-service"
            ? {
                ...project,
                conversations: project.conversations.map((conversation) =>
                  conversation.id === "c-flaky" ? { ...conversation, activeRunId: "run-live", status: "running", snippet: "Still running" } : conversation,
                ),
              }
            : project,
        ),
        threads: {
          ...state.threads,
          "chat-2": [
            ...state.threads["chat-2"],
            {
              id: "a-stale",
              role: "agent",
              blocks: [
                { kind: "reasoning", text: "Still thinking", active: true },
                { kind: "text", text: "partial answer", streaming: true },
              ],
            },
          ],
        },
      },
      new Set(["run-live"]),
    );

    expect(reconciled.chats.find((conversation) => conversation.id === "chat-2")).toMatchObject({
      activeRunId: undefined,
      status: "error",
      snippet: "Фоновый запуск прерван",
    });
    const staleBlocks = reconciled.threads["chat-2"].find((message) => message.id === "a-stale")?.blocks;
    expect(staleBlocks).toEqual([
      { kind: "reasoning", text: "Still thinking", active: false },
      { kind: "text", text: "partial answer", streaming: false },
      { kind: "status", level: "error", text: "Фоновый запуск прерван" },
    ]);
    expect(reconciled.projects[0]?.conversations.find((conversation) => conversation.id === "c-flaky")).toMatchObject({
      activeRunId: "run-live",
      status: "running",
      snippet: "Still running",
    });
  });

  it("serializes active background run handles for browser reconnects", () => {
    const binding: BackgroundRunBinding = {
      conversationId: "chat-2",
      runId: "run-background",
      userMessageId: "u-background",
      userMessageTime: "2026-06-06T14:00:00.000Z",
      agentMessageId: "a-background",
      agentMessageTime: "2026-06-06T14:00:01.000Z",
    };
    const handles = new Map<string, BackgroundRunHandle>([
      [
        binding.runId,
        {
          binding,
          startedAt: "2026-06-06T14:00:02.000Z",
          cancel: () => undefined,
        },
      ],
    ]);

    expect(activeBackgroundRunSnapshotsFromHandles(handles)).toEqual([
      {
        runId: "run-background",
        conversationId: "chat-2",
        userMessageId: "u-background",
        agentMessageId: "a-background",
        startedAt: "2026-06-06T14:00:02.000Z",
      },
    ]);
  });

  it("builds attach stream updates from persisted background run state", () => {
    const binding: BackgroundRunBinding = {
      conversationId: "chat-2",
      runId: "run-existing",
      userMessageId: "u-existing",
      userMessageTime: "14:00",
      agentMessageId: "a-existing",
      agentMessageTime: "14:01",
    };
    const state = buildInitialWorkspaceState();
    const runningState = {
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === "chat-2"
          ? {
              ...chat,
              activeRunId: binding.runId,
              status: "running" as const,
              snippet: "Working",
              time: binding.agentMessageTime,
            }
          : chat,
      ),
      threads: {
        ...state.threads,
        "chat-2": [
          ...state.threads["chat-2"],
          { id: binding.agentMessageId, role: "agent" as const, time: binding.agentMessageTime, blocks: [{ kind: "text" as const, text: "live" }] },
        ],
      },
    };

    expect(activeBackgroundRunUpdateFromState(runningState, binding, false)).toEqual({
      runId: binding.runId,
      conversationId: binding.conversationId,
      agentMessageId: binding.agentMessageId,
      status: "running",
      snippet: "Working",
      time: binding.agentMessageTime,
      done: false,
      blocks: [{ kind: "text", text: "live" }],
    });
  });

  it("builds attach stream updates with usage from the persisted agent message", () => {
    const binding: BackgroundRunBinding = {
      conversationId: "chat-2",
      runId: "run-existing",
      userMessageId: "u-existing",
      userMessageTime: "14:00",
      agentMessageId: "a-existing",
      agentMessageTime: "14:01",
    };
    const state = buildInitialWorkspaceState();
    const runningState = {
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === "chat-2"
          ? {
              ...chat,
              activeRunId: binding.runId,
              status: "running" as const,
              snippet: "Working",
              time: binding.agentMessageTime,
            }
          : chat,
      ),
      threads: {
        ...state.threads,
        "chat-2": [
          ...state.threads["chat-2"],
          {
            id: binding.agentMessageId,
            role: "agent" as const,
            time: binding.agentMessageTime,
            blocks: [{ kind: "text" as const, text: "live" }],
            costUsd: 0.0173,
            usage: { totalTokens: 9653 },
          },
        ],
      },
    };

    expect(activeBackgroundRunUpdateFromState(runningState, binding, false)).toMatchObject({
      runId: binding.runId,
      conversationId: binding.conversationId,
      agentMessageId: binding.agentMessageId,
      costUsd: 0.0173,
      usage: { totalTokens: 9653 },
    });
  });

  it("settles bound background runs that fail before an agent process starts", () => {
    const state = buildInitialWorkspaceState();
    const settled = settleEarlyBackgroundRunState(
      state,
      {
        conversationId: "chat-2",
        runId: "run-early",
        userMessageId: "u-early",
        userMessageTime: "10:00",
        agentMessageId: "a-early",
        agentMessageTime: "10:01",
      },
      {
        agent: "codex",
        model: "default",
        reasoning: "default",
        mode: "default",
        prompt: "Use an unsupported profile",
        accessMode: "read-only",
      },
      [
        { type: "start" },
        { type: "error", text: "Unknown model 'bad' for codex." },
      ],
    );

    expect(settled.chats.find((conversation) => conversation.id === "chat-2")).toMatchObject({
      activeRunId: undefined,
      status: "error",
      snippet: "Запуск завершился с ошибкой",
    });
    expect(settled.threads["chat-2"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "u-early", role: "user", text: "Use an unsupported profile" }),
        expect.objectContaining({
          id: "a-early",
          role: "agent",
          blocks: expect.arrayContaining([expect.objectContaining({ kind: "status", level: "error", text: "Unknown model 'bad' for codex." })]),
        }),
      ]),
    );
  });

  it("does not mark early warning-only bound background runs as done", () => {
    const state = buildInitialWorkspaceState();
    const settled = settleEarlyBackgroundRunState(
      state,
      {
        conversationId: "chat-2",
        runId: "run-missing-cli",
        userMessageId: "u-missing-cli",
        userMessageTime: "10:00",
        agentMessageId: "a-missing-cli",
        agentMessageTime: "10:01",
      },
      {
        agent: "codex",
        model: "default",
        reasoning: "default",
        mode: "default",
        prompt: "Run with missing CLI",
        accessMode: "read-only",
      },
      [
        { type: "start" },
        { type: "status", level: "warn", text: "codex is not installed on this machine" },
      ],
    );

    expect(settled.chats.find((conversation) => conversation.id === "chat-2")).toMatchObject({
      activeRunId: undefined,
      status: "error",
      snippet: "Запуск завершился с ошибкой",
    });
    expect(settled.threads["chat-2"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "a-missing-cli",
          role: "agent",
          blocks: expect.arrayContaining([expect.objectContaining({ kind: "status", level: "warn", text: "codex is not installed on this machine" })]),
        }),
      ]),
    );
  });
});
