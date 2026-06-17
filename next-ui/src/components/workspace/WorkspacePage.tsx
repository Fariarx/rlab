import AddIcon from "@mui/icons-material/Add";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatOutlined";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import TerminalIcon from "@mui/icons-material/Terminal";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import {
  Alert,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  Menu,
  MenuItem,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { useCallback, useMemo, useRef, useState } from "react";
import { I18nProvider, useI18n } from "../../i18n/I18nProvider";
import { ComposerSharedProvider, type ComposerSharedProps } from "../agent/composer/composer-shared-context";
import { contextWindowForAgentProfile } from "../../lib/model-context";
import type { HashRoute } from "../../lib/use-hash-route";
import {
  AGENTS,
  AgentBadge,
  AgentPicker,
  Composer,
  type ComposerHandle,
  Conversation,
  ConversationList,
  ConversationSearch,
  QueuedMessages,
  DEFAULT_PROFILE,
  TypingDots,
  type ConversationView,
  useAgentCliInfo,
  useAgentStatus,
  useAgentStatusError,
  useAgentStatusLive,
  useReloadAgentStatus,
  accessModeForAgentProfile,
} from "../agent";
import { dropIn } from "../agent/core/anim";
import { SettingsDialog } from "../settings/SettingsDialog";
import { Button, EmptyState, IconButton, useToast } from "../ui";
import { CommandPalette } from "./CommandPalette";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { BrowserPreview } from "./browser/BrowserPreview";
import { GitView } from "./git/GitPanel";
import { ResourcesPanel } from "./ResourcesPanel";
import { TerminalView } from "./terminal/TerminalView";
import { WorkspaceUiProvider } from "../../lib/workspace-ui";
import { DEFAULT_SIDEBAR_WIDTH, normalizeSidebarWidth } from "../../lib/app-settings";
import { rlabChatToolEnabled } from "../../lib/rlab-tools";
import { conversationProfile, type Workspace, useWorkspace } from "./use-workspace";
import { useSidebarResize } from "./hooks/use-sidebar-resize";
import {
  buildComposerLabel,
  conversationHasActiveWork,
  latestAgentDiffBlocks,
  workspaceConversations,
} from "./workspace-page-helpers";
import { composerMessageHistory, composerVoiceProvider, scheduledWakeupComposerTags } from "./models/workspace-composer-model";
import { WorkspacePageStore } from "./stores/workspace-page-store";
import { useRunNotifications } from "./hooks/use-run-notifications";
import { usePaneFileDrop } from "./hooks/use-pane-file-drop";
import { CliUpdatesAccordion } from "./CliUpdatesAccordion";
import { useCliUpdates } from "./hooks/use-cli-updates";
import { useWakeups } from "./hooks/use-wakeups";
import { useProjectFiles } from "./hooks/use-project-files";
import { useAgentLimits } from "./hooks/use-agent-limits";
import { useVoiceConfig } from "./hooks/use-voice-config";
import { useRlabPlugins } from "./hooks/use-rlab-plugins";
import { useGitWorktreeControl } from "./git/use-git-worktree-control";
import { useAppVersionReload } from "./hooks/use-app-version-reload";
import { useWorkspaceViewControl } from "./hooks/use-workspace-view-control";
import { useWorkspaceUiApi } from "./hooks/use-workspace-ui-api";
import { useComposerDockHeight } from "./hooks/use-composer-dock-height";
import { useWorkspaceRouteSync } from "./hooks/use-workspace-route-sync";
import { useWorkspaceCommandItems } from "./hooks/use-workspace-command-items";
import { useReviewComments } from "./hooks/use-review-comments";
import { useComposerDraftPersistence } from "./hooks/use-composer-draft-persistence";
import { useWorkspaceConversationActions } from "./hooks/use-workspace-conversation-actions";
import { useWorkspaceAgentProfileController } from "./hooks/use-workspace-agent-profile-controller";
import { useWorkspaceLoadErrorToast } from "./hooks/use-workspace-load-error-toast";
import { useCommandPaletteShortcut } from "./hooks/use-command-palette-shortcut";
import { useAppStatusFavicon } from "./hooks/use-app-status-favicon";
import { appendConversationErrorNotice } from "../agent/conversation/conversation-status-notice-model";
import { workspaceAttentionStatus } from "./models/workspace-attention-status-model";

const AGENT_AUTO_CONFIRM_AGENTS = new Set(["claude-code", "codex", "gemini"]);

// The sidebar title bar and the chat pane header share one fixed height so the
// two columns line up across the top.
const HEADER_MIN_HEIGHT = 53;
// Shared horizontal inset for the sidebar so the title and the list below it
// keep an even left/right margin.
const SIDEBAR_INSET = 1.5;
// Max width for the centered thread/composer content. The scroll container
// itself is full-width so its scrollbar sits at the screen edge.
const THREAD_MAX_WIDTH = 1040;
const THREAD_PADDING_X = { xs: 2, sm: 3 } as const;
const WORKSPACE_ERROR_ALERT_SX = {
  alignItems: "center",
  "& .MuiAlert-message": {
    display: "flex",
    alignItems: "center",
    minHeight: 32,
  },
  "& .MuiAlert-action": {
    alignItems: "center",
    pt: 0,
  },
} as const;

export const WorkspacePage = observer(function WorkspacePage() {
  const workspace = useWorkspace();

  return (
    <I18nProvider locale={workspace.settings.general.locale}>
      <WorkspacePageView workspace={workspace} />
    </I18nProvider>
  );
});

export const WorkspacePageView = observer(function WorkspacePageView({
  workspace: ws,
  route,
  onNavigate,
}: {
  readonly workspace: Workspace;
  readonly route?: HashRoute;
  readonly onNavigate?: (route: HashRoute) => void;
}) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const statusOf = useAgentStatus();
  const cliInfoOf = useAgentCliInfo();
  const agentStatusLive = useAgentStatusLive();
  const agentStatusError = useAgentStatusError();
  const reloadAgentStatus = useReloadAgentStatus();

  const [pageStore] = useState(() => new WorkspacePageStore(ws.settings.agents.defaultProfile ?? DEFAULT_PROFILE, normalizeSidebarWidth(ws.settings.appearance.sidebarWidth)));
  const {
    searchOpen,
    setSearchOpen,
    profile,
    setProfile,
    pickerOpen,
    setPickerOpen,
    newChatMenuAnchor,
    setNewChatMenuAnchor,
    settingsOpen,
    setSettingsOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    projectDialogOpen,
    setProjectDialogOpen,
    view,
    setView,
    browserOpenRequest,
    setBrowserOpenRequest,
    gitFocus,
    setGitFocus,
    gitReloadSignal,
    setGitReloadSignal,
    gitUnstaged,
    setGitUnstaged,
    setComposerTagsHeight,
    setComposerOverlayLift,
    setComposerDockHeight,
    browserActivityEvents,
    setBrowserActivityEvents,
    reviewComments,
    setReviewComments,
    drawerOpen,
    setDrawerOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    isResizingSidebar,
    setIsResizingSidebar,
    confirmDelete,
    setConfirmDelete,
    runKey,
    setRunKey,
    contentBottomInset,
    composerVisible,
  } = pageStore;
  const showTerminal = ws.settings.appearance.showTerminal;
  const selected = ws.find(ws.selectedId);
  const messages = ws.threads[ws.selectedId] ?? [];
  const displayedMessages = useMemo(() => appendConversationErrorNotice(selected, messages, t("conversationErrorNotice")), [messages, selected, t]);
  const selectedThreadLoaded = selected ? ws.isThreadLoaded(selected.id) : false;
  const selectedHasOlderMessages = selected ? ws.hasOlderThreadMessages(selected.id) : false;
  const loadOlderSelectedThread = useCallback(() => {
    if (selected) {
      return ws.loadOlderThread(selected.id);
    }
    return Promise.resolve();
  }, [selected, ws]);
  const persistConversationView = useCallback((conversationId: string, next: ConversationView) => {
    ws.setConversationView(conversationId, next);
  }, [ws]);
  const findConversation = useCallback((conversationId: string) => ws.find(conversationId), [ws]);
  const selectConversation = useCallback((conversationId: string) => ws.select(conversationId), [ws]);
  const showView = useWorkspaceViewControl({
    selectedConversationId: selected?.id,
    selectedView: selected?.view,
    terminalEnabled: showTerminal,
    view,
    setView,
    persistConversationView,
  });
  const { review, sendReviewComments } = useReviewComments({
    comments: reviewComments,
    setComments: setReviewComments,
    selectedConversationId: selected?.id,
    addReviewComments: (conversationId, comments) => ws.addReviewComments(conversationId, comments),
    showChat: () => showView("chat"),
  });
  const composerRef = useRef<ComposerHandle | null>(null);
  const composerDraftPersistence = useComposerDraftPersistence({ updateComposerDraft: ws.updateComposerDraft });
  const paneFileDrop = usePaneFileDrop({
    addFiles: (files) => composerRef.current?.addFiles([...files]),
  });
  const { sidebarShellRef, sidebarInnerRef, startSidebarResize } = useSidebarResize({
    sidebarCollapsed,
    sidebarWidth,
    isResizingSidebar,
    persistedSidebarWidth: ws.settings.appearance.sidebarWidth,
    setSidebarWidth,
    setIsResizingSidebar,
    persistSidebarWidth: (width) => ws.updateSettings({ appearance: { sidebarWidth: width } }),
  });

  const wakeupsController = useWakeups({
    selectedConversationId: selected?.id,
    selectedStatus: selected?.status,
    messageCount: messages.length,
    toast,
  });
  const conversations = useMemo(() => workspaceConversations({ chats: ws.chats, projects: ws.projects }), [ws.chats, ws.projects]);
  const appAttentionStatus = useMemo(() => workspaceAttentionStatus(conversations), [conversations]);
  useAppStatusFavicon(appAttentionStatus, ws.settings.appearance.reduceMotion);
  const runNotifications = useRunNotifications({
    conversations,
    selectedId: ws.selectedId,
    desktopNotifications: ws.settings.general.desktopNotifications,
    t,
    toast,
  });
  const cliUpdates = useCliUpdates({
    reloadAgentStatus,
    t,
    toast,
  });
  const agentLimits = useAgentLimits({ t, toast });
  const voiceConfig = useVoiceConfig({ toast });
  const registeredPlugins = useRlabPlugins({ toast });
  const activeRegisteredPlugins = useMemo(
    () => registeredPlugins.filter((plugin) => rlabChatToolEnabled(profile.tools, plugin.id)),
    [profile.tools, registeredPlugins],
  );
  const messageHistory = useMemo(() => composerMessageHistory(messages), [messages]);
  const selectedHasActiveWork = conversationHasActiveWork(selected, messages);
  const lastTurnDiffs = useMemo(() => latestAgentDiffBlocks(messages), [messages]);
  const composerDraft = ws.composerDrafts[ws.selectedId] ?? { text: "", attachments: [] };
  const voiceProvider = useMemo(
    () => composerVoiceProvider(ws.settings.general.voice, voiceConfig.config),
    [voiceConfig.config, ws.settings.general.voice],
  );
  const scheduledWakeups = useMemo(
    () => scheduledWakeupComposerTags({ locale, removeWakeup: wakeupsController.removeWakeup, wakeups: wakeupsController.selectedWakeups }),
    [locale, wakeupsController.removeWakeup, wakeupsController.selectedWakeups],
  );
  const selectedQueuedMessages = selected ? ws.queuedMessages(selected.id) : [];
  const selectedCwd = ws.cwdOf(ws.selectedId);
  const mentionableFiles = useProjectFiles({ cwd: selectedCwd, toast });
  const terminalCwd = selected ? (selectedCwd ?? ".") : undefined;
  const sendBrowserAnnotation = (message: string) => {
    if (!selected) {
      return;
    }
    runNotifications.mark(ws.selectedId);
    ws.sendMessage(ws.selectedId, message);
    showView("chat");
  };
  const uiApi = useWorkspaceUiApi({ showView, setBrowserOpenRequest, setGitFocus });
  const activeCwd = selectedCwd;
  const headerTitle = selected?.title ?? t("noConversation");
  const profileAccessMode = accessModeForAgentProfile(profile);
  const selectedBasePath = ws.basePathOf(ws.selectedId);
  const worktreeApi = useGitWorktreeControl({
    conversationId: selected?.id,
    basePath: selectedBasePath,
    worktreePath: selected?.worktreePath,
    setWorktree: (conversationId, worktreePath) => ws.setWorktree(conversationId, worktreePath),
    reloadGit: () => setGitReloadSignal((value) => value + 1),
    t,
    toast,
  });
  const mode = ws.settings.appearance.theme;
  const noAgentsAvailable = agentStatusLive && AGENTS.every((agent) => statusOf(agent.id) !== "available" && statusOf(agent.id) !== "running");
  const workspaceHydrating = !ws.loaded;
  const composerDockRef = useComposerDockHeight({ visible: composerVisible, setHeight: setComposerDockHeight });
  useWorkspaceRouteSync({
    route,
    chats: ws.chats,
    projects: ws.projects,
    selectedId: ws.selectedId,
    findConversation,
    selectConversation,
    setProfile,
    onNavigate,
  });

  useWorkspaceLoadErrorToast({ loadError: ws.loadError, t, toast });
  useAppVersionReload({ t, toast });
  useCommandPaletteShortcut({ setCommandPaletteOpen });

  const openPicker = () => {
    setPickerOpen(true);
  };

  const openKit = () => {
    if (onNavigate) {
      onNavigate({ kind: "kit" });
      return;
    }

    window.location.hash = "#/kit";
  };
  const openConversationSearch = useCallback(() => {
    setSearchOpen(true);
  }, [setSearchOpen]);
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, [setSettingsOpen]);
  const openGit = useCallback(() => {
    showView("git");
  }, [showView]);
  const openPreview = useCallback(() => {
    showView("preview");
  }, [showView]);
  const toggleTheme = useCallback(() => {
    ws.updateSettings({ appearance: { theme: mode === "dark" ? "light" : "dark" } });
  }, [mode, ws]);

  const { handleAutoConfirmChange, handleModeChange, handlePicked, supportedModes } = useWorkspaceAgentProfileController({
    defaultProfile: ws.settings.agents.defaultProfile,
    profile,
    selected,
    selectedId: ws.selectedId,
    setConversationProfile: (conversationId, nextProfile) => ws.setConversationProfile(conversationId, nextProfile),
    setProfile,
    cliInfoOf,
    t,
  });
  const bumpRunKey = useCallback(() => setRunKey((k) => k + 1), [setRunKey]);
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);

  const {
    openConversation,
    createConversation,
    submitComposerText,
    handleCreateProject,
    conversationActions,
    doDelete,
    messageActions,
  } = useWorkspaceConversationActions({
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
  });

  const commandItems = useWorkspaceCommandItems({
    t,
    createConversation: () => createConversation(),
    openConversationSearch,
    openSettings,
    openGit,
    openPreview,
    toggleTheme,
    openKit,
  });

  if (ws.loadError && !ws.loaded) {
    return (
      <Box sx={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default", p: 2 }}>
        <Alert
          severity="error"
          action={
            <Button variant="subtle" size="small" onClick={ws.reloadWorkspace} disabled={ws.loading}>
              {t("retryWorkspaceLoad")}
            </Button>
          }
          sx={{ ...WORKSPACE_ERROR_ALERT_SX, maxWidth: 720, width: "100%" }}
        >
          {t("workspaceError", { error: ws.loadError })}
        </Alert>
      </Box>
    );
  }

  const cliUpdateNotice = (
    <CliUpdatesAccordion updates={cliUpdates.snapshot.updates} busyAgent={cliUpdates.busyAgent} onUpdate={(update) => void cliUpdates.updateCli(update)} t={t} />
  );

  const sidebar = (
    <Stack sx={{ height: "100%", minHeight: 0, backgroundColor: (t) => t.custom.surfaces.s1 }}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", px: SIDEBAR_INSET, minHeight: HEADER_MIN_HEIGHT, flex: "0 0 auto", borderBottom: (t) => `1px solid ${t.custom.borders.subtle}` }}
      >
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
          <Tooltip title={t("toggleSidebar")}>
            <IconButton aria-label={t("toggleSidebar")} onClick={() => setSidebarCollapsed(true)} sx={{ display: { xs: "none", md: "inline-flex" } }}>
              <MenuOpenIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontWeight: 700, fontSize: "0.9rem" }}>{t("appTitle")}</Typography>
        </Stack>
        <Stack direction="row" spacing={0.25}>
          <Tooltip title={t("searchConversations")}>
            <IconButton
              aria-label={t("searchConversations")}
              onClick={openConversationSearch}
            >
              <SearchIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("settings")}>
            <IconButton aria-label={t("settings")} onClick={() => setSettingsOpen(true)}>
              <SettingsIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("newProject")}>
            <IconButton aria-label={t("newProject")} onClick={() => setProjectDialogOpen(true)}>
              <CreateNewFolderIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("newConversation")}>
            <IconButton aria-label={t("newConversation")} onClick={(event) => setNewChatMenuAnchor(event.currentTarget)}>
              <AddIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={newChatMenuAnchor}
            open={Boolean(newChatMenuAnchor)}
            onClose={() => setNewChatMenuAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ list: { dense: true } }}
          >
            <MenuItem onClick={() => createConversation()} sx={{ gap: 1, fontSize: "0.8rem" }}>
              <ChatBubbleOutlineIcon sx={{ fontSize: 16, color: "text.secondary" }} />
              <Box component="span">{t("simpleChatOption")}</Box>
            </MenuItem>
            {ws.projects.length > 0 && <Divider sx={{ my: 0.5 }} />}
            {ws.projects.map((project) => (
              <MenuItem key={project.id} onClick={() => createConversation(project.id)} sx={{ gap: 1, fontSize: "0.8rem" }}>
                <FolderOutlinedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                <Box component="span" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</Box>
              </MenuItem>
            ))}
          </Menu>
        </Stack>
      </Stack>

      <ConversationList projects={ws.projects} chats={ws.chats} threads={ws.threads} selectedId={ws.selectedId} onSelect={openConversation} actions={conversationActions} wakeupConversationIds={wakeupsController.wakeupConversationIds} />
      {cliUpdateNotice}
    </Stack>
  );

  // Composer props shared by the bottom dock and the in-thread message editor, so
  // editing a sent message gets the same capabilities (attachments, mentions,
  // $-plugins, voice, modes, limits) as composing a new one.
  const composerShared: ComposerSharedProps = {
    mentionableFiles,
    modes: supportedModes,
    activeMode: profile.mode,
    onModeChange: handleModeChange,
    autoConfirm: profile.autoConfirm ?? false,
    supportsAutoConfirm: AGENT_AUTO_CONFIRM_AGENTS.has(profile.agent),
    onAutoConfirmChange: handleAutoConfirmChange,
    onAttachmentError: (message) => toast({ message, severity: "error", duration: 3000 }),
    agentId: profile.agent,
    agentLimit: agentLimits.limits[profile.agent] ?? null,
    agentLimitLoaded: agentLimits.loaded,
    agentLimitRefreshing: agentLimits.refreshing[profile.agent] === true,
    agentLimitRefreshError: agentLimits.refreshErrors[profile.agent] ?? null,
    onRefreshAgentLimits: (requestRefresh) => agentLimits.refresh(profile.agent, requestRefresh),
    contextTokens: selected?.usage?.contextTokens,
    contextWindow: contextWindowForAgentProfile(profile),
    autoCompact: selected?.compaction?.auto ?? true,
    compactWindow: selected?.compaction?.window,
    onAutoCompactChange: (enabled) => {
      if (selected) {
        ws.setCompaction(selected.id, { auto: enabled });
      }
    },
    onCompactWindowChange: (window) => {
      if (selected) {
        ws.setCompaction(selected.id, { window });
      }
    },
    onCompactNow: () => {
      if (!selected) {
        return;
      }
      if (!ws.compactConversation(selected.id)) {
        toast({ message: t("compactionNoSession"), severity: "info", duration: 3000 });
      }
    },
    voiceProvider,
    onVoiceError: (message) => toast({ message, severity: "error", duration: 3500 }),
    browserActivityEvents: view === "preview" ? browserActivityEvents : undefined,
    registeredPlugins: activeRegisteredPlugins,
  };

  return (
    <WorkspaceUiProvider value={uiApi}>
    <ComposerSharedProvider value={composerShared}>
    <Box sx={{ height: "100dvh", display: "flex", overflow: "hidden", bgcolor: "background.default" }}>
      <Box
        ref={sidebarShellRef}
        sx={{
          display: { xs: "none", md: "block" },
          width: sidebarCollapsed ? 0 : sidebarWidth,
          flex: "0 0 auto",
          overflow: "hidden",
          transition: isResizingSidebar ? "none" : "width 200ms ease",
        }}
      >
        <Box ref={sidebarInnerRef} sx={{ width: sidebarWidth, height: "100%" }}>{sidebar}</Box>
      </Box>
      {!sidebarCollapsed && (
        <Box
          role="separator"
          aria-orientation="vertical"
          aria-label={t("resizeSidebar")}
          onMouseDown={startSidebarResize}
          sx={{
            display: { xs: "none", md: "block" },
            flex: "0 0 auto",
            width: "1px",
            cursor: "col-resize",
            backgroundColor: (t) => t.custom.borders.subtle,
            transition: "background-color 120ms ease",
            "&:hover": { backgroundColor: (t) => t.palette.status.running.main },
          }}
        />
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} sx={{ display: { md: "none" } }} slotProps={{ paper: { sx: { width: DEFAULT_SIDEBAR_WIDTH, backgroundImage: "none" } } }}>
        {sidebar}
      </Drawer>

      <Box
        sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}
        onDragEnter={paneFileDrop.onPaneDragEnter}
        onDragOver={paneFileDrop.onPaneDragOver}
        onDragLeave={paneFileDrop.onPaneDragLeave}
        onDrop={paneFileDrop.onPaneDrop}
      >
        {paneFileDrop.paneDragging && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 1.25,
              flexDirection: "column",
              color: "text.primary",
              backgroundColor: "rgba(8, 11, 14, 0.66)",
              backdropFilter: "blur(1px)",
              animation: `${dropIn} 140ms ease both`,
              pointerEvents: "none",
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 2.5,
                py: 1.75,
                borderRadius: (t) => `${t.custom.radii.lg}px`,
                border: (t) => `1.5px dashed ${t.custom.borders.strong}`,
                backgroundColor: (t) => t.custom.surfaces.s2,
                boxShadow: "0 16px 48px rgba(0, 0, 0, 0.5)",
              }}
            >
              <AttachFileIcon sx={{ fontSize: 20, color: (t) => t.palette.status.info.main }} />
              <Typography sx={{ fontSize: "0.92rem", fontWeight: 700 }}>{t("dropFilesHint")}</Typography>
            </Box>
          </Box>
        )}
        <Box component="header" sx={{ flex: "0 0 auto", backgroundColor: (t) => t.custom.surfaces.s1 }}>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center", justifyContent: "space-between", px: SIDEBAR_INSET, minHeight: HEADER_MIN_HEIGHT, borderBottom: (t) => `1px solid ${t.custom.borders.subtle}` }}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
              {/* Mobile: opens the drawer. Desktop: only shown to re-open a
                  collapsed sidebar. */}
              <IconButton
                aria-label={t("openConversations")}
                onClick={() => {
                  setDrawerOpen(true);
                  setSidebarCollapsed(false);
                }}
                sx={{ display: { xs: "inline-flex", md: sidebarCollapsed ? "inline-flex" : "none" } }}
              >
                <MenuIcon sx={{ fontSize: 20 }} />
              </IconButton>
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontWeight: 700, fontSize: "0.9rem" }}>
                  {headerTitle}
                </Typography>
                {activeCwd && (
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", display: { xs: "none", sm: "flex" } }}>
                    <FolderOutlinedIcon sx={{ fontSize: 12, color: "text.secondary" }} />
                    <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.64rem", color: "text.secondary" }}>
                      {activeCwd}
                    </Typography>
                  </Stack>
                )}
              </Box>
            </Stack>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flex: "0 0 auto", "& .MuiIconButton-root": { width: 30, height: 30 } }}>
              {selected && <AgentBadge profile={profile} onClick={openPicker} compact />}
              <ToggleButtonGroup
                size="small"
                exclusive
                value={view}
                onChange={(_, next: ConversationView | null) => next && showView(next)}
                aria-label={t("viewSwitcher")}
                sx={{
                  // Single bordered container with borderless segments inside, so
                  // the selected highlight fills its segment edge-to-edge (no
                  // uneven gap between the highlight and the group border).
                  height: 30,
                  alignItems: "stretch",
                  borderRadius: (t) => `${t.custom.radii.sm}px`,
                  border: (t) => `1px solid ${t.custom.borders.subtle}`,
                  backgroundColor: (t) => t.custom.surfaces.s2,
                  overflow: "hidden",
                  "& .MuiToggleButton-root": {
                    border: 0,
                    borderRadius: 0,
                    height: "100%",
                    px: 1.25,
                    py: 0,
                    gap: 0.5,
                    textTransform: "none",
                    fontFamily: (t) => t.custom.fonts.mono,
                    fontSize: "0.74rem",
                    color: "text.secondary",
                    "&:not(:first-of-type)": { borderLeft: (t) => `1px solid ${t.custom.borders.subtle}` },
                    "&.Mui-selected": { color: "text.primary", backgroundColor: (t) => t.custom.surfaces.s3 },
                    "&.Mui-selected:hover": { backgroundColor: (t) => t.custom.surfaces.s3 },
                  },
                }}
              >
                <ToggleButton value="chat" aria-label={t("chatTab")}>
                  <ChatBubbleOutlineIcon sx={{ fontSize: 15 }} />
                  <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("chatTab")}</Box>
                </ToggleButton>
                <ToggleButton value="git" aria-label={t("git")}>
                  <AccountTreeIcon sx={{ fontSize: 15 }} />
                  <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("git")}</Box>
                  {(gitUnstaged.additions > 0 || gitUnstaged.deletions > 0) && (
                    <Box component="span" sx={{ ml: 0.5, display: "inline-flex", gap: 0.5, fontSize: "0.64rem", fontWeight: 700 }}>
                      <Box component="span" sx={{ color: (t) => t.palette.status.ok.main }}>+{gitUnstaged.additions}</Box>
                      <Box component="span" sx={{ color: (t) => t.palette.status.error.main }}>−{gitUnstaged.deletions}</Box>
                    </Box>
                  )}
                </ToggleButton>
                <ToggleButton value="resources" aria-label={t("resourcesTab")}>
                  <InsertDriveFileOutlinedIcon sx={{ fontSize: 15 }} />
                  <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("resourcesTab")}</Box>
                </ToggleButton>
                <ToggleButton value="preview" aria-label={t("previewTab")}>
                  <OpenInBrowserIcon sx={{ fontSize: 15 }} />
                  <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("previewTab")}</Box>
                </ToggleButton>
                {showTerminal && (
                  <ToggleButton value="terminal" aria-label={t("terminalTab")}>
                    <TerminalIcon sx={{ fontSize: 15 }} />
                    <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>{t("terminalTab")}</Box>
                  </ToggleButton>
                )}
              </ToggleButtonGroup>
            </Stack>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Box sx={{ width: "100%", maxWidth: THREAD_MAX_WIDTH, mx: "auto", px: THREAD_PADDING_X, "&:empty": { display: "none" }, "&:not(:empty)": { pt: 2 } }}>
              {ws.loadError && (
              <Alert
                severity="error"
                action={
                  <Button variant="subtle" size="small" onClick={ws.reloadWorkspace}>
                    {t("retryWorkspaceLoad")}
                  </Button>
                }
                sx={{ ...WORKSPACE_ERROR_ALERT_SX, mb: 2 }}
              >
                {t("workspaceError", { error: ws.loadError })}
              </Alert>
            )}
            {agentStatusError && (
              <Alert
                severity="error"
                action={
                  <Button variant="subtle" size="small" onClick={reloadAgentStatus}>
                    {t("retryAgentDetection")}
                  </Button>
                }
                sx={{ mb: 2 }}
              >
                {t("agentDetectionError", { error: agentStatusError })}
              </Alert>
            )}
            {noAgentsAvailable && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t("noAgentsAvailable")}
              </Alert>
            )}
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
              {/* Chat and Git are both kept mounted; only the active one is shown,
                  so the Git view keeps its scroll/expanded state across chat switches. */}
              <Box sx={{ position: "absolute", inset: 0, display: view === "chat" ? "block" : "none" }}>
                {!selected ? (
                  <Stack sx={{ height: "100%", justifyContent: "center", alignItems: "center", px: THREAD_PADDING_X }}>
                    <EmptyState
                      icon={<ChatBubbleOutlineIcon />}
                      title={t("noConversationSelected")}
                      description={t("pickConversation")}
                      action={<Button variant="contained" onClick={() => createConversation()}>{t("newChat")}</Button>}
                    />
                  </Stack>
                ) : !selectedThreadLoaded ? (
                  <Stack aria-busy="true" data-testid="conversation-thread-loading" sx={{ height: "100%", justifyContent: "center", alignItems: "center", px: THREAD_PADDING_X }}>
                    <TypingDots />
                  </Stack>
                ) : displayedMessages.length === 0 ? (
                  <Stack sx={{ height: "100%", justifyContent: "center", alignItems: "center", px: THREAD_PADDING_X }}>
                    <EmptyState
                      icon={<ChatBubbleOutlineIcon />}
                      title={t("startConversation")}
                      description={t(profileAccessMode === "unrestricted" ? "messageAgentAccess" : "messageAgentReadOnlyAccess", { title: selected.title })}
                    />
                  </Stack>
                ) : (
                  <Conversation
                    key={`${ws.selectedId}-${runKey}`}
                    messages={displayedMessages}
                    typing={selected.status === "running" && messages[messages.length - 1]?.role === "user"}
                    actions={messageActions}
                    agentProfile={conversationProfile(selected)}
                    displayPrefs={{ reasoningAutoExpand: ws.settings.appearance.reasoningAutoExpand }}
                    contentMaxWidth={THREAD_MAX_WIDTH}
                    contentPaddingX={THREAD_PADDING_X}
                    bottomInset={contentBottomInset}
                    hasMoreBefore={selectedHasOlderMessages}
                    onLoadEarlier={loadOlderSelectedThread}
                  />
                )}
              </Box>
              <Box sx={{ position: "absolute", inset: 0, display: view === "git" ? "block" : "none" }}>
                <GitView
                  cwd={selectedCwd}
                  lastTurnDiffs={lastTurnDiffs}
                  review={selected ? review : undefined}
                  active={view === "git"}
                  onUnstagedStatsChange={setGitUnstaged}
                  bottomInset={contentBottomInset}
                  focusPath={gitFocus.path}
                  focusNonce={gitFocus.nonce}
                  reloadSignal={gitReloadSignal}
                  worktree={worktreeApi}
                />
              </Box>
              {/* Mounted only while active: it derives purely from the thread
                  (no scroll/expanded state to preserve), and keeping it mounted
                  would duplicate file/link text into the hidden DOM. */}
              {view === "resources" && (
                <Box sx={{ position: "absolute", inset: 0 }}>
                  <ResourcesPanel messages={messages} bottomInset={contentBottomInset} />
                </Box>
              )}
              <Box sx={{ position: "absolute", inset: 0, display: view === "preview" ? "block" : "none" }}>
                {selected ? (
                  <BrowserPreview
                    sessionId={selected.id}
                    active={view === "preview"}
                    bridgeActive={view === "preview" || selectedHasActiveWork}
                    onSendAnnotation={sendBrowserAnnotation}
                    onActivityEventsChange={setBrowserActivityEvents}
                    openRequest={browserOpenRequest}
                    serverHostOverride={ws.settings.general.previewServerHost}
                    bottomInset={view === "preview" ? contentBottomInset : 0}
                  />
                ) : null}
              </Box>
              {/* Keyed by folder so each project's terminal keeps its own scrollback. */}
              {showTerminal && (
                <Box sx={{ position: "absolute", inset: 0, display: view === "terminal" ? "block" : "none" }}>
                  <TerminalView key={terminalCwd ?? "none"} cwd={terminalCwd} />
                </Box>
              )}
            </Box>
          </Box>
        </Box>

        {/* The composer floats over the thread (absolute) with a soft fade behind
            it and a gap below, rather than sitting in a bordered bar that pushes
            the thread up. Hidden in the terminal/preview views (composerVisible). */}
        {composerVisible && (
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 8,
            pointerEvents: "none",
            background: (t) => `linear-gradient(to top, ${t.palette.background.default} 46%, ${t.palette.background.default}00)`,
          }}
        >
          <Box
            ref={composerDockRef}
            sx={{ width: "100%", maxWidth: THREAD_MAX_WIDTH, mx: "auto", px: THREAD_PADDING_X, pt: 2.5, pb: 2, pointerEvents: "auto" }}
          >
            {workspaceHydrating ? (
              <Box aria-busy="true" sx={{ minHeight: 44 }} />
            ) : (
              <Composer
                {...composerShared}
                key={ws.selectedId}
                ref={composerRef}
                placeholder={selected ? t("messagePlaceholder", { title: buildComposerLabel(profile) }) : t("startPlaceholder")}
                initialValue={composerDraft.text}
                initialAttachments={composerDraft.attachments}
                onDraftChange={(draft) => {
                  if (selected) {
                    composerDraftPersistence.scheduleDraft(ws.selectedId, draft);
                  }
                }}
                onSend={(text) => {
                  submitComposerText(text);
                }}
                onStop={() => ws.stopRun(ws.selectedId)}
                running={selectedHasActiveWork}
                reviewCount={reviewComments.length}
                onSendReview={sendReviewComments}
                onTagsHeightChange={setComposerTagsHeight}
                onOverlayLiftChange={setComposerOverlayLift}
                history={messageHistory}
                scheduledWakeups={scheduledWakeups}
                queuedContent={selected && selectedQueuedMessages.length > 0 ? (
                  <QueuedMessages
                    messages={selectedQueuedMessages}
                    paused={ws.isQueuePaused(selected.id)}
                    onCancel={(messageId) => ws.cancelQueuedMessage(selected.id, messageId)}
                    onCopy={(message) => messageActions.onCopy?.(message)}
                    onSendNow={() => ws.sendQueuedMessageNow(selected.id)}
                    onTogglePause={() => ws.setQueuePaused(selected.id, !ws.isQueuePaused(selected.id))}
                  />
                ) : undefined}
              />
            )}
          </Box>
        </Box>
        )}
      </Box>

      <AgentPicker open={pickerOpen} value={profile} onClose={() => setPickerOpen(false)} onSelect={handlePicked} />
      <ConversationSearch
        open={searchOpen}
        projects={ws.projects}
        chats={ws.chats}
        onClose={() => setSearchOpen(false)}
        onSelect={openConversation}
      />
      <CommandPalette open={commandPaletteOpen} items={commandItems} onClose={() => setCommandPaletteOpen(false)} />
      <CreateProjectDialog open={projectDialogOpen} defaultProfile={ws.settings.agents.defaultProfile} onClose={() => setProjectDialogOpen(false)} onCreate={handleCreateProject} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={ws.settings}
        onSettingsChange={ws.updateSettings}
        onVoiceConfigChange={voiceConfig.refresh}
      />

      <Dialog open={confirmDelete != null} onClose={() => setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("deleteConversationTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("deleteConversationBody")}</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button variant="text" onClick={() => setConfirmDelete(null)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" color="error" onClick={doDelete}>
            {t("delete")}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
    </ComposerSharedProvider>
    </WorkspaceUiProvider>
  );
});
