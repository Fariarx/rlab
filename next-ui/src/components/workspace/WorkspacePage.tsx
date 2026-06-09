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
import { type DragEvent, type MouseEvent as ReactMouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { I18nProvider, useI18n } from "../../i18n/I18nProvider";
import { normalizeExternalUrl } from "../../lib/external-url";
import { contextWindowForModel } from "../../lib/model-context";
import type { HashRoute } from "../../lib/use-hash-route";
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
  DEFAULT_PROFILE,
  type DiffBlock,
  getAgent,
  normalizeAgentProfile,
  messageToPlainText,
  type ChatMessage,
  type ComposerDraft,
  type ConversationStatus,
  type ConversationSummary,
  type ReviewCommentEntry,
  useAgentCliInfo,
  useAgentStatus,
  useAgentStatusError,
  useAgentStatusLive,
  useReloadAgentStatus,
  agentProfileEquals,
  agentProfileLabels,
} from "../agent";
import { dropIn } from "../agent/anim";
import { SettingsDialog } from "../settings/SettingsDialog";
import { Button, EmptyState, IconButton, useToast } from "../ui";
import { CommandPalette, type CommandPaletteItem } from "./CommandPalette";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { BrowserPreview, type BrowserActivityEvent } from "./BrowserPreview";
import { type DiffCommentApi, GitView } from "./GitPanel";
import { ResourcesPanel } from "./ResourcesPanel";
import { TerminalView } from "./TerminalView";
import { WorkspaceUiProvider, type WorkspaceUiApi } from "./workspace-ui";
import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, normalizeSidebarWidth } from "./app-settings";
import { conversationProfile, type Workspace, useWorkspace } from "./use-workspace";

const COMPOSER_DRAFT_SAVE_DELAY_MS = 350;
const EMPTY_COMPOSER_DRAFT: ComposerDraft = { text: "", attachments: [] };

type WorkspaceView = "chat" | "git" | "resources" | "preview" | "terminal";

async function createWorktree(cwd: string): Promise<{ readonly path: string; readonly branch: string }> {
  const response = await fetch("/api/git-worktree-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const payload = (await response.json().catch(() => ({}))) as { path?: string; branch?: string; error?: string };
  if (!response.ok || !payload.path) {
    throw new Error(payload.error ?? `Worktree create failed (${response.status})`);
  }
  return { path: payload.path, branch: payload.branch ?? "" };
}

async function mergeWorktree(base: string, worktreePath: string): Promise<void> {
  const response = await fetch("/api/git-worktree-merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base, worktreePath }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Worktree merge failed (${response.status})`);
  }
}

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

/** The visible text of a sent user message (attachment blocks and file-link
 *  markdown removed) for ArrowUp history recall. */
function composerHistoryText(raw: string): string {
  return raw
    .replace(/<attachment\s+name="[^"]*"[^>]*>[\s\S]*?<\/attachment>/g, "")
    .replace(/!?\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, _label, target: string) => (/[\\/]/.test(target) || /\.[a-z0-9]{1,8}$/i.test(target) ? "" : whole))
    .trim();
}

function abbreviateLabel(label: string): string {
  return label
    .split(/\s+/)
    .map((w) => (/\d/.test(w) ? w : (w[0]?.toUpperCase() ?? "")))
    .join(" ");
}

function buildComposerLabel(profile: AgentProfile): string {
  const agent = getAgent(profile.agent);
  const labels = agentProfileLabels(profile);
  if (labels.length === 0) {
    return agent?.short ?? profile.agent;
  }
  const joined = labels.join(" · ");
  return joined.length > 24 ? labels.map(abbreviateLabel).join(" · ") : joined;
}

function liveModesOrCatalog<T extends { readonly id: string }>(catalogOptions: readonly T[], liveOptions: readonly T[] | undefined): readonly T[] {
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

function latestAgentDiffBlocks(messages: readonly ChatMessage[]): readonly DiffBlock[] {
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

function conversationHasActiveWork(conversation: ConversationSummary | null, messages: readonly ChatMessage[]): boolean {
  return Boolean(
    conversation &&
      (conversation.activeRunId ||
        messages.some(messageHasLiveAgentWork)),
  );
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
  const { t } = useI18n();
  const { toast } = useToast();
  const statusOf = useAgentStatus();
  const cliInfoOf = useAgentCliInfo();
  const agentStatusLive = useAgentStatusLive();
  const agentStatusError = useAgentStatusError();
  const reloadAgentStatus = useReloadAgentStatus();

  const [searchOpen, setSearchOpen] = useState(false);
  const [profile, setProfile] = useState<AgentProfile>(ws.settings.agents.defaultProfile ?? DEFAULT_PROFILE);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The "+" button opens this menu to pick where a new chat lives (a standalone
  // simple chat, or one of the projects). The chat is created immediately on
  // pick — there's no draft/prelude step.
  const [newChatMenuAnchor, setNewChatMenuAnchor] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [view, setView] = useState<WorkspaceView>("chat");
  // A URL requested from a chat link's "open in preview"; handed to BrowserPreview
  // via a nonce so re-opening the same link re-triggers the load.
  const [browserOpenRequest, setBrowserOpenRequest] = useState<{ readonly url: string; readonly nonce: number }>({ url: "", nonce: 0 });
  // External "open in Git" target + a nonce so re-clicking the same file re-jumps.
  const [gitFocus, setGitFocus] = useState<{ readonly path: string; readonly nonce: number }>({ path: "", nonce: 0 });
  // Bumped to force the Git view to re-fetch status (after a worktree op).
  const [gitReloadSignal, setGitReloadSignal] = useState(0);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  // Unstaged line totals for the header Git-tab badge, reported by the Git view.
  const [gitUnstaged, setGitUnstaged] = useState<{ readonly additions: number; readonly deletions: number }>({ additions: 0, deletions: 0 });
  // Height of the composer's floating tags row; the thread/Git content reserves
  // matching bottom space so the (still-floating) tags never hide content.
  const [composerTagsHeight, setComposerTagsHeight] = useState(0);
  // How far the multiline-input overlay rises above the single-row baseline.
  const [composerOverlayLift, setComposerOverlayLift] = useState(0);
  // Measured height of the floating composer dock (input bar + its outer gap).
  // The thread/Git content reserves matching bottom space so nothing hides
  // behind the now-floating composer.
  const [composerDockHeight, setComposerDockHeight] = useState(0);
  const composerDockRef = useRef<HTMLDivElement | null>(null);
  const contentBottomInset = composerDockHeight + (composerTagsHeight > 0 ? composerTagsHeight + 22 : 0) + composerOverlayLift;
  const showTerminal = ws.settings.appearance.showTerminal ?? false;
  // The terminal has its own command input; the browser preview still uses the
  // composer menu for browser-agent activity.
  const composerVisible = view !== "terminal";
  const [browserActivityEvents, setBrowserActivityEvents] = useState<readonly BrowserActivityEvent[]>([]);
  const showView = (next: WorkspaceView) => setView(next);
  // Pending code-review comments, attached to diff lines in the Git view and sent
  // to the thread as one block (without starting an agent run).
  const [reviewComments, setReviewComments] = useState<readonly ReviewCommentEntry[]>([]);
  const reviewSeq = useRef(0);
  const review: DiffCommentApi = {
    comments: reviewComments,
    onAddComment: (file, line, lineText, body) =>
      setReviewComments((prev) => [...prev, { id: `rc-${++reviewSeq.current}`, file, line, lineText, body }]),
    onUpdateComment: (id, body) => setReviewComments((prev) => prev.map((comment) => (comment.id === id ? { ...comment, body } : comment))),
    onDeleteComment: (id) => setReviewComments((prev) => prev.filter((comment) => comment.id !== id)),
  };
  const sendReviewComments = () => {
    if (selected && reviewComments.length > 0) {
      ws.addReviewComments(ws.selectedId, reviewComments);
      setReviewComments([]);
      showView("chat");
    }
  };
  const [mentionableFiles, setMentionableFiles] = useState<readonly string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => normalizeSidebarWidth(ws.settings.appearance.sidebarWidth));
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [paneDragDepth, setPaneDragDepth] = useState(0);
  const paneDragging = paneDragDepth > 0;
  const composerRef = useRef<ComposerHandle | null>(null);
  const notifiableRuns = useRef(new Set<string>());
  const previousStatuses = useRef(new Map<string, ConversationStatus>());
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarShellRef = useRef<HTMLDivElement | null>(null);
  const sidebarInnerRef = useRef<HTMLDivElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingDraftSaves = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingDraftValues = useRef(new Map<string, ComposerDraft>());

  const selected = ws.find(ws.selectedId);
  const messages = ws.threads[ws.selectedId] ?? [];
  // Sent user messages (oldest first) for ArrowUp/ArrowDown recall in the
  // composer; attachment blocks / file-link markdown are stripped to the visible
  // text, and blank entries dropped.
  const messageHistory = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user")
        .map((message) => composerHistoryText(message.text ?? ""))
        .filter((text) => text.length > 0),
    [messages],
  );
  const selectedHasActiveWork = conversationHasActiveWork(selected, messages);
  const lastTurnDiffs = useMemo(() => latestAgentDiffBlocks(messages), [messages]);
  const composerDraft = ws.composerDrafts[ws.selectedId] ?? { text: "", attachments: [] };
  const selectedCwd = ws.cwdOf(ws.selectedId);
  const sendBrowserAnnotation = (message: string) => {
    if (!selected) {
      return;
    }
    notifiableRuns.current.add(ws.selectedId);
    ws.sendMessage(ws.selectedId, message);
    showView("chat");
  };
  // Workspace navigation handed to deeply nested chat components (markdown links,
  // resource rows) through context — see workspace-ui.tsx.
  const uiApi = useMemo<WorkspaceUiApi>(
    () => ({
      openPreview: (url: string) => {
        // Bare-domain links (vitest.dev/api) must be upgraded to an absolute URL
        // before the browser preview, which only accepts http(s)/about:blank.
        const target = normalizeExternalUrl(url) ?? url;
        setBrowserOpenRequest((prev) => ({ url: target, nonce: prev.nonce + 1 }));
        setView("preview");
      },
      openGitFile: (file: string) => {
        setGitFocus((prev) => ({ path: file, nonce: prev.nonce + 1 }));
        setView("git");
      },
    }),
    [],
  );
  const activeCwd = selectedCwd;
  const headerTitle = selected?.title ?? t("noConversation");
  const accessMode = ws.settings.agents.accessMode;
  const selectedBasePath = ws.basePathOf(ws.selectedId);
  // Worktree controls for the Git tab. Only in unrestricted mode, only for a
  // real project conversation (a base repo path exists).
  const worktreeApi = selected && selectedBasePath
    ? {
        active: accessMode === "unrestricted",
        inWorktree: Boolean(selected.worktreePath),
        busy: worktreeBusy,
        onCreate: () => {
          setWorktreeBusy(true);
          createWorktree(selectedBasePath)
            .then(({ path }) => {
              ws.setWorktree(ws.selectedId, path);
              setGitReloadSignal((value) => value + 1);
              toast({ message: t("worktreeCreatedToast"), severity: "success", duration: 2500 });
            })
            .catch((error) => toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 3500 }))
            .finally(() => setWorktreeBusy(false));
        },
        onMerge: () => {
          const worktreePath = selected.worktreePath;
          if (!worktreePath) {
            return;
          }
          setWorktreeBusy(true);
          mergeWorktree(selectedBasePath, worktreePath)
            .then(() => {
              ws.setWorktree(ws.selectedId, undefined);
              setGitReloadSignal((value) => value + 1);
              toast({ message: t("worktreeMergedToast"), severity: "success", duration: 2500 });
            })
            .catch((error) => toast({ message: error instanceof Error ? error.message : String(error), severity: "error", duration: 4000 }))
            .finally(() => setWorktreeBusy(false));
        },
      }
    : undefined;
  const mode = ws.settings.appearance.theme;
  const routeKind = route?.kind;
  const routeProjectId = route?.kind === "project" ? route.projectId : undefined;
  const routeConversationId = route?.kind === "chat" || route?.kind === "project" ? route.conversationId : undefined;
  const noAgentsAvailable = agentStatusLive && AGENTS.every((agent) => statusOf(agent.id) !== "available" && statusOf(agent.id) !== "running");
  const workspaceHydrating = !ws.loaded;

  const cancelDraftSave = (id: string) => {
    const timer = pendingDraftSaves.current.get(id);
    if (timer) {
      clearTimeout(timer);
      pendingDraftSaves.current.delete(id);
    }
  };

  const flushDraftSave = (id: string) => {
    const draft = pendingDraftValues.current.get(id);
    if (!draft) {
      cancelDraftSave(id);
      return;
    }
    cancelDraftSave(id);
    pendingDraftValues.current.delete(id);
    ws.updateComposerDraft(id, draft);
  };

  const scheduleDraftSave = (id: string, draft: ComposerDraft) => {
    pendingDraftValues.current.set(id, {
      text: draft.text,
      attachments: draft.attachments.map((attachment) => ({ ...attachment })),
    });
    cancelDraftSave(id);
    pendingDraftSaves.current.set(id, setTimeout(() => flushDraftSave(id), COMPOSER_DRAFT_SAVE_DELAY_MS));
  };

  useEffect(() => {
    return () => {
      for (const id of Array.from(pendingDraftValues.current.keys())) {
        flushDraftSave(id);
      }
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (selected) {
      setProfile(conversationProfile(selected));
    } else {
      setProfile(ws.settings.agents.defaultProfile);
    }
  }, [selected, ws.settings.agents.defaultProfile]);

  // Track the floating composer's height so the thread reserves matching bottom
  // space (it scrolls behind the composer instead of being pushed up by it). The
  // composer is unmounted in the terminal/preview views, where the inset is 0.
  useLayoutEffect(() => {
    const node = composerDockRef.current;
    if (!composerVisible || !node) {
      setComposerDockHeight(0);
      return;
    }
    const update = () => setComposerDockHeight(node.offsetHeight);
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [composerVisible]);

  useEffect(() => {
    if (!showTerminal) {
      setView((v) => (v === "terminal" ? "chat" : v));
    }
  }, [showTerminal]);

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

  // Detect a redeploy: poll the server's build version and, when it changes,
  // prompt to reload. A long-lived SPA tab navigates via hash routes and never
  // re-fetches the bundle on its own, so without this it keeps running stale JS
  // after a deploy (the source of "still broken" reports after a fix shipped).
  useEffect(() => {
    let baseline: string | null = null;
    let prompted = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const check = async () => {
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const { version } = (await response.json()) as { version?: string };
        if (!version || version === "dev") {
          return;
        }
        if (baseline === null) {
          baseline = version;
        } else if (version !== baseline && !prompted) {
          prompted = true;
          toast({
            message: t("newVersionAvailable"),
            severity: "info",
            duration: 0,
            action: (
              <Button variant="subtle" size="small" onClick={() => window.location.reload()}>
                {t("reloadApp")}
              </Button>
            ),
          });
        }
      } catch {
        // Offline / transient — ignore and retry on the next tick.
      }
    };
    void check();
    timer = setInterval(check, 60_000);
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [t, toast]);

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

  useLayoutEffect(() => {
    const projectConversationId = routeProjectId
      ? ws.projects.find((project) => project.id === routeProjectId)?.conversations[0]?.id
      : undefined;
    const targetConversationId = routeConversationId ?? (routeKind === "project" ? projectConversationId : undefined);

    if ((routeKind === "chat" || routeKind === "project") && targetConversationId) {
      if (ws.selectedId !== targetConversationId) {
        ws.select(targetConversationId);
      }
      const conv = ws.find(targetConversationId);
      if (conv) {
        setProfile((current) => {
          const nextProfile = conversationProfile(conv);
          return agentProfileEquals(current, nextProfile) ? current : nextProfile;
        });
      }
    }
  }, [routeKind, routeProjectId, routeConversationId, ws.projects, ws.selectedId, ws.select, ws.find]);

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
        // A plain "done" on the conversation you're already looking at is just
        // noise — you can see the result. Only surface done for background runs;
        // keep error / needs-input notifications everywhere (they're actionable).
        const isForeground = conversation.id === ws.selectedId;
        const skip = conversation.status === "done" && isForeground;
        if (!skip) {
          const runToast = runToastForStatus(conversation.status, conversation.title, t);
          if (runToast) {
            toast({ ...runToast, duration: 3500 });
          }
          showDesktopNotification(ws.settings.general.desktopNotifications, runNotificationForStatus(conversation.status, conversation.title, t));
        }
      }
    }
    previousStatuses.current = nextStatuses;
  }, [ws.chats, ws.projects, ws.selectedId, ws.settings.general.desktopNotifications, t, toast]);

  const openConversation = (id: string, updateRoute = true) => {
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

  // Create a new conversation immediately (no draft/prelude step) and focus the
  // composer so the user can start typing right away. `projectId` undefined ⇒ a
  // standalone simple chat; otherwise the chat is created inside that project.
  const createConversation = (projectId?: string) => {
    const newProfile = ws.settings.agents.defaultProfile ?? DEFAULT_PROFILE;
    setProfile(newProfile);
    const id = projectId ? ws.newProjectChat(projectId, newProfile) : ws.newChat(newProfile);
    setNewChatMenuAnchor(null);
    setDrawerOpen(false);
    setView("chat");
    setRunKey((k) => k + 1);
    onNavigate?.(routeForConversation(ws, id));
    // Defer focus until the freshly-created conversation's composer has mounted.
    requestAnimationFrame(() => composerRef.current?.focus());
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
    if (selected) {
      ws.setConversationProfile(ws.selectedId, picked);
    }
  };

  // Per-chat work modes were removed; agents run purely on the access mode.
  const supportedModes: readonly { readonly id: string; readonly label: string }[] = [];
  const handleModeChange = (modeId: string) => {
    const next = normalizeAgentProfile({ ...profile, mode: modeId });
    setProfile(next);
    if (selected) {
      ws.setConversationProfile(ws.selectedId, next);
    }
  };

  const persistedSidebarWidth = normalizeSidebarWidth(ws.settings.appearance.sidebarWidth);
  useEffect(() => {
    if (isResizingSidebar || sidebarWidthRef.current === persistedSidebarWidth) {
      return;
    }
    sidebarWidthRef.current = persistedSidebarWidth;
    setSidebarWidth(persistedSidebarWidth);
  }, [isResizingSidebar, persistedSidebarWidth]);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
    if (sidebarShellRef.current) {
      sidebarShellRef.current.style.width = sidebarCollapsed ? "0px" : `${sidebarWidth}px`;
    }
    if (sidebarInnerRef.current) {
      sidebarInnerRef.current.style.width = `${sidebarWidth}px`;
    }
  }, [sidebarCollapsed, sidebarWidth]);

  const startSidebarResize = (event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    let latestWidth = startWidth;
    setIsResizingSidebar(true);
    const applyWidth = (next: number) => {
      latestWidth = next;
      sidebarWidthRef.current = next;
      if (resizeFrameRef.current != null) {
        return;
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        if (sidebarShellRef.current) {
          sidebarShellRef.current.style.width = `${sidebarWidthRef.current}px`;
        }
        if (sidebarInnerRef.current) {
          sidebarInnerRef.current.style.width = `${sidebarWidthRef.current}px`;
        }
      });
    };
    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + (moveEvent.clientX - startX)));
      applyWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      if (sidebarShellRef.current) {
        sidebarShellRef.current.style.width = `${latestWidth}px`;
      }
      if (sidebarInnerRef.current) {
        sidebarInnerRef.current.style.width = `${latestWidth}px`;
      }
      const normalizedWidth = normalizeSidebarWidth(latestWidth);
      setSidebarWidth(normalizedWidth);
      ws.updateSettings({ appearance: { sidebarWidth: normalizedWidth } });
      setIsResizingSidebar(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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
    // Hide retry while the agent is working (no retrying an in-flight turn);
    // an undefined handler removes the button in MessageActionBar.
    onRetry: selectedHasActiveWork
      ? undefined
      : (message: ChatMessage) => {
          notifiableRuns.current.add(ws.selectedId);
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
      setRunKey((k) => k + 1);
      onNavigate?.(routeForConversation(ws, forkId));
      toast({ message: t("forkedConversationCreated"), severity: "success", duration: 2200 });
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

  const commandItems: readonly CommandPaletteItem[] = [
    {
      id: "new-conversation",
      label: t("commandNewConversation"),
      keywords: [t("newConversation"), t("newChat")],
      shortcut: ["Ctrl", "N"],
      action: () => createConversation(),
    },
    {
      id: "search-conversations",
      label: t("searchConversations"),
      keywords: [t("chats"), t("projects"), "search"],
      action: () => {
        void ws.loadAllThreads();
        setSearchOpen(true);
      },
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
      action: () => showView("git"),
    },
    {
      id: "open-preview",
      label: t("commandOpenPreview"),
      keywords: [t("previewTab"), t("browserPreviewTitle")],
      action: () => showView("preview"),
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
          sx={{ ...WORKSPACE_ERROR_ALERT_SX, maxWidth: 720, width: "100%" }}
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
              onClick={() => {
                void ws.loadAllThreads();
                setSearchOpen(true);
              }}
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

      <ConversationList projects={ws.projects} chats={ws.chats} selectedId={ws.selectedId} onSelect={openConversation} actions={conversationActions} showCost={ws.settings.appearance.showCost} showTokens={ws.settings.appearance.showTokens} />
    </Stack>
  );

  return (
    <WorkspaceUiProvider value={uiApi}>
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
                onChange={(_, next: WorkspaceView | null) => next && showView(next)}
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
                ) : messages.length === 0 ? (
                  <Stack sx={{ height: "100%", justifyContent: "center", alignItems: "center", px: THREAD_PADDING_X }}>
                    <EmptyState
                      icon={<ChatBubbleOutlineIcon />}
                      title={t("startConversation")}
                      description={t(accessMode === "unrestricted" ? "messageAgentAccess" : "messageAgentReadOnlyAccess", { title: selected.title })}
                    />
                  </Stack>
                ) : (
                  <Conversation
                    key={`${ws.selectedId}-${runKey}`}
                    messages={messages}
                    typing={selected.status === "running" && messages[messages.length - 1]?.role === "user"}
                    actions={messageActions}
                    agentProfile={conversationProfile(selected)}
                    displayPrefs={{ showTokens: ws.settings.appearance.showTokens, showCost: ws.settings.appearance.showCost, reasoningAutoExpand: ws.settings.appearance.reasoningAutoExpand }}
                    contentMaxWidth={THREAD_MAX_WIDTH}
                    contentPaddingX={THREAD_PADDING_X}
                    bottomInset={contentBottomInset}
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
                  <TerminalView key={selectedCwd ?? "none"} cwd={selectedCwd} />
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
                key={ws.selectedId}
                ref={composerRef}
                placeholder={selected ? t("messagePlaceholder", { title: buildComposerLabel(profile) }) : t("startPlaceholder")}
                initialValue={composerDraft.text}
                initialAttachments={composerDraft.attachments}
                onDraftChange={(draft) => {
                  if (selected) {
                    scheduleDraftSave(ws.selectedId, draft);
                  }
                }}
                onSend={(text) => {
                  if (!selected) {
                    return;
                  }
                  pendingDraftValues.current.delete(ws.selectedId);
                  cancelDraftSave(ws.selectedId);
                  ws.updateComposerDraft(ws.selectedId, EMPTY_COMPOSER_DRAFT);
                  notifiableRuns.current.add(ws.selectedId);
                  ws.sendMessage(ws.selectedId, text);
                }}
                mentionableFiles={mentionableFiles}
                modes={supportedModes}
                activeMode={profile.mode}
                onModeChange={handleModeChange}
                onStop={() => ws.stopRun(ws.selectedId)}
                onAttachmentError={(message) => toast({ message, severity: "error", duration: 3000 })}
                running={selectedHasActiveWork}
                reviewCount={reviewComments.length}
                onSendReview={sendReviewComments}
                onTagsHeightChange={setComposerTagsHeight}
                onOverlayLiftChange={setComposerOverlayLift}
                history={messageHistory}
                agentId={profile.agent}
                contextTokens={selected?.usage?.contextTokens}
                contextWindow={contextWindowForModel(profile.model)}
                costUsd={selected?.costUsd}
                autoCompact={selected?.compaction?.auto ?? true}
                compactWindow={selected?.compaction?.window}
                onAutoCompactChange={(enabled) => {
                  if (selected) {
                    ws.setCompaction(selected.id, { auto: enabled });
                  }
                }}
                onCompactWindowChange={(window) => {
                  if (selected) {
                    ws.setCompaction(selected.id, { window });
                  }
                }}
                onCompactNow={() => {
                  if (!selected) {
                    return;
                  }
                  if (!ws.compactConversation(selected.id)) {
                    toast({ message: t("compactionNoSession"), severity: "info", duration: 3000 });
                  }
                }}
                browserActivityEvents={view === "preview" ? browserActivityEvents : undefined}
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
        threads={ws.threads}
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
    </WorkspaceUiProvider>
  );
}
