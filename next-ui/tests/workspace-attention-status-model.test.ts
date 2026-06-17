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
  it("prioritizes unread errors, actions, running agents, then unread completions", () => {
    expect(
      workspaceAttentionStatus([
        conversation({ id: "done", status: "done", unread: true }),
        conversation({ id: "running", status: "running" }),
        conversation({ id: "waiting", status: "waiting" }),
        conversation({ id: "error", status: "error", unread: true }),
      ]),
    ).toBe("error");

    expect(
      workspaceAttentionStatus([
        conversation({ id: "done", status: "done", unread: true }),
        conversation({ id: "running", status: "running" }),
        conversation({ id: "waiting", status: "waiting" }),
      ]),
    ).toBe("action");

    expect(
      workspaceAttentionStatus([
        conversation({ id: "done", status: "done", unread: true }),
        conversation({ id: "running", status: "running" }),
      ]),
    ).toBe("working");

    expect(workspaceAttentionStatus([conversation({ id: "done", status: "done", unread: true })])).toBe("done");
    expect(workspaceAttentionStatus([conversation({ id: "read-error", status: "error", unread: false })])).toBeNull();
  });

  it("builds changing wave frames for attention states and a static one for done", () => {
    expect(workspaceAttentionFaviconHref("action", true, 0)).not.toBe(workspaceAttentionFaviconHref("action", true, 3));
    expect(workspaceAttentionFaviconHref("working", true, 0)).not.toBe(workspaceAttentionFaviconHref("working", true, 3));
    expect(workspaceAttentionFaviconHref("error", true, 0)).not.toBe(workspaceAttentionFaviconHref("error", true, 3));
    expect(workspaceAttentionFaviconHref("done", true, 0)).toBe(workspaceAttentionFaviconHref("done", true, 3));
    expect(decodeURIComponent(workspaceAttentionFaviconHref("working", true, 0))).toContain("stroke-width=\"2.4\"");
    expect(decodeURIComponent(workspaceAttentionFaviconHref("working", true, 3))).toContain("r=\"7.95\"");
  });
});
