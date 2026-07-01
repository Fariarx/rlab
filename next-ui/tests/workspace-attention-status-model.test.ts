import { describe, expect, it } from "vitest";
import type { ConversationSummary } from "../src/components/agent";
import { workspaceAttentionFaviconHref, workspaceAttentionStatus } from "../src/components/workspace/models/workspace-attention-status-model";

const base: ConversationSummary = {
  id: "base",
  title: "Base",
  snippet: "",
  time: "",
  status: "idle",
  agent: "codex",
};

function conversation(patch: Partial<ConversationSummary> & Pick<ConversationSummary, "id">): ConversationSummary {
  return { ...base, title: patch.id, ...patch };
}

describe("workspaceAttentionStatus", () => {
  it("prioritizes unread errors, unread actions, then unread completions", () => {
    expect(
      workspaceAttentionStatus([
        conversation({ id: "done", status: "done", unread: true }),
        conversation({ id: "running", status: "running" }),
        conversation({ id: "waiting", status: "waiting", unread: true }),
        conversation({ id: "error", status: "error", unread: true }),
      ]),
    ).toBe("error");

    expect(
      workspaceAttentionStatus([
        conversation({ id: "done", status: "done", unread: true }),
        conversation({ id: "running", status: "running" }),
        conversation({ id: "waiting", status: "waiting", unread: true }),
      ]),
    ).toBe("action");

    expect(
      workspaceAttentionStatus([
        conversation({ id: "done", status: "done", unread: true }),
        conversation({ id: "running", status: "running", activeRunId: "run-1" }),
      ]),
    ).toBe("done");

    expect(
      workspaceAttentionStatus([
        conversation({ id: "done", status: "done", unread: true }),
        conversation({ id: "stale-running", status: "running", activeRunId: "run-stale" }),
      ]),
    ).toBe("done");

    expect(workspaceAttentionStatus([conversation({ id: "stale-running", status: "running", activeRunId: "run-stale" })])).toBeNull();
    expect(workspaceAttentionStatus([conversation({ id: "stale-running", status: "running" })])).toBeNull();

    expect(workspaceAttentionStatus([conversation({ id: "done", status: "done", unread: true })])).toBe("done");
    expect(workspaceAttentionStatus([conversation({ id: "read-error", status: "error", unread: false })])).toBeNull();
    expect(workspaceAttentionStatus([conversation({ id: "read-waiting", status: "waiting", unread: false })])).toBeNull();
  });

  it("builds static favicon hrefs without animated frames", () => {
    expect(workspaceAttentionFaviconHref("action", true, 0)).toBe(workspaceAttentionFaviconHref("action", true, 3));
    expect(workspaceAttentionFaviconHref("error", true, 0)).toBe(workspaceAttentionFaviconHref("error", true, 3));
    expect(workspaceAttentionFaviconHref("done", true, 0)).toBe(workspaceAttentionFaviconHref("done", true, 3));
    expect(decodeURIComponent(workspaceAttentionFaviconHref("action", true, 0))).not.toContain("stroke-width=\"2.4\"");
  });
});
