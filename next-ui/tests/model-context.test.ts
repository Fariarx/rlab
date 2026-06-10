import { describe, expect, it } from "vitest";
import { contextWindowForAgentProfile } from "../src/lib/model-context";

describe("model context windows", () => {
  it("resolves default agent profiles to a usable context window for the composer gauge", () => {
    expect(contextWindowForAgentProfile({ agent: "codex", model: "default", reasoning: "default", mode: "default" })).toBe(272000);
    expect(contextWindowForAgentProfile({ agent: "gemini", model: "default", reasoning: "default", mode: "default" })).toBe(1000000);
    expect(contextWindowForAgentProfile({ agent: "claude-code", model: "default", reasoning: "default", mode: "default" })).toBe(200000);
    expect(contextWindowForAgentProfile({ agent: "opencode", model: "default", reasoning: "default", mode: "default" })).toBe(256000);
  });
});
