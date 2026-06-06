import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  agentStatusForDetection,
  agentCliInfoForDetection,
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
  parseGitStatusPorcelain,
  listMentionableFiles,
  migrateSeedWorkspaceState,
  hasGeminiStoredAuthAt,
  installCommandForAgent,
  resolveAgentInstallLaunch,
  resolveBinOnPath,
  resolveLaunchCommand,
  resolvePendingRunApproval,
  resolvePendingRunInput,
  shouldUseShellForBin,
  validateRunAccessModeForAgent,
  windowsCommandLine,
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
    expect(buildClaudeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "read-write" })).toContain("acceptEdits");
    expect(buildClaudeRunArgs({ prompt: "hello", model: "opus", reasoning: "max", mode: "plan", accessMode: "read-write" })).toEqual([
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
    expect(buildCodexRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "read-write" })).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "hello",
    ]);
    expect(buildGeminiRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "read-write" })).toContain("plan");
  });

  it("rejects writable runs for adapters without a live permission bridge", () => {
    expect(validateRunAccessModeForAgent("claude-code", "read-write")).toBeNull();
    expect(validateRunAccessModeForAgent("codex", "read-only")).toBeNull();
    expect(validateRunAccessModeForAgent("codex", "read-write")).toContain("does not support interactive approve/deny yet");
    expect(validateRunAccessModeForAgent("gemini", "read-write")).toContain("does not support interactive approve/deny yet");
    expect(validateRunAccessModeForAgent("opencode", "read-write")).toContain("does not support interactive approve/deny yet");
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
    expect(buildOpenCodeRunArgs({ prompt: "hello", model: "default", reasoning: "default", mode: "default", accessMode: "read-write" })).not.toContain("--dangerously-skip-permissions");
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
        type: "tool",
        id: "tool-1",
        name: "write_file",
        summary: "Write src/new.ts",
        args: { file_path: "src/new.ts", content: "export const ok = true;" },
      },
      { type: "tool_result", id: "tool-1", ok: true, output: "created" },
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

  it("builds Claude SDK options with a live permission handler for writable runs", () => {
    const controller = new AbortController();
    const canUseTool = (() => Promise.resolve({ behavior: "deny", message: "test" })) satisfies CanUseTool;

    expect(
      buildClaudeSdkOptions(
        { agent: "claude-code", model: "default", reasoning: "default", mode: "default", prompt: "hello", accessMode: "read-write" },
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
    });

    expect(
      buildClaudeSdkOptions(
        { agent: "claude-code", model: "opus", reasoning: "max", mode: "plan", prompt: "hello", accessMode: "read-write" },
        "C:/repo",
        controller,
        canUseTool,
      ),
    ).toMatchObject({
      effort: "max",
      model: "opus",
      permissionMode: "plan",
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
});
