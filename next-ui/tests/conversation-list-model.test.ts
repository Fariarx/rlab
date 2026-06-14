import { describe, expect, it } from "vitest";
import type { ConversationSummary, Project } from "../src/components/agent";
import { buildConversationListItems, visibleConversationIds, visibleConversationSections } from "../src/components/agent/conversation/conversation-list-model";

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

describe("conversation-list-model", () => {
  it("lifts pinned conversations into their own section and hides archived conversations", () => {
    const sections = visibleConversationSections({
      projects: [],
      chats: [
        conversation({ id: "archived", archived: true }),
        conversation({ id: "pinned", pinned: true }),
        conversation({ id: "plain" }),
      ],
      wakeupConversationIds: new Set(),
      pinnedLabel: "Pinned",
      chatsLabel: "Chats",
    });

    expect(sections.map((section) => [section.idBase, section.conversations.map((item) => item.id)])).toEqual([
      ["pinned-group", ["pinned"]],
      ["chats-group", ["plain"]],
    ]);
  });

  it("sorts active conversations inside each section without moving them between sections", () => {
    const projects: readonly Project[] = [
      {
        id: "project",
        name: "Project",
        conversations: [
          conversation({ id: "project-idle", status: "idle" }),
          conversation({ id: "project-running", status: "running" }),
        ],
      },
    ];

    const sections = visibleConversationSections({
      projects,
      chats: [
        conversation({ id: "chat-idle", status: "idle" }),
        conversation({ id: "chat-done", status: "done" }),
      ],
      wakeupConversationIds: new Set(),
      pinnedLabel: "Pinned",
      chatsLabel: "Chats",
    });

    expect(sections.map((section) => [section.idBase, section.conversations.map((item) => item.id)])).toEqual([
      ["project-group-project", ["project-running", "project-idle"]],
      ["chats-group", ["chat-done", "chat-idle"]],
    ]);
  });

  it("flattens only expanded conversation rows for keyboard navigation", () => {
    const sections = visibleConversationSections({
      projects: [],
      chats: [conversation({ id: "first" }), conversation({ id: "second" })],
      wakeupConversationIds: new Set(),
      pinnedLabel: "Pinned",
      chatsLabel: "Chats",
    });

    const expandedItems = buildConversationListItems(sections, new Set());
    const collapsedItems = buildConversationListItems(sections, new Set(["chats-group"]));

    expect(visibleConversationIds(expandedItems)).toEqual(["first", "second"]);
    expect(visibleConversationIds(collapsedItems)).toEqual([]);
  });
});
