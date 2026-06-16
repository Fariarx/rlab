import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../src/components/agent";
import { WorkspacePendingMessageQueue } from "../src/components/workspace/runtime/workspace-pending-message-queue";

function userMessage(id: string): ChatMessage {
  return { id, role: "user", text: id, time: "12:00" };
}

describe("WorkspacePendingMessageQueue", () => {
  it("returns queued messages in FIFO order and clears empty queues", () => {
    const queue = new WorkspacePendingMessageQueue();
    queue.enqueue("chat-1", userMessage("u1"));
    queue.enqueue("chat-1", userMessage("u2"));

    expect(queue.count("chat-1")).toBe(2);
    expect(queue.has("chat-1")).toBe(true);
    expect(queue.takeNext("chat-1")?.id).toBe("u1");
    expect(queue.count("chat-1")).toBe(1);
    expect(queue.takeNext("chat-1")?.id).toBe("u2");
    expect(queue.count("chat-1")).toBe(0);
    expect(queue.has("chat-1")).toBe(false);
    expect(queue.takeNext("chat-1")).toBeNull();
  });

  it("keeps queues isolated by conversation id", () => {
    const queue = new WorkspacePendingMessageQueue();
    queue.enqueue("chat-1", userMessage("u1"));
    queue.enqueue("chat-2", userMessage("u2"));

    expect(queue.takeNext("chat-2")?.id).toBe("u2");
    expect(queue.takeNext("chat-1")?.id).toBe("u1");
  });

  it("tracks a paused flag per conversation and resets it once the queue empties", () => {
    const queue = new WorkspacePendingMessageQueue();
    queue.enqueue("chat-1", userMessage("u1"));
    expect(queue.isPaused("chat-1")).toBe(false);

    queue.setPaused("chat-1", true);
    expect(queue.isPaused("chat-1")).toBe(true);
    // Pausing does not drain — the turn stays queued.
    expect(queue.has("chat-1")).toBe(true);

    queue.setPaused("chat-1", false);
    expect(queue.isPaused("chat-1")).toBe(false);

    // Emptying the queue clears any lingering paused flag.
    queue.setPaused("chat-1", true);
    queue.takeNext("chat-1");
    expect(queue.has("chat-1")).toBe(false);
    expect(queue.isPaused("chat-1")).toBe(false);
  });

  it("forgets all queued messages for a removed conversation", () => {
    const queue = new WorkspacePendingMessageQueue();
    queue.enqueue("chat-1", userMessage("u1"));
    queue.enqueue("chat-1", userMessage("u2"));

    queue.forget("chat-1");

    expect(queue.count("chat-1")).toBe(0);
    expect(queue.takeNext("chat-1")).toBeNull();
  });
});
