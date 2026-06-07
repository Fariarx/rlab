import { type StatusKey } from "../../theme/tokens";
import { type AgentSystemStatus } from "../../lib/agent-catalog";

export {
  AGENTS,
  AGENTS_BY_ID,
  AGENT_STATUS,
  DEFAULT_AGENT_OPTION_ID,
  DEFAULT_PROFILE,
  STATIC_AGENT_CLI_INFO,
  agentProfileEquals,
  agentProfileLabels,
  defaultProfileForAgent,
  getAgent,
  getAgentStatus,
  isAgentId,
  legacyProfileFromVariant,
  normalizeAgentProfile,
  resolveAgentModeValue,
  resolveAgentModelValue,
  resolveAgentOptionValue,
  resolveAgentReasoningValue,
} from "../../lib/agent-catalog";

export type {
  AgentCliInfo,
  AgentCliMap,
  AgentDef,
  AgentId,
  AgentOption,
  AgentProfile,
  AgentSystemStatus,
  AgentWorkMode,
} from "../../lib/agent-catalog";

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
