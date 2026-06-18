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

  it("keeps status from overriding recency ordering inside each section", () => {
    const projects: readonly Project[] = [
      {
        id: "project",
        name: "Project",
        conversations: [
          conversation({ id: "project-idle-newer", status: "idle", updatedAtMs: 3000 }),
          conversation({ id: "project-running-older", status: "running", updatedAtMs: 1000 }),
        ],
      },
    ];

    const sections = visibleConversationSections({
      projects,
      chats: [
        conversation({ id: "chat-idle-newer", status: "idle", updatedAtMs: 3000 }),
        conversation({ id: "chat-done-older", status: "done", updatedAtMs: 1000 }),
      ],
      wakeupConversationIds: new Set(),
      pinnedLabel: "Pinned",
      chatsLabel: "Chats",
    });

    expect(sections.map((section) => [section.idBase, section.conversations.map((item) => item.id)])).toEqual([
      ["project-group-project", ["project-idle-newer", "project-running-older"]],
      ["chats-group", ["chat-idle-newer", "chat-done-older"]],
    ]);
  });

  it("orders same-status conversations by recency, newest first", () => {
    const sections = visibleConversationSections({
      projects: [],
      chats: [
        conversation({ id: "older", updatedAtMs: 1000 }),
        conversation({ id: "newest", updatedAtMs: 3000 }),
        conversation({ id: "middle", updatedAtMs: 2000 }),
      ],
      wakeupConversationIds: new Set(),
      pinnedLabel: "Pinned",
      chatsLabel: "Chats",
    });

    expect(sections[0]?.conversations.map((item) => item.id)).toEqual(["newest", "middle", "older"]);
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

  it("limits each open section to four conversations until it is expanded", () => {
    const sections = visibleConversationSections({
      projects: [],
      chats: ["one", "two", "three", "four", "five", "six"].map((id) => conversation({ id })),
      wakeupConversationIds: new Set(),
      pinnedLabel: "Pinned",
      chatsLabel: "Chats",
    });

    const limitedItems = buildConversationListItems(sections, new Set());
    expect(visibleConversationIds(limitedItems)).toEqual(["one", "two", "three", "four"]);
    expect(limitedItems).toContainEqual({ kind: "show-more", idBase: "chats-group", hiddenCount: 2, delay: 320 });

    const expandedItems = buildConversationListItems(sections, new Set(), new Set(["chats-group"]));
    expect(visibleConversationIds(expandedItems)).toEqual(["one", "two", "three", "four", "five", "six"]);
    expect(expandedItems.some((item) => item.kind === "show-more")).toBe(false);
  });
});
