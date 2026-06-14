import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationSummary } from "../src/components/agent";
import type { ConversationListItem } from "../src/components/agent/conversation/conversation-list-model";
import { useConversationListNavigation, type ConversationListNavigation } from "../src/components/agent/conversation/use-conversation-list-navigation";

function conversation(id: string): ConversationSummary {
  return {
    id,
    title: id,
    snippet: id,
    time: "12:00",
    status: "idle",
    agent: "codex",
  };
}

function item(id: string): ConversationListItem {
  return { kind: "conversation", conversation: conversation(id), delay: 0 };
}

function Harness({
  listItems,
  onSelect,
  capture,
}: {
  readonly listItems: readonly ConversationListItem[];
  readonly onSelect: (id: string) => void;
  readonly capture: (navigation: ConversationListNavigation) => void;
}) {
  const navigation = useConversationListNavigation({ listItems, onSelect });

  useEffect(() => {
    capture(navigation);
  }, [capture, navigation]);

  return null;
}

describe("useConversationListNavigation", () => {
  it("moves between visible conversation rows only", async () => {
    const onSelect = vi.fn();
    const captured: { current: ConversationListNavigation | null } = { current: null };
    const listItems: readonly ConversationListItem[] = [
      { kind: "group", idBase: "chats", label: "Chats", conversations: [], delay: 0, iconKind: "chat" },
      item("first"),
      item("second"),
      { kind: "empty" },
    ];

    render(
      <Harness
        listItems={listItems}
        onSelect={onSelect}
        capture={(navigation) => {
          captured.current = navigation;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    expect(captured.current?.listConversationIds).toEqual(["first", "second"]);

    captured.current?.moveConversation("first", 1);

    expect(onSelect).toHaveBeenCalledWith("second");
  });

  it("does not move beyond list boundaries or from unknown ids", async () => {
    const onSelect = vi.fn();
    const captured: { current: ConversationListNavigation | null } = { current: null };

    render(
      <Harness
        listItems={[item("first")]}
        onSelect={onSelect}
        capture={(navigation) => {
          captured.current = navigation;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    captured.current?.moveConversation("first", -1);
    captured.current?.moveConversation("missing", 1);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("scrolls and focuses the selected row after moving", async () => {
    const onSelect = vi.fn();
    const captured: { current: ConversationListNavigation | null } = { current: null };
    const scrollToIndex = vi.fn();
    const row = document.createElement("div");
    const focus = vi.spyOn(row, "focus");

    render(
      <Harness
        listItems={[item("first"), item("second")]}
        onSelect={onSelect}
        capture={(navigation) => {
          captured.current = navigation;
        }}
      />,
    );

    await waitFor(() => expect(captured.current).not.toBeNull());
    if (captured.current) {
      captured.current.virtuosoRef.current = { scrollToIndex } as unknown as ConversationListNavigation["virtuosoRef"]["current"];
      captured.current.registerRowRef("second", row);
    }

    captured.current?.moveConversation("first", 1);

    expect(scrollToIndex).toHaveBeenCalledWith({ align: "center", behavior: "auto", index: 1 });
    await waitFor(() => expect(focus).toHaveBeenCalled());
  });
});
