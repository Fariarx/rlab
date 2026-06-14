import { describe, expect, it } from "vitest";
import { applyComposerSuggestion, composerMentionSuggestions, composerPluginSuggestions, composerSuggestions } from "../src/components/agent/composer/composer-suggestions-model";
import type { ComposerPluginLink } from "../src/lib/rlab-plugins";

const plugins: readonly ComposerPluginLink[] = [
  { id: "AskUserQuestion", label: "Ask User", token: "$AskUserQuestion" },
  { id: "TaskWakeup", label: "Task Wakeup", token: "$TaskWakeup" },
];

describe("composer-suggestions-model", () => {
  it("finds @file suggestions from the trailing mention query", () => {
    expect(composerMentionSuggestions("Read @", ["src/auth.ts", "README.md"])).toEqual(["src/auth.ts", "README.md"]);
    expect(composerMentionSuggestions("Read @auth", ["src/auth.ts", "README.md"])).toEqual(["src/auth.ts"]);
    expect(composerMentionSuggestions("/", ["src/auth.ts"])).toEqual([]);
  });

  it("finds plugin suggestions from id, label, or token", () => {
    expect(composerPluginSuggestions("$", plugins).map((plugin) => plugin.id)).toEqual(["AskUserQuestion", "TaskWakeup"]);
    expect(composerPluginSuggestions("$wake", plugins).map((plugin) => plugin.id)).toEqual(["TaskWakeup"]);
    expect(composerPluginSuggestions("plain", plugins)).toEqual([]);
  });

  it("builds one active suggestion list with plugin suggestions taking priority", () => {
    expect(composerSuggestions("$", ["README.md"], plugins, false, 99)).toMatchObject({
      open: true,
      activeIndex: 1,
      key: "AskUserQuestion|TaskWakeup",
      suggestions: [
        { id: "AskUserQuestion", label: "$AskUserQuestion", kind: "plugin", mono: true, value: "$AskUserQuestion" },
        { id: "TaskWakeup", label: "$TaskWakeup", kind: "plugin", mono: true, value: "$TaskWakeup" },
      ],
    });
    expect(composerSuggestions("Read @", ["README.md"], plugins, true, 0)).toMatchObject({
      open: false,
      activeIndex: 0,
      key: "README.md",
    });
  });

  it("applies selected suggestions to the active token", () => {
    expect(applyComposerSuggestion("Read @aut", { id: "src/auth.ts", label: "src/auth.ts", kind: "file", mono: true, value: "src/auth.ts" })).toBe(
      "Read @src/auth.ts ",
    );
    expect(
      applyComposerSuggestion("Use $wake", { id: "TaskWakeup", label: "$TaskWakeup", kind: "plugin", mono: true, value: "$TaskWakeup" }),
    ).toBe("Use $TaskWakeup ");
  });
});
