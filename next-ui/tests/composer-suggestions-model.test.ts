import { describe, expect, it } from "vitest";
import { applyComposerSuggestion, composerMentionSuggestions, composerPluginSuggestions, composerSuggestions } from "../src/components/agent/composer/composer-suggestions-model";
import type { ComposerPluginLink } from "../src/lib/rlab-plugins";

const plugins: readonly ComposerPluginLink[] = [
  { id: "AskUserQuestion", label: "Ask User", token: "$AskUserQuestion" },
  { id: "TaskAwaiter", label: "Task Awaiter", token: "$TaskAwaiter" },
];

describe("composer-suggestions-model", () => {
  it("finds @file suggestions from the trailing mention query", () => {
    expect(composerMentionSuggestions("Read @", ["src/auth.ts", "README.md"])).toEqual(["src/auth.ts", "README.md"]);
    expect(composerMentionSuggestions("Read @auth", ["src/auth.ts", "README.md"])).toEqual(["src/auth.ts"]);
    expect(composerMentionSuggestions("/", ["src/auth.ts"])).toEqual([]);
  });

  it("finds plugin suggestions from id, label, or token", () => {
    expect(composerPluginSuggestions("$", plugins).map((plugin) => plugin.id)).toEqual(["AskUserQuestion", "TaskAwaiter"]);
    expect(composerPluginSuggestions("$await", plugins).map((plugin) => plugin.id)).toEqual(["TaskAwaiter"]);
    expect(composerPluginSuggestions("plain", plugins)).toEqual([]);
  });

  it("builds one active suggestion list with plugin suggestions taking priority", () => {
    expect(composerSuggestions("$", ["README.md"], plugins, false, 99)).toMatchObject({
      open: true,
      activeIndex: 1,
      key: "AskUserQuestion|TaskAwaiter",
      suggestions: [
        { id: "AskUserQuestion", label: "$AskUserQuestion", kind: "plugin", mono: true, value: "$AskUserQuestion" },
        { id: "TaskAwaiter", label: "$TaskAwaiter", kind: "plugin", mono: true, value: "$TaskAwaiter" },
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
      applyComposerSuggestion("Use $await", { id: "TaskAwaiter", label: "$TaskAwaiter", kind: "plugin", mono: true, value: "$TaskAwaiter" }),
    ).toBe("Use $TaskAwaiter ");
  });
});
