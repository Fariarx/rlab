import { useCallback, useEffect, useLayoutEffect } from "react";
import type { ConversationView } from "../../agent";
import { normalizeConversationView } from "../workspace-page-helpers";

export interface UseWorkspaceViewControlOptions {
  readonly selectedConversationId: string | undefined;
  readonly selectedView: ConversationView | undefined;
  readonly terminalEnabled: boolean;
  readonly view: ConversationView;
  readonly setView: (view: ConversationView) => void;
  readonly persistConversationView: (conversationId: string, view: ConversationView) => void;
}

export function useWorkspaceViewControl({
  selectedConversationId,
  selectedView,
  terminalEnabled,
  view,
  setView,
  persistConversationView,
}: UseWorkspaceViewControlOptions): (next: ConversationView) => void {
  const showView = useCallback((next: ConversationView) => {
    setView(next);
    if (selectedConversationId) {
      persistConversationView(selectedConversationId, next);
    }
  }, [persistConversationView, selectedConversationId, setView]);

  useLayoutEffect(() => {
    setView(normalizeConversationView(selectedView, terminalEnabled));
  }, [selectedView, setView, terminalEnabled]);

  useEffect(() => {
    if (!terminalEnabled && view === "terminal") {
      showView("chat");
    }
  }, [showView, terminalEnabled, view]);

  return showView;
}
