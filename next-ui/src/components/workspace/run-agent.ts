import { type AgentBlock, type AgentProfile, type DiffBlock, type RunUsage } from "../agent";
import { translate } from "../../i18n/I18nProvider";
import { type Locale } from "./app-settings";
import { type AgentAccessMode } from "./app-settings";
import { truncate } from "./sample-data";

type RunEvent =
  | { type: "start" }
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; summary?: string; args?: Record<string, string> }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  | { type: "approval"; id: string; title: string; detail?: string }
  | { type: "options"; id: string; prompt: string; multi?: boolean; options: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }> }
  | { type: "status"; level: "info" | "ok" | "warn" | "error"; text: string }
  | { type: "error"; text: string }
  | { type: "done"; costUsd?: number; usage?: RunUsage };

export interface RunConversationResult {
  readonly status: "done" | "error" | "waiting" | "detached";
  readonly snippet: string;
  readonly costUsd?: number;
  readonly usage?: RunUsage;
}

type StreamingTool = {
  id: string;
  name: string;
  summary?: string;
  args?: Record<string, string>;
  state: "running" | "ok" | "error";
  output?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(value: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return value.name === "AbortError";
}

function splitDiffLines(value: string): string[] {
  if (value.length === 0) {
    return [];
  }
  return value.replace(/\r\n/g, "\n").split("\n");
}

function editPairToLines(oldText: string, newText: string): DiffBlock["lines"] {
  return [
    ...splitDiffLines(oldText).map((text) => ({ type: "del" as const, text })),
    ...splitDiffLines(newText).map((text) => ({ type: "add" as const, text })),
  ];
}

function parseMultiEditLines(value: string): DiffBlock["lines"] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const lines: Array<{ readonly type: "add" | "del" | "ctx"; readonly text: string }> = [];
    for (const item of parsed) {
      if (!isRecord(item) || typeof item.old_string !== "string" || typeof item.new_string !== "string") {
        return null;
      }
      lines.push(...editPairToLines(item.old_string, item.new_string));
    }
    return lines;
  } catch {
    return null;
  }
}

function toolToDiffBlock(tool: StreamingTool): DiffBlock | null {
  if (tool.state === "error") {
    return null;
  }
  const args = tool.args;
  const file = args?.file_path ?? args?.path;
  if (!file) {
    return null;
  }

  const normalizedName = tool.name.toLowerCase();
  let lines: DiffBlock["lines"] | null = null;
  if (normalizedName === "write" && typeof args?.content === "string") {
    lines = splitDiffLines(args.content).map((text) => ({ type: "add", text }));
  } else if (normalizedName === "edit" && typeof args?.old_string === "string" && typeof args?.new_string === "string") {
    lines = editPairToLines(args.old_string, args.new_string);
  } else if (normalizedName === "multiedit" && typeof args?.edits === "string") {
    lines = parseMultiEditLines(args.edits);
  }

  if (!lines) {
    return null;
  }

  return {
    kind: "diff",
    file,
    additions: lines.filter((line) => line.type === "add").length,
    deletions: lines.filter((line) => line.type === "del").length,
    lines,
  };
}

interface RunPersistenceBinding {
  readonly conversationId: string;
  readonly runId: string;
  readonly userMessageId: string;
  readonly userMessageTime: string;
  readonly agentMessageId: string;
  readonly agentMessageTime: string;
}

export async function cancelRun(runId: string): Promise<void> {
  const response = await fetch("/api/run-cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  if (!response.ok && response.status !== 404) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Run cancel failed (${response.status})`);
  }
}

/** POST a prompt to the dev backend and yield normalized run events as they stream. */
async function streamRun(
  profile: AgentProfile,
  prompt: string,
  cwd: string | undefined,
  accessMode: AgentAccessMode,
  binding: RunPersistenceBinding | undefined,
  onEvent: (e: RunEvent) => void,
  onAccepted: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: profile.agent, model: profile.model, reasoning: profile.reasoning, mode: profile.mode, prompt, cwd, accessMode, ...binding }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Run request failed (${res.status})`);
  }
  onAccepted();
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
          onEvent({ type: "error", text: `Malformed run event: ${line}` });
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
  readonly profile: AgentProfile;
  readonly prompt: string;
  readonly cwd?: string;
  readonly accessMode: AgentAccessMode;
  readonly locale: Locale;
  readonly binding?: RunPersistenceBinding;
  readonly signal?: AbortSignal;
  readonly onBlocks: (blocks: AgentBlock[]) => void;
}): Promise<RunConversationResult> {
  let reasoning = "";
  let hasReasoning = false;
  let started = false;
  let text = "";
  let hasText = false;
  const tools: StreamingTool[] = [];
  const approvals: Array<{ id: string; title: string; detail?: string }> = [];
  const options: Array<{ id: string; prompt: string; multi?: boolean; options: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }> }> = [];
  const statuses: Array<{ level: "warn" | "error"; text: string }> = [];
  let costUsd: number | undefined;
  let usage: RunUsage | undefined;
  let done = false;
  let canceled = false;
  let detached = false;
  let accepted = false;
  const start = performance.now();

  const rebuild = (): AgentBlock[] => {
    const blocks: AgentBlock[] = [];
    if (hasReasoning) {
      blocks.push({ kind: "reasoning", text: reasoning, active: !done, duration: done ? `${Math.max(1, Math.round((performance.now() - start) / 1000))}s` : undefined });
    } else if (started && !done) {
      blocks.push({ kind: "reasoning", text: "", active: true });
    }
    for (const t of tools) {
      blocks.push(toolToDiffBlock(t) ?? { kind: "tool", name: t.name, summary: t.summary, args: t.args, state: t.state, output: t.output });
    }
    for (const approval of approvals) {
      blocks.push({ kind: "approval", id: approval.id, title: approval.title, detail: approval.detail });
    }
    for (const option of options) {
      blocks.push({ kind: "options", id: option.id, prompt: option.prompt, multi: option.multi, options: option.options });
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
        started = true;
        hasReasoning = true;
        reasoning += e.text;
        opts.onBlocks(rebuild());
        break;
      case "text":
        started = true;
        hasText = true;
        text += e.text;
        opts.onBlocks(rebuild());
        break;
      case "tool":
        started = true;
        {
          const existing = tools.find((t) => t.id === e.id);
          if (existing) {
            existing.name = e.name;
            existing.summary = e.summary;
            existing.args = e.args;
          } else {
            tools.push({ id: e.id, name: e.name, summary: e.summary, args: e.args, state: "running" });
          }
        }
        opts.onBlocks(rebuild());
        break;
      case "tool_result": {
        started = true;
        const tool = tools.find((t) => t.id === e.id);
        if (tool) {
          tool.state = e.ok ? "ok" : "error";
          tool.output = e.output;
        }
        opts.onBlocks(rebuild());
        break;
      }
      case "approval":
        started = true;
        approvals.push({ id: e.id, title: e.title, detail: e.detail });
        opts.onBlocks(rebuild());
        break;
      case "options":
        started = true;
        {
          const existing = options.find((item) => item.id === e.id);
          if (existing) {
            existing.prompt = e.prompt;
            existing.multi = e.multi;
            existing.options = e.options;
          } else {
            options.push({ id: e.id, prompt: e.prompt, multi: e.multi, options: e.options });
          }
        }
        opts.onBlocks(rebuild());
        break;
      case "status":
        started = true;
        if (e.level === "warn" || e.level === "error") {
          statuses.push({ level: e.level, text: e.text });
          opts.onBlocks(rebuild());
        }
        break;
      case "error":
        started = true;
        statuses.push({ level: "error", text: e.text });
        opts.onBlocks(rebuild());
        break;
      case "start":
        started = true;
        opts.onBlocks(rebuild());
        break;
      case "done":
        costUsd = e.costUsd;
        usage = e.usage;
        break;
      default:
        break;
    }
  };

  try {
    await streamRun(
      opts.profile,
      opts.prompt,
      opts.cwd,
      opts.accessMode,
      opts.binding,
      onEvent,
      () => {
        accepted = true;
      },
      opts.signal,
    );
  } catch (err) {
    if (isAbortError(err, opts.signal)) {
      canceled = true;
    } else if (opts.binding && accepted) {
      detached = true;
    } else {
      statuses.push({ level: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  if (detached) {
    opts.onBlocks([...rebuild(), { kind: "status", level: "info", text: translate(opts.locale, "runDetachedSnippet") }]);
    return { status: "detached", snippet: "" };
  }

  done = true;
  let finalBlocks = rebuild();
  // Always emit a final settled render so a canceled run doesn't leave the
  // message stuck on the live "thinking" placeholder. If nothing streamed in
  // before the cancel, show an explicit "stopped" note instead of an empty bubble.
  if (canceled && finalBlocks.length === 0) {
    finalBlocks = [{ kind: "status", level: "warn", text: translate(opts.locale, "runCanceledSnippet") }];
  }
  opts.onBlocks(finalBlocks);

  const hadError = statuses.some((s) => s.level === "error");
  const needsInput = approvals.length > 0 || options.length > 0;
  const status = hadError ? "error" : needsInput ? "waiting" : "done";
  const snippet = canceled
    ? translate(opts.locale, "runCanceledSnippet")
    : hadError
      ? translate(opts.locale, "runFailedSnippet")
      : needsInput
        ? translate(opts.locale, "runNeedsInputSnippet")
      : truncate((hasText ? text : translate(opts.locale, "runDoneSnippet")).replace(/\s+/g, " "), 60);
  return { status, snippet, costUsd, usage };
}
