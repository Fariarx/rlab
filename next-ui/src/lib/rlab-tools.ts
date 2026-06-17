export type RlabChatToolId = "AskUserQuestion" | "TaskWakeup" | "BrowserPreview";

export interface RlabChatToolDef {
  readonly id: RlabChatToolId;
  readonly token: `$${RlabChatToolId}`;
}

export const RLAB_CHAT_TOOLS: readonly RlabChatToolDef[] = [
  { id: "AskUserQuestion", token: "$AskUserQuestion" },
  { id: "TaskWakeup", token: "$TaskWakeup" },
  { id: "BrowserPreview", token: "$BrowserPreview" },
];

export const RLAB_CHAT_TOOL_IDS: readonly RlabChatToolId[] = RLAB_CHAT_TOOLS.map((tool) => tool.id);

const RLAB_CHAT_TOOL_ID_SET = new Set<string>(RLAB_CHAT_TOOL_IDS);

export function isRlabChatToolId(value: unknown): value is RlabChatToolId {
  return typeof value === "string" && RLAB_CHAT_TOOL_ID_SET.has(value);
}

export function activeRlabChatToolIds(value: unknown): readonly RlabChatToolId[] {
  if (!Array.isArray(value)) {
    return RLAB_CHAT_TOOL_IDS;
  }
  const seen = new Set<RlabChatToolId>();
  for (const item of value) {
    if (isRlabChatToolId(item)) {
      seen.add(item);
    }
  }
  return RLAB_CHAT_TOOL_IDS.filter((id) => seen.has(id));
}

export function persistedRlabChatToolIds(value: unknown): readonly RlabChatToolId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const active = activeRlabChatToolIds(value);
  return active.length === RLAB_CHAT_TOOL_IDS.length ? undefined : active;
}

export function rlabChatToolEnabled(value: unknown, id: unknown): boolean {
  return isRlabChatToolId(id) && activeRlabChatToolIds(value).includes(id);
}
