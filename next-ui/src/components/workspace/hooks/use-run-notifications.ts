import { useEffect, useRef } from "react";
import type { useI18n } from "../../../i18n/I18nProvider";
import type { ConversationStatus, ConversationSummary } from "../../agent";
import type { ToastOptions } from "../../ui";
import { ensureBrowserNotificationPermission, runNotificationForStatus, runToastForStatus, showDesktopNotification } from "../workspace-page-helpers";

type Translate = ReturnType<typeof useI18n>["t"];

export interface RunNotificationController {
  readonly mark: (conversationId: string) => void;
  readonly forget: (conversationId: string) => void;
}

export interface UseRunNotificationsOptions {
  readonly conversations: readonly ConversationSummary[];
  readonly selectedId: string;
  readonly desktopNotifications: boolean;
  readonly t: Translate;
  readonly toast: (options: ToastOptions) => string;
}

export function useRunNotifications({
  conversations,
  selectedId,
  desktopNotifications,
  t,
  toast,
}: UseRunNotificationsOptions): RunNotificationController {
  const notifiableRuns = useRef(new Set<string>());
  const previousStatuses = useRef(new Map<string, ConversationStatus>());

  // Request browser notification permission when notifications are enabled so the
  // first run completion/wait can actually surface one (the setting defaults on,
  // so most users never toggle it manually).
  useEffect(() => {
    ensureBrowserNotificationPermission(desktopNotifications);
  }, [desktopNotifications]);

  useEffect(() => {
    const nextStatuses = new Map(conversations.map((conversation) => [conversation.id, conversation.status]));
    for (const conversation of conversations) {
      const previousStatus = previousStatuses.current.get(conversation.id);
      const activeRunStatusChanged =
        previousStatus !== undefined &&
        previousStatus !== conversation.status &&
        (previousStatus === "running" || previousStatus === "waiting") &&
        conversation.status !== "running";
      if (activeRunStatusChanged && notifiableRuns.current.has(conversation.id)) {
        if (conversation.status !== "waiting") {
          notifiableRuns.current.delete(conversation.id);
        }
        const isForeground = conversation.id === selectedId;
        const skip = conversation.status === "done" && isForeground;
        if (!skip) {
          const runToast = runToastForStatus(conversation.status, conversation.title, t);
          if (runToast) {
            toast({ ...runToast, duration: 3500 });
          }
          showDesktopNotification(desktopNotifications, runNotificationForStatus(conversation.status, conversation.title, t));
        }
      }
    }
    previousStatuses.current = nextStatuses;
  }, [conversations, desktopNotifications, selectedId, t, toast]);

  return {
    mark: (conversationId: string) => {
      notifiableRuns.current.add(conversationId);
    },
    forget: (conversationId: string) => {
      notifiableRuns.current.delete(conversationId);
    },
  };
}
