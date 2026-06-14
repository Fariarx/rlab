import { describe, expect, it } from "vitest";
import { composerHistoryText } from "../src/components/workspace/workspace-page-helpers";

describe("workspace-page-helpers", () => {
  it("keeps ordinary markdown links in composer history", () => {
    expect(composerHistoryText("Read [docs](https://example.com/path) first")).toBe("Read [docs](https://example.com/path) first");
  });

  it("removes composer attachment payloads from history text", () => {
    expect(composerHistoryText('Please inspect [notes](C:\\tmp\\notes.txt)\n<attachment name="secret.txt">secret</attachment>')).toBe("Please inspect");
  });
});
