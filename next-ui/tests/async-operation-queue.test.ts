import { describe, expect, it } from "vitest";
import { AsyncOperationQueue } from "../src/server/async-operation-queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("AsyncOperationQueue", () => {
  it("runs operations sequentially", async () => {
    const queue = new AsyncOperationQueue();
    const first = deferred();
    const events: string[] = [];

    queue.enqueue(async () => {
      events.push("first:start");
      await first.promise;
      events.push("first:end");
    });
    queue.enqueue(() => {
      events.push("second");
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    first.resolve();
    await queue.idle();

    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("continues after a failed operation", async () => {
    const queue = new AsyncOperationQueue();
    const events: string[] = [];

    queue.enqueue(async () => {
      events.push("first");
      throw new Error("failed");
    });
    queue.enqueue(() => {
      events.push("second");
    });

    await queue.idle();

    expect(events).toEqual(["first", "second"]);
  });
});
