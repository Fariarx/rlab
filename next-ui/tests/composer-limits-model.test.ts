import { describe, expect, it } from "vitest";
import type { I18nApi } from "../src/i18n/I18nProvider";
import { composerContextUsage, composerLimitLines, composerLimitResetLabel, composerLimitStatusLabel, composerLimitWindowLabel } from "../src/components/agent/composer/composer-limits-model";

const labels: Record<string, string> = {
  limitWindowWeekly: "Weekly",
  limitWindowDaily: "Daily",
  limitOverage: "Overage",
  limitWindow5h: "5h",
  limitStatusOk: "OK",
  limitStatusWarning: "Warning",
  limitStatusRejected: "Rejected",
  unitHourShort: "h",
  unitMinShort: "m",
  limitPlan: "Plan",
  limitStatus: "Status",
};

const t: I18nApi["t"] = (key) => labels[key] ?? key;

describe("composer-limits-model", () => {
  it("computes context over-limit and compaction support for the selected agent", () => {
    expect(composerContextUsage({ agentId: "codex", contextTokens: 100, contextWindow: 100 })).toEqual({
      contextOverLimit: true,
      supportsAutoCompact: false,
      supportsCompaction: true,
    });
    expect(composerContextUsage({ agentId: "claude-code", contextTokens: 100, contextWindow: 100 })).toEqual({
      contextOverLimit: true,
      supportsAutoCompact: true,
      supportsCompaction: true,
    });
    expect(composerContextUsage({ agentId: "opencode", contextTokens: 50, contextWindow: 100 })).toEqual({
      contextOverLimit: false,
      supportsAutoCompact: false,
      supportsCompaction: false,
    });
    expect(composerContextUsage({ agentId: "codex", contextTokens: Number.NaN, contextWindow: 100 }).contextOverLimit).toBe(false);
  });

  it("formats rate limit window labels, reset labels, and statuses", () => {
    expect(composerLimitWindowLabel("weekly", t)).toBe("Weekly");
    expect(composerLimitWindowLabel("daily", t)).toBe("Daily");
    expect(composerLimitWindowLabel("overage", t)).toBe("Overage");
    expect(composerLimitWindowLabel("five_hour", t)).toBe("5h");

    expect(composerLimitResetLabel(10_900, 1_000_000, t)).toBe("2h 45m");
    expect(composerLimitResetLabel(1_120, 1_000_000, t)).toBe("2m");

    expect(composerLimitStatusLabel("allowed", t)).toBe("OK");
    expect(composerLimitStatusLabel("allowed_warning", t)).toBe("Warning");
    expect(composerLimitStatusLabel("rejected", t)).toBe("Rejected");
    expect(composerLimitStatusLabel("unknown", t)).toBe("unknown");
  });

  it("builds display rows for agent rate limits", () => {
    expect(
      composerLimitLines(
        {
          updatedAt: 1,
          plan: "Pro",
          status: "allowed_warning",
          windows: [
            { kind: "five_hour", usedPercent: 72.4, resetsAt: 10_900 },
            { kind: "weekly", label: "Team weekly", usedPercent: 10 },
            { kind: "daily" },
          ],
        },
        t,
        1_000_000,
      ),
    ).toEqual([
      { id: "five_hour-", label: "5h", value: "72% · 2h 45m", percent: 72.4 },
      { id: "weekly-Team weekly", label: "Team weekly", value: "10%", percent: 10 },
      { id: "plan", label: "Plan", value: "Pro" },
      { id: "status", label: "Status", value: "Warning" },
    ]);
    expect(composerLimitLines(null, t)).toEqual([]);
  });
});
