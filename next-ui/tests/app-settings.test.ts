import { describe, expect, it } from "vitest";
import { DEFAULT_QUEUE_INTERRUPTION_PAUSE_MS, cloneAppSettings, defaultAppSettings, isAppSettings, mergeAppSettings } from "../src/lib/app-settings";

describe("app settings", () => {
  it("clones and merges agent default profile settings", () => {
    expect(
      cloneAppSettings({
        ...defaultAppSettings,
        agents: { ...defaultAppSettings.agents, defaultProfile: { agent: "codex", model: "default", reasoning: "default", mode: "plan" } },
      }).agents.defaultProfile,
    ).toEqual({ agent: "codex", model: "default", reasoning: "default", mode: "plan" });
    expect(mergeAppSettings(defaultAppSettings, { agents: { defaultProfile: { agent: "gemini", model: "default", reasoning: "default", mode: "auto" } } }).agents.defaultProfile).toEqual({
      agent: "gemini",
      model: "default",
      reasoning: "default",
      mode: "default",
    });
  });

  it("accepts persisted concrete agent work modes", () => {
    expect(
      isAppSettings({
        ...defaultAppSettings,
        agents: {
          ...defaultAppSettings.agents,
          defaultProfile: { agent: "codex", model: "default", reasoning: "default", mode: "review" },
        },
      }),
    ).toBe(true);
  });

  it("accepts older persisted settings without a system prompt or queue interruption pause", () => {
    const { systemPrompt: _systemPrompt, queueInterruptionPauseMs: _queueInterruptionPauseMs, ...legacyGeneral } = defaultAppSettings.general;

    expect(
      isAppSettings({
        ...defaultAppSettings,
        general: legacyGeneral,
      }),
    ).toBe(true);
  });

  it("normalizes missing and patched system prompts", () => {
    const { systemPrompt: _systemPrompt, queueInterruptionPauseMs: _queueInterruptionPauseMs, ...legacyGeneral } = defaultAppSettings.general;
    const cloned = cloneAppSettings({
      ...defaultAppSettings,
      general: legacyGeneral,
    } as unknown as typeof defaultAppSettings);

    expect(cloned.general.systemPrompt).toBe("");
    expect(cloned.general.queueInterruptionPauseMs).toBe(DEFAULT_QUEUE_INTERRUPTION_PAUSE_MS);
    expect(mergeAppSettings(defaultAppSettings, { general: { systemPrompt: "Use short answers." } }).general.systemPrompt).toBe("Use short answers.");
    expect(mergeAppSettings(defaultAppSettings, { general: { queueInterruptionPauseMs: 42 * 60_000 } }).general.queueInterruptionPauseMs).toBe(42 * 60_000);
  });

  it("rejects incomplete persisted settings", () => {
    expect(
      isAppSettings({
        ...defaultAppSettings,
        appearance: {
          density: "comfortable",
          reduceMotion: false,
          sidebarWidth: 300,
          theme: "dark",
        },
      }),
    ).toBe(false);
    expect(
      isAppSettings({
        ...defaultAppSettings,
        general: {
          confirmDestructiveActions: true,
          desktopNotifications: true,
          locale: "ru",
          telemetry: false,
          previewServerHost: "",
          voice: {},
        },
      }),
    ).toBe(false);
  });
});
