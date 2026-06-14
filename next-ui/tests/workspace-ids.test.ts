import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationSummary } from "../src/domain/agent-types";
import { DEFAULT_PROFILE } from "../src/lib/agent-catalog";
import { generatedWorkspaceIdSequence, nextWorkspaceId, syncGeneratedWorkspaceIdSequence } from "../src/lib/workspace-ids";
import { buildEmptyWorkspaceState } from "../src/lib/workspace-state";

function conversation(id: string, patch: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id,
    title: "Chat",
    agent: DEFAULT_PROFILE.agent,
    profile: DEFAULT_PROFILE,
    snippet: "",
    time: "now",
    status: "idle",
    ...patch,
  };
}

describe("workspace ids", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses generated numeric id sequences", () => {
    expect(generatedWorkspaceIdSequence("chat-42")).toBe(42);
    expect(generatedWorkspaceIdSequence("u-103")).toBe(103);
    expect(generatedWorkspaceIdSequence("a-9")).toBe(9);
    expect(generatedWorkspaceIdSequence("run-77")).toBe(77);
    expect(generatedWorkspaceIdSequence("chat-not-numeric")).toBe(0);
    expect(generatedWorkspaceIdSequence(undefined)).toBe(0);
  });

  it("keeps fallback ids ahead of loaded workspace ids", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(undefined as unknown as ReturnType<Crypto["randomUUID"]>);
    syncGeneratedWorkspaceIdSequence({
      ...buildEmptyWorkspaceState(),
      chats: [conversation("chat-1100", { title: "Top chat" })],
      projects: [
        {
          id: "project-1",
          name: "Project",
          path: "/repo",
          conversations: [conversation("chat-1200", { title: "Project chat", activeRunId: "run-1400" })],
        },
      ],
      threads: {
        "chat-1200": [{ id: "u-1300", role: "user", text: "hello", time: "now" }],
      },
    });

    expect(nextWorkspaceId("chat")).toMatch(/^chat-1401-/);
  });
});
