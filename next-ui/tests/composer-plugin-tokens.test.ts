import { describe, expect, it } from "vitest";
import { normalizePluginTokenDeletion, pluginPreviewParts, pluginTokenPattern, pluginTokenRanges, tokenRangeForDeleteKey } from "../src/components/agent/composer/composer-plugin-tokens";

describe("composer plugin tokens", () => {
  const pattern = /(\$TaskWakeup|\$ScheduleWakeup)\b/g;

  it("builds token patterns from registered plugin links", () => {
    const builtPattern = pluginTokenPattern([
      { token: "$TaskWakeup" },
      { token: "$Git.Commit" },
    ]);

    expect(pluginTokenRanges("use $ScheduleWakeup and $Git.Commit", builtPattern)).toEqual([
      { token: "$ScheduleWakeup", start: 4, end: 19 },
      { token: "$Git.Commit", start: 24, end: 35 },
    ]);
  });

  it("finds registered plugin token ranges", () => {
    expect(pluginTokenRanges("run $TaskWakeup then $ScheduleWakeup", pattern)).toEqual([
      { token: "$TaskWakeup", start: 4, end: 15 },
      { token: "$ScheduleWakeup", start: 21, end: 36 },
    ]);
  });

  it("builds preview parts around plugin tokens", () => {
    const value = "run $TaskWakeup now";

    expect(pluginPreviewParts(value, pluginTokenRanges(value, pattern))).toEqual([
      { type: "text", text: "run ", start: 0, end: 4 },
      { type: "plugin", token: "$TaskWakeup", start: 4, end: 15 },
      { type: "text", text: " now", start: 15, end: 19 },
    ]);
  });

  it("deletes a whole token when backspace is inside the token", () => {
    const ranges = pluginTokenRanges("run $TaskWakeup now", pattern);

    expect(tokenRangeForDeleteKey(ranges, 9, 9, "Backspace")).toEqual({ start: 4, end: 15 });
  });

  it("deletes a whole token when delete is inside the token", () => {
    const ranges = pluginTokenRanges("run $TaskWakeup now", pattern);

    expect(tokenRangeForDeleteKey(ranges, 4, 4, "Delete")).toEqual({ start: 4, end: 15 });
  });

  it("expands mixed text selection to include touched tokens", () => {
    const ranges = pluginTokenRanges("run $TaskWakeup now", pattern);

    expect(tokenRangeForDeleteKey(ranges, 2, 8, "Backspace")).toEqual({ start: 2, end: 15 });
  });

  it("normalizes partial token deletion into atomic token removal", () => {
    const previous = "run $TaskWakeup now";
    const ranges = pluginTokenRanges(previous, pattern);

    expect(normalizePluginTokenDeletion(previous, "run $Taskakeup now", ranges)).toEqual({
      value: "run  now",
      caret: 4,
    });
  });

  it("leaves normal text deletion untouched", () => {
    const previous = "run $TaskWakeup now";
    const ranges = pluginTokenRanges(previous, pattern);

    expect(normalizePluginTokenDeletion(previous, "ru $TaskWakeup now", ranges)).toBeNull();
  });
});
