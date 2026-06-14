import type { I18nApi } from "../../../i18n/I18nProvider";
import type { AgentRateLimit, RateLimitWindow } from "../../../lib/agent-limits";
import { supportsAutoCompactToggle, supportsCompactionWindow } from "./composer-model";

export interface ComposerLimitLine {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly percent?: number;
}

export interface ComposerContextUsage {
  readonly contextOverLimit: boolean;
  readonly supportsAutoCompact: boolean;
  readonly supportsCompaction: boolean;
}

export function composerContextUsage({
  agentId,
  contextTokens,
  contextWindow,
}: {
  readonly agentId?: string;
  readonly contextTokens?: number;
  readonly contextWindow?: number;
}): ComposerContextUsage {
  const hasKnownContextWindow = typeof contextWindow === "number" && contextWindow > 0;
  const effectiveContextTokens = typeof contextTokens === "number" && Number.isFinite(contextTokens) && contextTokens > 0 ? contextTokens : 0;
  return {
    contextOverLimit: hasKnownContextWindow && effectiveContextTokens / contextWindow >= 1,
    supportsAutoCompact: supportsAutoCompactToggle(agentId),
    supportsCompaction: supportsCompactionWindow(agentId),
  };
}

export function composerLimitWindowLabel(kind: RateLimitWindow["kind"], t: I18nApi["t"]): string {
  return kind === "weekly" ? t("limitWindowWeekly") : kind === "daily" ? t("limitWindowDaily") : kind === "overage" ? t("limitOverage") : t("limitWindow5h");
}

export function composerLimitStatusLabel(status: string, t: I18nApi["t"]): string {
  return status === "allowed" ? t("limitStatusOk") : status === "allowed_warning" ? t("limitStatusWarning") : status === "rejected" ? t("limitStatusRejected") : status;
}

export function composerLimitResetLabel(resetsAt: number, nowMs: number, t: I18nApi["t"]): string {
  const secs = Math.max(0, resetsAt * 1000 - nowMs) / 1000;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}${t("unitHourShort")} ${m}${t("unitMinShort")}` : `${m}${t("unitMinShort")}`;
}

export function composerLimitLines(agentLimit: AgentRateLimit | null, t: I18nApi["t"], nowMs = Date.now()): readonly ComposerLimitLine[] {
  if (!agentLimit) {
    return [];
  }

  const lines: ComposerLimitLine[] = [];
  for (const window of agentLimit.windows) {
    const parts: string[] = [];
    if (typeof window.usedPercent === "number") {
      parts.push(`${Math.round(window.usedPercent)}%`);
    }
    if (typeof window.resetsAt === "number") {
      parts.push(composerLimitResetLabel(window.resetsAt, nowMs, t));
    }
    if (parts.length > 0) {
      lines.push({
        id: `${window.kind}-${window.label ?? ""}`,
        label: window.label ?? composerLimitWindowLabel(window.kind, t),
        value: parts.join(" · "),
        percent: typeof window.usedPercent === "number" ? window.usedPercent : undefined,
      });
    }
  }
  if (agentLimit.plan) {
    lines.push({ id: "plan", label: t("limitPlan"), value: agentLimit.plan });
  }
  if (agentLimit.status) {
    lines.push({ id: "status", label: t("limitStatus"), value: composerLimitStatusLabel(agentLimit.status, t) });
  }
  return lines;
}
