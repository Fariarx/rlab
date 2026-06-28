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
  { id: "TaskAwaiter", label: "Task Awaiter", token: "$TaskAwaiter" },
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
      composerValue: "Use $TaskAwaiter now",
      limitOpen: false,
      mentionableFiles: ["README.md"],
      registeredPlugins: plugins,
      suggestDismissed: false,
      t,
    });

    expect(model.suggestionsState.open).toBe(false);
    expect(model.pluginTokenRanges).toEqual([{ token: "$TaskAwaiter", start: 4, end: 16 }]);
    expect(model.pluginPreviewParts).toEqual([
      { type: "text", text: "Use ", start: 0, end: 4 },
      { type: "plugin", token: "$TaskAwaiter", start: 4, end: 16 },
      { type: "text", text: " now", start: 16, end: 20 },
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
