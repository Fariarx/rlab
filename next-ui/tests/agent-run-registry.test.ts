import { describe, expect, it } from "vitest";
import { createAgentRunPluginRegistry, type AgentRunAdapters } from "../src/server/agents/run-registry";
import type { AgentRunRequest } from "../src/server/agents/run-plugin";

interface TestContext {
  readonly marker: string;
}

const request: AgentRunRequest = {
  accessMode: "unrestricted",
  agent: "claude-code",
  mode: "default",
  model: "default",
  prompt: "hello",
  reasoning: "default",
};

describe("agent run registry", () => {
  it("registers the supported agent runtimes through a common plugin contract", () => {
    const registry = createAgentRunPluginRegistry({
      claudeCode: { bin: "claude", run: () => undefined },
      codex: { bin: "codex", run: () => undefined },
      gemini: { bin: "gemini", buildArgs: () => ["--prompt"], createTranslator: () => () => [] },
      openCode: { bin: "opencode", run: () => undefined },
    } satisfies AgentRunAdapters<TestContext>);

    expect([...registry.keys()]).toEqual(["claude-code", "codex", "gemini", "opencode"]);
    expect(registry.get("claude-code")?.runtime).toBe("sdk");
    expect(registry.get("codex")?.runtime).toBe("server");
    expect(registry.get("gemini")?.runtime).toBe("cli");
    expect(registry.get("opencode")?.runtime).toBe("server");
  });

  it("preserves agent adapter handlers", async () => {
    let seenContext: TestContext | null = null;
    const registry = createAgentRunPluginRegistry({
      claudeCode: {
        bin: "claude",
        run: (_request, context) => {
          seenContext = context;
        },
      },
      codex: { bin: "codex", run: () => undefined },
      gemini: { bin: "gemini", buildArgs: () => ["--prompt"], createTranslator: () => () => [] },
      openCode: { bin: "opencode", run: () => undefined },
    } satisfies AgentRunAdapters<TestContext>);

    await registry.get("claude-code")?.run?.(request, { marker: "called" });

    expect(seenContext).toEqual({ marker: "called" });
  });
});
