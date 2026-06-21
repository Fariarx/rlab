import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROFILE, type AgentBlock } from "../src/components/agent";
import { attachRunUpdates, runConversation } from "../src/client/api/run-agent";
import { MAX_AGENT_TOOL_OUTPUT_CHARS } from "../src/lib/agent-output";

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

function rawChunkResponse(chunk: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}

function hangingStreamResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start() {
        // Intentionally leave the stream open without bytes.
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}

function timedStreamResponse(chunks: readonly { readonly delayMs: number; readonly events: readonly unknown[]; readonly close?: boolean }[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          setTimeout(() => {
            for (const event of chunk.events) {
              controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
            }
            if (chunk.close) {
              controller.close();
            }
          }, chunk.delayMs);
        }
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}

function abortableStreamResponse(events: readonly unknown[], signal?: AbortSignal): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
        }
        signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}

describe("runConversation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders an `ok` status (e.g. compaction) and settles the turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          { type: "status", level: "ok", text: "context compacted · 120k → 38k tokens" },
          { type: "done" },
        ]),
      ),
    );
    const blocks: AgentBlock[][] = [];

    const result = await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "/compact",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(result.status).toBe("done");
    expect(blocks.at(-1)).toEqual([{ kind: "status", level: "ok", text: "context compacted · 120k → 38k tokens" }]);
  });

  it("never leaves a settled turn with zero blocks (no hung thinking bubble)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([{ type: "done" }])));
    const blocks: AgentBlock[][] = [];

    const result = await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "/compact",
      accessMode: "read-only",
      locale: "en",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(result.status).toBe("done");
    expect(blocks.at(-1)).toEqual([{ kind: "status", level: "ok", text: "Done" }]);
  });

  it("sends the configured system prompt with the run request", async () => {
    const fetch = vi.fn(async () => streamResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetch);

    await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "answer",
      accessMode: "read-only",
      locale: "en",
      systemPrompt: "Be concise.",
      onBlocks: vi.fn(),
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/run",
      expect.objectContaining({
        body: expect.stringContaining('"systemPrompt":"Be concise."'),
      }),
    );
  });

  it("surfaces a foreground stream that closes before done as an explicit error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([{ type: "start" }])));
    const blocks: AgentBlock[][] = [];

    const result = await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "answer",
      accessMode: "read-only",
      locale: "en",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(result.status).toBe("error");
    expect(blocks.at(-1)).toContainEqual({ kind: "status", level: "error", text: "Run stream closed before completion" });
  });

  it("surfaces backend JSON errors from rejected run requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Project directory does not exist: /missing" }, { status: 400 })));
    const blocks: AgentBlock[][] = [];

    const result = await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "answer",
      accessMode: "read-only",
      locale: "en",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(result.status).toBe("error");
    expect(blocks.at(-1)).toContainEqual({ kind: "status", level: "error", text: "Project directory does not exist: /missing" });
  });

  it("detaches a server-owned stream that closes before done", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([{ type: "start" }])));
    const blocks: AgentBlock[][] = [];

    const result = await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "answer",
      accessMode: "read-only",
      locale: "ru",
      binding: {
        conversationId: "chat-1",
        runId: "run-1",
        userMessageId: "user-1",
        userMessageTime: "10:00",
        agentMessageId: "agent-1",
        agentMessageTime: "10:00",
      },
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(result.status).toBe("detached");
    expect(blocks.at(-1)).toContainEqual({ kind: "status", level: "info", text: "Запуск продолжается в фоне; идёт синхронизация с сервером" });
  });

  it("surfaces an idle server-owned stream as a transport error instead of detaching", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => hangingStreamResponse()));
    const blocks: AgentBlock[][] = [];

    const resultPromise = runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "answer",
      accessMode: "read-only",
      locale: "en",
      binding: {
        conversationId: "chat-1",
        runId: "run-1",
        userMessageId: "user-1",
        userMessageTime: "10:00",
        agentMessageId: "agent-1",
        agentMessageTime: "10:00",
      },
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    await vi.advanceTimersByTimeAsync(30_001);
    const result = await resultPromise;

    expect(result.status).toBe("error");
    expect(blocks.at(-1)).toContainEqual({ kind: "status", level: "error", text: "Run stream stalled while waiting for server heartbeat." });
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

  it("truncates large streamed tool outputs before rendering blocks", async () => {
    const largeOutput = `${"x".repeat(MAX_AGENT_TOOL_OUTPUT_CHARS)}tail`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          { type: "tool", id: "tool-1", name: "Shell", summary: "rg noisy" },
          { type: "tool_result", id: "tool-1", ok: true, output: largeOutput },
          { type: "done" },
        ]),
      ),
    );
    const blocks: AgentBlock[][] = [];

    await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "run command",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    const tool = blocks.at(-1)?.find((block) => block.kind === "tool");
    expect(tool).toMatchObject({ kind: "tool", state: "ok" });
    expect(tool?.kind === "tool" ? tool.output : "").toContain("[tool output truncated:");
    expect(tool?.kind === "tool" ? tool.output?.length : 0).toBeLessThanOrEqual(MAX_AGENT_TOOL_OUTPUT_CHARS);
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

    expect(result).toMatchObject({ status: "waiting" });
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

    expect(result).toMatchObject({ status: "waiting" });
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

    // Block order follows rebuild(): timeline items (search) render first, then
    // the pinned plan, then diffs — regardless of the order events arrived in.
    expect(blocks.at(-1)).toEqual([
      {
        kind: "search",
        query: "vibe kanban",
        state: "ok",
        results: [{ title: "Vibe Kanban", url: "https://github.com/BloopAI/vibe-kanban" }],
      },
      {
        kind: "plan",
        steps: [
          { label: "Read logs", state: "ok" },
          { label: "Patch mapper", state: "ok" },
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
    ]);
  });

  it("updates anonymous plan events in place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          {
            type: "plan",
            steps: [
              { label: "Read files", state: "running" },
              { label: "Patch UI", state: "pending" },
            ],
          },
          {
            type: "plan",
            steps: [
              { label: "Read files", state: "ok" },
              { label: "Patch UI", state: "running" },
            ],
          },
          { type: "done" },
        ]),
      ),
    );
    const blocks: AgentBlock[][] = [];

    await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "plan",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(blocks.at(-1)?.filter((block) => block.kind === "plan")).toEqual([
      {
        kind: "plan",
        steps: [
          { label: "Read files", state: "ok" },
          { label: "Patch UI", state: "ok" },
        ],
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

    expect(blocks[0]).toContainEqual(expect.objectContaining({ kind: "reasoning", text: "", active: true, startedAtMs: expect.any(Number) }));
    expect(blocks.at(-1)).toEqual([{ kind: "text", text: "answer", streaming: false, result: true }]);
  });

  it("settles live search blocks when the run finishes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          { type: "search", id: "search-1", query: "**/*calculator*", state: "running", results: [] },
          { type: "text", text: "checked" },
          { type: "done" },
        ]),
      ),
    );
    const blocks: AgentBlock[][] = [];

    await runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "search",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    expect(blocks.at(-1)).toEqual([
      { kind: "search", query: "**/*calculator*", state: "ok", results: [] },
      { kind: "text", text: "checked", streaming: false, result: true },
    ]);
  });

  it("coalesces consecutive text deltas from the same stream chunk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        rawChunkResponse(
          [
            JSON.stringify({ type: "text", text: "hel" }),
            JSON.stringify({ type: "text", text: "lo" }),
            JSON.stringify({ type: "done" }),
            "",
          ].join("\n"),
        ),
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

    const liveTextBlocks = blocks.flatMap((blockList) => blockList.filter((block) => block.kind === "text" && block.streaming === true));
    expect(liveTextBlocks).toEqual([{ kind: "text", text: "hello", streaming: true, result: false }]);
    expect(blocks.at(-1)).toEqual([{ kind: "text", text: "hello", streaming: false, result: true }]);
  });

  it("coalesces rapid text chunks into a frame-level live update", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        timedStreamResponse([
          { delayMs: 1, events: [{ type: "text", text: "hel" }] },
          { delayMs: 2, events: [{ type: "text", text: "lo" }] },
          { delayMs: 80, events: [{ type: "done" }], close: true },
        ]),
      ),
    );
    const blocks: AgentBlock[][] = [];

    const resultPromise = runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "answer",
      accessMode: "read-only",
      locale: "ru",
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    await vi.advanceTimersByTimeAsync(2);
    expect(blocks.flatMap((blockList) => blockList.filter((block) => block.kind === "text" && block.streaming === true))).toEqual([]);

    await vi.advanceTimersByTimeAsync(35);
    expect(blocks.flatMap((blockList) => blockList.filter((block) => block.kind === "text" && block.streaming === true))).toEqual([
      { kind: "text", text: "hello", streaming: true, result: false },
    ]);

    await vi.advanceTimersByTimeAsync(100);
    await resultPromise;

    expect(blocks.at(-1)).toEqual([{ kind: "text", text: "hello", streaming: false, result: true }]);
  });

  it("surfaces a canceled foreground run warning without promoting partial text", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        abortableStreamResponse(
          [
            { type: "reasoning", text: "Проверяю контекст" },
            { type: "text", text: "partial" },
          ],
          init?.signal ?? undefined,
        ),
      ),
    );
    const controller = new AbortController();
    const blocks: AgentBlock[][] = [];

    const resultPromise = runConversation({
      profile: DEFAULT_PROFILE,
      prompt: "answer",
      accessMode: "read-only",
      locale: "ru",
      signal: controller.signal,
      onBlocks: (nextBlocks) => blocks.push(nextBlocks),
    });

    await vi.advanceTimersByTimeAsync(40);
    controller.abort();
    const result = await resultPromise;

    expect(result.status).toBe("done");
    expect(blocks.at(-1)).toEqual([
      { kind: "reasoning", text: "Проверяю контекст", active: false, duration: expect.stringMatching(/s$/) },
      { kind: "text", text: "partial", streaming: false, result: false },
      { kind: "status", level: "warn", text: "Запуск остановлен", surface: true },
    ]);
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

  it("parses a final run stream event without a trailing newline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        rawChunkResponse(
          [
            JSON.stringify({ type: "text", text: "answer" }),
            JSON.stringify({ type: "done", usage: { totalTokens: 99 }, costUsd: 0.0009 }),
          ].join("\n"),
        ),
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
      costUsd: 0.0009,
      usage: { totalTokens: 99 },
    });
  });

  it("parses a final attach stream update without a trailing newline", async () => {
    const update = {
      runId: "run-1",
      conversationId: "chat-1",
      userMessageId: "user-1",
      agentMessageId: "agent-1",
      status: "done",
      time: "10:00",
      agentMessageTime: "10:01",
      done: true,
      blocks: [{ kind: "text", text: "done", streaming: false }],
      usage: { totalTokens: 77 },
    };
    vi.stubGlobal("fetch", vi.fn(async () => rawChunkResponse(JSON.stringify({ type: "update", update }))));
    const updates: unknown[] = [];

    await attachRunUpdates({
      runId: "run-1",
      onUpdate: (nextUpdate) => updates.push(nextUpdate),
    });

    expect(updates).toEqual([update]);
  });

  it("skips malformed attach stream updates without dropping the stream", async () => {
    const update = {
      runId: "run-1",
      conversationId: "chat-1",
      agentMessageId: "agent-1",
      status: "done",
      time: "10:00",
      agentMessageTime: "10:01",
      done: true,
      blocks: [{ kind: "text", text: "done", streaming: false }],
    };
    const validUpdate = { ...update, userMessageId: "user-1" };
    vi.stubGlobal("fetch", vi.fn(async () => rawChunkResponse(`${JSON.stringify({ type: "update", update })}\n${JSON.stringify({ type: "update", update: validUpdate })}\n`)));
    const updates: unknown[] = [];

    await attachRunUpdates({
      runId: "run-1",
      onUpdate: (nextUpdate) => updates.push(nextUpdate),
    });

    expect(updates).toEqual([validUpdate]);
  });
});
