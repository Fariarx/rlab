import { describe, expect, it } from "vitest";
import { cloneAppSettings, defaultAppSettings, isAgentAccessMode, mergeAppSettings, normalizeAgentAccessMode } from "../src/components/workspace/app-settings";

describe("app settings", () => {
  it("uses unrestricted as the writable access mode", () => {
    expect(isAgentAccessMode("read-only")).toBe(true);
    expect(isAgentAccessMode("unrestricted")).toBe(true);
    expect(isAgentAccessMode("read-write")).toBe(false);
  });

  it("migrates legacy read-write access settings to unrestricted", () => {
    expect(normalizeAgentAccessMode("read-write")).toBe("unrestricted");
    expect(
      cloneAppSettings({
        ...defaultAppSettings,
        agents: { ...defaultAppSettings.agents, accessMode: "read-write" },
      }).agents.accessMode,
    ).toBe("unrestricted");
    expect(mergeAppSettings(defaultAppSettings, { agents: { accessMode: "read-write" } }).agents.accessMode).toBe("unrestricted");
  });
});
