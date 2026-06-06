import { type StatusKey } from "../../theme/tokens";

/**
 * Agent (coding-executor) model, ported in spirit from vibe-kanban: a fixed set
 * of agents, each with named variants, plus the agent's status in the system.
 * No backend here — `AGENT_STATUS` is a demo registry standing in for the real
 * executor discovery (installed / configured / running).
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

export type AgentSystemStatus = "available" | "running" | "needs-setup" | "unavailable";

export interface AgentDef {
  readonly id: AgentId;
  readonly name: string;
  readonly vendor: string;
  /** Two-letter monogram for the avatar. */
  readonly short: string;
  /** Brand-ish accent used for the agent's identity. */
  readonly accent: string;
  /** Selectable profile variants (DEFAULT first). */
  readonly variants: readonly string[];
}

export const AGENTS: readonly AgentDef[] = [
  { id: "claude-code", name: "Claude Code", vendor: "Anthropic", short: "CC", accent: "#D2A24C", variants: ["DEFAULT", "Plan", "Router"] },
  { id: "codex", name: "Codex", vendor: "OpenAI", short: "CX", accent: "#10A37F", variants: ["DEFAULT", "GPT-5"] },
  { id: "gemini", name: "Gemini", vendor: "Google", short: "GM", accent: "#4C8DF6", variants: ["DEFAULT", "Flash", "Pro"] },
  { id: "amp", name: "AMP", vendor: "Sourcegraph", short: "AM", accent: "#E5484D", variants: ["DEFAULT"] },
  { id: "opencode", name: "OpenCode", vendor: "OpenCode", short: "OC", accent: "#8B5CF6", variants: ["DEFAULT"] },
  { id: "cursor", name: "Cursor", vendor: "Anysphere", short: "CU", accent: "#9aa4ad", variants: ["DEFAULT"] },
  { id: "qwen", name: "Qwen", vendor: "Alibaba", short: "QW", accent: "#7C3AED", variants: ["DEFAULT"] },
  { id: "copilot", name: "Copilot", vendor: "GitHub", short: "CP", accent: "#3FB950", variants: ["DEFAULT"] },
  { id: "droid", name: "Droid", vendor: "Factory", short: "DR", accent: "#22A6B3", variants: ["DEFAULT"] },
];

export const AGENTS_BY_ID: Record<AgentId, AgentDef> = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<
  AgentId,
  AgentDef
>;

export function getAgent(id: AgentId): AgentDef {
  return AGENTS_BY_ID[id];
}

/** Demo stand-in for executor discovery. */
export const AGENT_STATUS: Record<AgentId, AgentSystemStatus> = {
  "claude-code": "available",
  codex: "available",
  amp: "available",
  copilot: "available",
  gemini: "needs-setup",
  cursor: "needs-setup",
  opencode: "unavailable",
  qwen: "unavailable",
  droid: "unavailable",
};

export function getAgentStatus(id: AgentId): AgentSystemStatus {
  return AGENT_STATUS[id];
}

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
};

export const agentStatusLabel: Record<AgentSystemStatus, string> = {
  available: "Available",
  running: "Running",
  "needs-setup": "Needs setup",
  unavailable: "Not installed",
};

/** Convert a #rrggbb hex to an rgba() string at the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
