import { agentProfileCompactLabel, type AgentProfile } from "../core/agents";
import type { AgentBlock } from "../core/types";

export interface DurationUnits {
  readonly minute: string;
  readonly second: string;
}

export function formatElapsedSeconds(totalSec: number, units: DurationUnits): string {
  const safe = Math.max(0, totalSec);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return minutes > 0 ? `${minutes}${units.minute} ${seconds}${units.second}` : `${seconds}${units.second}`;
}

export function elapsedSecondsSince(startedAtMs: number | undefined, nowMs: number): number | null {
  return startedAtMs === undefined ? null : Math.round((nowMs - startedAtMs) / 1000);
}

export function firstReasoningStartedAtMs(blocks: readonly AgentBlock[]): number | undefined {
  return blocks.reduce<number | undefined>((found, block) => found ?? (block.kind === "reasoning" ? block.startedAtMs : undefined), undefined);
}

export function agentMessageProfileLabel(profile: AgentProfile | undefined): string | null {
  if (!profile) {
    return null;
  }
  return agentProfileCompactLabel(profile, "lower");
}
