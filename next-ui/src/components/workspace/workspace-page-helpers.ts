import type { HashRoute } from "../../lib/use-hash-route";
import type { useI18n } from "../../i18n/I18nProvider";
import {
  agentProfileCompactLabel,
  type AgentProfile,
  type ChatMessage,
  type ConversationStatus,
  type ConversationSummary,
  type ConversationView,
  type DiffBlock,
  type Project,
} from "../agent";
import { splitUserContent } from "../agent/message/message-content-model";

export interface ConversationRouteWorkspace {
  readonly chats: readonly ConversationSummary[];
  readonly projects: readonly Project[];
}

const CONVERSATION_VIEWS = new Set<ConversationView>(["chat", "git", "resources", "preview", "terminal"]);

export function normalizeConversationView(view: ConversationView | undefined, terminalEnabled: boolean, previewEnabled = true): ConversationView {
  if (!view || !CONVERSATION_VIEWS.has(view)) {
    return "chat";
  }
  if (view === "terminal" && !terminalEnabled) {
    return "chat";
  }
  if (view === "preview" && !previewEnabled) {
    return "chat";
  }
  return view;
}

/** The visible text of a sent user message (attachment blocks and file-link
 *  markdown removed) for ArrowUp history recall. */
export function composerHistoryText(raw: string): string {
  return splitUserContent(raw).text;
}

export function buildComposerLabel(profile: AgentProfile): string {
  return agentProfileCompactLabel(profile, "lower", { includeDefaults: true });
}

export function liveModesOrCatalog<T extends { readonly id: string }>(catalogOptions: readonly T[], liveOptions: readonly T[] | undefined): readonly T[] {
  if (!liveOptions?.length) {
    return catalogOptions;
  }
  const seen = new Set(catalogOptions.map((option) => option.id));
  const merged = [...catalogOptions];
  for (const option of liveOptions) {
    if (!seen.has(option.id)) {
      seen.add(option.id);
      merged.push(option);
    }
  }
  return merged;
}

function projectForConversation(workspace: ConversationRouteWorkspace, conversationId: string): { readonly id: string; readonly name: string } | null {
  const project = workspace.projects.find((item) => item.conversations.some((conversation) => conversation.id === conversationId));
  return project ? { id: project.id, name: project.name } : null;
}

export function routeForConversation(workspace: ConversationRouteWorkspace, conversationId: string): HashRoute {
  const project = projectForConversation(workspace, conversationId);
  return project ? { kind: "project", projectId: project.id, conversationId } : { kind: "chat", conversationId };
}

export function workspaceConversations(workspace: ConversationRouteWorkspace): readonly ConversationSummary[] {
  return [...workspace.chats, ...workspace.projects.flatMap((project) => project.conversations)];
}

export function firstVisibleConversationId(workspace: ConversationRouteWorkspace): string {
  const conversations = workspaceConversations(workspace);
  return conversations.find((conversation) => !conversation.archived)?.id ?? conversations[0]?.id ?? "";
}

export function latestAgentDiffBlocks(messages: readonly ChatMessage[]): readonly DiffBlock[] {
  const lastAgentMessage = [...messages].reverse().find((message) => message.role === "agent" && message.blocks?.some((block) => block.kind === "diff"));
  return lastAgentMessage?.blocks?.filter((block): block is DiffBlock => block.kind === "diff") ?? [];
}

function messageHasLiveAgentWork(message: ChatMessage): boolean {
  if (message.role !== "agent") {
    return false;
  }
  return Boolean(
    message.blocks?.some((block) => {
      switch (block.kind) {
        case "reasoning":
          return block.active === true;
        case "text":
          return block.streaming === true;
        case "tool":
        case "command":
        case "search":
          return block.state === "running";
        case "plan":
          return block.steps.some((step) => step.state === "running");
        default:
          return false;
      }
    }),
  );
}

export function conversationHasActiveWork(conversation: ConversationSummary | null, messages: readonly ChatMessage[]): boolean {
  return Boolean(
    conversation &&
      (conversation.activeRunId ||
        messages.some(messageHasLiveAgentWork)),
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

export function runToastForStatus(status: ConversationStatus, title: string, t: Translate) {
  if (status === "done") {
    return { message: t("runCompletedToast", { title }), severity: "success" as const };
  }
  if (status === "waiting") {
    return { message: t("runNeedsInputToast", { title }), severity: "warning" as const };
  }
  if (status === "error") {
    return { message: t("runFailedToast", { title }), severity: "error" as const };
  }
  return null;
}

export function runNotificationForStatus(status: ConversationStatus, title: string, t: Translate) {
  if (status === "done") {
    return { title: t("runCompletedNotificationTitle"), body: title };
  }
  if (status === "waiting") {
    return { title: t("runNeedsInputNotificationTitle"), body: title };
  }
  if (status === "error") {
    return { title: t("runFailedNotificationTitle"), body: title };
  }
  return null;
}

export function showDesktopNotification(enabled: boolean, notification: { readonly title: string; readonly body: string } | null): void {
  if (!enabled || notification == null || typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }
  try {
    new Notification(notification.title, { body: notification.body });
  } catch (error) {
    console.warn(`[rlab] Browser notification show failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Ask the browser for notification permission when notifications are enabled but
 *  the user hasn't decided yet. Best-effort: browsers may require a user gesture,
 *  so this is also called from the settings toggle. Safe to call repeatedly. */
export function ensureBrowserNotificationPermission(enabled: boolean): void {
  if (!enabled || typeof Notification === "undefined" || Notification.permission !== "default") {
    return;
  }
  try {
    void Promise.resolve(Notification.requestPermission()).catch((error: unknown) => {
      console.warn(`[rlab] Browser notification permission request failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  } catch (error) {
    console.warn(`[rlab] Browser notification permission request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
