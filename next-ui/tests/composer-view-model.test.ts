import { describe, expect, it } from "vitest";
import type { I18nApi } from "../src/i18n/I18nProvider";
import { composerViewModel } from "../src/components/agent/composer/composer-view-model";
import type { ComposerPluginLink } from "../src/lib/rlab-plugins";

const labels: Record<string, string> = {
  limitPlan: "Plan",
  limitStatus: "Status",
  limitStatusWarning: "Warning",
  limitWindow5h: "5h",
  unitHourShort: "h",
  unitMinShort: "m",
};

const t: I18nApi["t"] = (key) => labels[key] ?? key;

const plugins: readonly ComposerPluginLink[] = [
  { id: "TaskWakeup", label: "Task Wakeup", token: "$TaskWakeup" },
  { id: "Git.Commit", label: "Commit", token: "$Git.Commit" },
];

describe("composerViewModel", () => {
  it("builds suggestion and plugin-token preview state from composer inputs", () => {
    const model = composerViewModel({
      activeSuggestion: 0,
      agentId: "codex",
      agentLimit: null,
      agentLimitLoaded: false,
      agentLimitRefreshError: null,
      agentLimitRefreshing: false,
      composerValue: "Use $TaskWakeup now",
      limitOpen: false,
      mentionableFiles: ["README.md"],
      registeredPlugins: plugins,
      suggestDismissed: false,
      t,
    });

    expect(model.suggestionsState.open).toBe(false);
    expect(model.pluginTokenRanges).toEqual([{ token: "$TaskWakeup", start: 4, end: 15 }]);
    expect(model.pluginPreviewParts).toEqual([
      { type: "text", text: "Use ", start: 0, end: 4 },
      { type: "plugin", token: "$TaskWakeup", start: 4, end: 15 },
      { type: "text", text: " now", start: 15, end: 19 },
    ]);
  });

  it("combines context usage and rate-limit display state", () => {
    const model = composerViewModel({
      activeSuggestion: 0,
      agentId: "claude-code",
      agentLimit: {
        updatedAt: 1,
        plan: "Pro",
        status: "allowed_warning",
        windows: [{ kind: "five_hour", usedPercent: 66.6, resetsAt: 10_900 }],
      },
      agentLimitLoaded: true,
      agentLimitRefreshError: "stale",
      agentLimitRefreshing: true,
      composerValue: "",
      contextTokens: 100,
      contextWindow: 100,
      limitOpen: true,
      mentionableFiles: [],
      registeredPlugins: [],
      suggestDismissed: false,
      t,
    });

    expect(model.context).toEqual({
      contextOverLimit: true,
      supportsAutoCompact: true,
      supportsCompaction: true,
    });
    expect(model.limitLines.map((line) => line.id)).toEqual(["five_hour-", "plan", "status"]);
    expect(model.limitLayoutKey).toBe("true:stale:true:true:3");
  });
});
