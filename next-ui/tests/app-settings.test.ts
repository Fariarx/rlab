import { describe, expect, it } from "vitest";
import { cloneAppSettings, defaultAppSettings, isAgentAccessMode, mergeAppSettings } from "../src/components/workspace/app-settings";

describe("app settings", () => {
  it("uses unrestricted as the writable access mode", () => {
    expect(isAgentAccessMode("read-only")).toBe(true);
    expect(isAgentAccessMode("unrestricted")).toBe(true);
    expect(isAgentAccessMode("read-write")).toBe(false);
  });

  it("clones and merges unrestricted access settings", () => {
    expect(
      cloneAppSettings({
        ...defaultAppSettings,
        agents: { ...defaultAppSettings.agents, accessMode: "unrestricted" },
      }).agents.accessMode,
    ).toBe("unrestricted");
    expect(mergeAppSettings(defaultAppSettings, { agents: { accessMode: "unrestricted" } }).agents.accessMode).toBe("unrestricted");
  });
});
