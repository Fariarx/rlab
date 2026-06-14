import { describe, expect, it } from "vitest";
import { basename, readOnlyImageToolPath, splitUserContent } from "../src/components/agent/message/message-content-model";
import type { AgentBlock } from "../src/components/agent/core/types";

describe("message-content-model", () => {
  it("keeps normal markdown links in visible text", () => {
    const result = splitUserContent("Read [docs](https://example.com/docs) first");

    expect(result).toEqual({
      text: "Read [docs](https://example.com/docs) first",
      attachments: [],
    });
  });

  it("extracts path-based markdown links as attachments", () => {
    const result = splitUserContent("Review [report](C:\\tmp\\report.txt) and ![preview](C:\\tmp\\preview.PNG?raw=1)");

    expect(result.text).toBe("Review  and");
    expect(result.attachments).toEqual([
      { id: "link:1:report:C:\\tmp\\report.txt", name: "report", target: "C:\\tmp\\report.txt", isImage: false },
      { id: "link:2:preview:C:\\tmp\\preview.PNG?raw=1", name: "preview", target: "C:\\tmp\\preview.PNG?raw=1", isImage: true },
    ]);
  });

  it("extracts inline attachment blocks without leaking file contents into text", () => {
    const result = splitUserContent('Question\n<attachment name="notes.md">private contents</attachment>\nThanks');

    expect(result).toEqual({
      text: "Question\n\nThanks",
      attachments: [{ id: "inline:1:notes.md", name: "notes.md", isImage: false }],
    });
  });

  it("detects read-only image tool paths from supported tool argument names", () => {
    const block: AgentBlock = {
      kind: "tool",
      name: "tools/view-image",
      args: { filePath: "C:\\tmp\\capture.webp" },
      state: "ok",
    };

    expect(readOnlyImageToolPath(block)).toBe("C:\\tmp\\capture.webp");
  });

  it("does not treat errored tools or non-image targets as image previews", () => {
    expect(readOnlyImageToolPath({ kind: "tool", name: "Read", args: { path: "C:\\tmp\\notes.txt" }, state: "ok" })).toBeNull();
    expect(readOnlyImageToolPath({ kind: "tool", name: "Read", args: { path: "C:\\tmp\\capture.png" }, state: "error" })).toBeNull();
    expect(readOnlyImageToolPath({ kind: "command", command: "cat capture.png", state: "ok" })).toBeNull();
  });

  it("normalizes Windows and POSIX basenames", () => {
    expect(basename("C:\\tmp\\capture.png")).toBe("capture.png");
    expect(basename("/tmp/report.md")).toBe("report.md");
    expect(basename("/")).toBe("/");
  });
});
