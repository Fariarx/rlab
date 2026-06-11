import { describe, expect, it } from "vitest";
import {
  AGENTS,
  DEFAULT_AGENT_OPTION_ID,
  accessModeForAgentProfile,
  agentProfileLabels,
  getAgent,
  resolveAgentModeValue,
  resolveAgentModelValue,
  resolveAgentReasoningValue,
} from "../src/lib/agent-catalog";

describe("agent catalog", () => {
  it("is the shared source for UI options and CLI model values", () => {
    expect(getAgent("claude-code").models.map((option) => option.id)).toEqual(["default", "fable", "sonnet", "haiku"]);
    expect(resolveAgentModelValue("claude-code", "fable")).toBe("fable");
    expect(resolveAgentModelValue("gemini", "gemini-2.5-flash-lite")).toBe("gemini-2.5-flash-lite");
    expect(resolveAgentModelValue("opencode", DEFAULT_AGENT_OPTION_ID)).toBe("opencode/deepseek-v4-flash-free");
    expect(resolveAgentModelValue("opencode", "anthropic-claude-opus-4-7")).toBe("anthropic/claude-opus-4-7");
    expect(resolveAgentReasoningValue("codex", "xhigh")).toBe("xhigh");
  });

  it("exposes chat work modes for every runnable agent", () => {
    for (const agent of ["claude-code", "codex", "gemini", "opencode"] as const) {
      expect(getAgent(agent).modes.map((option) => option.id)).toEqual(["default", "plan", "auto"]);
    }
    expect(resolveAgentModeValue("codex", "plan")).toBe("plan");
    expect(resolveAgentModeValue("gemini", "auto")).toBe("auto");
    expect(accessModeForAgentProfile({ agent: "codex", model: "default", reasoning: "default", mode: "plan" })).toBe("read-only");
    expect(accessModeForAgentProfile({ agent: "codex", model: "default", reasoning: "default", mode: "auto" })).toBe("unrestricted");
  });

  it("only exposes the four currently supported visible agents", () => {
    expect(AGENTS.map((agent) => agent.id)).toEqual(["claude-code", "codex", "gemini", "opencode"]);
  });

  it("keeps every visible run adapter backed by selectable catalog options", () => {
    const runnable = AGENTS.filter((agent) => agent.runAdapter);

    expect(runnable.map((agent) => agent.id)).toEqual(["claude-code", "codex", "gemini", "opencode"]);
    expect(runnable.every((agent) => agent.models.length > 0 && agent.reasoning.length > 0 && agent.modes.length > 0)).toBe(true);
  });

  it("labels direct runtime model values that are not in the static catalog", () => {
    expect(agentProfileLabels({ agent: "opencode", model: "anthropic/claude-custom-lab", reasoning: "default", mode: "default" })).toEqual(["anthropic/claude-custom-lab"]);
  });
});
