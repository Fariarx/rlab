import { describe, expect, it } from "vitest";
import { activeRlabChatToolIds, persistedRlabChatToolIds, rlabChatToolEnabled } from "../src/lib/rlab-tools";

describe("rlab-tools", () => {
  it("normalizes persisted TaskWakeup selections to TaskAwaiter", () => {
    const legacyTools = ["AskUserQuestion", "TaskWakeup", "TaskTracker", "TaskGoal"];

    expect(activeRlabChatToolIds(legacyTools)).toEqual(["AskUserQuestion", "TaskAwaiter", "TaskTracker", "TaskGoal"]);
    expect(persistedRlabChatToolIds(legacyTools)).toBeUndefined();
    expect(rlabChatToolEnabled(legacyTools, "TaskAwaiter")).toBe(true);
    expect(rlabChatToolEnabled(legacyTools, "TaskWakeup")).toBe(true);
  });
});
