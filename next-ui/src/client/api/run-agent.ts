import type {
  AgentBlock,
  CompactionSettings,
  ConversationStatus,
  RunUsage,
} from "../../domain/agent-types";
import { translate } from "../../i18n/I18nProvider";
import { truncateAgentToolOutput } from "../../lib/agent-output";
import { finishLiveBlock } from "../../lib/agent-block-state";
import type { AgentAccessMode, AgentProfile } from "../../lib/agent-catalog";
import {
  accumulateRunEvent,
  createRunEventAccumulator,
  runEventAccumulatorHasOutput,
  runEventAccumulatorNeedsInput,
  runEventBlocks,
  type RunEvent,
} from "../../lib/run-event-accumulator";
import type { Locale } from "../../lib/app-settings";
import { isRecord, responseErrorMessage } from "./http";

const LIVE_BLOCK_FLUSH_MS = 32;

export interface RunConversationResult {
  readonly status: "done" | "error" | "waiting" | "detached";
  readonly costUsd?: number;
  readonly usage?: RunUsage;
  readonly sessionId?: string;
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
  readonly userMessageId: string;
  readonly agentMessageId: string;
  readonly startedAtMs?: number;
  readonly status: ConversationStatus;
  readonly time: string;
  readonly done: boolean;
  readonly blocks: readonly AgentBlock[];
  readonly costUsd?: number;
  readonly usage?: RunUsage;
}

type RunAttachEvent = { readonly type: "update"; readonly update: ActiveRunUpdate };

function readBufferedNdjsonLines(buffer: string, onLine: (line: string) => void): string {
  let nextBuffer = buffer;
  let nl = nextBuffer.indexOf("\n");
  while (nl >= 0) {
    const line = nextBuffer.slice(0, nl).trim();
    nextBuffer = nextBuffer.slice(nl + 1);
    if (line) {
      onLine(line);
    }
    nl = nextBuffer.indexOf("\n");
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
  return ["totalTokens", "inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "contextTokens"].every(
    (key) => value[key] === undefined || typeof value[key] === "number",
  );
}

function isActiveRunUpdate(value: unknown): value is ActiveRunUpdate {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    typeof value.conversationId === "string" &&
    typeof value.userMessageId === "string" &&
    typeof value.agentMessageId === "string" &&
    (value.startedAtMs === undefined || typeof value.startedAtMs === "number") &&
    isConversationStatus(value.status) &&
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
    throw new Error(await responseErrorMessage(response, `Active runs load failed (${response.status})`));
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
    throw new Error(await responseErrorMessage(response, `Run attach failed (${response.status})`));
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
    throw new Error(await responseErrorMessage(response, `Run cancel failed (${response.status})`));
  }
}

/** POST a prompt to the dev backend and yield normalized run events as they stream. */
async function streamRun(
  profile: AgentProfile,
  prompt: string,
  cwd: string | undefined,
  accessMode: AgentAccessMode,
  binding: RunPersistenceBinding | undefined,
  resume: string | undefined,
  compaction: CompactionSettings | undefined,
  onEvent: (e: RunEvent) => void,
  onAccepted: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent: profile.agent,
      model: profile.model,
      reasoning: profile.reasoning,
      mode: profile.mode,
      autoConfirm: profile.autoConfirm ?? false,
      prompt,
      cwd,
      accessMode,
      ...(resume ? { resume } : {}),
      ...(compaction?.auto !== undefined ? { autoCompact: compaction.auto } : {}),
      ...(typeof compaction?.window === "number" ? { compactWindow: compaction.window } : {}),
      ...binding,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(await responseErrorMessage(res, `Run request failed (${res.status})`));
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
 * stream in (`onBlocks`). Returns the resulting conversation status and usage.
 */
export async function runConversation(opts: {
  readonly profile: AgentProfile;
  readonly prompt: string;
  readonly cwd?: string;
  readonly accessMode: AgentAccessMode;
  readonly locale: Locale;
  readonly binding?: RunPersistenceBinding;
  readonly signal?: AbortSignal;
  /** Native session id to resume (same agent continuing the conversation). */
  readonly resume?: string;
  /** Per-conversation compaction preferences (auto on/off + window override),
   *  forwarded to the backend so the agent compacts to the user's settings. */
  readonly compaction?: CompactionSettings;
  readonly onAccepted?: () => void;
  /** Fires as soon as the agent reports its session id, so it can be persisted
   *  immediately (even if the run later detaches or errors). */
  readonly onSession?: (sessionId: string) => void;
  readonly onBlocks: (blocks: AgentBlock[]) => void;
}): Promise<RunConversationResult> {
  let sessionId: string | undefined;
  let doneEventReceived = false;
  let canceled = false;
  let detached = false;
  let accepted = false;
  const accumulator = createRunEventAccumulator();
  const rebuild = (): AgentBlock[] => runEventBlocks(accumulator);

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
    if (e.type === "session") {
      sessionId = e.id;
      opts.onSession?.(e.id);
    } else if (e.type === "done") {
      doneEventReceived = true;
    }

    accumulateRunEvent(accumulator, e, { formatToolOutput: truncateAgentToolOutput });

    if (e.type === "reasoning" || e.type === "text") {
      queueLiveBlocks();
      return;
    }
    if (e.type === "status" && e.level === "info") {
      return;
    }
    if (e.type !== "session" && e.type !== "done" && e.type !== "wakeup" && e.type !== "cancel_wakeup") {
      emitBlocks();
    }
  };

  try {
    await streamRun(
      opts.profile,
      opts.prompt,
      opts.cwd,
      opts.accessMode,
      opts.binding,
      opts.resume,
      opts.compaction,
      onEvent,
      () => {
        accepted = true;
        opts.onAccepted?.();
      },
      opts.signal,
    );
    if (!doneEventReceived) {
      if (opts.binding && accepted) {
        detached = true;
      } else {
        accumulateRunEvent(accumulator, { type: "error", text: translate(opts.locale, "runStreamClosedError") });
      }
    }
  } catch (err) {
    if (isAbortError(err, opts.signal)) {
      canceled = true;
    } else if (opts.binding && accepted) {
      detached = true;
    } else {
      accumulateRunEvent(accumulator, { type: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  if (detached) {
    flushLiveBlocks();
    opts.onBlocks([...rebuild(), { kind: "status", level: "info", text: translate(opts.locale, "runDetachedSnippet") }]);
    return { status: "detached", sessionId };
  }

  flushLiveBlocks();
  accumulator.done = true;
  const hadError = accumulator.statuses.some((s) => s.level === "error");
  const hadOutput = runEventAccumulatorHasOutput(accumulator);
  const warningOnlyFailure = accumulator.statuses.some((s) => s.level === "warn") && !hadOutput;
  const needsInput = runEventAccumulatorNeedsInput(accumulator);
  const status = hadError || warningOnlyFailure ? "error" : needsInput ? "waiting" : "done";
  let finalBlocks = rebuild().map((block) => finishLiveBlock(block, status === "error" ? "error" : "ok"));
  // Always emit a final settled render so a canceled run doesn't leave the
  // message stuck on the live "thinking" placeholder. If nothing streamed in
  // before the cancel, show an explicit "stopped" note instead of an empty bubble.
  if (canceled && finalBlocks.length === 0) {
    finalBlocks = [{ kind: "status", level: "warn", text: translate(opts.locale, "runCanceledSnippet") }];
  } else if (!canceled && finalBlocks.length === 0) {
    // A turn that settled without emitting any block (e.g. a slash command the
    // agent handled internally) must not leave the agent bubble stuck on the
    // empty "thinking" placeholder — surface an explicit "done" note instead.
    finalBlocks = [{ kind: "status", level: "ok", text: translate(opts.locale, "runDoneSnippet") }];
  }
  opts.onBlocks(finalBlocks);

  return { status, costUsd: accumulator.costUsd, usage: accumulator.usage, sessionId };
}
