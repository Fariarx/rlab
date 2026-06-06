import { type AgentBlock, type AgentId } from "../agent";
import { truncate } from "./sample-data";

type RunEvent =
  | { type: "start" }
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; summary?: string; args?: Record<string, string> }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  | { type: "status"; level: "info" | "ok" | "warn" | "error"; text: string }
  | { type: "error"; text: string }
  | { type: "done"; costUsd?: number };

/** POST a prompt to the dev backend and yield normalized run events as they stream. */
async function streamRun(agent: AgentId, prompt: string, cwd: string | undefined, onEvent: (e: RunEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, prompt, cwd }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Run request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as RunEvent);
        } catch {
          // skip malformed line
        }
      }
    }
  }
}

/**
 * Run a real agent for one turn, rebuilding the agent message's blocks as events
 * stream in (`onBlocks`). Returns the resulting conversation status + snippet.
 */
export async function runConversation(opts: {
  readonly agent: AgentId;
  readonly prompt: string;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly onBlocks: (blocks: AgentBlock[]) => void;
}): Promise<{ status: "done" | "error"; snippet: string }> {
  let reasoning = "";
  let hasReasoning = false;
  let text = "";
  let hasText = false;
  const tools: Array<{ id: string; name: string; summary?: string; args?: Record<string, string>; state: "running" | "ok" | "error"; output?: string }> = [];
  const statuses: Array<{ level: "warn" | "error"; text: string }> = [];
  let done = false;
  const start = performance.now();

  const rebuild = (): AgentBlock[] => {
    const blocks: AgentBlock[] = [];
    if (hasReasoning) {
      blocks.push({ kind: "reasoning", text: reasoning, active: !done, duration: done ? `${Math.max(1, Math.round((performance.now() - start) / 1000))}s` : undefined });
    }
    for (const t of tools) {
      blocks.push({ kind: "tool", name: t.name, summary: t.summary, args: t.args, state: t.state, output: t.output });
    }
    if (hasText) {
      blocks.push({ kind: "text", text, streaming: !done });
    }
    for (const s of statuses) {
      blocks.push({ kind: "status", level: s.level, text: s.text });
    }
    return blocks;
  };

  const onEvent = (e: RunEvent) => {
    switch (e.type) {
      case "reasoning":
        hasReasoning = true;
        reasoning += e.text;
        opts.onBlocks(rebuild());
        break;
      case "text":
        hasText = true;
        text += e.text;
        opts.onBlocks(rebuild());
        break;
      case "tool":
        tools.push({ id: e.id, name: e.name, summary: e.summary, args: e.args, state: "running" });
        opts.onBlocks(rebuild());
        break;
      case "tool_result": {
        const tool = tools.find((t) => t.id === e.id);
        if (tool) {
          tool.state = e.ok ? "ok" : "error";
          tool.output = e.output;
        }
        opts.onBlocks(rebuild());
        break;
      }
      case "status":
        if (e.level === "warn" || e.level === "error") {
          statuses.push({ level: e.level, text: e.text });
          opts.onBlocks(rebuild());
        }
        break;
      case "error":
        statuses.push({ level: "error", text: e.text });
        opts.onBlocks(rebuild());
        break;
      default:
        break;
    }
  };

  try {
    await streamRun(opts.agent, opts.prompt, opts.cwd, onEvent, opts.signal);
  } catch (err) {
    statuses.push({ level: "error", text: err instanceof Error ? err.message : String(err) });
  }

  done = true;
  opts.onBlocks(rebuild());

  const hadError = statuses.some((s) => s.level === "error");
  const snippet = hadError ? "Run failed" : truncate((hasText ? text : "Done").replace(/\s+/g, " "), 60);
  return { status: hadError ? "error" : "done", snippet };
}
