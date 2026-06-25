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

  it("keeps status from overriding server ordering inside each section", () => {
    const projects: readonly Project[] = [
      {
        id: "project",
        name: "Project",
        conversations: [
          conversation({ id: "project-running-older", status: "running", updatedAtMs: 1000 }),
          conversation({ id: "project-idle-newer", status: "idle", updatedAtMs: 3000 }),
        ],
      },
    ];

    const sections = visibleConversationSections({
      projects,
      chats: [
        conversation({ id: "chat-done-older", status: "done", updatedAtMs: 1000 }),
        conversation({ id: "chat-idle-newer", status: "idle", updatedAtMs: 3000 }),
      ],
      wakeupConversationIds: new Set(),
      pinnedLabel: "Pinned",
      chatsLabel: "Chats",
    });

    expect(sections.map((section) => [section.idBase, section.conversations.map((item) => item.id)])).toEqual([
      ["project-group-project", ["project-running-older", "project-idle-newer"]],
      ["chats-group", ["chat-done-older", "chat-idle-newer"]],
    ]);
  });

  it("preserves server order for same-status conversations", () => {
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

    expect(sections[0]?.conversations.map((item) => item.id)).toEqual(["older", "newest", "middle"]);
  });

  it("orders pinned conversations by their manual pinned order", () => {
    const sections = visibleConversationSections({
      projects: [
        {
          id: "project",
          name: "Project",
          conversations: [conversation({ id: "project-pinned", pinned: true, pinnedOrder: 1024, updatedAtMs: 1000 })],
        },
      ],
      chats: [
        conversation({ id: "chat-newer", pinned: true, pinnedOrder: 3072, updatedAtMs: 5000 }),
        conversation({ id: "chat-middle", pinned: true, pinnedOrder: 2048, updatedAtMs: 3000 }),
      ],
      wakeupConversationIds: new Set(),
      pinnedLabel: "Pinned",
      chatsLabel: "Chats",
    });

    expect(sections[0]?.idBase).toBe("pinned-group");
    expect(sections[0]?.conversations.map((item) => item.id)).toEqual(["project-pinned", "chat-middle", "chat-newer"]);
  });

  it("keeps legacy pinned conversations without manual order in their fallback position", () => {
    const sections = visibleConversationSections({
      projects: [],
      chats: [
        conversation({ id: "legacy-pinned", pinned: true }),
        conversation({ id: "new-pinned", pinned: true, pinnedOrder: 2048 }),
      ],
      wakeupConversationIds: new Set(),
      pinnedLabel: "Pinned",
      chatsLabel: "Chats",
    });

    expect(sections[0]?.conversations.map((item) => item.id)).toEqual(["legacy-pinned", "new-pinned"]);
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
