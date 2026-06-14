import { describe, expect, it } from "vitest";
import { fileBaseName, isFilePathLike, messageMarkdownUrlTransform, normalizedRlabToolName, rlabToolMarkdownLinks } from "../src/components/agent/message/message-link-model";

describe("message-link-model", () => {
  it("normalizes legacy ScheduleWakeup tool references to TaskWakeup", () => {
    expect(normalizedRlabToolName("ScheduleWakeup")).toBe("TaskWakeup");
    expect(normalizedRlabToolName("AskUserQuestion")).toBe("AskUserQuestion");
  });

  it("turns supported rlab tool tokens into markdown links", () => {
    expect(rlabToolMarkdownLinks("Use $TaskWakeup then $AskUserQuestion.")).toBe("Use [TaskWakeup](rlab-tool:TaskWakeup) then [AskUserQuestion](rlab-tool:AskUserQuestion).");
    expect(rlabToolMarkdownLinks("Legacy $ScheduleWakeup works.")).toBe("Legacy [TaskWakeup](rlab-tool:TaskWakeup) works.");
  });

  it("leaves non-tool dollar tokens untouched", () => {
    expect(rlabToolMarkdownLinks("Keep $UnknownTool and $TaskWakeupNow as text.")).toBe("Keep $UnknownTool and $TaskWakeupNow as text.");
  });

  it("allows internal rlab tool links through markdown URL sanitization", () => {
    expect(messageMarkdownUrlTransform("rlab-tool:TaskWakeup")).toBe("rlab-tool:TaskWakeup");
    expect(messageMarkdownUrlTransform("https://example.com/docs")).toBe("https://example.com/docs");
  });

  it("classifies local paths separately from web URLs and protocol links", () => {
    expect(isFilePathLike("C:\\tmp\\report.md")).toBe(true);
    expect(isFilePathLike("src/components/agent/parts.tsx")).toBe(true);
    expect(isFilePathLike("README.md")).toBe(true);

    expect(isFilePathLike("https://example.com/report.md")).toBe(false);
    expect(isFilePathLike("//example.com/report.md")).toBe(false);
    expect(isFilePathLike("#section")).toBe(false);
    expect(isFilePathLike("mailto:dev@example.com")).toBe(false);
    expect(isFilePathLike("bare-word")).toBe(false);
  });

  it("extracts basenames from Windows and POSIX paths", () => {
    expect(fileBaseName("C:\\tmp\\capture.png")).toBe("capture.png");
    expect(fileBaseName("/tmp/report.md")).toBe("report.md");
    expect(fileBaseName("README.md")).toBe("README.md");
    expect(fileBaseName("/")).toBe("/");
  });
});
