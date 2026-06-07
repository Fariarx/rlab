import { describe, expect, it } from "vitest";
import {
  AGENTS,
  DEFAULT_AGENT_OPTION_ID,
  agentProfileLabels,
  getAgent,
  resolveAgentModeValue,
  resolveAgentModelValue,
  resolveAgentReasoningValue,
} from "../src/lib/agent-catalog";

describe("agent catalog", () => {
  it("is the shared source for UI options and CLI model values", () => {
    expect(getAgent("claude-code").models.map((option) => option.id)).toContain("claude-opus-4-7");
    expect(resolveAgentModelValue("claude-code", "claude-opus-4-7")).toBe("claude-opus-4-7");
    expect(resolveAgentModelValue("gemini", "gemini-2.5-flash-lite")).toBe("gemini-2.5-flash-lite");
    expect(resolveAgentModelValue("opencode", DEFAULT_AGENT_OPTION_ID)).toBe("opencode/deepseek-v4-flash-free");
    expect(resolveAgentModelValue("opencode", "anthropic-claude-opus-4-7")).toBe("anthropic/claude-opus-4-7");
    expect(resolveAgentReasoningValue("codex", "xhigh")).toBe("xhigh");
  });

  it("exposes practical work modes separately from models and reasoning", () => {
    expect(getAgent("claude-code").modes.map((option) => option.id)).toEqual(["default", "plan", "auto-edit", "auto", "bypass-permissions"]);
    expect(resolveAgentModeValue("claude-code", "auto-edit")).toBe("acceptEdits");
    expect(resolveAgentModeValue("claude-code", "bypass-permissions")).toBe("bypassPermissions");

    expect(getAgent("codex").modes.map((option) => option.id)).toEqual(["default", "plan", "review"]);
    expect(resolveAgentModeValue("codex", "plan")).toBe("plan");
    expect(resolveAgentModeValue("codex", "review")).toBe("review");

    expect(getAgent("gemini").modes.map((option) => option.id)).toEqual(["default", "plan", "auto-edit", "yolo"]);
    expect(resolveAgentModeValue("gemini", "auto-edit")).toBe("auto_edit");

    expect(getAgent("opencode").modes.map((option) => option.id)).toEqual(["default", "build", "plan", "explore", "general", "summary"]);
    expect(resolveAgentModeValue("opencode", "explore")).toBe("explore");
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
