import { describe, expect, it } from "vitest";
import {
  AGENTS,
  DEFAULT_AGENT_OPTION_ID,
  accessModeForAgentProfile,
  agentProfileLabels,
  getAgent,
  normalizeAgentProfile,
  resolveAgentModeValue,
  resolveAgentModelValue,
  resolveAgentReasoningValue,
} from "../src/lib/agent-catalog";

describe("agent catalog", () => {
  it("is the shared source for UI options and CLI model values", () => {
    expect(getAgent("claude-code").models.map((option) => option.id)).toEqual(["default", "fable", "opus", "sonnet", "haiku"]);
    expect(resolveAgentModelValue("claude-code", "fable")).toBe("fable");
    expect(resolveAgentModelValue("claude-code", "opus")).toBe("opus");
    expect(resolveAgentModelValue("gemini", "gemini-2.5-flash-lite")).toBe("gemini-2.5-flash-lite");
    expect(resolveAgentModelValue("opencode", DEFAULT_AGENT_OPTION_ID)).toBe("opencode/deepseek-v4-flash-free");
    expect(resolveAgentModelValue("opencode", "opencode-north-mini-code-free")).toBe("opencode/north-mini-code-free");
    expect(resolveAgentReasoningValue("codex", "xhigh")).toBe("xhigh");
  });

  it("exposes chat work modes for every runnable agent", () => {
    for (const agent of ["claude-code", "gemini", "opencode"] as const) {
      expect(getAgent(agent).modes.map((option) => option.id)).toEqual(["default", "plan", "review", "build", "explore", "summary"]);
    }
    expect(getAgent("codex").modes.map((option) => option.id)).toEqual(["default", "fast", "plan", "review", "build", "explore", "summary"]);
    expect(resolveAgentModeValue("codex", "fast")).toBeUndefined();
    expect(resolveAgentModeValue("codex", "plan")).toBe("plan");
    expect(resolveAgentModeValue("gemini", "summary")).toBe("summary");
    expect(resolveAgentModeValue("gemini", "fast")).toBeUndefined();
    expect(resolveAgentModeValue("gemini", "auto")).toBeUndefined();
    expect(accessModeForAgentProfile({ agent: "codex", model: "default", reasoning: "default", mode: "plan" })).toBe("read-only");
    expect(accessModeForAgentProfile({ agent: "codex", model: "default", reasoning: "default", mode: "review" })).toBe("read-only");
    expect(accessModeForAgentProfile({ agent: "codex", model: "default", reasoning: "default", mode: "fast" })).toBe("unrestricted");
    expect(accessModeForAgentProfile({ agent: "codex", model: "default", reasoning: "default", mode: "build" })).toBe("unrestricted");
  });

  it("keeps auto-confirm as an explicit profile field only", () => {
    expect(normalizeAgentProfile({ agent: "codex", model: "default", reasoning: "default", mode: "fast" })).toEqual({
      agent: "codex",
      model: "default",
      reasoning: "default",
      mode: "default",
      fast: true,
    });
    expect(normalizeAgentProfile({ agent: "claude-code", model: "default", reasoning: "default", mode: "auto" })).toEqual({
      agent: "claude-code",
      model: "default",
      reasoning: "default",
      mode: "default",
    });
    expect(normalizeAgentProfile({ agent: "codex", model: "default", reasoning: "default", mode: "default", autoConfirm: true })).toEqual({
      agent: "codex",
      model: "default",
      reasoning: "default",
      mode: "default",
      autoConfirm: true,
    });
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
