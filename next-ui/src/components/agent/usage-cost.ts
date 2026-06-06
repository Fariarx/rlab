import { type RunUsage } from "./types";

export function formatCostUsd(costUsd: number): string {
  const precision = costUsd >= 1 ? 2 : 4;
  return `$${costUsd.toFixed(precision)}`;
}

function compactCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return `${value}`;
}

export function totalUsageTokens(usage: RunUsage): number | undefined {
  if (usage.totalTokens !== undefined) {
    return usage.totalTokens;
  }
  const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0);
  return total > 0 ? total : undefined;
}

export function formatTokenUsage(usage: RunUsage): string {
  const total = totalUsageTokens(usage);
  return total === undefined ? "tokens n/a" : `${compactCount(total)} tok`;
}
