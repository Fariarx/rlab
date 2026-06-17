import { useLayoutEffect, useRef } from "react";
import type { HashRoute } from "../../../lib/use-hash-route";
import { agentProfileEquals, type AgentProfile, type ConversationSummary, type Project } from "../../agent";
import { conversationProfile } from "../use-workspace";
import { firstVisibleConversationId, routeForConversation } from "../workspace-page-helpers";

export interface UseWorkspaceRouteSyncOptions {
  readonly route: HashRoute | undefined;
  readonly chats: readonly ConversationSummary[];
  readonly projects: readonly Project[];
  readonly selectedId: string;
  readonly findConversation: (conversationId: string) => ConversationSummary | null;
  readonly selectConversation: (conversationId: string) => void;
  readonly setProfile: (value: AgentProfile | ((current: AgentProfile) => AgentProfile)) => void;
  readonly onNavigate?: (route: HashRoute) => void;
}

export function useWorkspaceRouteSync({
  route,
  chats,
  projects,
  selectedId,
  findConversation,
  selectConversation,
  setProfile,
  onNavigate,
}: UseWorkspaceRouteSyncOptions): void {
  const lastProfileSyncedConversationIdRef = useRef<string | null>(null);
  const routeKind = route?.kind;
  const routeProjectId = route?.kind === "project" ? route.projectId : undefined;
  const routeConversationId = route?.kind === "chat" || route?.kind === "project" ? route.conversationId : undefined;

  useLayoutEffect(() => {
    const workspace = { chats, projects };
    const projectConversationId = routeProjectId
      ? projects.find((project) => project.id === routeProjectId)?.conversations[0]?.id
      : undefined;
    const targetConversationId = routeConversationId ?? (routeKind === "project" ? projectConversationId : undefined);

    if ((routeKind !== "chat" && routeKind !== "project") || !targetConversationId) {
      return;
    }

    const conversation = findConversation(targetConversationId);
    if (!conversation) {
      const fallbackId = firstVisibleConversationId(workspace);
      if (fallbackId) {
        onNavigate?.(routeForConversation(workspace, fallbackId));
        if (selectedId !== fallbackId) {
          selectConversation(fallbackId);
        }
      } else {
        onNavigate?.({ kind: "home" });
      }
      return;
    }

    const selectedChanged = selectedId !== targetConversationId;
    if (selectedChanged) {
      selectConversation(targetConversationId);
    }
    if (selectedChanged || lastProfileSyncedConversationIdRef.current !== targetConversationId) {
      lastProfileSyncedConversationIdRef.current = targetConversationId;
      setProfile((current) => {
        const nextProfile = conversationProfile(conversation);
        return agentProfileEquals(current, nextProfile) ? current : nextProfile;
      });
    }
  }, [chats, findConversation, onNavigate, projects, routeConversationId, routeKind, routeProjectId, selectConversation, selectedId, setProfile]);
}
