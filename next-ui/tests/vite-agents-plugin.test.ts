import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import {
  agentStatusForDetection,
  agentCliInfoForDetection,
  agentConfigErrorStatus,
  appendJsonBodyChunk,
  attachmentUploadErrorStatus,
  buildClaudeSdkOptions,
  buildClaudeRunArgs,
  buildCodexRunArgs,
  buildCodexThreadParams,
  codexDynamicToolCallResponse,
  codexAppServerItemEvents,
  codexRlabDynamicTools,
  codexAppServerUsage,
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
  emitOpenCodeParts,
  activeBackgroundRunUpdateFromState,
  activeBackgroundRunSnapshotsFromHandles,
  applyBrowserStorageSnapshot,
  appendRunAuditEvent,
  appendRlabChatToolsPrompt,
  BROWSER_ACTION_TIMEOUT_MS,
  browserBridgeOrigin,
  browserPreviewActionFailureResult,
  parseRunApprovalPayload,
  parseRunCancelPayload,
  parseRunInputPayload,
  parseAttachmentUploadPayload,
  parseBrowserActionPayload,
  parseBrowserDirtyPayload,
  parseBrowserSessionPayload,
  parseBrowserSyncPayload,
  parseAgentConfigPayload,
  parseAgentInstallPayload,
  parseAnthropicModelInfos,
  parseGitStatusPorcelain,
  parseGitCwdPayload,
  parseGitFilePayload,
  parseGitCommitPayload,
  parseGitCheckoutPayload,
  parseGitCommitActionPayload,
    gitGraphBranchHeads,
    parseGitGraphLog,
  parseTerminalSessionRequest,
  gitErrorStatus,
  gitPushRequestErrorStatus,
  isNoChangesGitCommitResult,
  jsonBodyReadErrorStatus,
  parseProjectDirectoryPayload,
  parseRunRequestPayload,
  agentInstallErrorStatus,
  applyRunApprovalDecisionState,
  applyRunInputSelectionState,
  cancelBackgroundRunState,
  cancelBackgroundRunRequestState,
  finishBackgroundRunState,
  backgroundRunStatusPatch,
  mergeWorkspacePutState,
  npmPackageNameFromInstallSpec,
  listMentionableFiles,
  reconcileStaleBackgroundRuns,
  hasGeminiStoredAuthAt,
  installCommandForAgent,
  JSON_CONTENT_TYPE,
  parseClaudeCliModelAliasesSource,
  parseClaudeOAuthUsagePayload,
  parseClaudeRateLimitStream,
  parseCodexModelsOutput,
  parseGeminiModelUsageOutput,
  parseClaudeAgentsOutput,
  parseGeminiCliModelConfigSource,
  parseOpenCodeAgentsOutput,
  parseOpenCodeModelsOutput,
  prepareAgentPrompt,
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
import { MAX_AGENT_TOOL_OUTPUT_CHARS } from "../src/lib/agent-output";
import { accumulateRunEvent, createRunEventAccumulator } from "../src/lib/run-event-accumulator";
import { buildInitialWorkspaceState } from "../src/lib/workspace-state";
import { type AgentProfile } from "../src/components/agent";

describe("vite agents plugin", () => {
  it("does not import client UI modules into the dev-server runtime", () => {
    const source = readFileSync("vite-agents-plugin.ts", "utf8");

    expect(source).not.toContain('from "./src/components/workspace/app-settings"');
    expect(source).not.toContain('from "./src/components/workspace/workspace-state"');
    expect(source).not.toContain('from "./src/components/workspace/sample-data"');
    expect(source).not.toContain('from "./src/i18n/I18nProvider"');
  });

  it("uses the loopback HTTP origin for browser bridge prompts behind the production proxy", () => {
    const req = {
      headers: {
        host: "127.0.0.1:4280",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "rlab.132.243.123.242.sslip.io",
      },
    } as unknown as Parameters<typeof browserBridgeOrigin>[0];

    expect(browserBridgeOrigin(req)).toBe("http://127.0.0.1:4280");
  });

  it("extracts npm package names from CLI update install specs", () => {
    expect(npmPackageNameFromInstallSpec("@anthropic-ai/claude-code@latest")).toBe("@anthropic-ai/claude-code");
    expect(npmPackageNameFromInstallSpec("@openai/codex@0.42.0")).toBe("@openai/codex");
    expect(npmPackageNameFromInstallSpec("opencode-ai@latest")).toBe("opencode-ai");
    expect(npmPackageNameFromInstallSpec("-g")).toBeNull();
  });

  it("adds rlab chat tool instructions to every agent prompt once", () => {
    const withTools = appendRlabChatToolsPrompt("wait until the deployment is ready");

    expect(withTools).toContain("<rlab-chat-tools>");
    expect(withTools).toContain("TaskWakeup supports delaySeconds/fireAt/cron");
    expect(withTools).toContain('TaskWakeup with action="list"');
    expect(withTools).toContain("{ prompt, script, intervalSeconds, reason }");
    expect(appendRlabChatToolsPrompt(withTools).match(/<rlab-chat-tools>/g)).toHaveLength(1);
  });

  it("keeps browser bridge prompt appended after the rlab chat tool contract", () => {
    const binding: BackgroundRunBinding = {
      conversationId: "chat-browser",
      runId: "run-browser",
      userMessageId: "u-browser",
      userMessageTime: "10:00",
      agentMessageId: "a-browser",
      agentMessageTime: "10:01",
    };
    const prompt = prepareAgentPrompt("use preview", binding, "https://rlab.example");

    expect(prompt.indexOf("<rlab-chat-tools>")).toBeGreaterThan(-1);
    expect(prompt.indexOf("<browser-preview-bridge>")).toBeGreaterThan(prompt.indexOf("</rlab-chat-tools>"));
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

    expect(snapshot.storage.stateFile).toContain("workspace.db");
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

  it("marks Claude Code available through the SDK runtime without a PATH binary", () => {
    expect(
      agentCliInfoForDetection(
        "claude-code",
        {
          bins: ["claude"],
          sdkRuntime: true,
          env: ["ANTHROPIC_API_KEY"],
          hasAuth: () => false,
        },
        { env: {} },
        { ANTHROPIC_API_KEY: "anthropic-test-key" },
        "",
        "linux",
      ),
    ).toMatchObject({
      status: "available",
      bins: ["claude"],
      resolvedBin: null,
      runAdapter: true,
      selectable: true,
      env: ["ANTHROPIC_API_KEY"],
    });
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

  it("parses Anthropic SDK model metadata for Claude Code", () => {
    const models: Parameters<typeof parseAnthropicModelInfos>[0] = [
      {
        type: "model",
        id: "claude-sonnet-4-6-20260101",
        display_name: "Claude Sonnet 4.6",
        created_at: "2026-01-01T00:00:00Z",
        capabilities: null,
        max_input_tokens: null,
        max_tokens: null,
      },
      {
        type: "model",
        id: "claude-haiku-4-5-20260101",
        display_name: "",
        created_at: "2026-01-01T00:00:00Z",
        capabilities: null,
        max_input_tokens: null,
        max_tokens: null,
      },
      {
        type: "model",
        id: "gpt-5.5",
        display_name: "GPT-5.5",
        created_at: "2026-01-01T00:00:00Z",
        capabilities: null,
        max_input_tokens: null,
        max_tokens: null,
      },
    ];

    expect(parseAnthropicModelInfos(models)).toEqual([
      { id: "claude-sonnet-4-6-20260101", label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6-20260101" },
      { id: "claude-haiku-4-5-20260101", label: "Claude Haiku 4.5 20260101", value: "claude-haiku-4-5-20260101" },
    ]);
  });

  it("parses Claude CLI model aliases from the installed binary metadata", () => {
    expect(parseClaudeCliModelAliasesSource("claude-fable-5 Fable 5 claude-sonnet-4-6 Sonnet 4.6 claude-haiku-4-5 Haiku 4.5")).toEqual([
      { id: "default", label: "Default" },
      { id: "fable", label: "Fable", value: "fable" },
      { id: "sonnet", label: "Sonnet", value: "sonnet" },
      { id: "haiku", label: "Haiku", value: "haiku" },
    ]);
  });

  it("parses visible model options from Gemini CLI model config", () => {
    expect(
      parseGeminiCliModelConfigSource(`
var DEFAULT_MODEL_CONFIGS = {
  modelDefinitions: {
    "gemini-3.1-pro-preview": {
      tier: "pro",
      isPreview: true,
      isVisible: true,
      features: { thinking: true }
    },
    "gemini-3.1-pro-preview-customtools": {
      tier: "pro",
      isPreview: true,
      isVisible: false,
      features: { thinking: true }
    },
    "gemma-4-31b-it": {
      displayName: "gemma-4-31b-it",
      tier: "custom",
      isVisible: true,
      features: { thinking: true }
    },
    auto: {
      displayName: "Auto",
      tier: "auto",
      isVisible: true,
      features: {}
    }
  }
};
`),
    ).toEqual([
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", value: "gemini-3.1-pro-preview" },
      { id: "gemma-4-31b-it", label: "gemma-4-31b-it", value: "gemma-4-31b-it" },
    ]);
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

    expect(
      parseClaudeAgentsOutput(
        JSON.stringify([
          { name: "Explore", model: "haiku" },
          { name: "statusline-setup", model: "haiku" },
          { id: "custom-reviewer", model: "inherit" },
          "Plan",
        ]),
      ),
    ).toEqual([
      { id: "claude-agent:Explore", label: "Explore", value: "Explore" },
      { id: "claude-agent:custom-reviewer", label: "Custom Reviewer", value: "custom-reviewer" },
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
    const args = buildClaudeRunArgs({ prompt: "hello" });
    expect(args).toEqual([
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--append-system-prompt",
      expect.stringContaining("AskUserQuestion"),
      "--settings",
      JSON.stringify({ autoCompactEnabled: true }),
      "--dangerously-skip-permissions",
    ]);
    expect(buildClaudeRunArgs({ prompt: "hello", autoConfirm: true })).toContain("--permission-mode");
    expect(buildClaudeRunArgs({ prompt: "hello", autoConfirm: true })).toContain("auto");
  });

  it("builds Claude args with a selected CLI model alias", () => {
    expect(buildClaudeRunArgs({ prompt: "hello", model: "fable", reasoning: "high", mode: "default", accessMode: "read-only", autoCompact: false, compactWindow: 120000 })).toEqual([
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--append-system-prompt",
      expect.stringContaining("AskUserQuestion"),
      "--settings",
      JSON.stringify({ autoCompactEnabled: false, autoCompactWindow: 120000 }),
      "--model",
      "fable",
      "--effort",
      "high",
      "--permission-mode",
      "plan",
      "--tools",
      "Read,Glob,Grep,LS,AskUserQuestion,TaskWakeup",
    ]);
  });

  it("passes selected Claude Code agent modes to the CLI", () => {
    expect(buildClaudeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "claude-agent:Goal", accessMode: "unrestricted" })).toEqual([
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--append-system-prompt",
      expect.stringContaining("AskUserQuestion"),
      "--settings",
      JSON.stringify({ autoCompactEnabled: true }),
      "--agent",
      "Goal",
      "--dangerously-skip-permissions",
    ]);
  });

  it("builds Claude SDK options for the selected model, effort, agent, and permissions", () => {
    const abortController = new AbortController();
    const canUseTool: Parameters<typeof buildClaudeSdkOptions>[3] = async (_toolName, input) => ({ behavior: "allow", updatedInput: input });

    expect(
      buildClaudeSdkOptions(
        {
          agent: "claude-code",
          prompt: "hello",
          model: "claude-sonnet-4-6-20260101",
          reasoning: "high",
          mode: "claude-agent:Goal",
          accessMode: "unrestricted",
          sessionId: "session-1",
          resume: "resume-1",
        },
        "C:/repo",
        abortController,
        canUseTool,
        { ANTHROPIC_API_KEY: "anthropic-test-key" },
      ),
    ).toMatchObject({
      abortController,
      allowDangerouslySkipPermissions: true,
      allowedTools: ["Read", "Glob", "Grep", "LS"],
      canUseTool,
      cwd: "C:/repo",
      env: { ANTHROPIC_API_KEY: "anthropic-test-key" },
      includePartialMessages: true,
      settings: { autoCompactEnabled: true },
      permissionMode: "bypassPermissions",
      systemPrompt: { type: "preset", preset: "claude_code", append: expect.stringContaining("AskUserQuestion") },
      tools: { type: "preset", preset: "claude_code" },
      model: "claude-sonnet-4-6-20260101",
      effort: "high",
      agent: "Goal",
      sessionId: "session-1",
      resume: "resume-1",
    });

    const readOnlyOptions = buildClaudeSdkOptions(
      { agent: "claude-code", prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "read-only", autoCompact: false, compactWindow: 120000 },
      "C:/repo",
      abortController,
      canUseTool,
    );
    expect(readOnlyOptions.allowDangerouslySkipPermissions).toBeUndefined();
    expect(readOnlyOptions).toMatchObject({
      permissionMode: "plan",
      settings: { autoCompactEnabled: false, autoCompactWindow: 120000 },
      tools: ["Read", "Glob", "Grep", "LS", "AskUserQuestion", "TaskWakeup"],
    });
  });

  it("registers rlab chat tools as MCP tools and aliases the bare names", () => {
    const abortController = new AbortController();
    const canUseTool: Parameters<typeof buildClaudeSdkOptions>[3] = async (_toolName, input) => ({ behavior: "allow", updatedInput: input });
    const options = buildClaudeSdkOptions(
      { agent: "claude-code", prompt: "hi", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted" },
      "C:/repo",
      abortController,
      canUseTool,
    );
    // The tools must be registered (so the SDK doesn't reject the call as unknown)
    // and the model-facing names must resolve to the registered MCP tool names.
    expect(options.mcpServers).toMatchObject({ rlab: expect.objectContaining({ type: "sdk", name: "rlab" }) });
    expect(options.toolAliases).toMatchObject({
      TaskWakeup: "mcp__rlab__TaskWakeup",
    });
    expect(options.toolAliases).not.toHaveProperty("TaskAwait");
  });

  it("schedules a wakeup from an MCP-prefixed TaskWakeup tool call", () => {
    const translate = createClaudeStreamTranslator();
    translate(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "w1", name: "mcp__rlab__TaskWakeup", input: { prompt: "check later", delaySeconds: 600 } }] },
      }),
    );
    const done = translate(
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "w1", content: "ok" }] },
      }),
    );
    // The mcp__rlab__ prefix is normalized, so the translator recognizes the tool
    // and emits a wakeup event instead of leaving the call unhandled.
    expect(done.some((event) => event.type === "wakeup" && event.prompt === "check later" && event.delaySeconds === 600)).toBe(true);
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

  it("surfaces a settled status for a compaction boundary so the bubble never hangs", () => {
    const translate = createClaudeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "system",
          subtype: "compact_boundary",
          compact_metadata: { trigger: "manual", pre_tokens: 120000, post_tokens: 38000 },
        }),
      ),
    ).toEqual([{ type: "status", level: "ok", text: "context compacted · 120k → 38k tokens" }]);

    // A trailing empty result must not re-emit a status (producedContent is set),
    // but still settles the run with a done event.
    expect(translate(JSON.stringify({ type: "result", status: "success", result: "" }))).toEqual([
      {
        type: "done",
        costUsd: undefined,
        usage: { contextTokens: 38000 },
        usageDebug: [{ source: "claude.compact_metadata", payload: { trigger: "manual", pre_tokens: 120000, post_tokens: 38000 } }],
      },
    ]);
  });

  it("renders a `/compact` result summary that arrived without a chat turn", () => {
    const translate = createClaudeStreamTranslator();

    expect(
      translate(JSON.stringify({ type: "result", subtype: "success", result: "Compacted the conversation." })),
    ).toEqual([{ type: "status", level: "ok", text: "Compacted the conversation." }, { type: "done" }]);
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

  it("translates Claude TaskWakeup tool results into scheduler events", () => {
    const translate = createClaudeStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "wake-1",
                name: "TaskWakeup",
                input: { delaySeconds: "180", prompt: "send OK", reason: "user asked for a reminder" },
              },
            ],
          },
        }),
      ),
    ).toEqual([{ type: "tool", id: "wake-1", name: "TaskWakeup", summary: "", args: { delaySeconds: "180", prompt: "send OK", reason: "user asked for a reminder" } }]);

    expect(
      translate(
        JSON.stringify({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "wake-1", content: "scheduled" }],
          },
        }),
      ),
    ).toEqual([
      { type: "tool_result", id: "wake-1", ok: true, output: "scheduled" },
      { type: "wakeup", toolId: "wake-1", prompt: "send OK", reason: "user asked for a reminder", delaySeconds: 180 },
    ]);
  });

  it("translates script wakeup tool input without requiring a timer-only trigger", () => {
    const translate = createClaudeStreamTranslator();

    translate(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "wake-script",
              name: "TaskWakeup",
              input: { script: "test -f /tmp/ready", intervalSeconds: 15, prompt: "continue after ready file exists" },
            },
          ],
        },
      }),
    );

    expect(
      translate(
        JSON.stringify({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "wake-script", content: "installed" }],
          },
        }),
      ),
    ).toEqual([
      { type: "tool_result", id: "wake-script", ok: true, output: "installed" },
      { type: "wakeup", toolId: "wake-script", prompt: "continue after ready file exists", script: "test -f /tmp/ready", intervalSeconds: 15 },
    ]);
  });

  it("translates TaskWakeup cancel tool input into a scheduler cancellation event", () => {
    const translate = createClaudeStreamTranslator();

    translate(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "wake-cancel",
              name: "TaskWakeup",
              input: { action: "cancel", wakeupId: "wakeup-123", reason: "user canceled it" },
            },
          ],
        },
      }),
    );

    expect(
      translate(
        JSON.stringify({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "wake-cancel", content: "canceled" }],
          },
        }),
      ),
    ).toEqual([
      { type: "tool_result", id: "wake-cancel", ok: true, output: "canceled" },
      { type: "cancel_wakeup", toolId: "wake-cancel", wakeupId: "wakeup-123", all: false, reason: "user canceled it" },
    ]);
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

  it("keeps an Edit tool card that settles (running -> ok) alongside its diff", () => {
    const translate = createClaudeStreamTranslator();
    const start = translate(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "e1", name: "Edit", input: { file_path: "a.ts", old_string: "foo", new_string: "bar" } },
        },
      }),
    );
    // A running tool card (so the lifecycle has something to settle) plus the diff.
    // The card's args must NOT carry old_string/new_string, or the client would
    // build a second, clipped diff from them.
    const startCard = start.find((event) => event.type === "tool");
    expect(startCard).toMatchObject({ type: "tool", id: "e1", name: "Edit" });
    expect((startCard as { args?: Record<string, string> }).args).not.toHaveProperty("old_string");
    expect(start.some((event) => event.type === "diff" && event.file === "a.ts")).toBe(true);

    const done = translate(
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "e1", content: "ok" }] },
      }),
    );
    // The card settles via tool_result so it stops showing "running".
    expect(done.some((event) => event.type === "tool_result" && event.id === "e1" && event.ok === true)).toBe(true);
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

  it("maps agent access mode into CLI safety flags", () => {
    expect(buildClaudeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted" })).toContain("--dangerously-skip-permissions");
    expect(buildClaudeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted", autoConfirm: true })).toEqual(expect.arrayContaining(["--permission-mode", "auto"]));
    expect(buildClaudeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted", autoConfirm: true })).not.toContain("--dangerously-skip-permissions");
    // Read-only access maps to Claude's plan permission mode.
    expect(buildClaudeRunArgs({ prompt: "hello", model: "opus", reasoning: "max", mode: "default", accessMode: "read-only" })).toEqual([
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--append-system-prompt",
      expect.stringContaining("AskUserQuestion"),
      "--settings",
      JSON.stringify({ autoCompactEnabled: true }),
      "--model",
      "opus",
      "--effort",
      "max",
      "--permission-mode",
      "plan",
      "--tools",
      "Read,Glob,Grep,LS,AskUserQuestion,TaskWakeup",
    ]);
    expect(buildCodexRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted" })).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "danger-full-access",
      "--skip-git-repo-check",
      "hello",
    ]);
    expect(buildCodexRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted", autoConfirm: true })).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "danger-full-access",
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

  it("maps access mode into real Gemini approval modes", () => {
    // Unrestricted without auto-confirm is the full-access/default automation mode.
    expect(buildGeminiRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted" })).toEqual([
      "--prompt",
      "hello",
      "--output-format",
      "stream-json",
      "--approval-mode",
      "yolo",
      "--skip-trust",
    ]);
    // Auto-confirm is a sandbox approval setting, not a chat work mode or full-access bypass.
    expect(buildGeminiRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted", autoConfirm: true })).toEqual([
      "--prompt",
      "hello",
      "--output-format",
      "stream-json",
      "--approval-mode",
      "auto_edit",
      "--skip-trust",
    ]);
    // Read-only -> plan (hard-enforced read-only at the tool layer).
    expect(buildGeminiRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "read-only" })).toContain("plan");
    expect(buildGeminiRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "plan", accessMode: "unrestricted" })).toEqual([
      "--prompt",
      "Plan mode is active.\nDo not modify files or run commands that write to the filesystem.\nInspect the workspace as needed, then respond with a concise implementation plan.\nhello",
      "--output-format",
      "stream-json",
      "--approval-mode",
      "plan",
      "--skip-trust",
    ]);
  });

  it("builds OpenCode read-only args with the plan agent, default model, and reasoning variant", () => {
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "default", reasoning: "high", mode: "default", accessMode: "read-only" })).toEqual([
      "run",
      "--format",
      "json",
      "--thinking",
      "--agent",
      "plan",
      "--model",
      "opencode/deepseek-v4-flash-free",
      "--variant",
      "high",
      "hello",
    ]);
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted" })).toContain("--dangerously-skip-permissions");
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted", autoConfirm: true })).toContain("--dangerously-skip-permissions");
  });

  it("builds OpenCode args with selected provider/model IDs", () => {
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "opencode-north-mini-code-free", reasoning: "default", mode: "default", accessMode: "read-only" })).toEqual([
      "run",
      "--format",
      "json",
      "--thinking",
      "--agent",
      "plan",
      "--model",
      "opencode/north-mini-code-free",
      "hello",
    ]);
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "opencode-big-pickle", reasoning: "default", mode: "default", accessMode: "read-only" })).toContain("opencode/big-pickle");
  });

  it("passes direct runtime provider/model IDs through to OpenCode", () => {
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "anthropic/claude-custom-lab", reasoning: "default", mode: "default", accessMode: "read-only" })).toContain("anthropic/claude-custom-lab");
  });

  it("does not bypass permissions for OpenCode read-only runs", () => {
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "read-only" })).not.toContain("--dangerously-skip-permissions");
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted" })).not.toContain("--agent");
  });

  it("normalizes away removed work modes (no per-mode agent flag)", () => {
    // Work modes were removed; a stale `explore` mode normalizes to default and
    // read-only still uses the plan agent, never a per-mode `--agent explore`.
    const args = buildOpenCodeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "explore", accessMode: "read-only" });
    expect(args).not.toContain("explore");
    expect(args).toEqual([
      "run",
      "--format",
      "json",
      "--thinking",
      "--agent",
      "plan",
      "--model",
      "opencode/deepseek-v4-flash-free",
      "hello",
    ]);
  });

  it("threads native session resume into each agent's run args", () => {
    expect(buildClaudeRunArgs({ prompt: "next", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted", resume: "claude-sess" })).toEqual(
      expect.arrayContaining(["--resume", "claude-sess"]),
    );
    // Codex resume is a subcommand: `exec resume <id>`.
    expect(buildCodexRunArgs({ prompt: "next", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted", resume: "cdx-sess" }).slice(0, 4)).toEqual(["exec", "resume", "cdx-sess", "--json"]);
    // Gemini: --resume for an existing session, --session-id for a new assigned one.
    expect(buildGeminiRunArgs({ prompt: "next", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted", resume: "gem-sess" })).toEqual(expect.arrayContaining(["--resume", "gem-sess"]));
    expect(buildGeminiRunArgs({ prompt: "new", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted", sessionId: "gem-new" })).toEqual(expect.arrayContaining(["--session-id", "gem-new"]));
    // OpenCode continues by session id.
    expect(buildOpenCodeRunArgs({ prompt: "next", model: "default", reasoning: "default", mode: "default", accessMode: "unrestricted", resume: "oc-sess" })).toEqual(expect.arrayContaining(["--session", "oc-sess"]));
  });

  it("passes Codex compaction window as a per-thread app-server config override", () => {
    expect(
      buildCodexThreadParams({
        agent: "codex",
        model: "default",
        reasoning: "default",
        mode: "default",
        prompt: "hello",
        accessMode: "read-only",
        compactWindow: 120000,
      }),
    ).toMatchObject({
      config: { model_auto_compact_token_limit: 120000 },
    });

    expect(
      buildCodexThreadParams({
        agent: "codex",
        model: "default",
        reasoning: "default",
        mode: "default",
        prompt: "hello",
        accessMode: "read-only",
      }).config,
    ).toBeUndefined();
  });

  it("keeps Codex full access separate from app-server auto-review", () => {
    expect(
      buildCodexThreadParams({
        agent: "codex",
        model: "default",
        reasoning: "default",
        mode: "default",
        prompt: "hello",
        accessMode: "unrestricted",
      }),
    ).toMatchObject({
      sandbox: "danger-full-access",
      approvalPolicy: "never",
    });

    expect(
      buildCodexThreadParams({
        agent: "codex",
        model: "default",
        reasoning: "default",
        mode: "default",
        prompt: "hello",
        accessMode: "unrestricted",
        autoConfirm: true,
      }),
    ).toMatchObject({
      sandbox: "danger-full-access",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    });
  });

  it("registers rlab dynamic tools for Codex app-server threads", () => {
    const tools = codexRlabDynamicTools();
    // A single consolidated wakeup tool (schedule/cancel/list); no separate TaskAwait.
    expect(tools).toHaveLength(1);
    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "TaskWakeup",
          inputSchema: expect.objectContaining({
            type: "object",
            properties: expect.objectContaining({
              action: expect.objectContaining({ enum: ["schedule", "cancel", "list"] }),
              prompt: expect.objectContaining({ type: "string" }),
              cron: expect.objectContaining({ type: "string" }),
              script: expect.objectContaining({ type: "string" }),
              intervalSeconds: expect.objectContaining({ type: "number" }),
            }),
          }),
        }),
      ]),
    );
    expect(tools.some((tool) => tool.name === "TaskAwait")).toBe(false);

    expect(
      buildCodexThreadParams({
        agent: "codex",
        model: "default",
        reasoning: "default",
        mode: "default",
        prompt: "hello",
        accessMode: "read-only",
      }).dynamicTools,
    ).toBe(tools);
  });

  it("answers Codex dynamic TaskWakeup calls with tool-call results", () => {
    expect(
      codexDynamicToolCallResponse({
        tool: "TaskWakeup",
        arguments: { prompt: "report result", delaySeconds: 60 },
      }),
    ).toEqual({
      contentItems: [
        {
          type: "inputText",
          text: "rlab accepted the TaskWakeup. Finish this turn now and wait for rlab to re-run you when it fires.",
        },
      ],
      success: true,
    });

    expect(
      codexDynamicToolCallResponse({
        tool: "TaskWakeup",
        arguments: { prompt: "missing trigger" },
      }),
    ).toEqual({
      contentItems: [{ type: "inputText", text: "TaskWakeup requires delaySeconds, fireAt, cron, or script." }],
      success: false,
    });

    expect(
      codexDynamicToolCallResponse(
        {
          tool: "TaskWakeup",
          arguments: { action: "list" },
        },
        { conversationId: "chat-empty" },
      ),
    ).toEqual({
      contentItems: [{ type: "inputText", text: "No scheduled TaskWakeup entries for this chat." }],
      success: true,
    });
  });

  it("captures each agent's native session id from its stream", () => {
    expect(createCodexStreamTranslator()(JSON.stringify({ type: "thread.started", thread_id: "cdx-123" }))).toEqual([{ type: "session", id: "cdx-123" }]);
    expect(createOpenCodeStreamTranslator()(JSON.stringify({ type: "step_start", sessionID: "ses_abc", part: { sessionID: "ses_abc" } }))).toEqual([{ type: "session", id: "ses_abc" }]);
  });

  it("translates Codex JSONL events into normalized run events", () => {
    const translate = createCodexStreamTranslator();

    expect(translate(JSON.stringify({ type: "turn.started" }))).toEqual([{ type: "status", level: "info", text: "codex turn started" }]);
    expect(translate(JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "hello" } }))).toEqual([{ type: "text", text: "hello" }]);
    expect(translate(JSON.stringify({ type: "agent_message", message: "hello" }))).toEqual([{ type: "text", text: "hello" }]);
    expect(translate(JSON.stringify({ type: "item.completed", item: { id: "reasoning_0", type: "reasoning", text: "right side." } }))).toEqual([{ type: "reasoning", text: "right side.\n" }]);
    expect(translate(JSON.stringify({ type: "turn.failed", error: { message: "model unsupported" } }))).toEqual([{ type: "error", text: "model unsupported" }]);
  });

  it("maps Codex app-server thread items (camelCase) into run events", () => {
    // agentMessage -> text
    expect(codexAppServerItemEvents({ type: "agentMessage", id: "m1", text: "hi" }, true)).toEqual([{ type: "text", text: "hi" }]);
    // reasoning -> joins summary + content
    expect(codexAppServerItemEvents({ type: "reasoning", id: "r1", summary: ["plan"], content: ["details"] }, true)).toEqual([{ type: "reasoning", text: "plan\ndetails\n" }]);
    expect(codexAppServerItemEvents({ type: "reasoning", id: "r2", summary: ["streaming"] }, false)).toEqual([{ type: "reasoning", text: "streaming" }]);
    // commandExecution started -> tool; completed -> tool + tool_result
    expect(codexAppServerItemEvents({ type: "commandExecution", id: "c1", command: "ls" }, false)).toEqual([{ type: "tool", id: "c1", name: "Shell", summary: "ls" }]);
    expect(codexAppServerItemEvents({ type: "commandExecution", id: "c1", command: "ls", status: "completed", aggregatedOutput: "a\nb" }, true)).toEqual([
      { type: "tool", id: "c1", name: "Shell", summary: "ls" },
      { type: "tool_result", id: "c1", ok: true, output: "a\nb" },
    ]);
    const largeOutput = `${"a".repeat(MAX_AGENT_TOOL_OUTPUT_CHARS)}tail`;
    const largeCommandEvents = codexAppServerItemEvents({ type: "commandExecution", id: "c2", command: "rg noisy", status: "completed", aggregatedOutput: largeOutput }, true);
    expect(largeCommandEvents).toHaveLength(2);
    expect(largeCommandEvents[1]).toMatchObject({ type: "tool_result", id: "c2", ok: true });
    expect(largeCommandEvents[1]?.type === "tool_result" ? largeCommandEvents[1].output : "").toContain("[tool output truncated:");
    expect(largeCommandEvents[1]?.type === "tool_result" ? largeCommandEvents[1].output.length : 0).toBeLessThanOrEqual(MAX_AGENT_TOOL_OUTPUT_CHARS);
    // fileChange started -> running Edit tool (no perpetual "running": resolved on completed)
    expect(codexAppServerItemEvents({ type: "fileChange", id: "f1", status: "inProgress", changes: [{ path: "a.ts", kind: "update" }] }, false)).toEqual([
      { type: "tool", id: "f1", name: "Edit", summary: "a.ts" },
    ]);
    // fileChange completed -> tool + tool_result (settles it) + a diff block
    expect(codexAppServerItemEvents({ type: "fileChange", id: "f1", status: "completed", changes: [{ path: "a.ts", kind: "update", diff: "@@\n+added\n-removed" }] }, true)).toEqual([
      { type: "tool", id: "f1", name: "Edit", summary: "a.ts" },
      { type: "tool_result", id: "f1", ok: true, output: "update a.ts" },
      { type: "diff", id: "f1", file: "a.ts", additions: 1, deletions: 1, lines: [{ type: "add", text: "added" }, { type: "del", text: "removed" }] },
    ]);
    // mcpToolCall -> tool + tool_result (failed)
    expect(codexAppServerItemEvents({ type: "mcpToolCall", id: "t1", server: "srv", tool: "fetch", status: "failed", error: { message: "boom" } }, true)).toEqual([
      { type: "tool", id: "t1", name: "srv/fetch" },
      { type: "tool_result", id: "t1", ok: false, output: JSON.stringify({ message: "boom" }) },
    ]);
    expect(codexAppServerItemEvents({ type: "dynamicToolCall", id: "wake-1", tool: "TaskWakeup", arguments: { prompt: "send OK", delaySeconds: 180 } }, false)).toEqual([
      { type: "tool", id: "wake-1", name: "TaskWakeup", summary: "send OK", args: { prompt: "send OK", delaySeconds: "180" } },
    ]);
    expect(
      codexAppServerItemEvents(
        {
          type: "dynamicToolCall",
          id: "wake-1",
          tool: "TaskWakeup",
          status: "completed",
          arguments: { prompt: "send OK", delaySeconds: 180 },
          contentItems: [{ type: "inputText", text: "accepted" }],
          success: true,
        },
        true,
      ),
    ).toEqual([
      { type: "tool", id: "wake-1", name: "TaskWakeup", summary: "send OK", args: { prompt: "send OK", delaySeconds: "180" } },
      { type: "tool_result", id: "wake-1", ok: true, output: "accepted" },
      { type: "wakeup", toolId: "wake-1", prompt: "send OK", delaySeconds: 180 },
    ]);
    // webSearch -> search
    expect(codexAppServerItemEvents({ type: "webSearch", id: "w1", query: "rust" }, true)).toEqual([{ type: "search", id: "w1", query: "rust", state: "ok" }]);
  });

  it("maps Codex app-server token usage (total breakdown) to RunUsage", () => {
    expect(codexAppServerUsage({ total: { totalTokens: 100, inputTokens: 80, cachedInputTokens: 60, outputTokens: 20, reasoningOutputTokens: 5 } })).toEqual({
      totalTokens: 100,
      inputTokens: 80,
      outputTokens: 20,
      reasoningTokens: 5,
      cacheReadTokens: 60,
    });
    expect(codexAppServerUsage({ total: { totalTokens: 100, contextTokens: 42 } })).toEqual({
      totalTokens: 100,
      contextTokens: 42,
    });
    expect(codexAppServerUsage(undefined)).toBeUndefined();
  });

  it("translates Amp Claude-compatible stream JSON into normalized run events", () => {
    const translate = createAmpStreamTranslator();

    expect(translate(JSON.stringify({ type: "system", subtype: "init", cwd: "/repo", session_id: "T-1", tools: ["Read"], mcp_servers: [], reasoning_effort: "high" }))).toEqual([
      { type: "status", level: "info", text: "model · agent" },
      { type: "session", id: "T-1" },
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
      {
        type: "done",
        costUsd: undefined,
        usage: { totalTokens: 12 },
        usageDebug: [
          { source: "claude.assistant.message.usage", payload: { totalTokens: 12 } },
          { source: "claude.result.usage", payload: { totalTokens: 12 } },
        ],
      },
    ]);
  });

  it("extracts Claude rate-limit events from CLI stream-json output", () => {
    expect(
      parseClaudeRateLimitStream(
        [
          JSON.stringify({ type: "system", subtype: "init" }),
          JSON.stringify({ type: "rate_limit_event", rate_limit_info: { rateLimitType: "five_hour", utilization: 0.42, resetsAt: 1_800_000_000, status: "allowed" } }),
          "not-json",
          JSON.stringify({ type: "rate_limit_event", rate_limit_info: { rateLimitType: "seven_day", utilization: 0.8, resetsAt: 1_800_360_000, status: "allowed_warning" } }),
        ].join("\n"),
      ),
    ).toEqual([
      { rateLimitType: "five_hour", utilization: 0.42, resetsAt: 1_800_000_000, status: "allowed" },
      { rateLimitType: "seven_day", utilization: 0.8, resetsAt: 1_800_360_000, status: "allowed_warning" },
    ]);
  });

  it("maps Claude OAuth usage response into account limit windows", () => {
    expect(
      parseClaudeOAuthUsagePayload(
        {
          five_hour: { utilization: 12.4, resets_at: "2026-06-11T13:30:00.000Z" },
          seven_day: { utilization: 91, resets_at: "2026-06-17T13:00:00.000Z" },
          extra_usage: { utilization: null, resets_at: null },
        },
        { subscriptionType: "max", rateLimitTier: "claude_max" },
      ),
    ).toEqual({
      plan: "Claude MAX",
      windows: [
        { kind: "five_hour", usedPercent: 12.4, resetsAt: 1781184600, status: "allowed" },
        { kind: "weekly", usedPercent: 91, resetsAt: 1781701200, status: "allowed_warning" },
      ],
    });
  });

  it("parses Gemini interactive /model usage into per-model limit windows", () => {
    expect(
      parseGeminiModelUsageOutput(
        [
          "Model usage",
          "Flash       ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 0%  Resets: 7:09 PM (24h)",
          "Flash Lite  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 1%  Resets: 6:55 PM (23h 46m)",
          "Pro         ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 90% Resets: 7:09 PM (24h)",
          "gemini-3.1-…▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ 100% Resets: 6:55 PM (23h 46m)",
        ].join("\n"),
        1_800_000_000_000,
      ),
    ).toEqual({
      plan: "Gemini CLI",
      windows: [
        { kind: "daily", label: "Flash", usedPercent: 0, resetsAt: 1_800_086_400, status: "allowed" },
        { kind: "daily", label: "Flash Lite", usedPercent: 1, resetsAt: 1_800_085_560, status: "allowed" },
        { kind: "daily", label: "Pro", usedPercent: 90, resetsAt: 1_800_086_400, status: "allowed_warning" },
        { kind: "daily", label: "gemini-3.1-…", usedPercent: 100, resetsAt: 1_800_085_560, status: "rejected" },
      ],
    });
  });

  it("translates Cursor stream JSON into normalized run events", () => {
    const translate = createCursorStreamTranslator();

    expect(translate(JSON.stringify({ type: "system", subtype: "init", model: "Claude 4 Sonnet", session_id: "T-1" }))).toEqual([
      { type: "status", level: "info", text: "model · Claude 4 Sonnet" },
      { type: "session", id: "T-1" },
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

  it("translates Gemini CLI tool_use and tool_result events into visible work blocks", () => {
    const translate = createGeminiStreamTranslator();

    expect(
      translate(
        JSON.stringify({
          type: "tool_use",
          tool_name: "update_topic",
          tool_id: "topic-1",
          parameters: {
            title: "Исследование каталога",
            summary: "Проверяю текущую папку перед ответом.",
            strategic_intent: "Понять контекст запуска.",
          },
        }),
      ),
    ).toEqual([{ type: "reasoning", text: "Исследование каталога\nПроверяю текущую папку перед ответом.\nIntent: Понять контекст запуска." }]);

    expect(
      translate(
        JSON.stringify({
          type: "tool_use",
          tool_name: "run_shell_command",
          tool_id: "shell-1",
          parameters: {
            command: "Get-Location",
            description: "Показать текущую директорию.",
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool",
        id: "shell-1",
        name: "run_shell_command",
        summary: "Показать текущую директорию.",
        args: { command: "Get-Location", description: "Показать текущую директорию." },
      },
    ]);

    expect(
      translate(
        JSON.stringify({
          type: "tool_result",
          tool_id: "shell-1",
          status: "success",
          output: "C:\\Users\\Admin\\Git\\Workspace\\rlab",
        }),
      ),
    ).toEqual([{ type: "tool_result", id: "shell-1", ok: true, output: "C:\\Users\\Admin\\Git\\Workspace\\rlab" }]);
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
    expect(translate(JSON.stringify({ type: "result", status: "success", stats: { total_tokens: 9653 } }))).toEqual([
      {
        type: "done",
        usage: { totalTokens: 9653 },
        usageDebug: { source: "gemini.result.stats", payload: { total_tokens: 9653 } },
      },
    ]);
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
    ).toEqual([
      {
        type: "done",
        costUsd: 0.0017,
        usage: { totalTokens: 42, inputTokens: 30, outputTokens: 2, reasoningTokens: 10 },
        usageDebug: { source: "opencode.part.step-finish.tokens", payload: { total: 42, input: 30, output: 2, reasoning: 10 } },
      },
    ]);
  });

  it("emits OpenCode server response parts with persisted reasoning and tool state shapes", () => {
    const events: unknown[] = [];

    const emitted = emitOpenCodeParts(
      [
        {
          type: "reasoning",
          text: "The user wants me to connect via Tailscale.",
        },
        {
          type: "tool",
          tool: "bash",
          callID: "call_00",
          state: {
            status: "completed",
            input: {
              command: "which tailscale && tailscale status",
              description: "Check Tailscale status",
            },
            output: "/usr/bin/tailscale\n100.75.107.12 research-gpu",
            title: "Check Tailscale status",
          },
        },
        {
          type: "tool",
          tool: "read",
          callID: "call_01",
          state: {
            status: "completed",
            input: {
              filePath: "/root/workspace/Research-Arch/.claude/settings.local.json",
            },
            output: "<file>settings</file>",
            title: ".claude/settings.local.json",
          },
        },
        {
          type: "tool",
          tool: "bash",
          callID: "call_02",
          state: {
            status: "running",
            input: {
              command: "cat ~/.ssh/config",
              description: "Check SSH config",
            },
          },
        },
      ],
      (event) => events.push(event),
    );

    expect(emitted).toBe(6);
    expect(events).toEqual([
      { type: "reasoning", text: "The user wants me to connect via Tailscale." },
      {
        type: "tool",
        id: "call_00",
        name: "bash",
        summary: "Check Tailscale status",
        args: {
          command: "which tailscale && tailscale status",
          description: "Check Tailscale status",
        },
      },
      {
        type: "tool_result",
        id: "call_00",
        ok: true,
        output: "/usr/bin/tailscale\n100.75.107.12 research-gpu",
      },
      {
        type: "tool",
        id: "call_01",
        name: "read",
        summary: ".claude/settings.local.json",
        args: {
          filePath: "/root/workspace/Research-Arch/.claude/settings.local.json",
        },
      },
      {
        type: "tool_result",
        id: "call_01",
        ok: true,
        output: "<file>settings</file>",
      },
      {
        type: "tool",
        id: "call_02",
        name: "bash",
        summary: "cat ~/.ssh/config",
        args: {
          command: "cat ~/.ssh/config",
          description: "Check SSH config",
        },
      },
    ]);
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

  it("recognizes git commit no-op output without swallowing real commit errors", () => {
    expect(
      isNoChangesGitCommitResult({
        stdout: "On branch kanban/wt-1\nnothing to commit, working tree clean\n",
        error: "git commit exited with code 1.",
      }),
    ).toBe(true);
    expect(
      isNoChangesGitCommitResult({
        stdout: "",
        error: "Author identity unknown\nfatal: unable to auto-detect email address",
      }),
    ).toBe(false);
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

  it("validates git checkout payloads without accepting non-object JSON", () => {
    expect(() => parseGitCheckoutPayload(JSON.stringify(false))).toThrow("Invalid git request payload.");
    expect(() => parseGitCheckoutPayload(JSON.stringify({ cwd: "C:\\repo", branch: "" }))).toThrow("Git branch is required.");
    expect(() => parseGitCheckoutPayload(JSON.stringify({ cwd: "C:\\repo", branch: "bad\0branch" }))).toThrow("Git branch contains an invalid null byte.");
    expect(parseGitCheckoutPayload(JSON.stringify({ cwd: " C:\\repo ", branch: " feature/ui " }))).toEqual({
      cwd: "C:\\repo",
      branch: "feature/ui",
    });
  });

  it("validates git commit-action payloads (hash + reset mode)", () => {
    expect(() => parseGitCommitActionPayload(JSON.stringify({ cwd: "", hash: "abc1234" }))).toThrow("Project directory is required.");
    expect(() => parseGitCommitActionPayload(JSON.stringify({ cwd: "/repo", hash: "nothex!" }))).toThrow("A valid commit hash is required.");
    expect(parseGitCommitActionPayload(JSON.stringify({ cwd: " /repo ", hash: " AbC1234 " }))).toEqual({ cwd: "/repo", hash: "AbC1234", mode: "mixed" });
    expect(parseGitCommitActionPayload(JSON.stringify({ cwd: "/repo", hash: "abc1234", mode: "HARD" })).mode).toBe("hard");
    expect(parseGitCommitActionPayload(JSON.stringify({ cwd: "/repo", hash: "abc1234", mode: "bogus" })).mode).toBe("mixed");
  });

  it("parses decorated git graph log rows", () => {
    const commits = parseGitGraphLog(
        [
          "* \u001fabcd1234\u001fabcd123\u001f1111 2222\u001fAda\u001f2026-06-11\u001fHEAD -> main, origin/main\u001fMerge branch 'feature'",
          "| * \u001fbeef5678\u001fbeef567\u001f3333\u001fLuis\u001f2026-06-10\u001ffeature/api\u001fRefine webhook handling",
        ].join("\n"),
      );

    expect(commits).toEqual([
      {
        graph: "*",
        hash: "abcd1234",
        shortHash: "abcd123",
        parents: ["1111", "2222"],
        author: "Ada",
        date: "2026-06-11",
        refs: ["HEAD -> main", "origin/main"],
        subject: "Merge branch 'feature'",
      },
      {
        graph: "| *",
        hash: "beef5678",
        shortHash: "beef567",
        parents: ["3333"],
        author: "Luis",
        date: "2026-06-10",
        refs: ["feature/api"],
        subject: "Refine webhook handling",
      },
    ]);
    expect(gitGraphBranchHeads(commits)).toEqual([
      { name: "main", hash: "abcd1234" },
      { name: "origin/main", hash: "abcd1234" },
      { name: "feature/api", hash: "beef5678" },
    ]);
  });

  it("parses terminal session cwd from request headers and resolves relative paths", () => {
    expect(() => parseTerminalSessionRequest({ headers: {} } as unknown as Parameters<typeof parseTerminalSessionRequest>[0])).toThrow("Project directory is required.");
    expect(
      parseTerminalSessionRequest({
        headers: { "x-rlab-terminal-cwd": " . ", "x-rlab-terminal-cols": "123", "x-rlab-terminal-rows": "37" },
      } as unknown as Parameters<typeof parseTerminalSessionRequest>[0]),
    ).toEqual({ cwd: resolve("."), cols: 123, rows: 37 });
    expect(
      parseTerminalSessionRequest({
        headers: { "x-rlab-terminal-cwd": " . ", "x-rlab-terminal-cols": "0", "x-rlab-terminal-rows": "bad" },
      } as unknown as Parameters<typeof parseTerminalSessionRequest>[0]),
    ).toEqual({ cwd: resolve("."), cols: undefined, rows: undefined });
  });

  it("classifies git validation errors separately from runtime errors", () => {
    expect(gitErrorStatus(new SyntaxError("Unexpected token"))).toBe(400);
    expect(gitErrorStatus(new Error("Invalid git request payload."))).toBe(400);
    expect(gitErrorStatus(new Error("Project directory is required."))).toBe(400);
    expect(gitErrorStatus(new Error("Git file path contains an invalid null byte."))).toBe(400);
    expect(gitErrorStatus(new Error("Git branch is required."))).toBe(400);
    expect(gitErrorStatus(new Error("Git branch contains an invalid null byte."))).toBe(400);
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
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "navigate", url: " http://localhost:3000/form " }))).toEqual({
      sessionId: "c-jwt",
      type: "navigate",
      url: "http://localhost:3000/form",
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "go-back" }))).toEqual({ sessionId: "c-jwt", type: "go-back" });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "go-forward" }))).toEqual({ sessionId: "c-jwt", type: "go-forward" });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "fill", text: "hello", target: { label: "Search" } }))).toEqual({
      sessionId: "c-jwt",
      type: "fill",
      text: "hello",
      target: { label: "Search" },
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "clear", target: { selector: "input[name=q]" } }))).toEqual({
      sessionId: "c-jwt",
      type: "clear",
      target: { selector: "input[name=q]" },
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "check", target: { role: "checkbox", name: "Remember" } }))).toEqual({
      sessionId: "c-jwt",
      type: "check",
      target: { role: "checkbox", name: "Remember" },
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "uncheck", target: { label: "Remember" } }))).toEqual({
      sessionId: "c-jwt",
      type: "uncheck",
      target: { label: "Remember" },
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "select", target: { label: "Country" }, value: "jp" }))).toEqual({
      sessionId: "c-jwt",
      type: "select",
      target: { label: "Country" },
      value: "jp",
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "select", target: { label: "Country" }, label: "Japan" }))).toEqual({
      sessionId: "c-jwt",
      type: "select",
      target: { label: "Country" },
      label: "Japan",
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "wait-for", target: { selector: "#ready" }, state: "visible" }))).toEqual({
      sessionId: "c-jwt",
      type: "wait-for",
      target: { selector: "#ready" },
      state: "visible",
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "wait-for", urlIncludes: "/done" }))).toEqual({
      sessionId: "c-jwt",
      type: "wait-for",
      urlIncludes: "/done",
    });
    expect(parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "hover", target: { text: "Menu" } }))).toEqual({
      sessionId: "c-jwt",
      type: "hover",
      target: { text: "Menu" },
    });
    expect(() => parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "click" }))).toThrow("Browser click target or x and y are required.");
    expect(() => parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "fill", text: "hello" }))).toThrow("Browser fill target is required.");
    expect(() => parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "select", target: { label: "Country" } }))).toThrow("Browser select value or label is required.");
    expect(() => parseBrowserActionPayload(JSON.stringify({ sessionId: "c-jwt", type: "wait-for" }))).toThrow("Browser wait-for target or urlIncludes is required.");
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
    expect(parseBrowserDirtyPayload(JSON.stringify({ sessionId: "c-jwt", reason: "iframe input", url: " http://localhost:3000/form " }))).toEqual({
      sessionId: "c-jwt",
      reason: "iframe input",
      url: "http://localhost:3000/form",
    });
    expect(parseBrowserDirtyPayload(JSON.stringify({ sessionId: "c-jwt", reason: "cross-origin iframe" }))).toEqual({
      sessionId: "c-jwt",
      reason: "cross-origin iframe",
    });
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
      accessMode: "unrestricted",
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
      snippet: "partial",
    });
    expect(canceledBlocks).toEqual([
      { kind: "reasoning", text: "Still running", active: false },
      { kind: "text", text: "partial", streaming: false, result: true },
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
      snippet: "Черновик готов. Открыть PR с обновлением CHANGELOG.md?",
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
    const accumulator = { ...createRunEventAccumulator(Date.now()), lastPersistedAt: 0, persistTimer: null };
    accumulateRunEvent(accumulator, { type: "reasoning", text: "Still running" });
    accumulateRunEvent(accumulator, { type: "text", text: "partial" });
    const finished = finishBackgroundRunState(canceledState, binding, accumulator, true);

    const blocks = finished.threads["chat-2"].find((message) => message.id === "a-bg")?.blocks;

    expect(finished.chats.find((conversation) => conversation.id === "chat-2")).toMatchObject({
      activeRunId: undefined,
      status: "idle",
      snippet: "partial",
    });
    expect(blocks).toEqual([
      { kind: "reasoning", text: "Still running", active: false, duration: expect.stringMatching(/s$/) },
      { kind: "text", text: "partial", streaming: false, result: true },
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

  it("preserves a current thread when a stale workspace PUT sends it as empty", () => {
    const current = buildInitialWorkspaceState();
    const staleClientState = {
      ...current,
      chats: current.chats.map((conversation) => (conversation.id === "chat-2" ? { ...conversation, title: "Renamed" } : conversation)),
      threads: {
        ...current.threads,
        "chat-2": [],
      },
    };

    const merged = mergeWorkspacePutState(staleClientState, current);

    expect(merged.chats.find((conversation) => conversation.id === "chat-2")?.title).toBe("Renamed");
    expect(merged.threads["chat-2"]).toEqual(current.threads["chat-2"]);
  });

  it("preserves a current thread when a stale workspace PUT sends only messages appended before lazy history loaded", () => {
    const current = buildInitialWorkspaceState();
    const staleClientState = {
      ...current,
      threads: {
        ...current.threads,
        "chat-2": [{ id: "u-new", role: "user" as const, text: "continue", time: "10:10" }],
      },
    };

    const merged = mergeWorkspacePutState(staleClientState, current);

    expect(merged.threads["chat-2"]).toEqual(current.threads["chat-2"]);
  });

  it("accepts a loaded workspace PUT that appends to a current thread", () => {
    const current = buildInitialWorkspaceState();
    const appended = [
      ...current.threads["chat-2"],
      { id: "u-new", role: "user" as const, text: "continue", time: "10:10" },
    ];
    const clientState = {
      ...current,
      threads: {
        ...current.threads,
        "chat-2": appended,
      },
    };

    const merged = mergeWorkspacePutState(clientState, current);

    expect(merged.threads["chat-2"]).toEqual(appended);
  });

  it("accepts a loaded workspace PUT that truncates a thread prefix for retry or edit", () => {
    const current = buildInitialWorkspaceState();
    const prefix = current.threads["chat-2"].slice(0, 1);
    const clientState = {
      ...current,
      threads: {
        ...current.threads,
        "chat-2": prefix,
      },
    };

    const merged = mergeWorkspacePutState(clientState, current);

    expect(merged.threads["chat-2"]).toEqual(prefix);
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
      snippet: "partial answer",
    });
    const staleBlocks = reconciled.threads["chat-2"].find((message) => message.id === "a-stale")?.blocks;
    expect(staleBlocks).toEqual([
      { kind: "reasoning", text: "Still thinking", active: false },
      { kind: "text", text: "partial answer", streaming: false, result: true },
      { kind: "status", level: "error", text: "Фоновый запуск прерван" },
    ]);
    expect(reconciled.projects[0]?.conversations.find((conversation) => conversation.id === "c-flaky")).toMatchObject({
      activeRunId: "run-live",
      status: "running",
      snippet: "Still running",
    });
  });

  it("does not materialize an empty thread while reconciling an unloaded stale background run", () => {
    const state = buildInitialWorkspaceState();
    const partialState = {
      ...state,
      chats: state.chats.map((conversation) =>
        conversation.id === "chat-2" ? { ...conversation, activeRunId: "run-stale", status: "running" as const, snippet: "Still running" } : conversation,
      ),
      threads: {},
    };

    const reconciled = reconcileStaleBackgroundRuns(partialState, new Set());

    expect(reconciled.chats.find((conversation) => conversation.id === "chat-2")).toMatchObject({
      activeRunId: undefined,
      status: "error",
      snippet: "Still running",
    });
    expect(Object.prototype.hasOwnProperty.call(reconciled.threads, "chat-2")).toBe(false);
  });

  it("does not materialize an empty thread while canceling an unloaded background run", () => {
    const state = buildInitialWorkspaceState();
    const partialState = {
      ...state,
      chats: state.chats.map((conversation) =>
        conversation.id === "chat-2" ? { ...conversation, activeRunId: "run-detached", status: "running" as const, snippet: "Still running" } : conversation,
      ),
      threads: {},
    };

    const canceled = cancelBackgroundRunState(partialState, "run-detached");

    expect(canceled.chats.find((conversation) => conversation.id === "chat-2")).toMatchObject({
      activeRunId: undefined,
      status: "idle",
      snippet: "Still running",
    });
    expect(Object.prototype.hasOwnProperty.call(canceled.threads, "chat-2")).toBe(false);
  });

  it("re-asserts a streaming background run as active so a stale interrupt can't strand it", () => {
    const binding: BackgroundRunBinding = {
      conversationId: "chat-2",
      runId: "run-live",
      userMessageId: "u-live",
      userMessageTime: "2026-06-06T14:00:00.000Z",
      agentMessageId: "a-live",
      agentMessageTime: "2026-06-06T14:00:01.000Z",
    };

    // A normal streaming event pins the conversation to "running" + this runId,
    // not an empty patch — otherwise a prior "interrupted" reconcile leaves it
    // stuck at "error" while the agent keeps working.
    const streaming = backgroundRunStatusPatch(binding, [{ kind: "text", text: "working" }]);
    expect(streaming).toEqual({ status: "running", activeRunId: "run-live", snippet: "working", time: "2026-06-06T14:00:01.000Z" });

    const toolOnly = backgroundRunStatusPatch(binding, [{ kind: "tool", name: "Shell", summary: "npm run dev", state: "running" }]);
    expect(toolOnly).toEqual({ status: "running", activeRunId: "run-live", time: "2026-06-06T14:00:01.000Z" });

    // A block awaiting input pins it to "waiting" but still keeps the runId.
    const waiting = backgroundRunStatusPatch(binding, [{ kind: "approval", title: "Run cmd" }]);
    expect(waiting).toEqual({ status: "waiting", activeRunId: "run-live", time: "2026-06-06T14:00:01.000Z" });
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
      userMessageId: binding.userMessageId,
      agentMessageId: binding.agentMessageId,
      status: "running",
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
      userMessageId: binding.userMessageId,
      agentMessageId: binding.agentMessageId,
      costUsd: 0.0173,
      usage: { totalTokens: 9653 },
    });
  });

  it("replaces stale agent replies when rerunning the same bound user message", () => {
    const state = buildInitialWorkspaceState();
    const binding: BackgroundRunBinding = {
      conversationId: "chat-2",
      runId: "run-rerun",
      userMessageId: "u-repeat",
      userMessageTime: "10:00",
      agentMessageId: "a-repeat-new",
      agentMessageTime: "10:01",
    };
    const withStaleReply = {
      ...state,
      threads: {
        ...state.threads,
        "chat-2": [
          ...state.threads["chat-2"],
          { id: "u-repeat", role: "user" as const, text: "Try again", time: "10:00" },
          { id: "a-repeat-old", role: "agent" as const, time: "10:00", blocks: [{ kind: "status" as const, level: "error" as const, text: "old failure" }] },
          { id: "u-later", role: "user" as const, text: "Later turn", time: "10:02" },
          { id: "a-later", role: "agent" as const, time: "10:03", blocks: [{ kind: "text" as const, text: "later answer" }] },
        ],
      },
    };

    const settled = settleEarlyBackgroundRunState(
      withStaleReply,
      binding,
      { agent: "codex", model: "default", reasoning: "default", mode: "default", prompt: "Try again", accessMode: "read-only" },
      [{ type: "text", text: "new answer" }],
    );
    const ids = settled.threads["chat-2"].map((message) => message.id);

    expect(ids).not.toContain("a-repeat-old");
    expect(ids.slice(ids.indexOf("u-repeat"), ids.indexOf("u-later") + 1)).toEqual(["u-repeat", "a-repeat-new", "u-later"]);
    expect(settled.threads["chat-2"].find((message) => message.id === "a-later")).toBeDefined();
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
      snippet: "Use an unsupported profile",
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

  it("persists bound background run native sessions per agent", () => {
    const state = buildInitialWorkspaceState();
    const stateWithExistingSession = {
      ...state,
      chats: state.chats.map((conversation) =>
        conversation.id === "chat-2"
          ? { ...conversation, agentSessions: { "claude-code": "claude-session-1" } }
          : conversation,
      ),
    };
    const settled = settleEarlyBackgroundRunState(
      stateWithExistingSession,
      {
        conversationId: "chat-2",
        runId: "run-session",
        userMessageId: "u-session",
        userMessageTime: "10:00",
        agentMessageId: "a-session",
        agentMessageTime: "10:01",
      },
      {
        agent: "codex",
        model: "default",
        reasoning: "default",
        mode: "default",
        prompt: "Continue with Codex",
        accessMode: "read-only",
      },
      [
        { type: "session", id: "codex-session-1" },
        { type: "text", text: "done" },
      ],
    );

    expect(settled.chats.find((conversation) => conversation.id === "chat-2")).toMatchObject({
      agentSessions: {
        "claude-code": "claude-session-1",
        codex: "codex-session-1",
      },
      sessionId: "codex-session-1",
      sessionAgent: "codex",
    });
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
      snippet: "Run with missing CLI",
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
