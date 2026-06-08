import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../src/components/agent";
import { buildAgentPrompt } from "../src/components/workspace/use-workspace";

describe("buildAgentPrompt", () => {
  it("sends only the text for the first message (no prior turns)", () => {
    expect(buildAgentPrompt([], "Hello")).toBe("Hello");
  });

  it("replays prior user and agent turns so the agent keeps the thread", () => {
    const prior: ChatMessage[] = [
      { id: "u1", role: "user", text: "What is 2+2?" },
      {
        id: "a1",
        role: "agent",
        blocks: [
          { kind: "reasoning", text: "let me think" },
          { kind: "tool", name: "Calc", state: "ok", output: "4" },
          { kind: "text", text: "It's 4." },
        ],
      },
    ];

    const prompt = buildAgentPrompt(prior, "And times 3?");

    expect(prompt).toContain("User: What is 2+2?");
    expect(prompt).toContain("Assistant: It's 4.");
    expect(prompt).toContain("User: And times 3?");
    // Reasoning and tool noise are kept out of the replayed history.
    expect(prompt).not.toContain("let me think");
    expect(prompt).not.toContain("Calc");
  });

  it("skips empty/blockless messages without producing dangling role labels", () => {
    const prior: ChatMessage[] = [
      { id: "u1", role: "user", text: "first" },
      { id: "a1", role: "agent", blocks: [{ kind: "reasoning", text: "only thinking, no answer yet" }] },
    ];

    const prompt = buildAgentPrompt(prior, "second");

    expect(prompt).toContain("User: first");
    expect(prompt).not.toContain("Assistant:");
    expect(prompt).toContain("User: second");
  });
});
