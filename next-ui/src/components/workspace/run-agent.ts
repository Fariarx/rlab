import {
  type AgentBlock,
  type AgentProfile,
  type CodeBlockData,
  type ConversationStatus,
  type DiffBlock,
  type PlanBlock,
  type RunState,
  type RunUsage,
  type SearchBlock,
  type SuggestedActionsBlock,
} from "../agent";
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
  | { type: "diff"; id?: string; file: string; additions: number; deletions: number; lines: DiffBlock["lines"] }
  | { type: "plan"; id?: string; steps: PlanBlock["steps"] }
  | { type: "code"; language: string; code: string }
  | { type: "search"; id?: string; query: string; state: RunState; results?: SearchBlock["results"] }
  | { type: "suggested"; actions: SuggestedActionsBlock["actions"] }
  | { type: "approval"; id: string; title: string; detail?: string }
  | { type: "options"; id: string; prompt: string; multi?: boolean; options: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }> }
  | { type: "status"; level: "info" | "ok" | "warn" | "error"; text: string }
  | { type: "error"; text: string }
  | { type: "done"; costUsd?: number; usage?: RunUsage };

const LIVE_BLOCK_FLUSH_MS = 32;

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

type StreamingSearch = {
  id?: string;
  query: string;
  state: RunState;
  results: SearchBlock["results"];
};

type StreamingPlan = {
  id?: string;
  steps: PlanBlock["steps"];
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

function finishLiveBlock(block: AgentBlock, state: "ok" | "error"): AgentBlock {
  switch (block.kind) {
    case "reasoning":
      return block.active ? { ...block, active: false } : block;
    case "text":
      return block.streaming ? { ...block, streaming: false } : block;
    case "tool":
    case "command":
    case "search":
      return block.state === "running" ? { ...block, state } : block;
    case "plan":
      return block.steps.some((step) => step.state === "running") ? { ...block, steps: block.steps.map((step) => (step.state === "running" ? { ...step, state } : step)) } : block;
    default:
      return block;
  }
}

interface RunPersistenceBinding {
  readonly conversationId: string;
  readonly runId: string;
  readonly userMessageId: string;
  readonly userMessageTime: string;
  readonly agentMessageId: string;
  readonly agentMessageTime: string;
}

export interface ActiveRunSnapshot {
  readonly runId: string;
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly agentMessageId: string;
  readonly startedAt: string;
}

export interface ActiveRunUpdate {
  readonly runId: string;
  readonly conversationId: string;
  readonly agentMessageId: string;
  readonly status: ConversationStatus;
  readonly snippet: string;
  readonly time: string;
  readonly done: boolean;
  readonly blocks: readonly AgentBlock[];
  readonly costUsd?: number;
  readonly usage?: RunUsage;
}

type RunAttachEvent = { readonly type: "update"; readonly update: ActiveRunUpdate };

function readBufferedNdjsonLines(buffer: string, onLine: (line: string) => void): string {
  let nextBuffer = buffer;
  let nl: number;
  while ((nl = nextBuffer.indexOf("\n")) >= 0) {
    const line = nextBuffer.slice(0, nl).trim();
    nextBuffer = nextBuffer.slice(nl + 1);
    if (line) {
      onLine(line);
    }
  }
  return nextBuffer;
}

function readFinalNdjsonLine(buffer: string, onLine: (line: string) => void): void {
  const line = buffer.trim();
  if (line) {
    onLine(line);
  }
}

function isActiveRunSnapshot(value: unknown): value is ActiveRunSnapshot {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    typeof value.conversationId === "string" &&
    typeof value.userMessageId === "string" &&
    typeof value.agentMessageId === "string" &&
    typeof value.startedAt === "string"
  );
}

function isConversationStatus(value: unknown): value is ConversationStatus {
  return value === "running" || value === "waiting" || value === "done" || value === "error" || value === "idle";
}

function isRunUsage(value: unknown): value is RunUsage {
  if (!isRecord(value)) {
    return false;
  }
  return ["totalTokens", "inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens"].every(
    (key) => value[key] === undefined || typeof value[key] === "number",
  );
}

function isActiveRunUpdate(value: unknown): value is ActiveRunUpdate {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    typeof value.conversationId === "string" &&
    typeof value.agentMessageId === "string" &&
    isConversationStatus(value.status) &&
    typeof value.snippet === "string" &&
    typeof value.time === "string" &&
    typeof value.done === "boolean" &&
    Array.isArray(value.blocks) &&
    (value.costUsd === undefined || typeof value.costUsd === "number") &&
    (value.usage === undefined || isRunUsage(value.usage))
  );
}

function isRunAttachEvent(value: unknown): value is RunAttachEvent {
  return isRecord(value) && value.type === "update" && isActiveRunUpdate(value.update);
}

export async function loadActiveRuns(): Promise<ActiveRunSnapshot[]> {
  const response = await fetch("/api/runs", { method: "GET", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Active runs load failed (${response.status})`);
  }
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || !Array.isArray(payload.runs) || !payload.runs.every(isActiveRunSnapshot)) {
    throw new Error("Active runs response is invalid.");
  }
  return payload.runs.map((run) => ({
    runId: run.runId,
    conversationId: run.conversationId,
    userMessageId: run.userMessageId,
    agentMessageId: run.agentMessageId,
    startedAt: run.startedAt,
  }));
}

export async function attachRunUpdates(opts: {
  readonly runId: string;
  readonly signal?: AbortSignal;
  readonly onUpdate: (update: ActiveRunUpdate) => void;
}): Promise<void> {
  const query = new URLSearchParams({ runId: opts.runId });
  const response = await fetch(`/api/run-attach?${query.toString()}`, { method: "GET", cache: "no-store", signal: opts.signal });
  if (!response.ok || !response.body) {
    throw new Error(`Run attach failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const readLine = (line: string) => {
    const parsed = JSON.parse(line) as unknown;
    if (!isRunAttachEvent(parsed)) {
      throw new Error(`Malformed run attach event: ${line}`);
    }
    opts.onUpdate(parsed.update);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = readBufferedNdjsonLines(buffer, readLine);
  }
  buffer += decoder.decode();
  readFinalNdjsonLine(buffer, readLine);
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
  const readLine = (line: string) => {
    try {
      onEvent(JSON.parse(line) as RunEvent);
    } catch {
      onEvent({ type: "error", text: `Malformed run event: ${line}` });
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = readBufferedNdjsonLines(buffer, readLine);
  }
  buffer += decoder.decode();
  readFinalNdjsonLine(buffer, readLine);
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
  readonly onAccepted?: () => void;
  readonly onBlocks: (blocks: AgentBlock[]) => void;
}): Promise<RunConversationResult> {
  let reasoning = "";
  let hasReasoning = false;
  let started = false;
  let text = "";
  let hasText = false;
  const tools: StreamingTool[] = [];
  const diffs: DiffBlock[] = [];
  const plans: StreamingPlan[] = [];
  const codes: CodeBlockData[] = [];
  const searches: StreamingSearch[] = [];
  const suggested: SuggestedActionsBlock[] = [];
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
    for (const plan of plans) {
      blocks.push({ kind: "plan", steps: plan.steps });
    }
    for (const t of tools) {
      blocks.push(toolToDiffBlock(t) ?? { kind: "tool", name: t.name, summary: t.summary, args: t.args, state: t.state, output: t.output });
    }
    blocks.push(...diffs);
    blocks.push(...codes);
    for (const search of searches) {
      blocks.push({ kind: "search", query: search.query, state: search.state, results: search.results });
    }
    blocks.push(...suggested);
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

  let pendingLiveBlocks: AgentBlock[] | null = null;
  let liveFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const clearPendingLiveBlocks = () => {
    if (liveFlushTimer !== null) {
      clearTimeout(liveFlushTimer);
      liveFlushTimer = null;
    }
    pendingLiveBlocks = null;
  };
  const flushLiveBlocks = () => {
    if (liveFlushTimer !== null) {
      clearTimeout(liveFlushTimer);
      liveFlushTimer = null;
    }
    const blocks = pendingLiveBlocks;
    pendingLiveBlocks = null;
    if (blocks) {
      opts.onBlocks(blocks);
    }
  };
  const queueLiveBlocks = () => {
    pendingLiveBlocks = rebuild();
    if (liveFlushTimer !== null) {
      return;
    }
    liveFlushTimer = setTimeout(flushLiveBlocks, LIVE_BLOCK_FLUSH_MS);
  };
  const emitBlocks = () => {
    clearPendingLiveBlocks();
    opts.onBlocks(rebuild());
  };

  const onEvent = (e: RunEvent) => {
    switch (e.type) {
      case "reasoning":
        started = true;
        hasReasoning = true;
        reasoning += e.text;
        queueLiveBlocks();
        break;
      case "text":
        started = true;
        hasText = true;
        text += e.text;
        queueLiveBlocks();
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
        emitBlocks();
        break;
      case "tool_result": {
        started = true;
        const tool = tools.find((t) => t.id === e.id);
        if (tool) {
          tool.state = e.ok ? "ok" : "error";
          tool.output = e.output;
        }
        emitBlocks();
        break;
      }
      case "diff": {
        started = true;
        const block: DiffBlock = { kind: "diff", file: e.file, additions: e.additions, deletions: e.deletions, lines: e.lines };
        const existingIndex = diffs.findIndex((item) => item.file === e.file);
        if (existingIndex >= 0) {
          diffs[existingIndex] = block;
        } else {
          diffs.push(block);
        }
        emitBlocks();
        break;
      }
      case "plan": {
        started = true;
        const existing = e.id ? plans.find((item) => item.id === e.id) : undefined;
        if (existing) {
          existing.steps = e.steps;
        } else {
          plans.push({ id: e.id, steps: e.steps });
        }
        emitBlocks();
        break;
      }
      case "code":
        started = true;
        codes.push({ kind: "code", language: e.language, code: e.code });
        emitBlocks();
        break;
      case "search": {
        started = true;
        const existing = e.id ? searches.find((item) => item.id === e.id) : searches.find((item) => item.query === e.query);
        if (existing) {
          existing.query = e.query;
          existing.state = e.state;
          existing.results = e.results ?? existing.results;
        } else {
          searches.push({ id: e.id, query: e.query, state: e.state, results: e.results ?? [] });
        }
        emitBlocks();
        break;
      }
      case "suggested":
        started = true;
        suggested.push({ kind: "suggested", actions: e.actions });
        emitBlocks();
        break;
      case "approval":
        started = true;
        approvals.push({ id: e.id, title: e.title, detail: e.detail });
        emitBlocks();
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
        emitBlocks();
        break;
      case "status":
        started = true;
        if (e.level === "warn" || e.level === "error") {
          statuses.push({ level: e.level, text: e.text });
          emitBlocks();
        }
        break;
      case "error":
        started = true;
        statuses.push({ level: "error", text: e.text });
        emitBlocks();
        break;
      case "start":
        started = true;
        emitBlocks();
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
        opts.onAccepted?.();
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
    flushLiveBlocks();
    opts.onBlocks([...rebuild(), { kind: "status", level: "info", text: translate(opts.locale, "runDetachedSnippet") }]);
    return { status: "detached", snippet: "" };
  }

  flushLiveBlocks();
  done = true;
  const hadError = statuses.some((s) => s.level === "error");
  const hadOutput =
    hasText ||
    hasReasoning ||
    tools.length > 0 ||
    diffs.length > 0 ||
    plans.length > 0 ||
    codes.length > 0 ||
    searches.length > 0 ||
    suggested.length > 0 ||
    approvals.length > 0 ||
    options.length > 0;
  const warningOnlyFailure = statuses.some((s) => s.level === "warn") && !hadOutput;
  const needsInput = approvals.length > 0 || options.length > 0;
  const status = hadError || warningOnlyFailure ? "error" : needsInput ? "waiting" : "done";
  let finalBlocks = rebuild().map((block) => finishLiveBlock(block, status === "error" ? "error" : "ok"));
  // Always emit a final settled render so a canceled run doesn't leave the
  // message stuck on the live "thinking" placeholder. If nothing streamed in
  // before the cancel, show an explicit "stopped" note instead of an empty bubble.
  if (canceled && finalBlocks.length === 0) {
    finalBlocks = [{ kind: "status", level: "warn", text: translate(opts.locale, "runCanceledSnippet") }];
  }
  opts.onBlocks(finalBlocks);

  const snippet = canceled
    ? translate(opts.locale, "runCanceledSnippet")
    : hadError || warningOnlyFailure
      ? translate(opts.locale, "runFailedSnippet")
      : needsInput
        ? translate(opts.locale, "runNeedsInputSnippet")
      : truncate((hasText ? text : translate(opts.locale, "runDoneSnippet")).replace(/\s+/g, " "), 60);
  return { status, snippet, costUsd, usage };
}
