import AddIcon from "@mui/icons-material/Add";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatOutlined";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import MenuIcon from "@mui/icons-material/Menu";
import ReplayIcon from "@mui/icons-material/Replay";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
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
  Drawer,
  Link,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { I18nProvider, useI18n } from "../../i18n/I18nProvider";
import { type HashRoute } from "../../lib/use-hash-route";
import {
  type AgentProfile,
  type ApprovalDecision,
  AGENTS,
  AgentBadge,
  AgentPicker,
  Composer,
  type ComposerHandle,
  Conversation,
  ConversationList,
  ConversationSearch,
  conversationStatusKey,
  DEFAULT_PROFILE,
  getAgent,
  normalizeAgentProfile,
  messageToPlainText,
  type ChatMessage,
  type ConversationStatus,
  type ConversationSummary,
  useAgentStatus,
  useAgentStatusError,
  useAgentStatusLive,
  useReloadAgentStatus,
  agentProfileEquals,
} from "../agent";
import { dropIn } from "../agent/anim";
import { SettingsDialog } from "../settings/SettingsDialog";
import { Button, EmptyState, IconButton, StatusDot, useToast } from "../ui";
import { CommandPalette, type CommandPaletteItem } from "./CommandPalette";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { GitPanel } from "./GitPanel";
import { conversationProfile, type Workspace, useWorkspace } from "./use-workspace";

const SIDEBAR_WIDTH = 300;
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

function projectForConversation(workspace: Workspace, conversationId: string): { readonly id: string; readonly name: string } | null {
  const project = workspace.projects.find((item) => item.conversations.some((conversation) => conversation.id === conversationId));
  return project ? { id: project.id, name: project.name } : null;
}

function routeForConversation(workspace: Workspace, conversationId: string): HashRoute {
  const project = projectForConversation(workspace, conversationId);
  return project ? { kind: "project", projectId: project.id, conversationId } : { kind: "chat", conversationId };
}

function workspaceConversations(workspace: Workspace): readonly ConversationSummary[] {
  return [...workspace.chats, ...workspace.projects.flatMap((project) => project.conversations)];
}

function runToastForStatus(status: ConversationStatus, title: string, t: ReturnType<typeof useI18n>["t"]) {
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

function runNotificationForStatus(status: ConversationStatus, title: string, t: ReturnType<typeof useI18n>["t"]) {
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

function showDesktopNotification(enabled: boolean, notification: { readonly title: string; readonly body: string } | null): void {
  if (!enabled || notification == null || typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }
  new Notification(notification.title, { body: notification.body });
}

export function WorkspacePage() {
  const workspace = useWorkspace();

  return (
    <I18nProvider locale={workspace.settings.general.locale}>
      <WorkspacePageView workspace={workspace} />
    </I18nProvider>
  );
}

export function WorkspacePageView({
  workspace: ws,
  route,
  onNavigate,
}: {
  readonly workspace: Workspace;
  readonly route?: HashRoute;
  readonly onNavigate?: (route: HashRoute) => void;
}) {
  const { t, conversationStatus } = useI18n();
  const { toast } = useToast();
  const statusOf = useAgentStatus();
  const agentStatusLive = useAgentStatusLive();
  const agentStatusError = useAgentStatusError();
  const reloadAgentStatus = useReloadAgentStatus();

  const [searchOpen, setSearchOpen] = useState(false);
  const [profile, setProfile] = useState<AgentProfile>(ws.settings.agents.defaultProfile ?? DEFAULT_PROFILE);
  const [pickerOpen, setPickerOpen] = useState(false);
  // A pending new chat that exists only in the composer until the user sends
  // the first message (then it's created with the current/default agent).
  const [composingNew, setComposingNew] = useState<{ readonly projectId?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [mentionableFiles, setMentionableFiles] = useState<readonly string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [paneDragDepth, setPaneDragDepth] = useState(0);
  const paneDragging = paneDragDepth > 0;
  const composerRef = useRef<ComposerHandle | null>(null);
  const notifiableRuns = useRef(new Set<string>());
  const previousStatuses = useRef(new Map<string, ConversationStatus>());

  const selected = composingNew ? null : ws.find(ws.selectedId);
  const messages = ws.threads[ws.selectedId] ?? [];
  const composerDraft = ws.composerDrafts[ws.selectedId] ?? { text: "", attachments: [] };
  const selectedCwd = ws.cwdOf(ws.selectedId);
  const draftProject = composingNew?.projectId ? ws.projects.find((p) => p.id === composingNew.projectId) ?? null : null;
  const activeCwd = composingNew ? draftProject?.path : selectedCwd;
  const headerTitle = composingNew ? t("newChat") : selected?.title ?? t("noConversation");
  const accessMode = ws.settings.agents.accessMode;
  const mode = ws.settings.appearance.theme;
  const routeKind = route?.kind;
  const routeConversationId = route && (route.kind === "chat" || route.kind === "project") ? route.conversationId : undefined;
  const noAgentsAvailable = agentStatusLive && AGENTS.every((agent) => statusOf(agent.id) !== "available" && statusOf(agent.id) !== "running");

  useEffect(() => {
    if (selected) {
      setProfile(conversationProfile(selected));
    } else {
      setProfile(ws.settings.agents.defaultProfile);
    }
  }, [selected, ws.settings.agents.defaultProfile]);

  useEffect(() => {
    let alive = true;
    if (!activeCwd) {
      setMentionableFiles([]);
      return;
    }

    fetch("/api/project-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: activeCwd }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { files?: string[]; error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? t("projectFilesUnavailable"));
        }
        if (alive) {
          setMentionableFiles(payload.files ?? []);
        }
      })
      .catch((error) => {
        if (alive) {
          setMentionableFiles([]);
          toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
        }
      });

    return () => {
      alive = false;
    };
  }, [activeCwd, t, toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if ((routeKind === "chat" || routeKind === "project") && routeConversationId) {
      if (ws.selectedId !== routeConversationId) {
        ws.select(routeConversationId);
      }
      const conv = ws.find(routeConversationId);
      if (conv) {
        setProfile((current) => {
          const nextProfile = conversationProfile(conv);
          return agentProfileEquals(current, nextProfile) ? current : nextProfile;
        });
      }
    }
  }, [routeKind, routeConversationId, ws.selectedId, ws.select, ws.find]);

  useEffect(() => {
    const conversations = workspaceConversations(ws);
    const nextStatuses = new Map(conversations.map((conversation) => [conversation.id, conversation.status]));
    for (const conversation of conversations) {
      const previousStatus = previousStatuses.current.get(conversation.id);
      const activeRunStatusChanged =
        previousStatus !== undefined &&
        previousStatus !== conversation.status &&
        (previousStatus === "running" || previousStatus === "waiting") &&
        conversation.status !== "running";
      if (
        activeRunStatusChanged &&
        notifiableRuns.current.has(conversation.id)
      ) {
        if (conversation.status !== "waiting") {
          notifiableRuns.current.delete(conversation.id);
        }
        const runToast = runToastForStatus(conversation.status, conversation.title, t);
        if (runToast) {
          toast({ ...runToast, duration: 3500 });
        }
        showDesktopNotification(ws.settings.general.desktopNotifications, runNotificationForStatus(conversation.status, conversation.title, t));
      }
    }
    previousStatuses.current = nextStatuses;
  }, [ws.chats, ws.projects, ws.settings.general.desktopNotifications, t, toast]);

  const openConversation = (id: string, updateRoute = true) => {
    setComposingNew(null);
    ws.select(id);
    const conv = ws.find(id);
    if (conv) {
      setProfile(conversationProfile(conv));
    }
    if (updateRoute) {
      onNavigate?.(routeForConversation(ws, id));
    }
    setDrawerOpen(false);
    setRunKey((k) => k + 1);
  };

  // Start a new chat using the default agent without a confirmation dialog. The
  // conversation isn't created until the user sends the first message.
  const startNewChat = () => {
    setProfile(ws.settings.agents.defaultProfile ?? DEFAULT_PROFILE);
    setComposingNew({});
    setDrawerOpen(false);
  };

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

  // The picker now only switches the agent (for the draft or the open
  // conversation); new chats default to the configured agent.
  const handlePicked = (picked: AgentProfile) => {
    setProfile(picked);
    if (!composingNew && selected) {
      ws.setConversationProfile(ws.selectedId, picked);
    }
  };

  // Work mode is toggled per chat from the composer (not the agent picker).
  const supportedModes = getAgent(profile.agent).modes.filter((mode) => mode.id !== "default").map((mode) => ({ id: mode.id, label: mode.label }));
  const handleModeChange = (modeId: string) => {
    const next = normalizeAgentProfile({ ...profile, mode: modeId });
    setProfile(next);
    if (!composingNew && selected) {
      ws.setConversationProfile(ws.selectedId, next);
    }
  };

  // Files can be dropped anywhere on the chat pane; the whole pane dims and the
  // dropped files are handed to the active composer.
  const paneDragHasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types ?? []).includes("Files");
  const onPaneDragEnter = (event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    setPaneDragDepth((depth) => depth + 1);
  };
  const onPaneDragOver = (event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onPaneDragLeave = (event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    setPaneDragDepth((depth) => Math.max(0, depth - 1));
  };
  const onPaneDrop = (event: DragEvent) => {
    if (!paneDragHasFiles(event)) {
      return;
    }
    event.preventDefault();
    setPaneDragDepth(0);
    void composerRef.current?.addFiles(Array.from(event.dataTransfer.files));
  };

  const handleCreateProject = (input: Parameters<typeof ws.createProject>[0]) => {
    try {
      const created = ws.createProject(input);
      setComposingNew(null);
      onNavigate?.({ kind: "project", projectId: created.projectId, conversationId: created.conversationId });
      setRunKey((k) => k + 1);
      toast({ message: t("newProjectChatWith", { agent: input.profile.agent, project: input.name }), severity: "info", duration: 2500 });
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
    }
  };

  const conversationActions = {
    onRename: ws.rename,
    onTogglePin: ws.togglePin,
    onArchive: (id: string) => {
      ws.remove(id);
      toast({ message: t("conversationArchived"), severity: "info", duration: 2500 });
    },
    onDelete: (id: string) => {
      if (ws.settings.general.confirmDestructiveActions) {
        setConfirmDelete(id);
        return;
      }
      ws.remove(id);
      toast({ message: t("conversationDeleted"), severity: "warning", duration: 2500 });
    },
  };

  const doDelete = () => {
    if (confirmDelete) {
      ws.remove(confirmDelete);
      setConfirmDelete(null);
      toast({ message: t("conversationDeleted"), severity: "warning", duration: 2500 });
    }
  };

  const messageActions = {
    onCopy: async (message: ChatMessage) => {
      try {
        await navigator.clipboard.writeText(messageToPlainText(message));
        toast({ message: t("messageCopied"), severity: "success", duration: 1800 });
      } catch {
        toast({ message: t("clipboardUnavailable"), severity: "error", duration: 2500 });
      }
    },
    onRetry: (message: ChatMessage) => {
      notifiableRuns.current.add(ws.selectedId);
      ws.retryMessage(ws.selectedId, message.id);
    },
    onEditAndResend: (message: ChatMessage, text: string) => {
      notifiableRuns.current.add(ws.selectedId);
      ws.editAndResendMessage(ws.selectedId, message.id, text);
    },
    onApprovalDecision: async (approvalId: string, decision: ApprovalDecision) => {
      try {
        const response = await fetch("/api/run-approval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: approvalId, decision }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Approval decision failed (${response.status})`);
        }
        ws.decideApproval(ws.selectedId, approvalId, decision);
      } catch (error) {
        toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
        throw error;
      }
    },
    onOptionSelection: async (optionBlockId: string, selectedLabels: readonly string[]) => {
      try {
        const response = await fetch("/api/run-input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: optionBlockId, selected: selectedLabels }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Option selection failed (${response.status})`);
        }
        ws.selectOptions(ws.selectedId, optionBlockId, selectedLabels);
      } catch (error) {
        toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3000 });
        throw error;
      }
    },
  };

  const retryLastUserMessage = () => {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
    if (lastUserMessage) {
      notifiableRuns.current.add(ws.selectedId);
      ws.retryMessage(ws.selectedId, lastUserMessage.id);
    }
  };

  const commandItems: readonly CommandPaletteItem[] = [
    {
      id: "new-conversation",
      label: t("commandNewConversation"),
      keywords: [t("newConversation"), t("newChat")],
      shortcut: ["Ctrl", "N"],
      action: startNewChat,
    },
    {
      id: "search-conversations",
      label: t("searchConversations"),
      keywords: [t("chats"), t("projects"), "search"],
      action: () => setSearchOpen(true),
    },
    {
      id: "open-settings",
      label: t("commandOpenSettings"),
      keywords: [t("settings"), t("appearance"), t("general")],
      shortcut: ["Ctrl", ","],
      action: () => setSettingsOpen(true),
    },
    {
      id: "open-git",
      label: t("commandOpenGit"),
      keywords: [t("git"), t("gitStatus")],
      action: () => setGitOpen(true),
    },
    {
      id: "toggle-theme",
      label: t("commandToggleTheme"),
      keywords: [t("theme"), t("dark"), t("light")],
      action: () => ws.updateSettings({ appearance: { theme: mode === "dark" ? "light" : "dark" } }),
    },
    {
      id: "open-kit",
      label: t("commandOpenKit"),
      keywords: [t("kit")],
      action: openKit,
    },
  ];

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
          sx={{ maxWidth: 720 }}
        >
          {t("workspaceError", { error: ws.loadError })}
        </Alert>
      </Box>
    );
  }

  const sidebar = (
    <Stack sx={{ height: "100%", minHeight: 0, backgroundColor: (t) => t.custom.surfaces.s1 }}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", px: SIDEBAR_INSET, minHeight: HEADER_MIN_HEIGHT, flex: "0 0 auto", borderBottom: (t) => `1px solid ${t.custom.borders.subtle}` }}
      >
        <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontWeight: 700, fontSize: "0.9rem" }}>{t("appTitle")}</Typography>
        <Stack direction="row" spacing={0.25}>
          <Tooltip title={t("searchConversations")}>
            <IconButton aria-label={t("searchConversations")} onClick={() => setSearchOpen(true)}>
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
            <IconButton aria-label={t("newConversation")} onClick={startNewChat}>
              <AddIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <ConversationList projects={ws.projects} chats={ws.chats} selectedId={ws.selectedId} onSelect={openConversation} actions={conversationActions} />
    </Stack>
  );

  return (
    <Box sx={{ height: "100dvh", display: "flex", overflow: "hidden", bgcolor: "background.default" }}>
      <Box sx={{ display: { xs: "none", md: "block" }, width: SIDEBAR_WIDTH, flex: "0 0 auto", borderRight: (t) => `1px solid ${t.custom.borders.subtle}` }}>{sidebar}</Box>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} sx={{ display: { md: "none" } }} slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH, backgroundImage: "none" } } }}>
        {sidebar}
      </Drawer>

      <Box
        sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}
        onDragEnter={onPaneDragEnter}
        onDragOver={onPaneDragOver}
        onDragLeave={onPaneDragLeave}
        onDrop={onPaneDrop}
      >
        {paneDragging && (
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
              <IconButton aria-label={t("openConversations")} onClick={() => setDrawerOpen(true)} sx={{ display: { md: "none" } }}>
                <MenuIcon sx={{ fontSize: 20 }} />
              </IconButton>
              {selected && (
                <StatusDot status={conversationStatusKey[selected.status]} label={conversationStatus(selected.status)} pulse={selected.status === "running"} />
              )}
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
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: "0 0 auto", "& .MuiIconButton-root": { width: 30, height: 30 } }}>
              {(selected || composingNew) && <AgentBadge profile={profile} onClick={openPicker} compact />}
              <Tooltip title={t("git")}>
                <IconButton tone="subtle" aria-label={t("git")} onClick={() => setGitOpen(true)}>
                  <AccountTreeIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("replay")}>
                <IconButton tone="subtle" aria-label={t("replay")} onClick={() => setRunKey((k) => k + 1)}>
                  <ReplayIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              {selected?.status === "error" && (
                <Tooltip title={t("retryRun")}>
                  <IconButton tone="subtle" aria-label={t("retryRun")} onClick={retryLastUserMessage}>
                    <RestartAltIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={mode === "dark" ? t("toggleThemeDark") : t("toggleThemeLight")}>
                <IconButton
                  tone="subtle"
                  aria-label={mode === "dark" ? t("toggleThemeDark") : t("toggleThemeLight")}
                  onClick={() => ws.updateSettings({ appearance: { theme: mode === "dark" ? "light" : "dark" } })}
                >
                  {mode === "dark" ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Link href="#/kit" underline="hover" sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.78rem", display: { xs: "none", sm: "block" } }}>
                {t("kit")}
              </Link>
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
                sx={{ mb: 2 }}
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
            <Box sx={{ flex: 1, minHeight: 0 }}>
              {composingNew ? (
                <Stack sx={{ height: "100%", justifyContent: "center", alignItems: "center", px: THREAD_PADDING_X }}>
                  <EmptyState
                    icon={<ChatBubbleOutlineIcon />}
                    title={t("startConversation")}
                    description={t(accessMode === "read-write" ? "messageAgentAccess" : "messageAgentReadOnlyAccess", { title: draftProject?.name ?? t("newChat") })}
                  />
                </Stack>
              ) : !selected ? (
                <Stack sx={{ height: "100%", justifyContent: "center", alignItems: "center", px: THREAD_PADDING_X }}>
                  <EmptyState
                    icon={<ChatBubbleOutlineIcon />}
                    title={t("noConversationSelected")}
                    description={t("pickConversation")}
                    action={<Button variant="contained" onClick={startNewChat}>{t("newChat")}</Button>}
                  />
                </Stack>
              ) : messages.length === 0 ? (
                <Stack sx={{ height: "100%", justifyContent: "center", alignItems: "center", px: THREAD_PADDING_X }}>
                  <EmptyState
                    icon={<ChatBubbleOutlineIcon />}
                    title={t("startConversation")}
                    description={t(accessMode === "read-write" ? "messageAgentAccess" : "messageAgentReadOnlyAccess", { title: selected.title })}
                  />
                </Stack>
              ) : (
                <Conversation
                  key={`${ws.selectedId}-${runKey}`}
                  messages={messages}
                  typing={selected.status === "running" && messages[messages.length - 1]?.role === "user"}
                  actions={messageActions}
                  contentMaxWidth={THREAD_MAX_WIDTH}
                  contentPaddingX={THREAD_PADDING_X}
                />
              )}
            </Box>
          </Box>
        </Box>

        <Box sx={{ flex: "0 0 auto", borderTop: (t) => `1px solid ${t.custom.borders.subtle}`, backgroundColor: (t) => t.custom.surfaces.s1 }}>
          <Box sx={{ width: "100%", maxWidth: THREAD_MAX_WIDTH, mx: "auto", px: THREAD_PADDING_X, py: 1.5 }}>
            {composingNew ? (
              <Composer
                key="new-draft"
                ref={composerRef}
                placeholder={t("startPlaceholder")}
                onSend={(text) => {
                  const id = composingNew.projectId ? ws.newProjectChat(composingNew.projectId, profile) : ws.newChat(profile);
                  setComposingNew(null);
                  notifiableRuns.current.add(id);
                  ws.sendMessage(id, text);
                  setRunKey((k) => k + 1);
                  onNavigate?.(routeForConversation(ws, id));
                }}
                mentionableFiles={mentionableFiles}
                modes={supportedModes}
                activeMode={profile.mode}
                onModeChange={handleModeChange}
                onAttachmentError={(message) => toast({ message, severity: "error", duration: 3000 })}
              />
            ) : (
              <Composer
                ref={composerRef}
                placeholder={selected ? t("messagePlaceholder", { title: selected.title }) : t("startPlaceholder")}
                value={composerDraft.text}
                attachments={composerDraft.attachments}
                onDraftChange={(draft) => {
                  if (selected) {
                    ws.updateComposerDraft(ws.selectedId, draft);
                  }
                }}
                onSend={(text) => {
                  if (selected) {
                    notifiableRuns.current.add(ws.selectedId);
                    ws.sendMessage(ws.selectedId, text);
                  }
                }}
                mentionableFiles={mentionableFiles}
                modes={supportedModes}
                activeMode={profile.mode}
                onModeChange={handleModeChange}
                onStop={() => ws.stopRun(ws.selectedId)}
                onAttachmentError={(message) => toast({ message, severity: "error", duration: 3000 })}
                running={selected?.status === "running"}
              />
            )}
          </Box>
        </Box>
      </Box>

      <AgentPicker open={pickerOpen} value={profile} onClose={() => setPickerOpen(false)} onSelect={handlePicked} />
      <ConversationSearch
        open={searchOpen}
        projects={ws.projects}
        chats={ws.chats}
        threads={ws.threads}
        onClose={() => setSearchOpen(false)}
        onSelect={openConversation}
      />
      <GitPanel open={gitOpen} cwd={selectedCwd} onClose={() => setGitOpen(false)} />
      <CommandPalette open={commandPaletteOpen} items={commandItems} onClose={() => setCommandPaletteOpen(false)} />
      <CreateProjectDialog open={projectDialogOpen} defaultProfile={ws.settings.agents.defaultProfile} onClose={() => setProjectDialogOpen(false)} onCreate={handleCreateProject} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={ws.settings}
        onSettingsChange={ws.updateSettings}
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
  );
}
