export type RlabChatToolId = "AskUserQuestion" | "TaskAwaiter" | "TaskTracker" | "TaskGoal" | "BrowserPreview";

export interface RlabChatToolDef {
  readonly id: RlabChatToolId;
  readonly token: `$${RlabChatToolId}`;
}

export const RLAB_CHAT_TOOLS: readonly RlabChatToolDef[] = [
  { id: "AskUserQuestion", token: "$AskUserQuestion" },
  { id: "TaskAwaiter", token: "$TaskAwaiter" },
  { id: "TaskTracker", token: "$TaskTracker" },
  { id: "TaskGoal", token: "$TaskGoal" },
  { id: "BrowserPreview", token: "$BrowserPreview" },
];

export const RLAB_CHAT_TOOL_IDS: readonly RlabChatToolId[] = RLAB_CHAT_TOOLS.map((tool) => tool.id);
export const DEFAULT_RLAB_CHAT_TOOL_IDS: readonly RlabChatToolId[] = ["AskUserQuestion", "TaskAwaiter", "TaskTracker", "TaskGoal"];

const RLAB_CHAT_TOOL_ID_SET = new Set<string>(RLAB_CHAT_TOOL_IDS);
const LEGACY_RLAB_CHAT_TOOL_IDS: Readonly<Record<string, RlabChatToolId>> = {
  TaskWakeup: "TaskAwaiter",
};

function normalizeRlabChatToolId(value: unknown): RlabChatToolId | null {
  if (typeof value !== "string") {
    return null;
  }
  if (RLAB_CHAT_TOOL_ID_SET.has(value)) {
    return value as RlabChatToolId;
  }
  return LEGACY_RLAB_CHAT_TOOL_IDS[value] ?? null;
}

export function isRlabChatToolId(value: unknown): value is RlabChatToolId {
  return typeof value === "string" && RLAB_CHAT_TOOL_ID_SET.has(value);
}

export function activeRlabChatToolIds(value: unknown): readonly RlabChatToolId[] {
  if (!Array.isArray(value)) {
    return DEFAULT_RLAB_CHAT_TOOL_IDS;
  }
  const seen = new Set<RlabChatToolId>();
  for (const item of value) {
    const normalized = normalizeRlabChatToolId(item);
    if (normalized) {
      seen.add(normalized);
    }
  }
  return RLAB_CHAT_TOOL_IDS.filter((id) => seen.has(id));
}

export function persistedRlabChatToolIds(value: unknown): readonly RlabChatToolId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const active = activeRlabChatToolIds(value);
  return active.length === DEFAULT_RLAB_CHAT_TOOL_IDS.length && active.every((id, index) => id === DEFAULT_RLAB_CHAT_TOOL_IDS[index]) ? undefined : active;
}

export function rlabChatToolEnabled(value: unknown, id: unknown): boolean {
  const normalized = normalizeRlabChatToolId(id);
  return normalized !== null && activeRlabChatToolIds(value).includes(normalized);
}
