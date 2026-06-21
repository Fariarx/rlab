import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildComposerLabel,
  composerHistoryText,
  ensureBrowserNotificationPermission,
  showDesktopNotification,
} from "../src/components/workspace/workspace-page-helpers";

describe("workspace-page-helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

  it("does not crash when the browser rejects the Notification constructor", () => {
    class ThrowingNotification {
      static permission: NotificationPermission = "granted";

      constructor() {
        throw new TypeError("Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.");
      }
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("Notification", ThrowingNotification);

    expect(() => showDesktopNotification(true, { title: "Done", body: "Build" })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[rlab] Browser notification show failed: Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.",
    );
  });

  it("does not assume notification permission requests return a promise", () => {
    const requestPermission = vi.fn(() => "granted" as NotificationPermission);
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission,
    });

    expect(() => ensureBrowserNotificationPermission(true)).not.toThrow();
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});
