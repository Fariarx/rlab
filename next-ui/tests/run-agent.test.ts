import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROFILE, type AgentBlock } from "../src/components/agent";
import { runConversation } from "../src/components/workspace/run-agent";

function streamResponse(events: readonly unknown[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}

function rawStreamResponse(lines: readonly string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(new TextEncoder().encode(`${line}\n`));
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}

describe("runConversation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps Edit tool calls to diff blocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          {
            type: "tool",
            id: "tool-1",
            name: "Edit",
            args: {
              file_path: "src/auth.ts",
              old_string: "const ttl = 60;",
              new_string: "const ttl = 120;",
            },
          },
          { type: "tool_result", id: "tool-1", ok: true, output: "updated" },
          { type: "done" },
        ]),
      ),
    );
    const blocks: AgentBlock[][] = [];

    await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "edit ttl",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(blocks.at(-1)).toContainEqual({
      kind: "diff",
      file: "src/auth.ts",
      additions: 1,
      deletions: 1,
      lines: [
        { type: "del", text: "const ttl = 60;" },
        { type: "add", text: "const ttl = 120;" },
      ],
    });
  });

  it("maps Write tool calls to diff blocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          {
            type: "tool",
            id: "tool-1",
            name: "Write",
            args: {
              file_path: "src/new.ts",
              content: "export const ok = true;\nexport const value = 1;",
            },
          },
          { type: "tool_result", id: "tool-1", ok: true, output: "created" },
          { type: "done" },
        ]),
      ),
    );
    const blocks: AgentBlock[][] = [];

    await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "write file",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(blocks.at(-1)).toContainEqual({
      kind: "diff",
      file: "src/new.ts",
      additions: 2,
      deletions: 0,
      lines: [
        { type: "add", text: "export const ok = true;" },
        { type: "add", text: "export const value = 1;" },
      ],
    });
  });

  it("maps approval run events to actionable approval blocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          {
            type: "approval",
            id: "approval-1",
            title: "Approve Bash command?",
            detail: "npm test",
          },
          { type: "done" },
        ]),
      ),
    );
    const blocks: AgentBlock[][] = [];

    const result = await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "run tests",
      accessMode: "unrestricted",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(result).toMatchObject({ status: "waiting", snippet: "Ждёт ввод" });
    expect(blocks.at(-1)).toContainEqual({
      kind: "approval",
      id: "approval-1",
      title: "Approve Bash command?",
      detail: "npm test",
    });
  });

  it("maps AskUserQuestion option events to selectable option blocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          {
            type: "options",
            id: "toolu_question:q0",
            prompt: "How should I format the output?",
            options: [
              { id: "Summary", label: "Summary", description: "Brief overview" },
              { id: "Detailed", label: "Detailed", description: "Full explanation" },
            ],
          },
          { type: "done" },
        ]),
      ),
    );
    const blocks: AgentBlock[][] = [];

    const result = await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "choose format",
      accessMode: "unrestricted",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(result).toMatchObject({ status: "waiting", snippet: "Ждёт ввод" });
    expect(blocks.at(-1)).toContainEqual({
      kind: "options",
      id: "toolu_question:q0",
      prompt: "How should I format the output?",
      options: [
        { id: "Summary", label: "Summary", description: "Brief overview" },
        { id: "Detailed", label: "Detailed", description: "Full explanation" },
      ],
    });
  });

  it("maps rich run events to chat components during live streams", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          {
            type: "plan",
            id: "plan-1",
            steps: [
              { label: "Read logs", state: "ok" },
              { label: "Patch mapper", state: "running" },
            ],
          },
          {
            type: "search",
            id: "search-1",
            query: "vibe kanban",
            state: "ok",
            results: [{ title: "Vibe Kanban", url: "https://github.com/BloopAI/vibe-kanban" }],
          },
          {
            type: "diff",
            id: "diff-1",
            file: "src/auth.ts",
            additions: 1,
            deletions: 1,
            lines: [
              { type: "del", text: "old" },
              { type: "add", text: "new" },
            ],
          },
          { type: "done" },
        ]),
      ),
    );
    const blocks: AgentBlock[][] = [];

    await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "map rich events",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(blocks.at(-1)).toEqual([
      {
        kind: "plan",
        steps: [
          { label: "Read logs", state: "ok" },
          { label: "Patch mapper", state: "running" },
        ],
      },
      {
        kind: "diff",
        file: "src/auth.ts",
        additions: 1,
        deletions: 1,
        lines: [
          { type: "del", text: "old" },
          { type: "add", text: "new" },
        ],
      },
      {
        kind: "search",
        query: "vibe kanban",
        state: "ok",
        results: [{ title: "Vibe Kanban", url: "https://github.com/BloopAI/vibe-kanban" }],
      },
    ]);
  });

  it("shows a live thinking block after run start even before reasoning tokens arrive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          { type: "start" },
          { type: "text", text: "answer" },
          { type: "done" },
        ]),
      ),
    );
    const blocks: AgentBlock[][] = [];

    await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "answer",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(blocks[0]).toContainEqual({ kind: "reasoning", text: "", active: true });
    expect(blocks.at(-1)).toEqual([{ kind: "text", text: "answer", streaming: false }]);
  });

  it("surfaces malformed run stream lines as explicit errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => rawStreamResponse([JSON.stringify({ type: "start" }), "{bad-json", JSON.stringify({ type: "done" })])),
    );
    const blocks: AgentBlock[][] = [];

    const result = await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "answer",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(result.status).toBe("error");
    expect(blocks.at(-1)).toContainEqual({
      kind: "status",
      level: "error",
      text: "Malformed run event: {bad-json",
    });
  });

  it("treats warning-only runs without agent output as errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          { type: "start" },
          { type: "status", level: "warn", text: "codex is not installed on this machine" },
          { type: "done" },
        ]),
      ),
    );

    const result = await runConversation({
      profile: { agent: "codex", model: "default", reasoning: "default", mode: "default" },
      prompt: "answer",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: vi.fn(),
    });

    expect(result.status).toBe("error");
    expect(result.snippet).toBe("Запуск завершился с ошибкой");
  });

  it("returns usage from completed run events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          { type: "text", text: "answer" },
          { type: "done", usage: { totalTokens: 1200, inputTokens: 1000, outputTokens: 200 }, costUsd: 0.0042 },
        ]),
      ),
    );

    const result = await runConversation({
      profile: { agent: "opencode", model: "default", reasoning: "default", mode: "default" },
      prompt: "answer",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: vi.fn(),
    });

    expect(result).toMatchObject({
      costUsd: 0.0042,
      usage: { totalTokens: 1200, inputTokens: 1000, outputTokens: 200 },
    });
  });
});
