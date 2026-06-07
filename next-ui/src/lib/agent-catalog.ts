/**
 * Shared agent catalog. Keep UI labels, persisted profile ids, and CLI values
 * here so the picker and /api/run cannot drift.
 */
export type AgentId =
  | "claude-code"
  | "codex"
  | "gemini"
  | "opencode"
  | "amp"
  | "cursor"
  | "qwen"
  | "copilot"
  | "droid";

export type AgentSystemStatus = "available" | "running" | "needs-setup" | "unavailable" | "unsupported";
export const KNOWN_AGENT_WORK_MODE_IDS = [
  "default",
  "plan",
  "auto-edit",
  "auto",
  "bypass-permissions",
  "review",
  "build",
  "explore",
  "general",
  "summary",
] as const;
export type KnownAgentWorkMode = (typeof KNOWN_AGENT_WORK_MODE_IDS)[number];
export type AgentWorkMode = KnownAgentWorkMode | (string & {});

export interface AgentOption {
  readonly id: string;
  readonly label: string;
  readonly value?: string;
}

export interface AgentDef {
  readonly id: AgentId;
  readonly name: string;
  readonly vendor: string;
  /** CLI executables checked on PATH, in priority order. */
  readonly cliBins: readonly string[];
  /** Whether this UI can run the agent through /api/run. */
  readonly runAdapter: boolean;
  /** Two-letter monogram for the avatar. */
  readonly short: string;
  /** Brand-ish accent used for the agent's identity. */
  readonly accent: string;
  /** Selectable model aliases/IDs (default first). */
  readonly models: readonly AgentOption[];
  /** Selectable reasoning effort levels supported by the adapter (default first). */
  readonly reasoning: readonly AgentOption[];
  /** Chat work modes (default first); this is not a model or reasoning setting. */
  readonly modes: readonly AgentOption[];
}

export const DEFAULT_AGENT_OPTION_ID = "default";

const DEFAULT_OPTION: AgentOption = { id: DEFAULT_AGENT_OPTION_ID, label: "Default" };
const DEFAULT_ONLY = [DEFAULT_OPTION] as const;
export const CLAUDE_AGENT_MODE_PREFIX = "claude-agent:";
// Permission-level modes (Auto, Bypass Permissions) are intentionally omitted —
// filesystem access is governed by the next-ui access mode (read-only vs
// unrestricted), not a per-message work mode.
const CLAUDE_MODE_OPTIONS = [
  DEFAULT_OPTION,
  { id: "plan", label: "Plan", value: "plan" },
  { id: "auto-edit", label: "Auto Edit", value: "acceptEdits" },
] as const;
const CODEX_MODE_OPTIONS = [DEFAULT_OPTION, { id: "plan", label: "Plan", value: "plan" }, { id: "review", label: "Review", value: "review" }] as const;
// Permission-level modes (Auto Edit, YOLO) are omitted — filesystem access is
// governed by the next-ui access mode (read-only vs unrestricted).
const GEMINI_MODE_OPTIONS = [
  DEFAULT_OPTION,
  { id: "plan", label: "Plan", value: "plan" },
] as const;
const OPENCODE_MODE_OPTIONS = [
  DEFAULT_OPTION,
  { id: "build", label: "Build", value: "build" },
  { id: "plan", label: "Plan", value: "plan" },
  { id: "explore", label: "Explore", value: "explore" },
  { id: "general", label: "General", value: "general" },
  { id: "summary", label: "Summary", value: "summary" },
] as const;
const OPENCODE_INTERNAL_AGENT_IDS = new Set(["title", "compaction"]);
const CLAUDE_INTERNAL_AGENT_IDS = new Set(["statusline-setup"]);
const CLAUDE_REASONING_OPTIONS = [
  DEFAULT_OPTION,
  { id: "low", label: "Low", value: "low" },
  { id: "medium", label: "Medium", value: "medium" },
  { id: "high", label: "High", value: "high" },
  { id: "xhigh", label: "Extra High", value: "xhigh" },
  { id: "max", label: "Max", value: "max" },
] as const;
const CLAUDE_MODEL_OPTIONS = [
  DEFAULT_OPTION,
  { id: "claude-opus-4-8", label: "Opus 4.8", value: "claude-opus-4-8" },
  { id: "claude-opus-4-7", label: "Opus 4.7", value: "claude-opus-4-7" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", value: "claude-sonnet-4-6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", value: "claude-haiku-4-5-20251001" },
  { id: "opus", label: "Opus alias", value: "opus" },
  { id: "sonnet", label: "Sonnet alias", value: "sonnet" },
] as const;
const CODEX_REASONING_OPTIONS = [
  DEFAULT_OPTION,
  { id: "low", label: "Low", value: "low" },
  { id: "medium", label: "Medium", value: "medium" },
  { id: "high", label: "High", value: "high" },
  { id: "xhigh", label: "Extra High", value: "xhigh" },
] as const;
const GEMINI_MODEL_OPTIONS = [
  DEFAULT_OPTION,
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview", value: "gemini-3-pro-preview" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", value: "gemini-3-flash-preview" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", value: "gemini-2.5-flash-lite" },
  { id: "gemini-2.5-flash-preview-09-2025", label: "Gemini 2.5 Flash Preview 09-2025", value: "gemini-2.5-flash-preview-09-2025" },
  {
    id: "gemini-2.5-flash-lite-preview-09-2025",
    label: "Gemini 2.5 Flash-Lite Preview 09-2025",
    value: "gemini-2.5-flash-lite-preview-09-2025",
  },
] as const;
const OPENCODE_MODEL_OPTIONS = [
  { id: DEFAULT_AGENT_OPTION_ID, label: "Default", value: "opencode/deepseek-v4-flash-free" },
  { id: "opencode-big-pickle", label: "OpenCode Big Pickle", value: "opencode/big-pickle" },
  { id: "opencode-mimo-v2.5-free", label: "Mimo v2.5 Free", value: "opencode/mimo-v2.5-free" },
  { id: "opencode-minimax-m3-free", label: "MiniMax M3 Free", value: "opencode/minimax-m3-free" },
  { id: "opencode-nemotron-3-ultra-free", label: "Nemotron 3 Ultra Free", value: "opencode/nemotron-3-ultra-free" },
  { id: "anthropic-claude-opus-4-8", label: "Claude Opus 4.8", value: "anthropic/claude-opus-4-8" },
  { id: "anthropic-claude-opus-4-8-fast", label: "Claude Opus 4.8 Fast", value: "anthropic/claude-opus-4-8-fast" },
  { id: "anthropic-claude-opus-4-7", label: "Claude Opus 4.7", value: "anthropic/claude-opus-4-7" },
  { id: "anthropic-claude-opus-4-7-fast", label: "Claude Opus 4.7 Fast", value: "anthropic/claude-opus-4-7-fast" },
  { id: "anthropic-claude-opus-4-6", label: "Claude Opus 4.6", value: "anthropic/claude-opus-4-6" },
  { id: "anthropic-claude-opus-4-6-fast", label: "Claude Opus 4.6 Fast", value: "anthropic/claude-opus-4-6-fast" },
  { id: "anthropic-claude-opus-4-5", label: "Claude Opus 4.5", value: "anthropic/claude-opus-4-5" },
  { id: "anthropic-claude-sonnet-4-6", label: "Claude Sonnet 4.6", value: "anthropic/claude-sonnet-4-6" },
  { id: "anthropic-claude-sonnet-4-5", label: "Claude Sonnet 4.5", value: "anthropic/claude-sonnet-4-5" },
  { id: "anthropic-claude-haiku-4-5", label: "Claude Haiku 4.5", value: "anthropic/claude-haiku-4-5" },
  { id: "lmstudio-openai-gpt-oss-20b", label: "LM Studio GPT-OSS 20B", value: "lmstudio/openai/gpt-oss-20b" },
  { id: "lmstudio-qwen3-30b-a3b-2507", label: "LM Studio Qwen3 30B A3B", value: "lmstudio/qwen/qwen3-30b-a3b-2507" },
  { id: "lmstudio-qwen3-coder-30b", label: "LM Studio Qwen3 Coder 30B", value: "lmstudio/qwen/qwen3-coder-30b" },
] as const;
const QWEN_MODEL_OPTIONS = [
  DEFAULT_OPTION,
  { id: "qwen3.6-plus", label: "Qwen3.6 Plus", value: "qwen3.6-plus" },
  { id: "qwen3.5-plus", label: "Qwen3.5 Plus", value: "qwen3.5-plus" },
  { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus", value: "qwen3-coder-plus" },
] as const;
const CURSOR_MODEL_OPTIONS = [
  DEFAULT_OPTION,
  { id: "gpt-5", label: "GPT-5", value: "gpt-5" },
] as const;

export const AGENTS: readonly AgentDef[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    vendor: "Anthropic",
    cliBins: ["claude"],
    runAdapter: true,
    short: "CC",
    accent: "#D2A24C",
    models: CLAUDE_MODEL_OPTIONS,
    reasoning: CLAUDE_REASONING_OPTIONS,
    modes: CLAUDE_MODE_OPTIONS,
  },
  {
    id: "codex",
    name: "Codex",
    vendor: "OpenAI",
    cliBins: ["codex"],
    runAdapter: true,
    short: "CX",
    accent: "#10A37F",
    models: [
      DEFAULT_OPTION,
      { id: "gpt-5.5", label: "GPT-5.5", value: "gpt-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4", value: "gpt-5.4" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
      { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark", value: "gpt-5.3-codex-spark" },
    ],
    reasoning: CODEX_REASONING_OPTIONS,
    modes: CODEX_MODE_OPTIONS,
  },
  {
    id: "gemini",
    name: "Gemini",
    vendor: "Google",
    cliBins: ["gemini"],
    runAdapter: true,
    short: "GM",
    accent: "#4C8DF6",
    models: GEMINI_MODEL_OPTIONS,
    reasoning: DEFAULT_ONLY,
    modes: GEMINI_MODE_OPTIONS,
  },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "OpenCode",
    cliBins: ["opencode"],
    runAdapter: true,
    short: "OC",
    accent: "#8B5CF6",
    models: OPENCODE_MODEL_OPTIONS,
    reasoning: CLAUDE_REASONING_OPTIONS,
    modes: OPENCODE_MODE_OPTIONS,
  },
];

export const AGENTS_BY_ID: Record<AgentId, AgentDef> = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent])) as Record<
  AgentId,
  AgentDef
>;

export function getAgent(id: AgentId): AgentDef {
  return AGENTS_BY_ID[id];
}

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && value in AGENTS_BY_ID;
}

/** Initial status baseline before runtime executor discovery returns. */
export const AGENT_STATUS: Record<AgentId, AgentSystemStatus> = {
  "claude-code": "available",
  codex: "available",
  gemini: "available",
  opencode: "unavailable",
  amp: "unavailable",
  copilot: "unsupported",
  cursor: "unavailable",
  qwen: "unavailable",
  droid: "unsupported",
};

export function getAgentStatus(id: AgentId): AgentSystemStatus {
  return AGENT_STATUS[id];
}

export interface AgentCliInfo {
  readonly status: AgentSystemStatus;
  readonly bins: readonly string[];
  readonly resolvedBin: string | null;
  readonly runAdapter: boolean;
  readonly selectable: boolean;
  readonly env: readonly string[];
  readonly installCommand: string | null;
  readonly models?: readonly AgentOption[];
  readonly reasoning?: readonly AgentOption[];
  readonly modes?: readonly AgentOption[];
}

export type AgentCliMap = Partial<Record<AgentId, AgentCliInfo>>;

export const STATIC_AGENT_CLI_INFO: Record<AgentId, AgentCliInfo> = Object.fromEntries(
  AGENTS.map((agent) => {
    const status = AGENT_STATUS[agent.id];
    return [
      agent.id,
      {
        status,
        bins: agent.cliBins,
        resolvedBin: null,
        runAdapter: agent.runAdapter,
        selectable: status !== "unavailable" && status !== "unsupported",
        env: [],
        installCommand: null,
      },
    ];
  }),
) as unknown as Record<AgentId, AgentCliInfo>;

export interface AgentProfile {
  readonly agent: AgentId;
  readonly model: string;
  readonly reasoning: string;
  readonly mode: AgentWorkMode;
}

export const DEFAULT_PROFILE: AgentProfile = { agent: "claude-code", model: DEFAULT_AGENT_OPTION_ID, reasoning: DEFAULT_AGENT_OPTION_ID, mode: "default" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentWorkMode(value: unknown): value is AgentWorkMode {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOption(options: readonly AgentOption[], id: string): boolean {
  return options.some((option) => option.id === id);
}

export function isDirectAgentModelValue(agent: AgentId, value: string): boolean {
  if (value === DEFAULT_AGENT_OPTION_ID) {
    return true;
  }
  switch (agent) {
    case "claude-code":
      return /^(?:claude-[A-Za-z0-9._-]+|opus|sonnet|haiku)$/.test(value);
    case "codex":
      return /^(?:gpt|codex)-[A-Za-z0-9._-]+$/.test(value);
    case "gemini":
      return /^gemini-[A-Za-z0-9._-]+$/.test(value);
    case "opencode":
      return /^[a-z0-9][a-z0-9.-]*(?:\/[A-Za-z0-9._-]+)+$/.test(value);
    case "qwen":
      return /^(?:qwen|glm|kimi)-[A-Za-z0-9._-]+$/.test(value);
    case "cursor":
      return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value);
    default:
      return false;
  }
}

export function isDirectAgentModeValue(agent: AgentId, value: string): boolean {
  if (value === DEFAULT_AGENT_OPTION_ID) {
    return true;
  }
  if (agent === "claude-code") {
    return claudeAgentNameFromMode(value) !== null;
  }
  if (agent === "opencode") {
    return !OPENCODE_INTERNAL_AGENT_IDS.has(value) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
  }
  return false;
}

export function claudeAgentModeId(agentName: string): string {
  return `${CLAUDE_AGENT_MODE_PREFIX}${agentName}`;
}

export function claudeAgentNameFromMode(value: string): string | null {
  if (!value.startsWith(CLAUDE_AGENT_MODE_PREFIX)) {
    return null;
  }
  const agentName = value.slice(CLAUDE_AGENT_MODE_PREFIX.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(agentName) || CLAUDE_INTERNAL_AGENT_IDS.has(agentName)) {
    return null;
  }
  return agentName;
}

function normalizeOptionId(agent: AgentId, kind: "models" | "reasoning", options: readonly AgentOption[], id: string): string {
  if (hasOption(options, id)) {
    return id;
  }
  if (kind === "models" && isDirectAgentModelValue(agent, id)) {
    return id;
  }
  return DEFAULT_AGENT_OPTION_ID;
}

function normalizeModeId(agent: AgentId, options: readonly AgentOption[], id: string): AgentWorkMode {
  if (hasOption(options, id) || isDirectAgentModeValue(agent, id)) {
    return id;
  }
  return DEFAULT_AGENT_OPTION_ID;
}

export function defaultProfileForAgent(agent: AgentId): AgentProfile {
  return { agent, model: DEFAULT_AGENT_OPTION_ID, reasoning: DEFAULT_AGENT_OPTION_ID, mode: "default" };
}

export function normalizeAgentProfile(value: unknown, fallbackAgent: AgentId = DEFAULT_PROFILE.agent): AgentProfile {
  const activeFallbackAgent = isAgentId(fallbackAgent) ? fallbackAgent : DEFAULT_PROFILE.agent;
  if (!isRecord(value)) {
    return defaultProfileForAgent(activeFallbackAgent);
  }
  const agent = isAgentId(value.agent) ? value.agent : activeFallbackAgent;
  if (typeof value.variant === "string") {
    return legacyProfileFromVariant(agent, value.variant);
  }
  const def = getAgent(agent);
  return {
    agent,
    model: typeof value.model === "string" ? normalizeOptionId(agent, "models", def.models, value.model) : DEFAULT_AGENT_OPTION_ID,
    reasoning: typeof value.reasoning === "string" ? normalizeOptionId(agent, "reasoning", def.reasoning, value.reasoning) : DEFAULT_AGENT_OPTION_ID,
    mode: isAgentWorkMode(value.mode) ? normalizeModeId(agent, def.modes, value.mode.trim()) : DEFAULT_AGENT_OPTION_ID,
  };
}

export function legacyProfileFromVariant(agent: AgentId, variant: string): AgentProfile {
  const base = defaultProfileForAgent(agent);
  if (agent === "claude-code" && variant === "Plan") {
    return { ...base, mode: "plan" };
  }
  if (agent === "codex" && (variant === "GPT-5" || variant === "GPT-5.5")) {
    return { ...base, model: "gpt-5.5" };
  }
  if (agent === "gemini" && variant === "Flash") {
    return { ...base, model: "gemini-2.5-flash" };
  }
  if (agent === "gemini" && variant === "Pro") {
    return { ...base, model: "gemini-2.5-pro" };
  }
  return base;
}

export function agentProfileEquals(a: AgentProfile, b: AgentProfile): boolean {
  return a.agent === b.agent && a.model === b.model && a.reasoning === b.reasoning && a.mode === b.mode;
}

function optionLabel(options: readonly AgentOption[], id: string): string | null {
  return options.find((option) => option.id === id)?.label ?? null;
}

export function resolveAgentOptionValue(agent: AgentId, kind: "models" | "reasoning", id: string): string | undefined {
  return getAgent(agent)[kind].find((option) => option.id === id)?.value;
}

export function resolveAgentModelValue(agent: AgentId, id: string): string | undefined {
  return resolveAgentOptionValue(agent, "models", id);
}

export function resolveAgentReasoningValue(agent: AgentId, id: string): string | undefined {
  return resolveAgentOptionValue(agent, "reasoning", id);
}

export function resolveAgentModeValue(agent: AgentId, id: string): string | undefined {
  return getAgent(agent).modes.find((option) => option.id === id)?.value;
}

export function agentProfileLabels(profile: AgentProfile): readonly string[] {
  const def = getAgent(profile.agent);
  const labels: string[] = [];
  if (profile.model !== DEFAULT_AGENT_OPTION_ID) {
    const label = optionLabel(def.models, profile.model);
    if (label) {
      labels.push(label);
    } else if (isDirectAgentModelValue(profile.agent, profile.model)) {
      labels.push(profile.model);
    }
  }
  if (profile.reasoning !== DEFAULT_AGENT_OPTION_ID) {
    const label = optionLabel(def.reasoning, profile.reasoning);
    if (label) {
      labels.push(label);
    }
  }
  // Work mode is surfaced as a removable chat tag (not in the agent badge).
  return labels;
}
