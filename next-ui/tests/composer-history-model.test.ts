import { describe, expect, it } from "vitest";
import { emptyComposerHistoryState, navigateComposerHistory, resetComposerHistoryState } from "../src/components/agent/composer/composer-history-model";

describe("composer-history-model", () => {
  it("does not handle navigation when history is empty", () => {
    expect(navigateComposerHistory({ history: [], state: emptyComposerHistoryState, currentValue: "draft", direction: "up" })).toEqual({
      handled: false,
      state: emptyComposerHistoryState,
    });
  });

  it("starts browsing from the newest entry and remembers the current draft", () => {
    const result = navigateComposerHistory({
      history: ["first", "second"],
      state: emptyComposerHistoryState,
      currentValue: "draft",
      direction: "up",
    });

    expect(result).toEqual({ handled: true, state: { index: 1, draft: "draft" }, value: "second" });
  });

  it("walks to older entries and swallows extra up navigation at the oldest entry", () => {
    const first = navigateComposerHistory({
      history: ["first", "second"],
      state: { index: 1, draft: "draft" },
      currentValue: "second",
      direction: "up",
    });
    const oldest = navigateComposerHistory({
      history: ["first", "second"],
      state: first.state,
      currentValue: "first",
      direction: "up",
    });

    expect(first).toEqual({ handled: true, state: { index: 0, draft: "draft" }, value: "first" });
    expect(oldest).toEqual({ handled: true, state: { index: 0, draft: "draft" } });
  });

  it("walks down through newer entries and restores the draft after the newest", () => {
    const newer = navigateComposerHistory({
      history: ["first", "second"],
      state: { index: 0, draft: "draft" },
      currentValue: "first",
      direction: "down",
    });
    const restored = navigateComposerHistory({
      history: ["first", "second"],
      state: newer.state,
      currentValue: "second",
      direction: "down",
    });

    expect(newer).toEqual({ handled: true, state: { index: 1, draft: "draft" }, value: "second" });
    expect(restored).toEqual({ handled: true, state: { index: -1, draft: "draft" }, value: "draft" });
  });

  it("ignores down navigation outside browsing mode and resets only active browsing", () => {
    expect(navigateComposerHistory({ history: ["first"], state: emptyComposerHistoryState, currentValue: "draft", direction: "down" })).toEqual({
      handled: false,
      state: emptyComposerHistoryState,
    });
    expect(resetComposerHistoryState(emptyComposerHistoryState)).toBe(emptyComposerHistoryState);
    expect(resetComposerHistoryState({ index: 0, draft: "draft" })).toEqual({ index: -1, draft: "draft" });
  });
});
