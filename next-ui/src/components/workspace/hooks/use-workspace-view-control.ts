import { useCallback, useEffect, useLayoutEffect } from "react";
import type { ConversationView } from "../../agent";
import { normalizeConversationView } from "../workspace-page-helpers";

export interface UseWorkspaceViewControlOptions {
  readonly selectedConversationId: string | undefined;
  readonly selectedView: ConversationView | undefined;
  readonly terminalEnabled: boolean;
  readonly previewEnabled: boolean;
  readonly view: ConversationView;
  readonly setView: (view: ConversationView) => void;
  readonly persistConversationView: (conversationId: string, view: ConversationView) => void;
}

export function useWorkspaceViewControl({
  selectedConversationId,
  selectedView,
  terminalEnabled,
  previewEnabled,
  view,
  setView,
  persistConversationView,
}: UseWorkspaceViewControlOptions): (next: ConversationView) => void {
  const showView = useCallback((next: ConversationView) => {
    const normalized = normalizeConversationView(next, terminalEnabled, previewEnabled);
    setView(normalized);
    if (selectedConversationId) {
      persistConversationView(selectedConversationId, normalized);
    }
  }, [persistConversationView, previewEnabled, selectedConversationId, setView, terminalEnabled]);

  useLayoutEffect(() => {
    setView(normalizeConversationView(selectedView, terminalEnabled, previewEnabled));
  }, [previewEnabled, selectedView, setView, terminalEnabled]);

  useEffect(() => {
    if ((!terminalEnabled && view === "terminal") || (!previewEnabled && view === "preview")) {
      showView("chat");
    }
  }, [previewEnabled, showView, terminalEnabled, view]);

  return showView;
}
