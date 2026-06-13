import { describe, expect, it } from "vitest";
import { cloneAppSettings, defaultAppSettings, isAppSettings, mergeAppSettings } from "../src/components/workspace/app-settings";

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
