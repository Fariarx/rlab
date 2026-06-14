import { type MutableRefObject, useMemo, useRef } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import type { ConversationListItem } from "./conversation-list-model";
import { visibleConversationIds } from "./conversation-list-model";

export interface ConversationListNavigation {
  readonly listConversationIds: readonly string[];
  readonly registerRowRef: (id: string, element: HTMLDivElement | null) => void;
  readonly moveConversation: (id: string, offset: -1 | 1) => void;
  readonly virtuosoRef: MutableRefObject<VirtuosoHandle | null>;
}

export function useConversationListNavigation({
  listItems,
  onSelect,
}: {
  readonly listItems: readonly ConversationListItem[];
  readonly onSelect: (id: string) => void;
}): ConversationListNavigation {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const listConversationIds = useMemo(() => visibleConversationIds(listItems), [listItems]);
  const conversationItemIndexes = useMemo(() => {
    const indexes = new Map<string, number>();
    listItems.forEach((item, index) => {
      if (item.kind === "conversation") {
        indexes.set(item.conversation.id, index);
      }
    });
    return indexes;
  }, [listItems]);

  const registerRowRef = (id: string, element: HTMLDivElement | null) => {
    if (element) {
      rowRefs.current.set(id, element);
    } else {
      rowRefs.current.delete(id);
    }
  };

  const focusConversation = (id: string) => {
    const index = conversationItemIndexes.get(id);
    if (index !== undefined) {
      virtuosoRef.current?.scrollToIndex({ align: "center", behavior: "auto", index });
    }
    const focus = () => rowRefs.current.get(id)?.focus();
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focus);
      window.requestAnimationFrame(() => window.requestAnimationFrame(focus));
    } else {
      window.setTimeout(focus, 0);
    }
  };

  const moveConversation = (id: string, offset: -1 | 1) => {
    const currentIndex = listConversationIds.indexOf(id);
    if (currentIndex < 0) {
      return;
    }
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), listConversationIds.length - 1);
    const nextId = listConversationIds[nextIndex];
    if (!nextId || nextId === id) {
      return;
    }
    onSelect(nextId);
    focusConversation(nextId);
  };

  return {
    listConversationIds,
    moveConversation,
    registerRowRef,
    virtuosoRef,
  };
}
