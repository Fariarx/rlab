import { type Dispatch, type SetStateAction, useCallback, useMemo } from "react";
import type { HashRoute } from "../../../lib/use-hash-route";
import type { I18nApi } from "../../../i18n/I18nProvider";
import { submitRunApproval, submitRunInput } from "../../../client/api/workspace-page-api";
import {
  messageToPlainText,
  type AgentProfile,
  type ApprovalDecision,
  type ChatMessage,
  type ConversationActions,
  type ConversationView,
  type MessageActionHandlers,
  type Project,
} from "../../agent";
import type { ToastOptions } from "../../ui";
import { conversationProfile, type Workspace } from "../use-workspace";
import type { ComposerDraftPersistence } from "./use-composer-draft-persistence";
import type { RunNotificationController } from "./use-run-notifications";
import { routeForConversation } from "../workspace-page-helpers";

const EMPTY_CHAT_ID = "";

export function projectIdForNewConversationFromRoute(route: HashRoute | undefined, projects: readonly Project[]): string | undefined {
  if (route?.kind !== "project") {
    return undefined;
  }
  return projects.some((project) => project.id === route.projectId) ? route.projectId : undefined;
}

export interface UseWorkspaceConversationActionsOptions {
  readonly workspace: Workspace;
  readonly route: HashRoute | undefined;
  readonly onNavigate: ((route: HashRoute) => void) | undefined;
  readonly setProfile: Dispatch<SetStateAction<AgentProfile>>;
  readonly setView: (view: ConversationView) => void;
  readonly setDrawerOpen: (open: boolean) => void;
  readonly setNewChatMenuAnchor: (anchor: HTMLElement | null) => void;
  readonly confirmDelete: string | null;
  readonly setConfirmDelete: (conversationId: string | null) => void;
  readonly bumpRunKey: () => void;
  readonly focusComposer: () => void;
  readonly composerDraftPersistence: ComposerDraftPersistence;
  readonly runNotifications: RunNotificationController;
  readonly selectedHasActiveWork: boolean;
  readonly t: I18nApi["t"];
  readonly toast: (options: ToastOptions) => string;
}

export interface WorkspaceConversationActions {
  readonly openConversation: (id: string, updateRoute?: boolean) => void;
  readonly createConversation: (projectId?: string) => void;
  readonly submitComposerText: (text: string) => void;
  readonly handleCreateProject: (input: Parameters<Workspace["createProject"]>[0]) => void;
  readonly conversationActions: ConversationActions;
  readonly doDelete: () => void;
  readonly messageActions: MessageActionHandlers;
}

export function useWorkspaceConversationActions({
  workspace: ws,
  route,
  onNavigate,
  setProfile,
  setView,
  setDrawerOpen,
  setNewChatMenuAnchor,
  confirmDelete,
  setConfirmDelete,
  bumpRunKey,
  focusComposer,
  composerDraftPersistence,
  runNotifications,
  selectedHasActiveWork,
  t,
  toast,
}: UseWorkspaceConversationActionsOptions): WorkspaceConversationActions {
  const openConversation = useCallback(
    (id: string, updateRoute = true) => {
      ws.select(id);
      const conversation = ws.find(id);
      if (conversation) {
        setProfile(conversationProfile(conversation));
      }
      if (updateRoute) {
        onNavigate?.(routeForConversation(ws, id));
      }
      setDrawerOpen(false);
      bumpRunKey();
    },
    [bumpRunKey, onNavigate, setDrawerOpen, setProfile, ws],
  );

  const navigateAfterConversationRemoval = useCallback(
    (nextConversationId: string) => {
      if (nextConversationId && ws.find(nextConversationId)) {
        onNavigate?.(routeForConversation(ws, nextConversationId));
      } else {
        onNavigate?.({ kind: "home" });
      }
      bumpRunKey();
    },
    [bumpRunKey, onNavigate, ws],
  );

  const removeConversation = useCallback(
    (id: string) => {
      composerDraftPersistence.discardDraft(id);
      runNotifications.forget(id);
      const nextConversationId = ws.remove(id);
      navigateAfterConversationRemoval(nextConversationId);
    },
    [composerDraftPersistence, navigateAfterConversationRemoval, runNotifications, ws],
  );

  const createConversation = useCallback(
    (projectId?: string) => {
      const newProfile = ws.settings.agents.defaultProfile;
      setProfile(newProfile);
      const id = projectId ? ws.newProjectChat(projectId, newProfile) : ws.newChat(newProfile);
      setNewChatMenuAnchor(null);
      setDrawerOpen(false);
      setView("chat");
      ws.setConversationView(id, "chat");
      bumpRunKey();
      onNavigate?.(routeForConversation(ws, id));
      requestAnimationFrame(focusComposer);
    },
    [bumpRunKey, focusComposer, onNavigate, setDrawerOpen, setNewChatMenuAnchor, setProfile, setView, ws],
  );

  const submitComposerText = useCallback(
    (text: string) => {
      const activeConversation = ws.find(ws.selectedId);
      let targetId = activeConversation?.id ?? EMPTY_CHAT_ID;
      if (!targetId) {
        const newProfile = ws.settings.agents.defaultProfile;
        const projectId = projectIdForNewConversationFromRoute(route, ws.projects);
        setProfile(newProfile);
        targetId = projectId ? ws.newProjectChat(projectId, newProfile) : ws.newChat(newProfile);
        setView("chat");
        ws.setConversationView(targetId, "chat");
        bumpRunKey();
        onNavigate?.(routeForConversation(ws, targetId));
      }
      composerDraftPersistence.clearDraft(targetId);
      runNotifications.mark(targetId);
      ws.sendMessage(targetId, text);
    },
    [bumpRunKey, composerDraftPersistence, onNavigate, route, runNotifications, setProfile, setView, ws],
  );

  const handleCreateProject = useCallback(
    (input: Parameters<Workspace["createProject"]>[0]) => {
      try {
        const created = ws.createProject(input);
        onNavigate?.({ kind: "project", projectId: created.projectId, conversationId: created.conversationId });
        bumpRunKey();
        toast({ message: t("newProjectChatWith", { agent: input.profile.agent, project: input.name }), severity: "info", duration: 2500 });
      } catch (error) {
        toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
      }
    },
    [bumpRunKey, onNavigate, t, toast, ws],
  );

  const conversationActions = useMemo<ConversationActions>(
    () => ({
      onRename: ws.rename,
      onTogglePin: ws.togglePin,
      onArchive: (id: string) => {
        ws.archive(id);
        toast({ message: t("conversationArchived"), severity: "info", duration: 2500 });
      },
      onDelete: (id: string) => {
        if (ws.settings.general.confirmDestructiveActions) {
          setConfirmDelete(id);
          return;
        }
        removeConversation(id);
        toast({ message: t("conversationDeleted"), severity: "warning", duration: 2500 });
      },
    }),
    [removeConversation, setConfirmDelete, t, toast, ws],
  );

  const doDelete = useCallback(() => {
    if (!confirmDelete) {
      return;
    }
    removeConversation(confirmDelete);
    setConfirmDelete(null);
    toast({ message: t("conversationDeleted"), severity: "warning", duration: 2500 });
  }, [confirmDelete, removeConversation, setConfirmDelete, t, toast]);

  const messageActions = useMemo<MessageActionHandlers>(
    () => ({
      onCopy: async (message: ChatMessage) => {
        try {
          await navigator.clipboard.writeText(messageToPlainText(message));
          toast({ message: t("messageCopied"), severity: "success", duration: 1800 });
        } catch {
          toast({ message: t("clipboardUnavailable"), severity: "error", duration: 2500 });
        }
      },
      onRetry: selectedHasActiveWork
        ? undefined
        : (message: ChatMessage) => {
            runNotifications.mark(ws.selectedId);
            ws.retryMessage(ws.selectedId, message.id);
          },
      onFork: (message: ChatMessage) => {
        const forkId = ws.forkConversationFromMessage(ws.selectedId, message.id);
        if (!forkId) {
          return;
        }
        const fork = ws.find(forkId);
        if (fork) {
          setProfile(conversationProfile(fork));
        }
        setView("chat");
        ws.setConversationView(forkId, "chat");
        bumpRunKey();
        onNavigate?.(routeForConversation(ws, forkId));
        toast({ message: t("forkedConversationCreated"), severity: "success", duration: 2200 });
      },
      onEditAndResend: (message: ChatMessage, text: string) => {
        runNotifications.mark(ws.selectedId);
        ws.editAndResendMessage(ws.selectedId, message.id, text);
      },
      onApprovalDecision: async (approvalId: string, decision: ApprovalDecision) => {
        try {
          await submitRunApproval(approvalId, decision);
          ws.decideApproval(ws.selectedId, approvalId, decision);
        } catch (error) {
          toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
          throw error;
        }
      },
      onOptionSelection: async (optionBlockId: string, selectedLabels: readonly string[]) => {
        try {
          await submitRunInput(optionBlockId, selectedLabels);
          ws.selectOptions(ws.selectedId, optionBlockId, selectedLabels);
        } catch (error) {
          toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
          throw error;
        }
      },
    }),
    [bumpRunKey, onNavigate, runNotifications, selectedHasActiveWork, setProfile, setView, t, toast, ws],
  );

  return {
    openConversation,
    createConversation,
    submitComposerText,
    handleCreateProject,
    conversationActions,
    doDelete,
    messageActions,
  };
}
