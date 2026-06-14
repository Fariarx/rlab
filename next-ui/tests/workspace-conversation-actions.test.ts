import { describe, expect, it } from "vitest";
import type { Project } from "../src/components/agent";
import { projectIdForNewConversationFromRoute } from "../src/components/workspace/hooks/use-workspace-conversation-actions";

const projects: readonly Project[] = [
  {
    id: "project-1",
    name: "Project One",
    conversations: [],
  },
];

describe("workspace conversation actions", () => {
  it("uses the current project route when creating a conversation without an active selection", () => {
    expect(projectIdForNewConversationFromRoute({ kind: "project", projectId: "project-1" }, projects)).toBe("project-1");
  });

  it("ignores stale project routes and non-project routes", () => {
    expect(projectIdForNewConversationFromRoute({ kind: "project", projectId: "missing" }, projects)).toBeUndefined();
    expect(projectIdForNewConversationFromRoute({ kind: "chat", conversationId: "chat-1" }, projects)).toBeUndefined();
    expect(projectIdForNewConversationFromRoute(undefined, projects)).toBeUndefined();
  });
});
