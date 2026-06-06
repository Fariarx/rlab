import { type StatusKey } from "../../theme/tokens";

/**
 * Agent (coding-executor) model, ported in spirit from vibe-kanban: a fixed set
 * of agents, each with named variants. Runtime availability is loaded through
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
  /** Selectable profile variants (DEFAULT first). */
  readonly variants: readonly string[];
}

export const AGENTS: readonly AgentDef[] = [
  { id: "claude-code", name: "Claude Code", vendor: "Anthropic", cliBins: ["claude"], runAdapter: true, short: "CC", accent: "#D2A24C", variants: ["DEFAULT", "Plan", "Router"] },
  { id: "codex", name: "Codex", vendor: "OpenAI", cliBins: ["codex"], runAdapter: true, short: "CX", accent: "#10A37F", variants: ["DEFAULT", "GPT-5.5"] },
  { id: "gemini", name: "Gemini", vendor: "Google", cliBins: ["gemini"], runAdapter: true, short: "GM", accent: "#4C8DF6", variants: ["DEFAULT", "Flash", "Pro"] },
  { id: "amp", name: "AMP", vendor: "Sourcegraph", cliBins: ["amp"], runAdapter: false, short: "AM", accent: "#E5484D", variants: ["DEFAULT"] },
  { id: "opencode", name: "OpenCode", vendor: "OpenCode", cliBins: ["opencode"], runAdapter: true, short: "OC", accent: "#8B5CF6", variants: ["DEFAULT"] },
  { id: "cursor", name: "Cursor", vendor: "Anysphere", cliBins: ["cursor-agent", "cursor"], runAdapter: false, short: "CU", accent: "#9aa4ad", variants: ["DEFAULT"] },
  { id: "qwen", name: "Qwen", vendor: "Alibaba", cliBins: ["qwen", "qwen-code"], runAdapter: false, short: "QW", accent: "#7C3AED", variants: ["DEFAULT"] },
  { id: "copilot", name: "Copilot", vendor: "GitHub", cliBins: ["copilot"], runAdapter: false, short: "CP", accent: "#3FB950", variants: ["DEFAULT"] },
  { id: "droid", name: "Droid", vendor: "Factory", cliBins: ["droid"], runAdapter: false, short: "DR", accent: "#22A6B3", variants: ["DEFAULT"] },
];

export const AGENTS_BY_ID: Record<AgentId, AgentDef> = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<
  AgentId,
  AgentDef
>;

export function getAgent(id: AgentId): AgentDef {
  return AGENTS_BY_ID[id];
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
  readonly variant: string;
}

export const DEFAULT_PROFILE: AgentProfile = { agent: "claude-code", variant: "DEFAULT" };

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
