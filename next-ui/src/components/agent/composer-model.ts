import type { VoiceProviderId, VoiceProviderKind } from "../../lib/voice-providers";

export interface ComposerBrowserActivityEvent {
  readonly id: number;
  readonly type: string;
  readonly label: string;
  readonly detail?: string;
}

export interface ComposerVoiceProvider {
  readonly id: VoiceProviderId;
  readonly name: string;
  readonly kind: Exclude<VoiceProviderKind, "none">;
  readonly language: string;
  readonly configured: boolean;
}

const AUTO_COMPACT_TOGGLE_AGENTS = new Set<string>(["claude-code"]);
const COMPACTION_WINDOW_AGENTS = new Set<string>(["claude-code", "codex"]);

export function browserActivityTone(type: string): "info" | "success" | "warning" | "error" {
  if (type === "console.error" || type === "page.error" || type === "network.failed") {
    return "error";
  }
  if (type === "navigation.done" || type === "tab.selected") {
    return "success";
  }
  if (type === "navigation.started") {
    return "warning";
  }
  return "info";
}

export function supportsAutoCompactToggle(agentId: string | undefined): boolean {
  return agentId !== undefined && AUTO_COMPACT_TOGGLE_AGENTS.has(agentId);
}

export function supportsCompactionWindow(agentId: string | undefined): boolean {
  return agentId !== undefined && COMPACTION_WINDOW_AGENTS.has(agentId);
}
