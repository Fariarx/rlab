import { describe, expect, it } from "vitest";
import { buildComposerLabel, composerHistoryText } from "../src/components/workspace/workspace-page-helpers";

describe("workspace-page-helpers", () => {
  it("keeps ordinary markdown links in composer history", () => {
    expect(composerHistoryText("Read [docs](https://example.com/path) first")).toBe("Read [docs](https://example.com/path) first");
  });

  it("removes composer attachment payloads from history text", () => {
    expect(composerHistoryText('Please inspect [notes](C:\\tmp\\notes.txt)\n<attachment name="secret.txt">secret</attachment>')).toBe("Please inspect");
  });

  it("formats the composer profile label as compact slash-separated tokens", () => {
    expect(buildComposerLabel({ agent: "claude-code", model: "default", reasoning: "default", mode: "default" })).toBe(
      "claude-code/default/default",
    );
    expect(buildComposerLabel({ agent: "codex", model: "gpt-5.5", reasoning: "xhigh", mode: "default" })).toBe(
      "codex/gpt-5.5/xhigh",
    );
    expect(buildComposerLabel({ agent: "opencode", model: "opencode-big-pickle", reasoning: "max", mode: "default" })).toBe(
      "opencode/big-pickle/max",
    );
    expect(buildComposerLabel({ agent: "opencode", model: "opencode/deepseek-v4-flash-free", reasoning: "medium", mode: "default" })).toBe(
      "opencode/deepseek-v4-flash-free/medium",
    );
  });
});
