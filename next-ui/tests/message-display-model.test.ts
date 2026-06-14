import { describe, expect, it } from "vitest";
import { agentMessageProfileLabel, elapsedSecondsSince, firstReasoningStartedAtMs, formatElapsedSeconds } from "../src/components/agent/message/message-display-model";
import type { AgentBlock } from "../src/components/agent/core/types";

describe("message-display-model", () => {
  it("formats elapsed seconds with caller-provided units", () => {
    expect(formatElapsedSeconds(4, { minute: "м", second: "с" })).toBe("4с");
    expect(formatElapsedSeconds(125, { minute: "м", second: "с" })).toBe("2м 5с");
    expect(formatElapsedSeconds(-3, { minute: "м", second: "с" })).toBe("0с");
  });

  it("computes elapsed seconds from a persisted start timestamp", () => {
    expect(elapsedSecondsSince(undefined, 10_000)).toBeNull();
    expect(elapsedSecondsSince(1_000, 3_600)).toBe(3);
  });

  it("finds the first reasoning start timestamp", () => {
    const blocks: AgentBlock[] = [
      { kind: "tool", name: "Read", state: "ok" },
      { kind: "reasoning", text: "first", startedAtMs: 10 },
      { kind: "reasoning", text: "second", startedAtMs: 20 },
    ];

    expect(firstReasoningStartedAtMs(blocks)).toBe(10);
    expect(firstReasoningStartedAtMs([{ kind: "text", text: "answer" }])).toBeUndefined();
  });

  it("builds compact agent profile labels", () => {
    expect(agentMessageProfileLabel(undefined)).toBeNull();
    expect(agentMessageProfileLabel({ agent: "codex", model: "default", reasoning: "default", mode: "default" })).toBe("Codex · Default");
    expect(agentMessageProfileLabel({ agent: "codex", model: "gpt-5.5", reasoning: "high", mode: "default" })).toBe("Codex · GPT-5.5 · high");
  });
});
