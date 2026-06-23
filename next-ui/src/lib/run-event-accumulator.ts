import type {
  AgentBlock,
  CodeBlockData,
  DiffBlock,
  PlanBlock,
  RunState,
  RunUsage,
  SearchBlock,
  SuggestedActionsBlock,
} from "../domain/agent-types";

export type RunEvent =
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
  | { type: "options"; id: string; prompt: string; multi?: boolean; options: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }>; selected?: readonly string[] }
  | { type: "status"; level: "info" | "ok" | "warn" | "error"; text: string }
  | { type: "error"; text: string }
  | { type: "session"; id: string }
  | { type: "wakeup"; prompt: string; reason?: string; toolId?: string; delaySeconds?: number; fireAt?: string; cron?: string; script?: string; intervalSeconds?: number }
  | { type: "cancel_wakeup"; wakeupId?: string; all?: boolean; reason?: string; toolId?: string }
  | { type: "goal"; action: "add" | "update" | "remove" | "complete" | "list"; goalId?: string; description?: string; afterItemId?: string | null; toolId?: string }
  | { type: "done"; costUsd?: number; usage?: RunUsage; usageDebug?: unknown };

export interface StreamingTool {
  id: string;
  name: string;
  summary?: string;
  args?: Record<string, string>;
  state: "running" | "ok" | "error";
  output?: string;
}

interface StreamingSearch {
  id?: string;
  query: string;
  state: RunState;
  results: SearchBlock["results"];
}

interface StreamingPlan {
  id?: string;
  steps: PlanBlock["steps"];
}

export interface AccumulatedOptionsQuestion {
  id: string;
  prompt: string;
  multi?: boolean;
  options: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }>;
  selected?: readonly string[];
}

interface RunTimelineReasoning {
  kind: "reasoning";
  text: string;
}

interface RunTimelineText {
  kind: "text";
  text: string;
}

interface RunTimelineTool {
  readonly kind: "tool";
  readonly tool: StreamingTool;
}

interface RunTimelineSearch {
  readonly kind: "search";
  readonly search: StreamingSearch;
}

interface RunTimelineCode {
  readonly kind: "code";
  readonly data: CodeBlockData;
}

type RunTimelineItem = RunTimelineReasoning | RunTimelineText | RunTimelineTool | RunTimelineSearch | RunTimelineCode;

export interface RunEventAccumulator {
  sessionId?: string;
  started: boolean;
  hasReasoning: boolean;
  hasText: boolean;
  readonly tools: StreamingTool[];
  readonly timeline: RunTimelineItem[];
  readonly diffs: DiffBlock[];
  readonly plans: StreamingPlan[];
  readonly codes: CodeBlockData[];
  readonly searches: StreamingSearch[];
  readonly suggested: SuggestedActionsBlock[];
  readonly approvals: Array<{ id: string; title: string; detail?: string }>;
  readonly options: AccumulatedOptionsQuestion[];
  readonly statuses: Array<{ level: "ok" | "warn" | "error"; text: string }>;
  costUsd?: number;
  usage?: RunUsage;
  done: boolean;
  readonly startMs: number;
}

export interface AccumulateRunEventOptions {
  readonly formatToolOutput?: (output: string) => string;
}

export interface RunEventBlocksOptions {
  readonly nowMs?: number;
}

export function createRunEventAccumulator(startMs = Date.now()): RunEventAccumulator {
  return {
    started: false,
    hasReasoning: false,
    hasText: false,
    tools: [],
    timeline: [],
    diffs: [],
    plans: [],
    codes: [],
    searches: [],
    suggested: [],
    approvals: [],
    options: [],
    statuses: [],
    done: false,
    startMs,
  };
}

export function accumulateRunEvent(accumulator: RunEventAccumulator, event: RunEvent, options: AccumulateRunEventOptions = {}): void {
  switch (event.type) {
    case "session":
      accumulator.sessionId = event.id;
      break;
    case "start":
      accumulator.started = true;
      break;
    case "reasoning": {
      accumulator.started = true;
      accumulator.hasReasoning = true;
      const last = accumulator.timeline[accumulator.timeline.length - 1];
      if (last?.kind === "reasoning") {
        last.text += event.text;
      } else {
        accumulator.timeline.push({ kind: "reasoning", text: event.text });
      }
      break;
    }
    case "text": {
      accumulator.started = true;
      accumulator.hasText = true;
      const last = accumulator.timeline[accumulator.timeline.length - 1];
      if (last?.kind === "text") {
        last.text += event.text;
      } else {
        accumulator.timeline.push({ kind: "text", text: event.text });
      }
      break;
    }
    case "tool": {
      accumulator.started = true;
      const existing = accumulator.tools.find((tool) => tool.id === event.id);
      if (existing) {
        existing.name = event.name;
        existing.summary = event.summary;
        existing.args = event.args;
      } else {
        const tool: StreamingTool = { id: event.id, name: event.name, summary: event.summary, args: event.args, state: "running" };
        accumulator.tools.push(tool);
        accumulator.timeline.push({ kind: "tool", tool });
      }
      break;
    }
    case "tool_result": {
      accumulator.started = true;
      const tool = accumulator.tools.find((item) => item.id === event.id);
      if (tool) {
        tool.state = event.ok ? "ok" : "error";
        tool.output = options.formatToolOutput?.(event.output) ?? event.output;
      }
      break;
    }
    case "diff": {
      accumulator.started = true;
      const block: DiffBlock = { kind: "diff", file: event.file, additions: event.additions, deletions: event.deletions, lines: event.lines };
      const existingIndex = accumulator.diffs.findIndex((item) => item.file === event.file);
      if (existingIndex >= 0) {
        accumulator.diffs[existingIndex] = block;
      } else {
        accumulator.diffs.push(block);
      }
      break;
    }
    case "plan":
      accumulator.started = true;
      accumulator.plans.splice(0, accumulator.plans.length, { id: event.id, steps: event.steps });
      break;
    case "code": {
      accumulator.started = true;
      const data: CodeBlockData = { kind: "code", language: event.language, code: event.code };
      accumulator.codes.push(data);
      accumulator.timeline.push({ kind: "code", data });
      break;
    }
    case "search": {
      accumulator.started = true;
      const existing = event.id ? accumulator.searches.find((item) => item.id === event.id) : accumulator.searches.find((item) => item.query === event.query);
      if (existing) {
        existing.query = event.query;
        existing.state = event.state;
        existing.results = event.results ?? existing.results;
      } else {
        const search: StreamingSearch = { id: event.id, query: event.query, state: event.state, results: event.results ?? [] };
        accumulator.searches.push(search);
        accumulator.timeline.push({ kind: "search", search });
      }
      break;
    }
    case "suggested":
      accumulator.started = true;
      accumulator.suggested.push({ kind: "suggested", actions: event.actions });
      break;
    case "approval":
      accumulator.started = true;
      accumulator.approvals.push({ id: event.id, title: event.title, detail: event.detail });
      break;
    case "options": {
      accumulator.started = true;
      const existing = accumulator.options.find((item) => item.id === event.id);
      if (existing) {
        existing.prompt = event.prompt;
        existing.multi = event.multi;
        existing.options = event.options;
        if (event.selected !== undefined) {
          existing.selected = [...event.selected];
        }
      } else {
        accumulator.options.push({ id: event.id, prompt: event.prompt, multi: event.multi, options: event.options, ...(event.selected === undefined ? {} : { selected: [...event.selected] }) });
      }
      break;
    }
    case "status":
      accumulator.started = true;
      if (event.level === "ok" || event.level === "warn" || event.level === "error") {
        accumulator.statuses.push({ level: event.level, text: event.text });
      }
      break;
    case "error":
      accumulator.started = true;
      accumulator.statuses.push({ level: "error", text: event.text });
      break;
    case "done":
      accumulator.costUsd = event.costUsd;
      accumulator.usage = event.usage;
      break;
    case "wakeup":
    case "cancel_wakeup":
    case "goal":
      break;
  }
}

export function applyRunEventOptionSelection(
  accumulator: RunEventAccumulator,
  selection: { readonly id: string; readonly selected: readonly string[] },
): boolean {
  const option = accumulator.options.find((item) => item.id === selection.id);
  if (!option) {
    return false;
  }
  option.selected = [...selection.selected];
  return true;
}

export function runEventBlocks(accumulator: RunEventAccumulator, options: RunEventBlocksOptions = {}): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  const timeline = accumulator.timeline;
  const firstReasoningIdx = timeline.findIndex((item) => item.kind === "reasoning");
  let lastReasoningIdx = -1;
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    if (timeline[i].kind === "reasoning") {
      lastReasoningIdx = i;
      break;
    }
  }
  const duration = `${Math.max(1, Math.round(((options.nowMs ?? Date.now()) - accumulator.startMs) / 1000))}s`;
  let lastNonTextIdx = -1;
  let lastTextIdx = -1;
  timeline.forEach((item, idx) => {
    if (item.kind === "text") {
      lastTextIdx = idx;
    } else {
      lastNonTextIdx = idx;
    }
  });
  timeline.forEach((item, idx) => {
    if (item.kind === "reasoning") {
      const active = !accumulator.done && idx === lastReasoningIdx;
      blocks.push({ kind: "reasoning", text: item.text, active, duration: accumulator.done && idx === firstReasoningIdx ? duration : undefined, ...(active ? { startedAtMs: accumulator.startMs } : {}) });
    } else if (item.kind === "text") {
      blocks.push({ kind: "text", text: item.text, streaming: !accumulator.done && idx === lastTextIdx, result: accumulator.done && idx > lastNonTextIdx });
    } else if (item.kind === "search") {
      const search = item.search;
      blocks.push({ kind: "search", query: search.query, state: search.state, results: search.results });
    } else if (item.kind === "code") {
      blocks.push(item.data);
    } else {
      const tool = item.tool;
      blocks.push(toolToDiffBlock(tool) ?? { kind: "tool", name: tool.name, summary: tool.summary, args: tool.args, state: tool.state, output: tool.output });
    }
  });
  if (timeline.length === 0 && accumulator.started && !accumulator.done) {
    blocks.push({ kind: "reasoning", text: "", active: true, startedAtMs: accumulator.startMs });
  }
  for (const plan of accumulator.plans) {
    blocks.push({ kind: "plan", steps: plan.steps });
  }
  blocks.push(...accumulator.diffs);
  blocks.push(...accumulator.suggested);
  for (const approval of accumulator.approvals) {
    blocks.push({ kind: "approval", id: approval.id, title: approval.title, detail: approval.detail });
  }
  for (const option of accumulator.options) {
    blocks.push({
      kind: "options",
      id: option.id,
      prompt: option.prompt,
      multi: option.multi,
      options: option.options,
      ...(option.selected === undefined ? {} : { selected: [...option.selected] }),
    });
  }
  for (const status of accumulator.statuses) {
    blocks.push({ kind: "status", level: status.level, text: status.text });
  }
  return blocks;
}

export function runEventAccumulatorHasOutput(accumulator: RunEventAccumulator): boolean {
  return (
    accumulator.hasText ||
    accumulator.hasReasoning ||
    accumulator.tools.length > 0 ||
    accumulator.diffs.length > 0 ||
    accumulator.plans.length > 0 ||
    accumulator.codes.length > 0 ||
    accumulator.searches.length > 0 ||
    accumulator.suggested.length > 0 ||
    accumulator.approvals.length > 0 ||
    accumulator.options.length > 0
  );
}

export function runEventAccumulatorNeedsInput(accumulator: RunEventAccumulator): boolean {
  return accumulator.approvals.length > 0 || accumulator.options.length > 0;
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
      if (typeof item !== "object" || item === null || Array.isArray(item) || typeof (item as { old_string?: unknown }).old_string !== "string" || typeof (item as { new_string?: unknown }).new_string !== "string") {
        return null;
      }
      lines.push(...editPairToLines((item as { old_string: string }).old_string, (item as { new_string: string }).new_string));
    }
    return lines;
  } catch {
    return null;
  }
}

function parseUnifiedDiffLines(value: string): DiffBlock["lines"] {
  return splitDiffLines(value)
    .filter((line) => !line.startsWith("diff --git ") && !line.startsWith("index ") && !line.startsWith("--- ") && !line.startsWith("+++ ") && !line.startsWith("@@"))
    .map((line) => {
      if (line.startsWith("+")) {
        return { type: "add" as const, text: line.slice(1) };
      }
      if (line.startsWith("-")) {
        return { type: "del" as const, text: line.slice(1) };
      }
      return { type: "ctx" as const, text: line.startsWith(" ") ? line.slice(1) : line };
    });
}

function normalizedToolName(name: string): string {
  return name
    .replace(/^mcp__[^_]+__/, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function firstString(input: Record<string, string> | undefined, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function diffBlockFromLines(file: string, lines: DiffBlock["lines"]): DiffBlock {
  return {
    kind: "diff",
    file,
    additions: lines.filter((line) => line.type === "add").length,
    deletions: lines.filter((line) => line.type === "del").length,
    lines,
  };
}

export function toolToDiffBlock(tool: StreamingTool): DiffBlock | null {
  if (tool.state === "error") {
    return null;
  }
  const args = tool.args;
  const file = firstString(args, ["file_path", "filePath", "path", "filename", "file"]);
  if (!file) {
    return null;
  }
  const normalizedName = normalizedToolName(tool.name);
  let lines: DiffBlock["lines"] | null = null;
  if ((normalizedName === "write" || normalizedName === "writefile" || normalizedName === "filewrite") && typeof args?.content === "string") {
    lines = splitDiffLines(args.content).map((text) => ({ type: "add", text }));
  } else if (
    (normalizedName === "edit" || normalizedName === "fileedit" || normalizedName === "replace") &&
    typeof args?.old_string === "string" &&
    typeof args?.new_string === "string"
  ) {
    lines = editPairToLines(args.old_string, args.new_string);
  } else if (normalizedName === "multiedit" && typeof args?.edits === "string") {
    lines = parseMultiEditLines(args.edits);
  } else if ((normalizedName === "applypatch" || normalizedName === "patch" || normalizedName === "fileedit") && typeof args?.diff === "string") {
    lines = parseUnifiedDiffLines(args.diff);
  }
  return lines ? diffBlockFromLines(file, lines) : null;
}
