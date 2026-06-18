import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteWakeup, loadWakeups, type WakeupSummary } from "../../../client/api/workspace-page-api";
import type { ToastOptions } from "../../ui";

export interface UseWakeupsOptions {
  readonly selectedConversationId: string | undefined;
  readonly selectedStatus: string | undefined;
  readonly messageCount: number;
  readonly toast: (options: ToastOptions) => string;
}

export interface WakeupsController {
  readonly wakeups: readonly WakeupSummary[];
  readonly selectedWakeups: readonly WakeupSummary[];
  readonly wakeupConversationIds: ReadonlySet<string>;
  readonly removeWakeup: (wakeupId: string) => void;
}

const WAKEUPS_POLL_MS = 30_000;

export function useWakeups({
  selectedConversationId,
  toast,
}: UseWakeupsOptions): WakeupsController {
  const [wakeups, setWakeups] = useState<readonly WakeupSummary[]>([]);

  const refreshWakeups = useCallback((_reason: string) => {
    loadWakeups()
      .then(setWakeups)
      .catch(() => setWakeups([]));
  }, []);

  useEffect(() => {
    let canceled = false;
    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      loadWakeups()
        .then((items) => {
          if (!canceled) {
            setWakeups(items);
          }
        })
        .catch(() => {
          if (!canceled) {
            setWakeups([]);
          }
        });
    };
    const handleVisibilityChange = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        refresh();
      }
    };
    refresh();
    const timer = window.setInterval(refresh, WAKEUPS_POLL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      canceled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const removeWakeup = useCallback((wakeupId: string) => {
    if (!selectedConversationId) {
      return;
    }
    const conversationId = selectedConversationId;
    setWakeups((current) => current.filter((wakeup) => wakeup.id !== wakeupId));
    deleteWakeup(conversationId, wakeupId).catch((error: unknown) => {
      refreshWakeups("delete-failed");
      toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
    });
  }, [refreshWakeups, selectedConversationId, toast]);

  const selectedWakeups = useMemo(
    () => (selectedConversationId ? wakeups.filter((wakeup) => wakeup.conversationId === selectedConversationId) : []),
    [selectedConversationId, wakeups],
  );
  const wakeupConversationIds = useMemo(() => new Set(wakeups.map((wakeup) => wakeup.conversationId)), [wakeups]);

  return { wakeups, selectedWakeups, wakeupConversationIds, removeWakeup };
}
