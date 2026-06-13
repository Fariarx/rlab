import { describe, expect, it } from "vitest";
import { commandToEvent, parseRlabEvent } from "../src/lib/rlab-events";

describe("rlab event contract", () => {
  it("maps a run request command to the exact requested event", () => {
    expect(
      commandToEvent(
        {
          commandId: "cmd-1",
          clientId: "client-1",
          correlationId: "corr-1",
          command: {
            type: "run.request",
            runId: "run-1",
            conversationId: "conversation-1",
            userMessageId: "user-1",
            agentMessageId: "agent-1",
            prompt: "ship it",
            agent: "codex",
            model: "default",
            reasoning: "default",
            mode: "default",
          },
        },
        "2026-06-13T12:00:00.000Z",
      ),
    ).toEqual({
      type: "run.requested",
      data: {
        runId: "run-1",
        conversationId: "conversation-1",
        userMessageId: "user-1",
        agentMessageId: "agent-1",
        prompt: "ship it",
        agent: "codex",
        model: "default",
        reasoning: "default",
        mode: "default",
      },
      metadata: {
        schemaVersion: 1,
        commandId: "cmd-1",
        clientId: "client-1",
        correlationId: "corr-1",
        createdAt: "2026-06-13T12:00:00.000Z",
      },
    });
  });

  it("rejects state-shaped run events with invalid payloads", () => {
    expect(() =>
      parseRlabEvent({
        type: "run.completed",
        data: { state: "done" },
        metadata: {
          schemaVersion: 1,
          commandId: "cmd-1",
          clientId: "client-1",
          correlationId: "cmd-1",
          createdAt: "2026-06-13T12:00:00.000Z",
        },
      }),
    ).toThrow();
  });
});
