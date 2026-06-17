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

  it("builds an animated SVG favicon for attention states and a static one for done", () => {
    expect(decodeURIComponent(workspaceAttentionFaviconHref("error", true))).toContain("repeatCount=\"indefinite\"");
    expect(decodeURIComponent(workspaceAttentionFaviconHref("done", true))).not.toContain("repeatCount=\"indefinite\"");
  });
});
