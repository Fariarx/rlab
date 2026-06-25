import { conversationPreviewSnippet } from "../../../lib/conversation-preview";
import { messageToPlainText } from "../message/message-actions";
import { conversationStatusKey as statusToKey, type ChatMessage, type ConversationSummary, type Project } from "../core/types";

export const CONVERSATION_SECTION_INITIAL_LIMIT = 4;
export type ConversationUnreadAttentionStatus = "error" | "action" | "done";

export type ConversationListIconKind = "pin" | "project" | "chat";

export interface ConversationListSection {
  readonly idBase: string;
  readonly label: string;
  readonly conversations: readonly ConversationSummary[];
  readonly baseDelay: number;
  readonly iconKind: ConversationListIconKind;
}

export type ConversationListItem =
  | {
      readonly kind: "group";
      readonly idBase: string;
      readonly label: string;
      readonly conversations: readonly ConversationSummary[];
      readonly delay: number;
      readonly iconKind: ConversationListIconKind;
    }
  | {
      readonly kind: "conversation";
      readonly conversation: ConversationSummary;
      readonly delay: number;
    }
  | {
      readonly kind: "show-more";
      readonly idBase: string;
      readonly hiddenCount: number;
      readonly delay: number;
    }
  | {
      readonly kind: "empty";
    };

export function conversationMatches(conversation: ConversationSummary, query: string, threads: Readonly<Record<string, readonly ChatMessage[]>>): boolean {
  const threadText = (threads[conversation.id] ?? []).map(messageToPlainText).join("\n");
  const summaryText = conversationPreviewSnippet(threads[conversation.id] ?? [], 60) || conversation.snippet;
  const archiveText = conversation.archived ? "\narchive archived архив" : "";
  const searchable = `${conversation.title}\n${summaryText}${archiveText}\n${threadText}`.toLowerCase();
  return searchable.includes(query);
}

export function visualStatusKey(conversation: ConversationSummary, hasWakeup: boolean) {
  if (hasWakeup) {
    return "warn" as const;
  }
  return statusToKey[conversation.status];
}

export function unreadAttentionStatus(conversation: ConversationSummary): ConversationUnreadAttentionStatus | null {
  if (conversation.unread !== true) {
    return null;
  }
  if (conversation.status === "error") {
    return "error";
  }
  if (conversation.status === "waiting") {
    return "action";
  }
  if (conversation.status === "done") {
    return "done";
  }
  return null;
}

export function sortedConversationsByActivity(conversations: readonly ConversationSummary[]): readonly ConversationSummary[] {
  return conversations;
}

const PINNED_ORDER_FALLBACK_STEP = 1024;

export function sortPinnedConversations(conversations: readonly ConversationSummary[]): readonly ConversationSummary[] {
  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((left, right) => {
      const leftOrder = typeof left.conversation.pinnedOrder === "number" && Number.isFinite(left.conversation.pinnedOrder)
        ? left.conversation.pinnedOrder
        : (left.index + 1) * PINNED_ORDER_FALLBACK_STEP;
      const rightOrder = typeof right.conversation.pinnedOrder === "number" && Number.isFinite(right.conversation.pinnedOrder)
        ? right.conversation.pinnedOrder
        : (right.index + 1) * PINNED_ORDER_FALLBACK_STEP;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.index - right.index;
    })
    .map((item) => item.conversation);
}

export function visibleConversationSections({
  projects,
  chats,
  pinnedLabel,
  chatsLabel,
}: {
  readonly projects: readonly Project[];
  readonly chats: readonly ConversationSummary[];
  readonly wakeupConversationIds: ReadonlySet<string>;
  readonly pinnedLabel: string;
  readonly chatsLabel: string;
}): readonly ConversationListSection[] {
  const pinned = sortPinnedConversations([...chats, ...projects.flatMap((project) => project.conversations)].filter((conversation) => conversation.pinned && !conversation.archived));
  const visibleProjects = projects
    .map((project) => ({
      ...project,
      conversations: sortedConversationsByActivity(project.conversations.filter((conversation) => !conversation.pinned && !conversation.archived)),
    }))
    .filter((project) => project.conversations.length > 0);
  const visibleChats = sortedConversationsByActivity(chats.filter((conversation) => !conversation.pinned && !conversation.archived));

  const sections: ConversationListSection[] = [];
  if (pinned.length > 0) {
    sections.push({ idBase: "pinned-group", label: pinnedLabel, conversations: pinned, baseDelay: 0, iconKind: "pin" });
  }

  visibleProjects.forEach((project, index) => {
    sections.push({
      idBase: `project-group-${project.id}`,
      label: project.name,
      conversations: project.conversations,
      baseDelay: (index + 1) * 120,
      iconKind: "project",
    });
  });

  if (visibleChats.length > 0) {
    sections.push({
      idBase: "chats-group",
      label: chatsLabel,
      conversations: visibleChats,
      baseDelay: (visibleProjects.length + 1) * 120,
      iconKind: "chat",
    });
  }

  return sections;
}

export function buildConversationListItems(
  sections: readonly ConversationListSection[],
  collapsedGroups: ReadonlySet<string>,
  expandedGroups: ReadonlySet<string> = new Set<string>(),
): readonly ConversationListItem[] {
  if (sections.length === 0) {
    return [{ kind: "empty" }];
  }

  const items: ConversationListItem[] = [];
  for (const section of sections) {
    items.push({
      kind: "group",
      idBase: section.idBase,
      label: section.label,
      conversations: section.conversations,
      delay: section.baseDelay,
      iconKind: section.iconKind,
    });
    if (!collapsedGroups.has(section.idBase)) {
      const expanded = expandedGroups.has(section.idBase);
      const visibleConversations = expanded ? section.conversations : section.conversations.slice(0, CONVERSATION_SECTION_INITIAL_LIMIT);
      visibleConversations.forEach((conversation, index) => {
        items.push({ kind: "conversation", conversation, delay: section.baseDelay + index * 50 });
      });
      const hiddenCount = section.conversations.length - visibleConversations.length;
      if (hiddenCount > 0) {
        items.push({
          kind: "show-more",
          idBase: section.idBase,
          hiddenCount,
          delay: section.baseDelay + visibleConversations.length * 50,
        });
      }
    }
  }
  return items;
}

export function visibleConversationIds(items: readonly ConversationListItem[]): readonly string[] {
  return items.flatMap((item) => (item.kind === "conversation" ? [item.conversation.id] : []));
}
