import { type StatusKey } from "../../theme/tokens";

/**
 * Agent (coding-executor) model. Runtime availability is loaded through
 * `/api/agents`; `AGENT_STATUS` is only the initial static baseline while that
 * endpoint is pending.
 */
export type AgentId =
  | "claude-code"
  | "codex"
  | "gemini"
  | "amp"
  | "opencode"
  | "cursor"
  | "qwen"
  | "copilot"
  | "droid";

export type AgentSystemStatus = "available" | "running" | "needs-setup" | "unavailable" | "unsupported";
export type AgentWorkMode = "default" | "plan";

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
const DEFAULT_MODE_OPTIONS = [DEFAULT_OPTION] as const;
const CLAUDE_MODE_OPTIONS = [DEFAULT_OPTION, { id: "plan", label: "Plan", value: "plan" }] as const;
const CLAUDE_REASONING_OPTIONS = [
  DEFAULT_OPTION,
  { id: "low", label: "Low", value: "low" },
  { id: "medium", label: "Medium", value: "medium" },
  { id: "high", label: "High", value: "high" },
  { id: "xhigh", label: "Extra High", value: "xhigh" },
  { id: "max", label: "Max", value: "max" },
] as const;
const CODEX_REASONING_OPTIONS = [
  DEFAULT_OPTION,
  { id: "low", label: "Low", value: "low" },
  { id: "medium", label: "Medium", value: "medium" },
  { id: "high", label: "High", value: "high" },
  { id: "xhigh", label: "Extra High", value: "xhigh" },
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
    models: [DEFAULT_OPTION, { id: "sonnet", label: "Sonnet", value: "sonnet" }, { id: "opus", label: "Opus", value: "opus" }],
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
    modes: DEFAULT_MODE_OPTIONS,
  },
  {
    id: "gemini",
    name: "Gemini",
    vendor: "Google",
    cliBins: ["gemini"],
    runAdapter: true,
    short: "GM",
    accent: "#4C8DF6",
    models: [
      DEFAULT_OPTION,
      { id: "flash", label: "Flash", value: "gemini-2.5-flash" },
      { id: "pro", label: "Pro", value: "gemini-2.5-pro" },
    ],
    reasoning: DEFAULT_ONLY,
    modes: DEFAULT_MODE_OPTIONS,
  },
  { id: "amp", name: "AMP", vendor: "Sourcegraph", cliBins: ["amp"], runAdapter: false, short: "AM", accent: "#E5484D", models: DEFAULT_ONLY, reasoning: DEFAULT_ONLY, modes: DEFAULT_MODE_OPTIONS },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "OpenCode",
    cliBins: ["opencode"],
    runAdapter: true,
    short: "OC",
    accent: "#8B5CF6",
    models: [{ id: DEFAULT_AGENT_OPTION_ID, label: "Default", value: "opencode/deepseek-v4-flash-free" }],
    reasoning: CLAUDE_REASONING_OPTIONS,
    modes: DEFAULT_MODE_OPTIONS,
  },
  { id: "cursor", name: "Cursor", vendor: "Anysphere", cliBins: ["cursor-agent", "cursor"], runAdapter: false, short: "CU", accent: "#9aa4ad", models: DEFAULT_ONLY, reasoning: DEFAULT_ONLY, modes: DEFAULT_MODE_OPTIONS },
  { id: "qwen", name: "Qwen", vendor: "Alibaba", cliBins: ["qwen", "qwen-code"], runAdapter: false, short: "QW", accent: "#7C3AED", models: DEFAULT_ONLY, reasoning: DEFAULT_ONLY, modes: DEFAULT_MODE_OPTIONS },
  { id: "copilot", name: "Copilot", vendor: "GitHub", cliBins: ["copilot"], runAdapter: false, short: "CP", accent: "#3FB950", models: DEFAULT_ONLY, reasoning: DEFAULT_ONLY, modes: DEFAULT_MODE_OPTIONS },
  { id: "droid", name: "Droid", vendor: "Factory", cliBins: ["droid"], runAdapter: false, short: "DR", accent: "#22A6B3", models: DEFAULT_ONLY, reasoning: DEFAULT_ONLY, modes: DEFAULT_MODE_OPTIONS },
];

export const AGENTS_BY_ID: Record<AgentId, AgentDef> = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<
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
  amp: "unsupported",
  copilot: "unsupported",
  cursor: "unsupported",
  qwen: "unsupported",
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
  return value === "default" || value === "plan";
}

function hasOption(options: readonly AgentOption[], id: string): boolean {
  return options.some((option) => option.id === id);
}

function normalizeOptionId(options: readonly AgentOption[], id: string): string {
  return hasOption(options, id) ? id : DEFAULT_AGENT_OPTION_ID;
}

export function defaultProfileForAgent(agent: AgentId): AgentProfile {
  return { agent, model: DEFAULT_AGENT_OPTION_ID, reasoning: DEFAULT_AGENT_OPTION_ID, mode: "default" };
}

export function normalizeAgentProfile(value: unknown, fallbackAgent: AgentId = DEFAULT_PROFILE.agent): AgentProfile {
  if (!isRecord(value)) {
    return defaultProfileForAgent(fallbackAgent);
  }
  const agent = isAgentId(value.agent) ? value.agent : fallbackAgent;
  if (typeof value.variant === "string") {
    return legacyProfileFromVariant(agent, value.variant);
  }
  const def = getAgent(agent);
  return {
    agent,
    model: typeof value.model === "string" ? normalizeOptionId(def.models, value.model) : DEFAULT_AGENT_OPTION_ID,
    reasoning: typeof value.reasoning === "string" ? normalizeOptionId(def.reasoning, value.reasoning) : DEFAULT_AGENT_OPTION_ID,
    mode: isAgentWorkMode(value.mode) && hasOption(def.modes, value.mode) ? value.mode : "default",
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
    return { ...base, model: "flash" };
  }
  if (agent === "gemini" && variant === "Pro") {
    return { ...base, model: "pro" };
  }
  return base;
}

export function agentProfileEquals(a: AgentProfile, b: AgentProfile): boolean {
  return a.agent === b.agent && a.model === b.model && a.reasoning === b.reasoning && a.mode === b.mode;
}

function optionLabel(options: readonly AgentOption[], id: string): string | null {
  return options.find((option) => option.id === id)?.label ?? null;
}

export function agentProfileLabels(profile: AgentProfile): readonly string[] {
  const def = getAgent(profile.agent);
  const labels: string[] = [];
  if (profile.model !== DEFAULT_AGENT_OPTION_ID) {
    const label = optionLabel(def.models, profile.model);
    if (label) {
      labels.push(label);
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

export const agentStatusKey: Record<AgentSystemStatus, StatusKey> = {
  available: "ok",
  running: "running",
  "needs-setup": "warn",
  unavailable: "idle",
  unsupported: "warn",
};

export const agentStatusLabel: Record<AgentSystemStatus, string> = {
  available: "Available",
  running: "Running",
  "needs-setup": "Needs setup",
  unavailable: "Not installed",
  unsupported: "Adapter missing",
};

/** Convert a #rrggbb hex to an rgba() string at the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
