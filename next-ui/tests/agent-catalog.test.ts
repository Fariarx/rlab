import { describe, expect, it } from "vitest";
import {
  AGENTS,
  DEFAULT_AGENT_OPTION_ID,
  agentProfileLabels,
  getAgent,
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
    expect(resolveAgentModelValue("cursor", "gpt-5")).toBe("gpt-5");
    expect(resolveAgentModelValue("qwen", "qwen3.6-plus")).toBe("qwen3.6-plus");
    expect(resolveAgentReasoningValue("codex", "xhigh")).toBe("xhigh");
  });

  it("keeps every run adapter backed by selectable catalog options", () => {
    const runnable = AGENTS.filter((agent) => agent.runAdapter);

    expect(runnable.map((agent) => agent.id)).toEqual(["claude-code", "codex", "gemini", "amp", "opencode", "cursor", "qwen"]);
    expect(runnable.every((agent) => agent.models.length > 0 && agent.reasoning.length > 0 && agent.modes.length > 0)).toBe(true);
  });

  it("labels direct runtime model values that are not in the static catalog", () => {
    expect(agentProfileLabels({ agent: "opencode", model: "anthropic/claude-custom-lab", reasoning: "default", mode: "default" })).toEqual(["anthropic/claude-custom-lab"]);
    expect(agentProfileLabels({ agent: "cursor", model: "custom-cursor-model", reasoning: "default", mode: "default" })).toEqual(["custom-cursor-model"]);
  });
});
