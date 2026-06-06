import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  buildCodexRunArgs,
  buildGeminiRunArgs,
  buildGitCommitArgs,
  buildGitPushArgs,
  buildOpenCodeRunArgs,
  createRunApprovalHandler,
  createClaudeStreamTranslator,
  createCodexStreamTranslator,
  createGeminiStreamTranslator,
  createOpenCodeStreamTranslator,
  parseRunApprovalPayload,
  parseRunCancelPayload,
  parseRunInputPayload,
  parseAttachmentUploadPayload,
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
  migrateSeedWorkspaceState,
  reconcileStaleBackgroundRuns,
  hasGeminiStoredAuthAt,
  installCommandForAgent,
  resolveAgentInstallLaunch,
  resolveBinOnPath,
  resolveLaunchCommand,
  resolvePendingRunApproval,
  resolvePendingRunInput,
  runControlErrorStatus,
  settleEarlyBackgroundRunState,
  shouldUseShellForBin,
  validateRunAccessModeForAgent,
  windowsCommandLine,
  workspacePutErrorStatus,
} from "../vite-agents-plugin";
import { buildInitialWorkspaceState } from "../src/components/workspace/workspace-state";
import { type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { type AgentProfile } from "../src/components/agent";

describe("vite agents plugin", () => {
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
    expect(buildGeminiRunArgs({ prompt: "hello", model: "flash", reasoning: "default", mode: "default", accessMode: "read-only" })).toEqual([
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
    expect(buildGeminiRunArgs({ prompt: "hello", model: "gemini-3-pro", reasoning: "default", mode: "default", accessMode: "read-only" })).toContain("gemini-3-pro-preview");
    expect(buildGeminiRunArgs({ prompt: "hello", model: "flash-lite", reasoning: "default", mode: "default", accessMode: "read-only" })).toContain("gemini-2.5-flash-lite");
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
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "gpt-5.1-codex", reasoning: "default", mode: "default", accessMode: "read-only" })).toEqual([
      "run",
      "--format",
      "json",
      "--thinking",
      "--model",
      "opencode/gpt-5.1-codex",
      "hello",
    ]);
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "gemini-3-pro", reasoning: "default", mode: "default", accessMode: "read-only" })).toContain("google/gemini-3-pro-preview");
  });

  it("translates Codex JSONL events into normalized run events", () => {
    const translate = createCodexStreamTranslator();

    expect(translate(JSON.stringify({ type: "turn.started" }))).toEqual([{ type: "status", level: "info", text: "codex turn started" }]);
    expect(translate(JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "hello" } }))).toEqual([{ type: "text", text: "hello" }]);
    expect(translate(JSON.stringify({ type: "agent_message", message: "hello" }))).toEqual([{ type: "text", text: "hello" }]);
    expect(translate(JSON.stringify({ type: "turn.failed", error: { message: "model unsupported" } }))).toEqual([{ type: "error", text: "model unsupported" }]);
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

  it("translates real Gemini headless stream-json without echoing user messages", () => {
    const translate = createGeminiStreamTranslator();

    expect(translate(JSON.stringify({ type: "init", model: "auto-gemini-3" }))).toEqual([{ type: "status", level: "info", text: "model · auto-gemini-3" }]);
    expect(translate(JSON.stringify({ type: "message", role: "user", content: "Say exactly: hi" }))).toEqual([]);
    expect(translate(JSON.stringify({ type: "message", role: "assistant", content: "hi", delta: true }))).toEqual([{ type: "text", text: "hi" }]);
    expect(translate(JSON.stringify({ type: "result", status: "success", stats: { total_tokens: 9653 } }))).toEqual([{ type: "done", usage: { totalTokens: 9653 } }]);
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
    expect(() => parseAgentConfigPayload(JSON.stringify({ agent: "codex", apiKey: "" }))).toThrow("API key is required.");
    expect(parseAgentConfigPayload(JSON.stringify({ agent: " codex ", apiKey: " sk-test " }))).toEqual({
      agent: "codex",
      apiKey: "sk-test",
    });
  });

  it("validates agent install payloads without accepting non-object JSON", () => {
    expect(() => parseAgentInstallPayload(JSON.stringify([]))).toThrow("Invalid agent install payload.");
    expect(() => parseAgentInstallPayload(JSON.stringify({ agent: "" }))).toThrow("Agent id is required.");
    expect(parseAgentInstallPayload(JSON.stringify({ agent: " codex " }))).toEqual({ agent: "codex" });
  });

  it("validates project directory payloads without accepting non-object JSON", () => {
    expect(() => parseProjectDirectoryPayload(JSON.stringify([]), "path", "Project path is required.")).toThrow("Invalid project directory payload.");
    expect(() => parseProjectDirectoryPayload(JSON.stringify({ path: "" }), "path", "Project path is required.")).toThrow("Project path is required.");
    expect(parseProjectDirectoryPayload(JSON.stringify({ path: " C:\\work\\app " }), "path", "Project path is required.")).toBe("C:\\work\\app");
    expect(parseProjectDirectoryPayload(JSON.stringify({ cwd: " C:\\work\\app " }), "cwd", "Project directory is required.")).toBe("C:\\work\\app");
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

  it("migrates old persisted seed copy without touching custom conversations", () => {
    const state = buildInitialWorkspaceState();
    const migrated = migrateSeedWorkspaceState({
      ...state,
      chats: [
        { ...state.chats[0], title: "Draft release notes for 0.1.69", snippet: "Done", status: "done" },
        { id: "custom", title: "Draft release notes for 0.1.69", snippet: "Writing the changelog…", time: "now", status: "idle", agent: "codex" },
        ...state.chats.slice(1),
      ],
      projects: state.projects.map((project) =>
        project.id === "auth-service"
          ? {
              ...project,
              conversations: project.conversations.map((conversation) =>
                conversation.id === "c-jwt"
                  ? { ...conversation, title: "Rotate JWT secrets", snippet: "Waiting for approval to deploy" }
                  : conversation,
              ),
            }
          : project,
      ),
      threads: {
        ...state.threads,
        "c-jwt": [
          { id: "u1", role: "user", time: "·", text: "Rotate JWT secrets" },
          {
            id: "a1",
            role: "agent",
            time: "·",
            blocks: [
              { kind: "reasoning", duration: "2s", text: "Scoping “Rotate JWT secrets” — gathering context from the workspace before acting." },
              { kind: "text", text: "On it. I'll work on “Rotate JWT secrets” and report back with concrete changes." },
              { kind: "suggested", actions: [{ id: "go", label: "Proceed", tone: "primary" }] },
            ],
          },
        ],
      },
    });

    expect(migrated.chats[0]).toMatchObject({ title: "Release notes для 0.1.69", snippet: "Готово" });
    expect(migrated.chats[1]).toMatchObject({ id: "custom", title: "Draft release notes for 0.1.69" });
    expect(migrated.projects[0]?.conversations[1]).toMatchObject({ title: "Ротация JWT-секретов", snippet: "Ждёт подтверждение deploy" });
    expect(JSON.stringify(migrated.threads["c-jwt"])).toContain("Принял");
  });

  it("migrates persisted Codex seed and legacy model variants to the supported Codex model", () => {
    const state = buildInitialWorkspaceState();
    const migrated = migrateSeedWorkspaceState({
      ...state,
      chats: state.chats.map((conversation) =>
        conversation.id === "chat-2" ? { ...conversation, profile: { agent: "codex", variant: "GPT-5" } as unknown as AgentProfile } : conversation,
      ),
      projects: state.projects.map((project) =>
        project.id === "auth-service"
          ? {
              ...project,
              conversations: project.conversations.map((conversation) =>
                conversation.id === "c-jwt" ? { ...conversation, profile: { agent: "codex", variant: "DEFAULT" } as unknown as AgentProfile } : conversation,
              ),
            }
          : project,
      ),
    });

    expect(migrated.chats.find((conversation) => conversation.id === "chat-2")?.profile).toEqual({ agent: "codex", model: "gpt-5.5", reasoning: "default", mode: "default" });
    expect(migrated.projects[0]?.conversations.find((conversation) => conversation.id === "c-jwt")?.profile).toEqual({ agent: "codex", model: "gpt-5.5", reasoning: "default", mode: "default" });
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
