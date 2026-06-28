import { describe, expect, it } from "vitest";
import { normalizePluginTokenDeletion, pluginPreviewParts, pluginTokenPattern, pluginTokenRanges, tokenRangeForDeleteKey } from "../src/components/agent/composer/composer-plugin-tokens";

describe("composer plugin tokens", () => {
  const pattern = /(\$TaskAwaiter|\$ScheduleAwaiter)\b/g;

  it("builds token patterns from registered plugin links", () => {
    const builtPattern = pluginTokenPattern([
      { token: "$TaskAwaiter" },
      { token: "$Git.Commit" },
    ]);

    expect(pluginTokenRanges("use $ScheduleAwaiter and $Git.Commit", builtPattern)).toEqual([
      { token: "$ScheduleAwaiter", start: 4, end: 20 },
      { token: "$Git.Commit", start: 25, end: 36 },
    ]);
  });

  it("finds registered plugin token ranges", () => {
    expect(pluginTokenRanges("run $TaskAwaiter then $ScheduleAwaiter", pattern)).toEqual([
      { token: "$TaskAwaiter", start: 4, end: 16 },
      { token: "$ScheduleAwaiter", start: 22, end: 38 },
    ]);
  });

  it("builds preview parts around plugin tokens", () => {
    const value = "run $TaskAwaiter now";

    expect(pluginPreviewParts(value, pluginTokenRanges(value, pattern))).toEqual([
      { type: "text", text: "run ", start: 0, end: 4 },
      { type: "plugin", token: "$TaskAwaiter", start: 4, end: 16 },
      { type: "text", text: " now", start: 16, end: 20 },
    ]);
  });

  it("deletes a whole token when backspace is inside the token", () => {
    const ranges = pluginTokenRanges("run $TaskAwaiter now", pattern);

    expect(tokenRangeForDeleteKey(ranges, 9, 9, "Backspace")).toEqual({ start: 4, end: 16 });
  });

  it("deletes a whole token when delete is inside the token", () => {
    const ranges = pluginTokenRanges("run $TaskAwaiter now", pattern);

    expect(tokenRangeForDeleteKey(ranges, 4, 4, "Delete")).toEqual({ start: 4, end: 16 });
  });

  it("expands mixed text selection to include touched tokens", () => {
    const ranges = pluginTokenRanges("run $TaskAwaiter now", pattern);

    expect(tokenRangeForDeleteKey(ranges, 2, 8, "Backspace")).toEqual({ start: 2, end: 16 });
  });

  it("normalizes partial token deletion into atomic token removal", () => {
    const previous = "run $TaskAwaiter now";
    const ranges = pluginTokenRanges(previous, pattern);

    expect(normalizePluginTokenDeletion(previous, "run $TaskAiter now", ranges)).toEqual({
      value: "run  now",
      caret: 4,
    });
  });

  it("leaves normal text deletion untouched", () => {
    const previous = "run $TaskAwaiter now";
    const ranges = pluginTokenRanges(previous, pattern);

    expect(normalizePluginTokenDeletion(previous, "ru $TaskAwaiter now", ranges)).toBeNull();
  });
});
